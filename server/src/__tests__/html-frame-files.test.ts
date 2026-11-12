import { expect, it } from 'vitest'
import { frameRect } from '../../../selector/src/lib/display.js'
import { htmlRuntime } from './runtime-browser.js'

// The game's frame has an opaque origin: its own files count as another origin's.
it('loads a game\'s pictures so its canvas can be read back', () => {
  class HTMLImageElement {
    crossOrigin: string | null = null
    private url = ''
    get src() { return this.url }
    set src(value: string) { this.url = value }
  }
  const { window } = htmlRuntime(1, (w) => { w.HTMLImageElement = HTMLImageElement })
  const skin = new window.HTMLImageElement()
  skin.src = 'img/system/Window.png'
  expect([skin.src, skin.crossOrigin]).toEqual(['img/system/Window.png', 'anonymous'])
  // The game's own choice stays, and pictures made in the page need nothing.
  const chosen = new window.HTMLImageElement()
  chosen.crossOrigin = 'use-credentials'
  chosen.src = 'img/a.png'
  const drawn = new window.HTMLImageElement()
  drawn.src = 'data:image/png;base64,AAAA'
  // Another site may send no CORS headers: its pictures load as before.
  const elsewhere = new window.HTMLImageElement()
  elsewhere.src = 'https://cdn.example/banner.png'
  expect([chosen.crossOrigin, drawn.crossOrigin, elsewhere.crossOrigin]).toEqual(['use-credentials', null, null])
})

it('starts a game\'s worker from a copy of its script, which still finds the game\'s files', () => {
  const started: string[] = []
  const blobs = new Map<string, Blob>()
  class Worker {
    constructor(public url: string) {
      if (!url.startsWith('blob:')) throw new DOMException(`Script at '${url}' cannot be accessed from origin 'null'.`, 'SecurityError')
      started.push(url)
    }
  }
  class XMLHttpRequest {
    status = 0
    responseText = ''
    private url = ''
    open(_method: string, url: string, async: boolean) { expect(async).toBe(false); this.url = url }
    send() {
      expect(this.url).toBe('http://renplay.test/g/game/b1/js/libs/vorbisdecoder.js')
      this.status = 200
      this.responseText = 'self.decoder = true'
    }
  }
  const { window } = htmlRuntime(1, (w) => {
    w.Worker = Worker
    w.XMLHttpRequest = XMLHttpRequest
    w.URL = Object.assign(class extends URL {}, { createObjectURL: (blob: Blob) => { const id = `blob:null/${blobs.size}`; blobs.set(id, blob); return id } })
  })
  const worker = new window.Worker('js/libs/vorbisdecoder.js')
  expect(worker).toBeInstanceOf(Worker)
  expect(started).toEqual(['blob:null/0'])
  return blobs.get('blob:null/0')!.text().then((code) => {
    expect(code.endsWith('self.decoder = true')).toBe(true)
    // In the copy, relative addresses (importScripts, fetch) mean the script's folder.
    const self: any = { importScripts: (...urls: string[]) => urls, fetch: (url: string) => url }
    new Function('self', code.split('\n')[0]!)(self)
    expect(self.importScripts('decoder.wasm.js')).toEqual(['http://renplay.test/g/game/b1/js/libs/decoder.wasm.js'])
    expect(self.fetch('vorbisdecoder.wasm')).toBe('http://renplay.test/g/game/b1/js/libs/vorbisdecoder.wasm')
  })
})

it('loads media for Web Audio, and asks no cookies for the game\'s own files', async () => {
  class Element {
    tagName = ''
    crossOrigin: string | null = null
    attrs: Record<string, string> = {}
    setAttribute(name: string, value: string) { this.attrs[name] = value }
  }
  class HTMLMediaElement extends Element {
    private url = ''
    get src() { return this.url }
    set src(value: string) { this.url = value }
  }
  class XMLHttpRequest {
    withCredentials = false
    sent: boolean | null = null
    open(_method: string, _url: string) {}
    send() { this.sent = this.withCredentials }
  }
  const asked: Array<[string, unknown]> = []
  const { window } = htmlRuntime(1, (w) => {
    Object.assign(w, { Element, HTMLMediaElement, XMLHttpRequest })
    w.fetch = async (input: string, init?: RequestInit) => { asked.push([input, init?.credentials]); return new Response('{}') }
  })
  const music = new window.HTMLMediaElement()
  music.src = 'audio/bgm/theme.ogg'
  const video = new window.Element()
  video.tagName = 'VIDEO'
  video.setAttribute('src', 'movies/opening.webm')
  expect([music.crossOrigin, video.crossOrigin, video.attrs['src']]).toEqual(['anonymous', 'anonymous', 'movies/opening.webm'])
  await window.fetch('data/Map001.json', { credentials: 'include' })
  await window.fetch('https://cdn.example/lib.js', { credentials: 'include' })
  expect(asked).toEqual([['data/Map001.json', 'same-origin'], ['https://cdn.example/lib.js', 'include']])
  const own = new window.XMLHttpRequest()
  own.open('GET', 'data/System.json')
  own.withCredentials = true
  own.send()
  const other = new window.XMLHttpRequest()
  other.open('GET', 'https://api.example/scores')
  other.withCredentials = true
  other.send()
  expect([own.sent, other.sent]).toEqual([false, true])
})

