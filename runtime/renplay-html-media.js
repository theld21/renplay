/*
 * The HTML games' media: videos and sound. The server puts it between renplay-player.js and
 * renplay-html.js in one function (server/src/play/runtime.ts), so isMuted and setAudioMuted come
 * from the first, and the second calls playsInline (for a video's source) and setMuted (when the
 * player mutes).
 */

// A video plays inside the game, never in the phone's own player. Plugins that draw a video into
// RPG Maker's canvas make theirs without playsinline, and an iPhone then opens it full screen
// while the game keeps a still picture.
function isVideo(el) {
  return !!el && typeof el.tagName === 'string' && el.tagName.toUpperCase() === 'VIDEO'
}
function playsInline(el) {
  if (!isVideo(el) || el.playsInline === true) return
  try {
    el.playsInline = true
  } catch (e) {}
  if (typeof el.setAttribute === 'function') {
    el.setAttribute('playsinline', '')
    el.setAttribute('webkit-playsinline', '')
  }
}
var createElement = document.createElement
if (typeof createElement === 'function') {
  document.createElement = function (tag) {
    var el = createElement.apply(this, arguments)
    if (String(tag).toLowerCase() === 'video') playsInline(el)
    return el
  }
}

// ------------------------------------------------------------- mute

// Media elements follow the player's choice; the game's own muting is kept apart.
var own = new WeakMap()
var mutedDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted')
if (mutedDesc && mutedDesc.set) {
  Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
    configurable: true,
    get: function () {
      return own.has(this) ? own.get(this) : mutedDesc.get.call(this)
    },
    set: function (v) {
      own.set(this, !!v)
      applyMedia(this)
    },
  })
}
// An iPhone ignores a media element's volume (it always reads 1): one the game turns down to
// nothing is muted.
var volumes = new WeakMap()
var volumeDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume')
if (volumeDesc && volumeDesc.set) {
  Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
    configurable: true,
    get: function () {
      return volumes.has(this) ? volumes.get(this) : volumeDesc.get.call(this)
    },
    set: function (v) {
      volumeDesc.set.call(this, v)
      volumes.set(this, Number(v))
      applyMedia(this)
    },
  })
}
// An iPhone refuses a video with sound that starts without a tap: it starts muted instead and gets
// its sound back at the next tap. One that may not start even muted (Low Power Mode) starts then,
// unless the game paused it or gave it another source meanwhile.
var silenced = []
var stalled = []
function applyMedia(el) {
  var quiet = isMuted() || (own.has(el) && own.get(el)) || volumes.get(el) === 0 || silenced.indexOf(el) >= 0
  if (!mutedDesc || !mutedDesc.set) return
  mutedDesc.set.call(el, quiet)
  var tw = twins.get(el)
  if (tw) mutedDesc.set.call(tw.video, quiet)
}
function drop(list, el) {
  for (var i = list.length - 1; i >= 0; i--) if (list[i] === el || list[i].el === el) list.splice(i, 1)
}
function stall(el) {
  drop(stalled, el)
  stalled.push({ el: el, src: el.src })
}
// Media playing now, in the page or not (a video drawn into a canvas), so the player's sound switch
// reaches them. One that stops leaves the list, and its next play() applies the switch again.
var playing = []
var watched = new WeakMap()
function watch(el) {
  if (playing.indexOf(el) < 0) playing.push(el)
  if (watched.has(el) || typeof el.addEventListener !== 'function') return
  watched.set(el, true)
  el.addEventListener('pause', function () {
    // Handed over to its twin for a lap (below): it still plays, for the game and the sound switch.
    var tw = twins.get(el)
    if (tw && tw.active !== el) return
    drop(playing, el)
    // The phone stopped it for another tab or app: it plays again when the page is back.
    if (document.hidden && !pausedByGame.has(el) && interrupted.indexOf(el) < 0) interrupted.push(el)
  })
  el.addEventListener('playing', function () {
    hasPlayed.set(el, true)
  })
  // A loop that ended anyway starts again at once, not at the next frame's check.
  el.addEventListener('ended', function () {
    if (appleTouch && el.loop && !pausedByGame.has(el) && !document.hidden) loopAgain(el, true)
  })
}

