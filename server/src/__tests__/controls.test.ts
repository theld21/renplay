import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'
import { defaultLayout, normalizeLayout } from '../shared/controls.js'
import { htmlRuntime } from './runtime-browser.js'

// This fork's own on-screen controls: the layouts kept per person and game, and the keys they press.

describe('on-screen control layouts', () => {
  let app: App
  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'renplay-controls-'))
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    app = await createApp(loadConfig(), { startJobs: false })
    app.db.insertGame({ id: 'rpg', title: 'RPG', status: 'installed' })
    app.db.insertGame({ id: 'other', title: 'Other', status: 'installed' })
  })
  afterAll(() => app?.close())

  it('keeps a layout per game, made safe, lists it to copy from, and forgets it', async () => {
    await request(app.app).get('/api/games/rpg/controls').expect(200, { layout: null })
    const sent = { ...defaultLayout('rpgmaker', true), landscape: [...defaultLayout('rpgmaker', true).landscape, { id: 'x', kind: 'button', key: 'rm -rf', label: 'Bad', mode: 'tap', x: 0.5, y: 0.5, size: 0.1 }, { id: 'far', kind: 'button', key: 'z', label: 'Z', mode: 'spin', x: 9, y: -1, size: 2 }] }
    const res = await request(app.app).put('/api/games/rpg/controls').send({ layout: sent }).expect(200)
    const far = res.body.layout.landscape.find((c: { id: string }) => c.id === 'far')
    expect(res.body.layout.landscape.some((c: { id: string }) => c.id === 'x')).toBe(false)
    expect(far).toMatchObject({ key: 'z', mode: 'tap', x: 1, y: 0, size: 0.5 })
    await request(app.app).get('/api/games/rpg/controls').expect(200).then((r) => expect(r.body.layout.landscape).toHaveLength(5))
    await request(app.app).get('/api/controls').expect(200).then((r) => expect(r.body.games).toEqual([{ id: 'rpg', title: 'RPG', updatedAt: expect.any(Number) }]))
    await request(app.app).put('/api/games/other/controls').send({ layout: 'no' }).expect(400)
    await request(app.app).put('/api/games/missing/controls').send({ layout: sent }).expect(404)
    await request(app.app).delete('/api/games/rpg/controls').expect(200)
    await request(app.app).get('/api/games/rpg/controls').expect(200, { layout: null })
  })

  it('starts RPG Maker with arrows on a touch screen, and Ren\'Py off', () => {
    expect(defaultLayout('rpgmaker', true)).toMatchObject({ on: true, landscape: expect.arrayContaining([expect.objectContaining({ kind: 'dpad' })]) })
    expect(defaultLayout('renpy', true).on).toBe(false)
    expect(normalizeLayout(null)).toBeNull()
  })
})

it('presses the game\'s keys as a keyboard would, with the modifiers held, and lets go of all', () => {
  const events: Array<{ type: string; key: string; keyCode: number; charCode: number; shiftKey: boolean; ctrlKey: boolean }> = []
  class KeyboardEvent {
    constructor(readonly type: string, init: Record<string, unknown>) {
      Object.assign(this, init)
    }
  }
  const canvas = { tagName: 'CANVAS', dispatchEvent: (e: (typeof events)[number]) => events.push({ type: e.type, key: e.key, keyCode: e.keyCode, charCode: e.charCode, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey }) }
  const page = htmlRuntime(1, (w) => {
    w.KeyboardEvent = KeyboardEvent
    w.document.activeElement = null
    w.document.getElementById = (id: string) => (id === 'canvas' ? canvas : null)
  })
  page.message({ type: 'renplay:key', key: 'Shift', down: true })
  page.message({ type: 'renplay:key', key: 'a', down: true })
  page.message({ type: 'renplay:key', key: 'Meta', down: true })
  page.message({ type: 'renplay:keys-release' })
  expect(events).toEqual([
    { type: 'keydown', key: 'Shift', keyCode: 16, charCode: 0, shiftKey: true, ctrlKey: false },
    { type: 'keydown', key: 'A', keyCode: 65, charCode: 0, shiftKey: true, ctrlKey: false },
    { type: 'keypress', key: 'A', keyCode: 65, charCode: 65, shiftKey: true, ctrlKey: false },
    { type: 'keyup', key: 'Shift', keyCode: 16, charCode: 0, shiftKey: false, ctrlKey: false },
    { type: 'keyup', key: 'a', keyCode: 65, charCode: 0, shiftKey: false, ctrlKey: false },
  ])
})
