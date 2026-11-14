import { expect, it, vi } from 'vitest'
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
  let sends = 0
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
      sends++
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
  // A sound per worker: the next one starts from the same copy, without asking again.
  new window.Worker('js/libs/vorbisdecoder.js')
  expect(started).toEqual(['blob:null/0', 'blob:null/0'])
  expect(() => new window.Worker('https://cdn.example/other.js')).toThrow('cannot be accessed')
  expect(sends).toBe(1)
  return blobs.get('blob:null/0')!.text().then((code) => {
    expect(code.endsWith('self.decoder = true')).toBe(true)
    // In the copy, relative addresses (importScripts, fetch) mean the script's folder.
    const self: any = { importScripts: (...urls: string[]) => urls, fetch: (url: string) => url }
    new Function('self', code.split('\n')[0]!)(self)
    expect(self.importScripts('decoder.wasm.js')).toEqual(['http://renplay.test/g/game/b1/js/libs/decoder.wasm.js'])
    expect(self.fetch('vorbisdecoder.wasm')).toBe('http://renplay.test/g/game/b1/js/libs/vorbisdecoder.wasm')
  })
})

it('loads media for Web Audio, set as a property or with setAttribute', () => {
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
  const { window } = htmlRuntime(1, (w) => { Object.assign(w, { Element, HTMLMediaElement }) })
  const music = new window.HTMLMediaElement()
  music.src = 'audio/bgm/theme.ogg'
  const video = new window.Element()
  video.tagName = 'VIDEO'
  video.setAttribute('src', 'movies/opening.webm')
  expect([music.crossOrigin, video.crossOrigin, video.attrs['src']]).toEqual(['anonymous', 'anonymous', 'movies/opening.webm'])
})

it('plays a game\'s videos inside the game, never in the phone\'s own player', () => {
  class HTMLMediaElement {
    tagName = 'VIDEO'
    playsInline = false
    attrs: Record<string, string> = {}
    private url = ''
    get src() { return this.url }
    set src(value: string) { this.url = value }
    setAttribute(name: string, value: string) { this.attrs[name] = value }
  }
  const { window } = htmlRuntime(1, (w) => {
    w.HTMLMediaElement = HTMLMediaElement
    w.document.createElement = (tag: string) => (tag === 'video' ? new HTMLMediaElement() : { tagName: tag.toUpperCase() })
  })
  const made = window.document.createElement('video')
  expect([made.playsInline, made.attrs['playsinline'], made.attrs['webkit-playsinline']]).toEqual([true, '', ''])
  expect(window.document.createElement('div').playsInline).toBeUndefined()
  // A video made another way gets it with its source.
  const other = new window.HTMLMediaElement()
  other.src = 'movies/scene.webm'
  expect([other.playsInline, other.attrs['playsinline']]).toEqual([true, ''])
})

/** A video as an iPhone has it: sound needs a tap, a silent start may need one too (Low Power Mode). */
function phoneVideo(rules: { taps: number, lowPower: boolean }) {
  return class HTMLMediaElement {
    tagName = 'VIDEO'
    src = 'movies/scene.webm'
    paused = true
    ended = false
    private silent = false
    private stops: Array<() => void> = []
    get muted() { return this.silent }
    set muted(value: boolean) { this.silent = value }
    // It takes a volume and still reads 1.
    get volume() { return 1 }
    set volume(_value: number) {}
    addEventListener(type: string, listener: () => void) { if (type === 'pause') this.stops.push(listener) }
    play() {
      if (!rules.taps && (!this.silent || rules.lowPower)) return Promise.reject(new DOMException('needs a tap', 'NotAllowedError'))
      this.paused = false
      return Promise.resolve()
    }
    pause() { this.paused = true; this.stops.forEach((stop) => stop()) }
  }
}

it('starts a video the phone refuses to play with sound muted, and gives the sound back at the next tap', async () => {
  const rules = { taps: 0, lowPower: false }
  const Video = phoneVideo(rules)
  const nativeMuted = Object.getOwnPropertyDescriptor(Video.prototype, 'muted')!.get!
  const page = htmlRuntime(1, (w) => { w.HTMLMediaElement = Video })
  const scene = new page.window.HTMLMediaElement()
  await scene.play()
  expect([scene.paused, nativeMuted.call(scene)]).toEqual([false, true])
  // The game unmuting it before a tap would make the phone stop it.
  scene.muted = false
  expect(nativeMuted.call(scene)).toBe(true)
  rules.taps++
  page.fire('touchend')
  expect(nativeMuted.call(scene)).toBe(false)

  // Not even muted: it starts at the next tap, unless the game paused it meanwhile.
  rules.taps = 0
  rules.lowPower = true
  const waiting = new page.window.HTMLMediaElement()
  const paused = new page.window.HTMLMediaElement()
  await expect(waiting.play()).rejects.toThrow('needs a tap')
  await expect(paused.play()).rejects.toThrow('needs a tap')
  paused.pause()
  rules.taps++
  page.fire('touchend')
  await vi.waitFor(() => expect(waiting.paused).toBe(false))
  expect([nativeMuted.call(waiting), paused.paused]).toEqual([false, true])
})