it('answers no gamepads when the browser refuses the frame, instead of stopping the game', () => {
  const pads = [{ id: 'pad' }]
  let refuse = true
  const { window } = htmlRuntime(1, (w) => {
    w.navigator = { getGamepads: () => { if (refuse) throw new DOMException('frames are not allowed to call getGamepads()', 'SecurityError'); return pads } }
  })
  expect(window.navigator.getGamepads()).toEqual([])
  refuse = false
  expect(window.navigator.getGamepads()).toBe(pads)
})

it('tells the player the size a canvas game draws at, and nothing for a page that follows the window', () => {
  const canvases: Array<{ width: number; height: number }> = []
  const page = htmlRuntime(1, (w) => {
    Object.assign(w, { innerWidth: 390, innerHeight: 844, devicePixelRatio: 3 })
    w.document.getElementsByTagName = (tag: string) => (tag === 'canvas' ? canvases : [])
  })
  const screens = () => page.post.mock.calls.map(([m]) => m).filter((m) => m.type === 'renplay:info').map((m) => m.screen)
  const before = page.intervals.length
  page.fire('load')
  const added = page.intervals.slice(before)
  const look = () => added.forEach((fn) => fn())
  // A page whose canvas follows the window, then RPG Maker's FPS meter and its game canvas.
  canvases.push({ width: 1170, height: 2532 })
  look()
  canvases.push({ width: 84, height: 30 }, { width: 1280, height: 720 })
  look()
  look()
  expect(screens()).toEqual([[1280, 720]])
})

it('stretches the frame over the whole area, and keeps fit and fill as they were', () => {
  // A 16:9 game on a long phone in landscape.
  expect(frameRect(844, 390, [1280, 720], 'fit')).toEqual({ width: 693, height: 390, left: 76, top: 0, scaleX: 1, scaleY: 1 })
  const stretched = frameRect(844, 390, [1280, 720], 'stretch')
  expect(stretched).toMatchObject({ width: 693, height: 390, left: 0, top: 0, scaleY: 1 })
  expect(stretched.width * stretched.scaleX).toBeCloseTo(844)
  // An iPad's 4:3: Fill crops the sides, Stretch makes the game taller.
  expect(frameRect(1024, 768, [1280, 720], 'fill')).toMatchObject({ width: 1365, height: 768, left: -170, top: 0 })
  expect(frameRect(1024, 768, [1280, 720], 'stretch')).toMatchObject({ width: 1024, height: 576, scaleX: 1 })
  expect(frameRect(1024, 768, null, 'stretch')).toEqual({ width: 1024, height: 768, left: 0, top: 0, scaleX: 1, scaleY: 1 })
})

it('lets RPG Maker on a phone use the frame\'s whole height', () => {
  const updated: string[] = []
  const Graphics = {
    _canvas: {},
    // RPG Maker's own: in a phone's browser a tenth is kept for the browser's bars.
    _stretchHeight: () => 390 * 0.9,
    _updateRealScale() { updated.push(`scale for ${this._stretchHeight()}`) },
    _updateAllElements() { updated.push('elements') },
  }
  const page = htmlRuntime(1, (w) => {
    w.document.documentElement = { clientHeight: 390 }
    w.document.getElementsByTagName = () => []
    Object.assign(w, { Graphics, Utils: { RPGMAKER_NAME: 'MZ' } })
  })
  page.fire('load')
  expect(page.window.Graphics._stretchHeight()).toBe(390)
  expect(updated).toEqual(['scale for 390', 'elements'])
})

