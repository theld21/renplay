import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { Catalog } from '../catalog/catalog.js'
import type { Config } from '../config.js'
import type { Db } from '../db.js'
import type { JobContext, JobManager } from '../jobs/manager.js'
import { downloadCatalogGame, type CatalogDownloadParams } from '../library/itch.js'
import { downloadable } from '../shared/recipe.js'
import type { Recipe } from '../shared/recipe.js'

const FILE = Buffer.from('a game download')
const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: 'free-game', title: 'Free Game', engine: 'renpy', free: true,
  links: { itch: 'https://dev.itch.io/free-game' },
  releases: [
    { version: '2.0', status: 'untested', archives: [{ name: 'FreeGame-2.0-pc.zip' }] },
    { version: '1.0', status: 'playable', archives: [{ name: 'FreeGame-1.0-mac.zip' }, { name: 'FreeGame-1.0-pc.zip', size: FILE.length, sha256: createHash('sha256').update(FILE).digest('hex') }] },
  ],
  ...over,
} as Recipe)

// itch.io as the server sees it: the game page with its session cookie and token, the file's
// address for that session, and the file.
function itch(page: string) {
  const asked: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    asked.push(`${init.method ?? 'GET'} ${url}`)
    const cookie = new Headers(init.headers).get('cookie') ?? ''
    if (url === 'https://dev.itch.io/free-game') return new Response(page, { headers: { 'set-cookie': 'itchio_token=abc; Path=/' } })
    if (url.startsWith('https://dev.itch.io/free-game/file/7?')) {
      const token = (init.body as URLSearchParams).get('csrf_token')
      if (token !== 'T' || !cookie.includes('itchio_token=abc')) return Response.json({ errors: ['invalid csrf token'] })
      return Response.json({ url: 'https://files.example/FreeGame-1.0-pc.zip' })
    }
    if (url === 'https://files.example/FreeGame-1.0-pc.zip') return new Response(FILE, { headers: { 'content-length': String(FILE.length) } })
    return new Response('not found', { status: 404 })
  }))
  return asked
}

const PAGE = '<meta name="csrf_token" value="T" /><div class="upload"><a data-upload_id="6">Download</a><strong title="FreeGame-1.0-mac.zip" class="name">mac</strong></div>'
  + '<div class="upload"><a data-upload_id="7">Download</a><strong title="FreeGame-1.0-pc.zip" class="name">pc</strong></div>'

const roots: string[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

function run(r: Recipe) {
  const root = mkdtempSync(join(tmpdir(), 'renplay-itch-')); roots.push(root)
  const enqueue = vi.fn(() => 'install-job')
  const ctx: JobContext<CatalogDownloadParams> = { id: 'j', params: { recipeId: r.id }, signal: new AbortController().signal, progress() {}, log() {}, checkAbort() {} }
  const marked: string[] = []
  const deps = { cfg: { archivesDir: root } as Config, db: { markUploadedArchive: (rel: string) => marked.push(rel) } as unknown as Db, catalog: { recipe: () => r } as unknown as Catalog, jobs: { enqueue } as unknown as JobManager }
  return { root, enqueue, marked, result: downloadCatalogGame(ctx, deps) }
}

it('picks the newest tested PC download of a free itch.io game, and nothing else', () => {
  expect(downloadable(recipe())).toMatchObject({ release: { version: '1.0' }, archive: { name: 'FreeGame-1.0-pc.zip' }, page: 'https://dev.itch.io/free-game' })
  expect(downloadable(recipe({ free: false }))).toBeNull()
  expect(downloadable(recipe({ links: { patreon: 'https://patreon.com/dev' } }))).toBeNull()
  expect(downloadable(recipe({ links: { itch: 'https://evil.example/free-game' } }))).toBeNull()
})

it('downloads the tested file the way the Download button does, checks it and queues its install', async () => {
  const asked = itch(PAGE)
  const { root, enqueue, marked, result } = run(recipe())
  await expect(result).resolves.toEqual({ archive: 'FreeGame-1.0-pc.zip', install: 'install-job' })
  // It counts as an upload: with Keep downloads off it is deleted once the game installed.
  expect(marked).toEqual(['FreeGame-1.0-pc.zip'])
  expect(readFileSync(join(root, 'FreeGame-1.0-pc.zip'))).toEqual(FILE)
  expect(enqueue).toHaveBeenCalledWith('import', '', expect.objectContaining({ source: { kind: 'archive', path: 'FreeGame-1.0-pc.zip' }, recipeId: 'free-game' }))
  expect(asked).toContain('POST https://dev.itch.io/free-game/file/7?source=view_game&as_props=1&after_download_lightbox=true')
})

it('keeps nothing when the file is not the one the catalog tested', async () => {
  itch(PAGE)
  const r = recipe()
  r.releases[1]!.archives[1]!.sha256 = '0'.repeat(64)
  const { root, enqueue, result } = run(r)
  await expect(result).rejects.toThrow('checksum')
  expect(existsSync(join(root, 'FreeGame-1.0-pc.zip')) || existsSync(join(root, 'FreeGame-1.0-pc.zip.part'))).toBe(false)
  expect(enqueue).not.toHaveBeenCalled()
})

it('says so when itch.io no longer has the tested file', async () => {
  itch(PAGE.replace('FreeGame-1.0-pc.zip', 'FreeGame-3.0-pc.zip'))
  await expect(run(recipe()).result).rejects.toThrow('no file named FreeGame-1.0-pc.zip')
})