it('mutes a video the game turns down to nothing, and a playing one outside the page when the player mutes', async () => {
  const Video = phoneVideo({ taps: 1, lowPower: false })
  const nativeMuted = Object.getOwnPropertyDescriptor(Video.prototype, 'muted')!.get!
  const page = htmlRuntime(1, (w) => { w.HTMLMediaElement = Video })
  const scene = new page.window.HTMLMediaElement()
  const stopped = new page.window.HTMLMediaElement()
  await scene.play()
  await stopped.play()
  stopped.pause()
  scene.volume = 0
  expect([scene.volume, nativeMuted.call(scene)]).toEqual([0, true])
  scene.volume = 0.5
  expect(nativeMuted.call(scene)).toBe(false)
  page.message({ type: 'renplay:mute', value: true })
  expect([nativeMuted.call(scene), nativeMuted.call(stopped)]).toEqual([true, false])
  page.message({ type: 'renplay:mute', value: false })
  expect(nativeMuted.call(scene)).toBe(false)
  // The one that stopped gets the switch when it plays again.
  page.message({ type: 'renplay:mute', value: true })
  await stopped.play()
  expect(nativeMuted.call(stopped)).toBe(true)
})

/** A video that plays without a tap, with its time and events, as a game's looping scene. */
const loopingVideo = () => class LoopingVideo {
  tagName = 'VIDEO'
  src = 'movies/scene.webm'
  paused = true
  ended = false
  loop = false
  error = null
  currentTime = 0
  duration = 1.5
  private listeners: Record<string, Array<() => void>> = {}
  addEventListener(type: string, listener: () => void) { (this.listeners[type] ??= []).push(listener) }
  emit(type: string) { this.listeners[type]?.forEach((listener) => listener()) }
  readyState = 4
  // A video already playing (autoplay) fires no 'playing' when played again.
  play() { const was = this.paused; this.paused = false; this.ended = false; if (was) this.emit('playing'); return Promise.resolve() }
  pause() { this.paused = true; this.emit('pause') }
}
const iPhone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)', maxTouchPoints: 5 }

it('keeps a looping video moving on an iPhone, turning back just before its end', async () => {
  const page = htmlRuntime(1, (w) => { w.HTMLMediaElement = loopingVideo(); w.navigator = iPhone })
  const frames = () => new Promise((r) => setTimeout(r, 60))
  const scene = new page.window.HTMLMediaElement()
  scene.loop = true
  await scene.play()
  // Its last picture: the lap turns back without waiting for the end.
  scene.currentTime = 1.47
  await vi.waitFor(() => expect(scene.currentTime).toBe(0))
  scene.currentTime = 0.8
  await frames()
  expect(scene.currentTime).toBe(0.8)
  // It ended or stopped although it loops: it starts again at once.
  scene.currentTime = 1.5
  scene.ended = true
  scene.paused = true
  scene.emit('ended')
  expect([scene.currentTime, scene.paused, scene.ended]).toEqual([0, false, false])
  scene.currentTime = 0.5
  scene.paused = true
  await vi.waitFor(() => expect(scene.paused).toBe(false))
  // One the game paused, or does not loop, stays as it is.
  scene.pause()
  scene.currentTime = 1.5
  scene.ended = true
  scene.emit('ended')
  await frames()
  expect([scene.currentTime, scene.paused]).toEqual([1.5, true])
  const once = new page.window.HTMLMediaElement()
  await once.play()
  once.currentTime = 1.49
  await frames()
  once.ended = true
  once.paused = true
  once.emit('ended')
  await frames()
  expect([once.currentTime, once.paused]).toEqual([1.49, true])
})

/** A video as a browser has it, with its state behind accessors, made by document.createElement. */
const browserVideo = () => class BrowserVideo {
  tagName = 'VIDEO'
  readyState = 4
  seeking = false
  error = null
  duration = 1.5
  loop = false
  preload = ''
  playsInline = false
  crossOrigin: string | null = null
  private time = 0
  private stopped = true
  private done = false
  private silent = false
  private url = ''
  private listeners: Record<string, Array<() => void>> = {}
  get currentTime() { return this.time }
  set currentTime(value: number) { this.time = value; this.done = false }
  get paused() { return this.stopped }
  get ended() { return this.done }
  get muted() { return this.silent }
  set muted(value: boolean) { this.silent = value }
  get src() { return this.url }
  set src(value: string) { this.url = value }
  setAttribute() {}
  removeAttribute() { this.url = '' }
  load() {}
  addEventListener(type: string, listener: () => void) { (this.listeners[type] ??= []).push(listener) }
  play() { this.stopped = false; this.done = false; this.listeners['playing']?.forEach((l) => l()); return Promise.resolve() }
  pause() { this.stopped = true; this.listeners['pause']?.forEach((l) => l()) }
}

