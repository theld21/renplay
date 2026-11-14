// ------------------------------------------------------------------ title picture and snaps

/*
 * This fork's own. A game without art gets a picture of its title screen: the player asks with
 * 'renplay:title-picture' and gets one 'renplay:title-picture' back, with a data: URL. Ren'Py's is
 * its own screenshot of the main menu, RPG Maker's a snap of Scene_Title, each taken once the
 * screen has stood for a few seconds (after a splash, a warning and the fade in).
 *
 * 'renplay:snap' with an id asks for a picture of the screen as it is now, for the game's
 * thumbnail: one 'renplay:snap' comes back with that id and a data: URL, or null data.
 */
var titleAsked = false
function renpyShot() {
  var py = 'import base64\nresult = "data:image/png;base64," + base64.b64encode(renpy.screenshot_to_bytes((1280, 720))).decode()'
  return window.renpy_exec(py)
}
function rpgMakerShot() {
  var shot = window.SceneManager.snap()
  var canvas = shot && (shot.canvas || shot._canvas)
  return canvas ? canvas.toDataURL('image/jpeg', 0.9) : null
}
// Another HTML game: its largest canvas, read just after the game drew its frame, while a WebGL
// canvas still holds the picture.
function canvasShot() {
  return new Promise(function (resolve) {
    requestAnimationFrame(function () {
      var best = null
      var all = typeof document.getElementsByTagName === 'function' ? document.getElementsByTagName('canvas') : []
      for (var i = 0; i < all.length; i++) if (!best || all[i].width * all[i].height > best.width * best.height) best = all[i]
      try {
        resolve(best && best.width ? best.toDataURL('image/jpeg', 0.9) : null)
      } catch (e) {
        resolve(null)
      }
    })
  })
}
function shotNow() {
  if (typeof window.renpy_exec === 'function') return renpyShot()
  var S = window.SceneManager
  if (S && S._scene && typeof S.snap === 'function') {
    try {
      var data = rpgMakerShot()
      if (data) return data
    } catch (e) {}
  }
  return canvasShot()
}
function isPicture(data) {
  return typeof data === 'string' && /^data:image\//.test(data)
}
function titleWhenStill(isTitle, take) {
  // Checked every half second: six checks in a row on the title screen are three seconds.
  var still = 0
  var tries = 0
  var look = setInterval(function () {
    // Two minutes at most: a game that never shows a title screen gets no picture.
    if (++tries > 240) return clearInterval(look)
    Promise.resolve(isTitle()).then(function (on) {
      still = on ? still + 1 : 0
      if (still !== 6) return
      clearInterval(look)
      return Promise.resolve(take()).then(function (data) {
        if (isPicture(data)) post('title-picture', { data: data })
      })
    }).catch(function () {})
  }, 500)
}
window.addEventListener('message', function (e) {
  if (e.source !== window.parent || !e.data || e.data.type !== 'renplay:snap') return
  var id = e.data.id
  var answer = function (data) {
    post('snap', { id: id, data: isPicture(data) ? data : null })
  }
  try {
    Promise.resolve(shotNow()).then(answer, function () {
      answer(null)
    })
  } catch (err) {
    answer(null)
  }
})
window.addEventListener('message', function (e) {
  if (e.source !== window.parent || !e.data || e.data.type !== 'renplay:title-picture' || titleAsked) return
  titleAsked = true
  if (typeof window.renpy_exec === 'function') {
    titleWhenStill(function () {
      return window.renpy_exec('result = bool(renpy.context()._main_menu)').then(function (r) {
        return r === true
      })
    }, renpyShot)
    return
  }
  titleWhenStill(function () {
    var S = window.SceneManager
    return !!(S && S._scene && window.Scene_Title && S._scene instanceof window.Scene_Title && !(S._scene.isBusy && S._scene.isBusy()))
  }, rpgMakerShot)
})
