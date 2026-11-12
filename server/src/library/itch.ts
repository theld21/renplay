import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Config } from '../config.js'
import type { Db } from '../db.js'
import type { Catalog } from '../catalog/catalog.js'
import type { JobContext, JobManager } from '../jobs/manager.js'
import { enqueueImport } from '../pipeline/import.js'
import { downloadable, type RecipeArchive } from '../shared/recipe.js'
import { archiveIdentity } from './archives.js'
import { cleanRelPath, safeJoin } from '../util/paths.js'

/**
 * Downloads from itch.io for catalog games that are free there. File hosts tie a download link
 * to the browser that asked for it, but itch.io's own Download button for a free game asks the
 * game page for the file's address with the page's session, which the server can do too. The
 * download must be the catalog's tested archive, by name, and its size and checksum when known.
 */

const AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 Renplay'

/** A tiny cookie jar: itch.io checks its CSRF token against the session cookie. */
class Session {
  private cookies = new Map<string, string>()
  async fetch(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('user-agent', AGENT)
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '))
    const res = await fetch(url, { ...init, headers, redirect: 'follow', signal })
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';')
      const at = pair!.indexOf('=')
      if (at > 0) this.cookies.set(pair!.slice(0, at).trim(), pair!.slice(at + 1).trim())
    }
    return res
  }
}

const csrfOf = (html: string) => /name="csrf_token" value="([^"]+)"/.exec(html)?.[1]

function uploadsOf(html: string): Array<{ id: string; name: string }> {
  return [...html.matchAll(/data-upload_id="(\d+)"[\s\S]{0,3000}?<strong title="([^"]+)"/g)].map((m) => ({ id: m[1]!, name: m[2]! }))
}

/** The address of a free game's upload with this file name, as the Download button gets it. */
async function itchFileUrl(page: string, name: string, signal?: AbortSignal): Promise<string> {
  const session = new Session()
  const form = (csrf: string) => ({ method: 'POST', body: new URLSearchParams({ csrf_token: csrf }), headers: { 'x-requested-with': 'XMLHttpRequest', referer: page } })
  const html = await (await session.fetch(page, {}, signal)).text()
  const csrf = csrfOf(html)
  if (!csrf) throw new Error('itch.io did not show the game page. Try again later.')
  let uploads = uploadsOf(html)
  if (!uploads.length) {
    // "Name your price" games list their files on a download page.
    const asked = (await (await session.fetch(`${page}/download_url`, form(csrf), signal)).json()) as { url?: string }
    if (!asked.url) throw new Error('itch.io offers no free download for this game')
    uploads = uploadsOf(await (await session.fetch(asked.url, {}, signal)).text())
  }
  const upload = uploads.find((u) => u.name === name) ?? uploads.find((u) => u.name.toLowerCase() === name.toLowerCase())
  if (!upload) throw new Error(`itch.io has no file named ${name} for this game. The developer may have released a newer version.`)
  const { origin, pathname } = new URL(page)
  const slug = pathname.split('/').filter(Boolean).pop()!
  const res = await session.fetch(`${origin}/${slug}/file/${upload.id}?source=view_game&as_props=1&after_download_lightbox=true`, form(csrf), signal)
  const answer = (await res.json().catch(() => ({}))) as { url?: string; errors?: string[] }
  if (!answer.url) throw new Error(`itch.io refused the download${answer.errors?.length ? `: ${answer.errors.join(', ')}` : ''}`)
  return answer.url
}

/** A file already in the downloads folder is used when it is the tested one (checksum, or size). */
async function isTested(path: string, archive: RecipeArchive): Promise<boolean> {
  const st = await stat(path).catch(() => null)
  if (!st || (archive.size && st.size !== archive.size)) return false
  if (!archive.sha256) return !!archive.size
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex') === archive.sha256.toLowerCase()
}

export interface CatalogDownloadParams {
  recipeId: string
}

/** The Download job: fetches the catalog's tested archive into the downloads folder, then installs it. */
export async function downloadCatalogGame(
  ctx: JobContext<CatalogDownloadParams>,
  s: { cfg: Config; db: Db; catalog: Catalog; jobs: JobManager },
): Promise<{ archive: string; install: string }> {
  const recipe = s.catalog.recipe(ctx.params.recipeId)
  const pick = recipe ? downloadable(recipe) : null
  if (!recipe || !pick) throw new Error('This game has no free download on itch.io that the catalog tested')
  const rel = cleanRelPath(pick.archive.name)
  const dest = safeJoin(s.cfg.archivesDir, rel)
  if (await isTested(dest, pick.archive)) {
    ctx.log(`${rel} is already in the downloads folder`)
  } else {
    ctx.progress('Asking itch.io for the file', 0)
    const url = await itchFileUrl(pick.page, pick.archive.name, ctx.signal)
    ctx.log(`Downloading ${rel} (${recipe.title} ${pick.release.version}) from itch.io`)
    const res = await fetch(url, { headers: { 'user-agent': AGENT }, signal: ctx.signal })
    if (!res.ok || !res.body) throw new Error(`itch.io answered ${res.status} for the file`)
    const total = Number(res.headers.get('content-length')) || pick.archive.size || 0
    const part = `${dest}.part`
    await mkdir(dirname(dest), { recursive: true })
    const hash = createHash('sha256')
    let got = 0
    const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>)
    body.on('data', (chunk: Buffer) => {
      got += chunk.length
      hash.update(chunk)
      ctx.progress('Downloading', total ? got / total : 0, `${Math.floor(got / 1e6)} of ${Math.floor(total / 1e6)} MB`)
    })
    try {
      await pipeline(body, createWriteStream(part))
      if (pick.archive.size && got !== pick.archive.size) throw new Error(`The download has ${got} bytes, the catalog expects ${pick.archive.size}`)
      const sha256 = hash.digest('hex')
      if (pick.archive.sha256 && sha256 !== pick.archive.sha256.toLowerCase()) throw new Error('The download is not the file the catalog tested (its checksum differs)')
      await rename(part, dest)
      // Like an upload: with Keep downloads off, it goes once the game installed.
      s.db.markUploadedArchive(rel, archiveIdentity(await stat(dest)))
    } catch (error) {
      await rm(part, { force: true })
      throw error
    }
    ctx.log(`Downloaded ${Math.round(got / 1e6)} MB`)
  }
  const install = enqueueImport(s.jobs, { source: { kind: 'archive', path: rel }, recipeId: recipe.id, reapplyMods: true })
  ctx.log('Install queued')
  return { archive: rel, install }
}