it('laps a looping clip on an iPhone with a twin held on its first picture, so it never stops', async () => {
  const Video = browserVideo()
  const made: any[] = []
  const drawn: any[] = []
  class CanvasRenderingContext2D { drawImage(source: unknown) { drawn.push(source) } }
  const page = htmlRuntime(1, (w) => {
    Object.assign(w, { HTMLMediaElement: Video, CanvasRenderingContext2D, navigator: iPhone })
    w.document.createElement = (tag: string) => { const v = tag === 'video' ? new Video() : { tagName: tag.toUpperCase() }; made.push(v); return v }
  })
  const own = Object.getOwnPropertyDescriptor(Video.prototype, 'currentTime')!.get!
  const ownPaused = Object.getOwnPropertyDescriptor(Video.prototype, 'paused')!.get!
  const scene = page.window.document.createElement('video')
  scene.src = 'movies/scene.webm'
  scene.loop = true
  await scene.play()
  await vi.waitFor(() => expect(made.length).toBe(2))
  const twin = made[1]
  // It played a moment, silent, to load its first picture, and waits on it with the game's sound.
  await vi.waitFor(() => expect(twin.paused).toBe(true))
  expect([twin.src, twin.preload, twin.currentTime, twin.muted]).toEqual(['movies/scene.webm', 'auto', 0, false])
  const ctx = new page.window.CanvasRenderingContext2D()
  // The lap: the twin plays on from its first picture, the game's video goes back out of sight.
  scene.currentTime = 1.47
  await vi.waitFor(() => expect(ownPaused.call(twin)).toBe(false))
  expect([ownPaused.call(scene), own.call(scene), scene.paused, scene.currentTime]).toEqual([true, 0, false, 0])
  ctx.drawImage(scene, 0, 0)
  expect(drawn.at(-1)).toBe(twin)
  // The next lap swaps back.
  scene.currentTime = 1.48
  await vi.waitFor(() => expect(ownPaused.call(scene)).toBe(false))
  expect([ownPaused.call(twin), own.call(twin)]).toEqual([true, 0])
  ctx.drawImage(scene, 0, 0)
  expect(drawn.at(-1)).toBe(scene)
  // Paused by the game during the twin's lap: its place carries over to the game's video.
  scene.currentTime = 1.47
  await vi.waitFor(() => expect(ownPaused.call(twin)).toBe(false))
  scene.currentTime = 0.6
  scene.pause()
  expect([ownPaused.call(twin), own.call(scene), scene.paused]).toEqual([true, 0.6, true])
  ctx.drawImage(scene, 0, 0)
  expect(drawn.at(-1)).toBe(scene)
  // The game's pause lets the twin go, with its clip: the next play makes another.
  expect(twin.src).toBe('')
  // A new source: the twin goes.
  await scene.play()
  await vi.waitFor(() => expect(made.length).toBe(3))
  scene.src = 'movies/other.webm'
  await vi.waitFor(() => expect(made[2].src).toBe(''))
})

it('starts a looping clip again when its time stands still while it plays', async () => {
  const page = htmlRuntime(1, (w) => { w.HTMLMediaElement = loopingVideo(); w.navigator = iPhone })
  const scene = new page.window.HTMLMediaElement()
  scene.loop = true
  await scene.play()
  scene.currentTime = 0.6
  await new Promise((r) => setTimeout(r, 300))
  expect(scene.currentTime).toBe(0.6)
  await vi.waitFor(() => expect(scene.currentTime).toBe(0), { timeout: 2000 })
})

it('keeps a clip the game made with autoplay looping, though its play() fired no playing', async () => {
  const page = htmlRuntime(1, (w) => { w.HTMLMediaElement = loopingVideo(); w.navigator = iPhone })
  const scene = new page.window.HTMLMediaElement()
  // It started by itself; the game sets the loop and calls play() on a playing video.
  scene.paused = false
  scene.loop = true
  await scene.play()
  // An iPhone leaves it playing on its last picture.
  scene.currentTime = 1.5
  await vi.waitFor(() => expect(scene.currentTime).toBe(0))
})

