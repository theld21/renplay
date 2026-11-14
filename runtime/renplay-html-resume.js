/*
 * This fork's own: where an RPG Maker MZ game was left. The game saves by itself only when the
 * player moves to another map, and a story told in one long scene never does, so leaving it lost
 * everything since the last save. When the game is left (the player's exit or Main menu, or the
 * page hidden for another tab or app), the last calm point is written to the game's own Autosave
 * slot, which its Continue offers. Only in games that show that slot; the person's own slots are
 * never written, and a newer save of the game's own is never replaced.
 *
 * A calm point is taken on the map, at most every few seconds: just before a line of text shows,
 * or while no event runs. Loading it shows that line again. The server puts this file before
 * renplay-html.js, which calls resumeWrite before it hands the game's storage to the player.
 */

var RESUME_EVERY_MS = 4000
var resumeTaken = 0
var resumeJson = null
var resumeInfo = null
var resumeWritten = null
var resumeHooked = false

/** RPG Maker MZ, with the parts a calm point needs. */
function resumeEngine() {
  var u = window.Utils
  var d = window.DataManager
  var s = window.StorageManager
  return !!(
    u && u.RPGMAKER_NAME === 'MZ' && d && s && window.Game_Interpreter && window.Scene_Map &&
    typeof d.makeSaveContents === 'function' && typeof d.makeSavefileInfo === 'function' && typeof d.makeSavename === 'function' &&
    window.JsonEx && typeof JsonEx.stringify === 'function' && typeof s.jsonToZip === 'function' && typeof s.saveZip === 'function' && typeof s.saveObject === 'function'
  )
}

function resumeCalm() {
  var sys = window.$gameSystem
  var scene = window.SceneManager && window.SceneManager._scene
  return !!(
    sys && scene instanceof window.Scene_Map && sys.isAutosaveEnabled() && sys.isSaveEnabled() &&
    !DataManager.isBattleTest() && !DataManager.isEventTest() &&
    window.$gamePlayer && !$gamePlayer.isTransferring() && window.$gameMessage && !$gameMessage.isBusy()
  )
}

function resumeTake() {
  var now = Date.now()
  if (now - resumeTaken < RESUME_EVERY_MS || !resumeCalm()) return
  resumeTaken = now
  var sys = $gameSystem
  // What a save writes (the music now, the frame count), without counting a save the game sees.
  var count = sys._saveCount
  try {
    sys.onBeforeSave()
    resumeJson = JsonEx.stringify(DataManager.makeSaveContents())
    resumeInfo = DataManager.makeSavefileInfo()
  } catch (e) {
    resumeJson = null
  }
  sys._saveCount = count
}

/** Starting again or loading a save leaves what came before behind. */
function resumeForget() {
  resumeJson = null
  resumeInfo = null
  resumeTaken = 0
}

function resumeInstall() {
  if (resumeHooked || !resumeEngine()) return
  resumeHooked = true
  var interpreter = Game_Interpreter.prototype
  var showText = interpreter.command101
  interpreter.command101 = function () {
    resumeTake()
    return showText.apply(this, arguments)
  }
  var map = Scene_Map.prototype
  var update = map.update
  map.update = function () {
    update.apply(this, arguments)
    if (window.$gameMap && !$gameMap.isEventRunning()) resumeTake()
  }
  ;['setupNewGame', 'extractSaveContents'].forEach(function (name) {
    var original = DataManager[name]
    if (typeof original !== 'function') return
    DataManager[name] = function () {
      resumeForget()
      return original.apply(this, arguments)
    }
  })
}

/** Writes the last calm point to the Autosave slot, unless that slot already holds something newer. */
function resumeWrite() {
  if (!resumeJson || !resumeInfo || resumeJson === resumeWritten || !resumeEngine()) return Promise.resolve()
  var info = DataManager._globalInfo
  var kept = info && info[0]
  if (!info || (kept && kept.timestamp >= resumeInfo.timestamp)) return Promise.resolve()
  var json = resumeJson
  var made = resumeInfo
  resumeWritten = json
  return StorageManager.jsonToZip(json)
    .then(function (zip) {
      return StorageManager.saveZip(DataManager.makeSavename(0), zip)
    })
    .then(function () {
      info[0] = made
      return StorageManager.saveObject('global', info)
    })
    .catch(function (e) {
      resumeWritten = null
      console.warn('[renplay] could not keep where the game was left', e)
    })
}