// ------------------------------------------------------------- looping and coming back

// An iPhone can leave a looping video drawn into a canvas stopped on its last picture, so the
// animated scene froze after one lap while a computer kept it moving. On an iPhone a video the game
// loops is watched every frame and laps just before its last picture ends, and one that ended or
// stopped anyway starts again at once. A video the game paused is left alone.
var pausedByGame = new WeakMap()
var hasPlayed = new WeakMap()
var interrupted = []
var loopers = []
var nav = window.navigator || {}
var appleTouch = /iP(hone|ad|od)/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
// How close to its end a lap turns back: about one and a half pictures of a 30 fps clip.
var LAP_EARLY = 0.05
// A playing clip whose time stands still this long is stuck.
var STUCK_MS = 700
function noop() {}
function loopAgain(el, fromStart) {
  try {
    if (fromStart) el.currentTime = 0
  } catch (e) {}
  if (el.paused || el.ended) el.play().catch(noop)
}
function keepLooping() {
  for (var i = loopers.length - 1; i >= 0; i--) {
    var w = loopers[i]
    var el = w.el
    var tw = twins.get(el)
    if (tw && tw.src !== el.src) {
      dropTwin(el)
      tw = null
    }
    if (!el.src || el.error || pausedByGame.has(el) || (el.ended && !el.loop)) {
      loopers.splice(i, 1)
      // Its twin goes with it: a twin left behind keeps a decoder and the clip in memory.
      dropTwin(el)
      continue
    }
    // A clip the game made with autoplay is already playing when the game calls play(), which then
    // fires no 'playing': seen playing, it has played.
    if (!hasPlayed.has(el) && !el.paused && el.readyState >= 2) hasPlayed.set(el, true)
    if (document.hidden || !el.loop || !hasPlayed.has(el) || interrupted.indexOf(el) >= 0) continue
    if (!tw) tw = makeTwin(el)
    var d = (tw ? tw.active : el).duration
    // With a twin these read the video playing now, the game's or its twin.
    var t = el.currentTime
    var now = Date.now()
    if (t !== w.t || el.paused || el.seeking) {
      w.t = t
      w.since = now
    }
    if (el.ended || el.paused) {
      restart(el, tw)
    } else if (d > 0 && isFinite(d) && t >= d - Math.min(LAP_EARLY, d / 4)) lap(el, tw)
    else if (now - w.since > STUCK_MS) {
      // Playing, but its time has stood still: it starts the lap again.
      w.since = now
      if (tw && tw.active !== el) restart(el, tw)
      else loopAgain(el, true)
    }
  }
  watching = false
  if (loopers.length) watchLoops()
}
var watching = false
function watchLoops() {
  if (watching || typeof requestAnimationFrame !== 'function') return
  watching = true
  requestAnimationFrame(keepLooping)
}

// ------------------------------------------------------------- seamless laps

