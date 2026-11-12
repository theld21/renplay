// ------------------------------------------------------------------ title picture

/*
 * This fork's own. A game without art gets a picture of its title screen: the player asks with
 * 'renplay:title-picture' and gets one 'renplay:title-picture' back, with a data: URL. Ren'Py's is
 * its own screenshot of the main menu, RPG Maker's a snap of Scene_Title, each taken once the
 * screen has stood for a few seconds (after a splash, a warning and the fade in).
 */
var titleAsked = false
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
        if (typeof data === 'string' && /^data:image\//.test(data)) post('title-picture', { data: data })
      })
    }).catch(function () {})
  }, 500)
}
window.addEventListener('message', function (e) {
  if (e.source !== window.parent || !e.data || e.data.type !== 'renplay:title-picture' || titleAsked) return
  titleAsked = true
  if (typeof window.renpy_exec === 'function') {
    titleWhenStill(
      function () {
        return window.renpy_exec('result = bool(renpy.context()._main_menu)').then(function (r) {
          return r === true
        })
      },
      function () {
        var py = 'import base64\nresult = "data:image/png;base64," + base64.b64encode(renpy.screenshot_to_bytes((1280, 720))).decode()'
        return window.renpy_exec(py)
      },
    )
    return
  }
  titleWhenStill(
    function () {
      var S = window.SceneManager
      return !!(S && S._scene && window.Scene_Title && S._scene instanceof window.Scene_Title && !(S._scene.isBusy && S._scene.isBusy()))
    },
    function () {
      var shot = window.SceneManager.snap()
      var canvas = shot && (shot.canvas || shot._canvas)
      return canvas ? canvas.toDataURL('image/jpeg', 0.9) : null
    },
  )
})
