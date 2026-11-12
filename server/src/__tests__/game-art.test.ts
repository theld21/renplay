import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import yazl from 'yazl'
import { createApp, type App } from '../app.js'
import { GameArt } from '../art/fromgame.js'
import type { ArtStore } from '../art/store.js'
import { loadConfig } from '../config.js'
import type { GameRow } from '../db.js'
import type { Builds } from '../games/builds.js'

// This fork's own: a game outside the catalog gets its title screen as art, and an admin can rename it.

const noise = (width: number, height: number, channels: 3 | 4 = 3) =>
  sharp(Buffer.from(Array.from({ length: width * height * channels }, () => Math.floor(Math.random() * 256))), { raw: { width, height, channels } }).png().toBuffer()
const plain = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#222' } }).png().toBuffer()

function zip(entries: Record<string, Buffer>): Promise<Buffer> {
  return new Promise((resolve) => {
    const z = new yazl.ZipFile()
    for (const [name, data] of Object.entries(entries)) z.addBuffer(data, name)
    z.end()
    const chunks: Buffer[] = []
    z.outputStream.on('data', (c: Buffer) => chunks.push(c))
    z.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
  })
}
/** A build folder: its pack of streamed files and its game.zip. */
async function build(dir: string, pack: Record<string, Buffer>, zipped: Record<string, Buffer> = {}) {
  mkdirSync(dir, { recursive: true })
  const index: Record<string, [number, number]> = {}
  let at = 0
  for (const [name, data] of Object.entries(pack)) {
    index[name] = [at, data.length]
    at += data.length
  }
  writeFileSync(join(dir, 'assets.pack'), Buffer.concat(Object.values(pack)))
  writeFileSync(join(dir, 'assets.json'), JSON.stringify(index))
  writeFileSync(join(dir, 'game.zip'), await zip(zipped))
}
function gameArt(dir: string, has = false) {
  const given: Array<{ kind: string; scope: number; size: number }> = []
  const art = {
    upload: async (_game: string, kind: string, data: Buffer, _focal: unknown, scope: number) => (given.push({ kind, scope, size: data.length }), { id: `${kind}-id`, warning: null }),
    choose: () => {},
  } as unknown as ArtStore
  return { given, art: new GameArt(art, { dir: () => dir } as unknown as Builds, () => has) }
}
const row = (family: string) => ({ id: 'g', title: 'G', build: 'b1', status: 'installed', family }) as GameRow

describe('art from a game\'s own files', () => {
  const root = mkdtempSync(join(tmpdir(), 'renplay-game-art-'))

  it('takes a Ren\'Py game\'s title screen and window icon, not a plain menu picture', async () => {
    const dir = join(root, 'renpy')
    const title = await noise(1280, 720)
    await build(dir, { 'images/ui/title_bg.png': title, 'images/bg/street.png': await noise(1280, 720) }, { 'game/gui/main_menu.png': await plain(1920, 1080), 'game/gui/window_icon.png': await noise(256, 256), 'game/gui/overlay/main_menu.png': await noise(1280, 720) })
    const { given, art } = gameArt(dir)
    await art.give(row('renpy'))
    expect(given).toEqual([{ kind: 'wide', scope: 0, size: title.length }, { kind: 'icon', scope: 0, size: expect.any(Number) }])
  })

  it('takes an RPG Maker game\'s title picture from System.json', async () => {
    const dir = join(root, 'rpgm')
    const title = await noise(816, 624)
    await build(dir, { 'data/System.json': Buffer.from(JSON.stringify({ title1Name: 'Castle' })), 'img/titles1/Castle.png': title, 'img/titles1/Beach.png': await noise(816, 624) })
    const { given, art } = gameArt(dir)
    await art.give(row('html'))
    expect(given).toEqual([{ kind: 'wide', scope: 0, size: title.length }])
  })

  it('takes the first picture named after the title RPG Maker names, when that one is not there', async () => {
    const dir = join(root, 'rpgm-random')
    const first = await noise(816, 624)
    await build(dir, { 'data/System.json': Buffer.from(JSON.stringify({ title1Name: 'title' })), 'img/titles1/title01.png': first, 'img/titles1/title02.png': await noise(816, 624) })
    const { given, art } = gameArt(dir)
    await art.give(row('html'))
    expect(given).toEqual([{ kind: 'wide', scope: 0, size: first.length }])
  })

  it('leaves a game that has pictures alone', async () => {
    const { given, art } = gameArt(join(root, 'renpy'), true)
    await art.give(row('renpy'))
    expect(given).toEqual([])
  })
})

describe('a game\'s name', () => {
  let app: App
  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'renplay-game-name-'))
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    app = await createApp(loadConfig(), { startJobs: false })
    app.db.insertGame({ id: 'named', title: 'Named_Game?', status: 'installed' })
  })
  afterAll(() => app?.close())

  it('is the one an admin gives it, until it gets its own back', async () => {
    let res = await request(app.app).put('/api/games/named/title').send({ title: '  Named   Game ' }).expect(200)
    expect(res.body.game).toMatchObject({ title: 'Named Game', renamed: true })
    res = await request(app.app).get('/api/games/named').expect(200)
    expect(res.body.game.title).toBe('Named Game')
    res = await request(app.app).put('/api/games/named/title').send({ title: '' }).expect(200)
    expect(res.body.game).toMatchObject({ title: 'Named_Game?', renamed: false })
    await request(app.app).put('/api/games/named/title').send({ title: 5 }).expect(400)
  })
})