// Going back to the start costs an iPhone a moment (it decodes the clip's first picture again), so
// a clip of a second stopped visibly at every lap. A looping clip gets a twin: the same clip, held
// on its first picture. At the end of a lap the other one plays on and the game's canvas draws it,
// while the one that finished goes back to its start out of sight. The game sees one video playing
// on: its time, paused and ended are the playing one's.
var twins = new WeakMap()
function accessor(name) {
  var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, name)
  return d && d.get ? d : null
}
var timeDesc = accessor('currentTime')
var pausedDesc = accessor('paused')
var endedDesc = accessor('ended')
// Clips longer than this lap rarely enough to pay for a second copy.
var TWIN_MAX_SECONDS = 15
function seekStart(v) {
  try {
    timeDesc.set.call(v, 0)
  } catch (e) {}
}
function makeTwin(el) {
  var d = el.duration
  if (!timeDesc || !timeDesc.set || !pausedDesc || !endedDesc || !mutedDesc || !mutedDesc.set || typeof nativePause !== 'function') return null
  if (!(d > 0) || d > TWIN_MAX_SECONDS || typeof createElement !== 'function') return null
  var v = createElement.call(document, 'video')
  if (!isVideo(v)) return null
  playsInline(v)
  v.preload = 'auto'
  if (el.crossOrigin) v.crossOrigin = el.crossOrigin
  mutedDesc.set.call(v, mutedDesc.get.call(el))
  v.src = el.src
  if (typeof v.load === 'function') v.load()
  var tw = { video: v, active: el, src: el.src }
  twins.set(el, tw)
  // An iPhone loads nothing of a video outside the page until it plays: the twin plays a moment,
  // silent (which needs no tap), and waits on its first picture.
  mutedDesc.set.call(v, true)
  var settle = function () {
    if (twins.get(el) !== tw || tw.active === v) return
    nativePause.call(v)
    seekStart(v)
    mutedDesc.set.call(v, mutedDesc.get.call(el))
  }
  try {
    var primed = nativePlay.call(v)
    if (primed && typeof primed.then === 'function') primed.then(settle, settle)
    else settle()
  } catch (e) {
    settle()
  }
  ;[['currentTime', timeDesc], ['paused', pausedDesc], ['ended', endedDesc]].forEach(function (p) {
    var desc = p[1]
    Object.defineProperty(el, p[0], {
      configurable: true,
      get: function () {
        return desc.get.call(tw.active)
      },
      set: desc.set
        ? function (value) {
            desc.set.call(tw.active, value)
          }
        : undefined,
    })
  })
  return tw
}
function dropTwin(el) {
  var tw = twins.get(el)
  if (!tw) return
  twins.delete(el)
  ;['currentTime', 'paused', 'ended'].forEach(function (name) {
    try {
      delete el[name]
    } catch (e) {}
  })
  try {
    nativePause.call(tw.video)
    tw.video.removeAttribute('src')
    tw.video.load()
  } catch (e) {}
}
// It stopped: at its end it starts the lap again, elsewhere (an iPhone stops one video while
// another starts) it plays on from where it is.
function restart(el, tw) {
  var d = (tw ? tw.active : el).duration
  var atEnd = el.ended || (d > 0 && isFinite(d) && el.currentTime >= d - 0.3)
  if (!tw || tw.active === el) return loopAgain(el, atEnd)
  if (atEnd) seekStart(tw.video)
  var again = nativePlay.call(tw.video)
  if (again && typeof again.catch === 'function') again.catch(noop)
}
function lap(el, tw) {
  var from = tw ? tw.active : el
  var to = !tw ? null : from === el ? tw.video : el
  // The other one not ready on its first picture: this one goes back to its start, as before.
  if (!to || to.readyState < 2 || to.seeking || timeDesc.get.call(to) > 0.05) {
    if (!tw) return loopAgain(el, true)
    return seekStart(from)
  }
  tw.active = to
  var started = nativePlay.call(to)
  nativePause.call(from)
  seekStart(from)
  var back = function () {
    if (tw.active !== to) return
    tw.active = from
    seekStart(from)
    var again = nativePlay.call(from)
    if (again && typeof again.catch === 'function') again.catch(noop)
  }
  if (!started || typeof started.catch !== 'function') return
  started.catch(function (e) {
    if (tw.active !== to) return
    // The twin may not start with sound before a tap: it plays this lap silent.
    if (to === tw.video && e && e.name === 'NotAllowedError' && !mutedDesc.get.call(to)) {
      mutedDesc.set.call(to, true)
      var silent = nativePlay.call(to)
      if (silent && typeof silent.catch === 'function') silent.catch(back)
      return
    }
    back()
  })
}
// The game paused it while its twin played: the twin's place carries over and the game's video
// is the one paused.
function handBack(el) {
  var tw = twins.get(el)
  if (!tw || tw.active === el) return
  var at = timeDesc.get.call(tw.video)
  nativePause.call(tw.video)
  tw.active = el
  try {
    timeDesc.set.call(el, at)
  } catch (e) {}
  seekStart(tw.video)
}
// At a tap a twin may start with sound later: it plays and stops at once, and gets the sound switch.
function letTwinsSound() {
  loopers.forEach(function (w) {
    var tw = twins.get(w.el)
    if (!tw || tw.heard || tw.active === tw.video) return
    tw.heard = true
    try {
      var p = nativePlay.call(tw.video)
      if (p && typeof p.catch === 'function') p.catch(noop)
      nativePause.call(tw.video)
      seekStart(tw.video)
    } catch (e) {}
    applyMedia(w.el)
  })
}
// What the game draws: where it names its video, the one playing now.
function swapSources(proto, name) {
  var native = proto && proto[name]
  if (typeof native !== 'function') return
  proto[name] = function () {
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i]
      var tw = a && typeof a === 'object' && twins.get(a)
      if (tw && tw.active !== a && tw.active.readyState >= 2) {
        var args = Array.prototype.slice.call(arguments)
        args[i] = tw.active
        return native.apply(this, args)
      }
    }
    return native.apply(this, arguments)
  }
}
if (appleTouch) {
  swapSources(window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype, 'drawImage')
  ;['WebGLRenderingContext', 'WebGL2RenderingContext'].forEach(function (name) {
    var proto = window[name] && window[name].prototype
    swapSources(proto, 'texImage2D')
    swapSources(proto, 'texSubImage2D')
  })
}