it('plays a looping clip on from where it is when the phone stops it midway', async () => {
  const page = htmlRuntime(1, (w) => { w.HTMLMediaElement = loopingVideo(); w.navigator = iPhone })
  const scene = new page.window.HTMLMediaElement()
  scene.loop = true
  await scene.play()
  scene.currentTime = 0.4
  scene.paused = true
  await vi.waitFor(() => expect(scene.paused).toBe(false))
  expect(scene.currentTime).toBe(0.4)
})

it('leaves looping to the browser on a computer', async () => {
  const page = htmlRuntime(1, (w) => { w.HTMLMediaElement = loopingVideo(); w.navigator = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' } })
  const scene = new page.window.HTMLMediaElement()
  scene.loop = true
  await scene.play()
  scene.currentTime = 1.49
  scene.ended = true
  scene.paused = true
  scene.emit('ended')
  await new Promise((r) => setTimeout(r, 60))
  expect([scene.currentTime, scene.paused]).toEqual([1.49, true])
})

it('plays media the phone stopped for another tab again when the game is back, unless the game paused it', async () => {
  const Video = loopingVideo()
  // The phone stops it itself, without the game's pause().
  const systemPause = Video.prototype.pause
  const page = htmlRuntime(1, (w) => { w.HTMLMediaElement = Video; w.navigator = iPhone })
  const doc = page.window.document
  const scene = new page.window.HTMLMediaElement()
  const paused = new page.window.HTMLMediaElement()
  scene.loop = true
  await scene.play()
  await paused.play()
  paused.pause()
  doc.hidden = true
  doc.visibilityState = 'hidden'
  page.fire('visibilitychange')
  systemPause.call(scene)
  // While hidden it stays stopped.
  await new Promise((r) => setTimeout(r, 60))
  expect(scene.paused).toBe(true)
  doc.hidden = false
  doc.visibilityState = 'visible'
  page.fire('visibilitychange')
  expect([scene.paused, paused.paused]).toEqual([false, true])
})

it('wakes the game\'s sound when the page is back from another tab, unless the game suspended it', () => {
  class AudioNode {
    constructor(public context: any) {}
    connect(_target: unknown) { return this }
    disconnect() {}
  }
  class AudioDestinationNode extends AudioNode {}
  class AudioContext {
    state = 'running'
    destination = new AudioDestinationNode(this)
    createGain() { return Object.assign(new AudioNode(this), { gain: { value: 1 } }) }
    resume() { this.state = 'running'; return Promise.resolve() }
    suspend() { this.state = 'suspended'; return Promise.resolve() }
  }
  const page = htmlRuntime(1, (w) => { Object.assign(w, { AudioNode, AudioDestinationNode, AudioContext }) })
  const music = new page.window.AudioContext()
  new page.window.AudioNode(music).connect(music.destination)
  const quiet = new page.window.AudioContext()
  new page.window.AudioNode(quiet).connect(quiet.destination)
  quiet.suspend()
  // The phone interrupts both while another tab is in front.
  music.state = 'interrupted'
  quiet.state = 'interrupted'
  page.fire('visibilitychange')
  expect([music.state, quiet.state]).toEqual(['running', 'interrupted'])
  music.state = 'suspended'
  page.fire('touchend')
  expect(music.state).toBe('running')
  // The game's own resume counts again.
  quiet.resume()
  quiet.state = 'interrupted'
  page.fire('pageshow')
  expect(quiet.state).toBe('running')
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

it('gives RPG Maker MV on a phone the sound and movie files of the PC download it can play', () => {
  const mv = (ogg: boolean, webm: boolean, plugin = false) => {
    const page = htmlRuntime(1, (w) => {
      w.document.getElementsByTagName = () => []
      // RPG Maker MV's own choices: .m4a and .mp4 on any phone.
      const Utils = { RPGMAKER_NAME: 'MV', isMobileDevice: () => true }
      const AudioManager = { audioFileExt: () => (ogg && !Utils.isMobileDevice() ? '.ogg' : '.m4a') }
      if (plugin) AudioManager.audioFileExt = () => '.m4a'
      const Game_Interpreter = class { videoFileExt() { return webm && !Utils.isMobileDevice() ? '.webm' : '.mp4' } }
      Object.assign(w, { Utils, AudioManager, Game_Interpreter })
    })
    page.fire('load')
    page.fire('load')
    return [page.window.AudioManager.audioFileExt(), new page.window.Game_Interpreter().videoFileExt(), page.window.Utils.isMobileDevice()]
  }
  expect(mv(true, true)).toEqual(['.ogg', '.webm', true])
  expect(mv(false, false)).toEqual(['.m4a', '.mp4', true])
  // A game whose plugin asks for .m4a ships it.
  expect(mv(true, true, true)).toEqual(['.m4a', '.webm', true])
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
