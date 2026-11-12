// ------------------------------------------------------------------ on-screen keys

/*
 * This fork's own. The player's on-screen controls press keys in the game: a 'renplay:key' message
 * from the player becomes the keydown, keypress and keyup a keyboard sends, with the legacy keyCode
 * that RPG Maker and Emscripten (Ren'Py) read. Only keys of this list (shared/controls.ts names
 * the same), only from the player. A modifier held here marks the events after it, as a keyboard
 * does. 'renplay:keys-release' lets go of every key.
 */
var keysHeld = {}
var NAMED_KEYS = {
  Enter: ['Enter', 13], Escape: ['Escape', 27], Tab: ['Tab', 9], ' ': ['Space', 32], Backspace: ['Backspace', 8],
  Shift: ['ShiftLeft', 16], Control: ['ControlLeft', 17], Alt: ['AltLeft', 18],
  PageUp: ['PageUp', 33], PageDown: ['PageDown', 34], End: ['End', 35], Home: ['Home', 36], Insert: ['Insert', 45], Delete: ['Delete', 46],
  ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40],
}
function keyInfo(key) {
  if (typeof key !== 'string') return null
  var named = Object.prototype.hasOwnProperty.call(NAMED_KEYS, key) ? NAMED_KEYS[key] : null
  if (named) return { key: key, code: named[0], keyCode: named[1], char: key === ' ' ? ' ' : '', location: /^(Shift|Control|Alt)$/.test(key) ? 1 : 0 }
  if (/^[a-z]$/.test(key)) return { key: key, code: 'Key' + key.toUpperCase(), keyCode: key.toUpperCase().charCodeAt(0), char: key, location: 0 }
  if (/^[0-9]$/.test(key)) return { key: key, code: 'Digit' + key, keyCode: 48 + Number(key), char: key, location: 0 }
  var f = /^F([1-9]|1[0-2])$/.exec(key)
  if (f) return { key: key, code: key, keyCode: 111 + Number(f[1]), char: '', location: 0 }
  return null
}
function keyTarget() {
  var a = document.activeElement
  if (a && a !== document.body && a !== document.documentElement && a.tagName !== 'IFRAME') return a
  return document.getElementById('canvas') || document.body || document.documentElement
}
function fireKey(target, type, k) {
  var shift = !!keysHeld.Shift
  var ch = k.char && shift ? k.char.toUpperCase() : k.char
  var code = type === 'keypress' ? ch.charCodeAt(0) : k.keyCode
  var e = new KeyboardEvent(type, {
    key: ch || k.key,
    code: k.code,
    location: k.location,
    bubbles: true,
    cancelable: true,
    view: window,
    shiftKey: shift,
    ctrlKey: !!keysHeld.Control,
    altKey: !!keysHeld.Alt,
  })
  var legacy = { keyCode: code, which: code, charCode: type === 'keypress' ? code : 0 }
  for (var name in legacy) {
    try {
      Object.defineProperty(e, name, { value: legacy[name] })
    } catch (err) {}
  }
  target.dispatchEvent(e)
}
function pressKey(key, down) {
  var k = keyInfo(key)
  if (!k || !!keysHeld[key] === down) return
  var target = keyTarget()
  if (down) {
    keysHeld[key] = true
    fireKey(target, 'keydown', k)
    if (k.char) fireKey(target, 'keypress', k)
  } else {
    delete keysHeld[key]
    fireKey(target, 'keyup', k)
  }
}
window.addEventListener('message', function (e) {
  if (e.source !== window.parent || !e.data) return
  if (e.data.type === 'renplay:key') pressKey(e.data.key, !!e.data.down)
  else if (e.data.type === 'renplay:keys-release') for (var key in keysHeld) pressKey(key, false)
})