function wakeMedia() {
  if (document.hidden) return
  var waiting = interrupted
  interrupted = []
  waiting.forEach(function (el) {
    if (!el.paused || pausedByGame.has(el) || (el.ended && !el.loop)) return
    el.play().catch(function () {
      if (interrupted.indexOf(el) < 0) interrupted.push(el)
    })
  })
}
document.addEventListener('visibilitychange', wakeMedia)
window.addEventListener('pageshow', wakeMedia)

var nativePlay = HTMLMediaElement.prototype.play
HTMLMediaElement.prototype.play = function () {
  var el = this
  pausedByGame.delete(el)
  drop(interrupted, el)
  if (appleTouch && isVideo(el) && !loopers.some(function (w) { return w.el === el })) loopers.push({ el: el })
  if (loopers.length) watchLoops()
  playsInline(el)
  watch(el)
  applyMedia(el)
  var started = nativePlay.apply(el, arguments)
  if (started && typeof started.catch === 'function') {
    started.catch(function () {
      drop(playing, el)
    })
  }
  if (!isVideo(el) || !started || typeof started.catch !== 'function' || !mutedDesc || !mutedDesc.set) return started
  return started.catch(function (e) {
    if (!e || e.name !== 'NotAllowedError') throw e
    if (silenced.indexOf(el) < 0 && !mutedDesc.get.call(el)) {
      silenced.push(el)
      mutedDesc.set.call(el, true)
      return nativePlay.call(el).then(
        function () {
          watch(el)
        },
        function (again) {
          if (again && again.name === 'NotAllowedError') stall(el)
          throw again
        },
      )
    }
    stall(el)
    throw e
  })
}
var nativePause = HTMLMediaElement.prototype.pause
if (typeof nativePause === 'function') {
  HTMLMediaElement.prototype.pause = function () {
    pausedByGame.set(this, true)
    drop(interrupted, this)
    drop(stalled, this)
    handBack(this)
    var paused = nativePause.apply(this, arguments)
    dropTwin(this)
    return paused
  }
}
function afterTap() {
  var waiting = stalled
  var quiet = silenced
  stalled = []
  silenced = []
  quiet.forEach(applyMedia)
  waiting.forEach(function (w) {
    if (w.el.paused && !w.el.ended && w.el.src === w.src) w.el.play().catch(function () {})
  })
  wakeMedia()
  letTwinsSound()
}
;['touchend', 'pointerup', 'click', 'keydown'].forEach(function (type) {
  document.addEventListener(type, afterTap, true)
})
function setMuted(on) {
  setAudioMuted(on)
  var all = Array.prototype.slice.call(document.querySelectorAll('audio, video'))
  playing.forEach(function (el) {
    if (all.indexOf(el) < 0) all.push(el)
  })
  all.forEach(applyMedia)
}
