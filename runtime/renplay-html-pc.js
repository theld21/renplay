/*
 * What an RPG Maker game's PC download expects of NW.js, for plugins that ask for it without
 * checking first: require('fs'), require('path') and process. A plugin that looks for
 * save/file3.rmmzsave (or .rpgsave) finds it when the game has that save, the game's saves being
 * its web saves. Other files are missing and writes go nowhere, as they would on a computer
 * without them, so a plugin's own fallback runs. RPG Maker itself still knows it runs in a
 * browser: its Utils.isNwjs answers false. Nothing is added before RPG Maker's core has loaded,
 * so the engine's libraries see a plain browser. The server puts this in front of renplay-html.js.
 */

var pcPath = {
  sep: '/',
  normalize: function (p) {
    var parts = []
    String(p)
      .replace(/\\/g, '/')
      .split('/')
      .forEach(function (part) {
        if (part === '..') parts.pop()
        else if (part && part !== '.') parts.push(part)
      })
    return parts.join('/') || '.'
  },
  join: function () {
    return pcPath.normalize(Array.prototype.filter.call(arguments, function (p) {
      return typeof p === 'string' && p !== ''
    }).join('/'))
  },
  resolve: function () {
    return pcPath.join.apply(null, arguments)
  },
  dirname: function (p) {
    var n = pcPath.normalize(p)
    var i = n.lastIndexOf('/')
    return i > 0 ? n.slice(0, i) : '.'
  },
  basename: function (p, ext) {
    var b = pcPath.normalize(p).split('/').pop()
    return ext && b.slice(-ext.length) === ext ? b.slice(0, -ext.length) : b
  },
  extname: function (p) {
    var m = /\.[^.]*$/.exec(pcPath.basename(p))
    return m ? m[0] : ''
  },
}

function pcMissing(p) {
  var e = new Error("ENOENT: no such file or directory, '" + p + "'")
  e.code = 'ENOENT'
  return e
}

// RPG Maker MZ names its saves file3, global and config; MV numbers them 3, 0 and -1.
function pcHasSave(p) {
  var m = /(?:^|\/)save\/([^/]+)\.(rmmzsave|rpgsave)$/.exec(pcPath.normalize(p))
  var storage = window.StorageManager
  if (!m || !storage || typeof storage.exists !== 'function') return false
  if (m[2] === 'rmmzsave') return !!storage.exists(m[1])
  var file = /^file(\d+)$/.exec(m[1])
  var id = m[1] === 'config' ? -1 : m[1] === 'global' ? 0 : file ? Number(file[1]) : null
  return id !== null && !!storage.exists(id)
}

function pcNothing() {}
function pcThrows(p) {
  throw pcMissing(p)
}
var pcFs = {
  existsSync: pcHasSave,
  readFileSync: pcThrows,
  statSync: pcThrows,
  lstatSync: pcThrows,
  readdirSync: pcThrows,
  writeFileSync: pcNothing,
  appendFileSync: pcNothing,
  mkdirSync: pcNothing,
  unlinkSync: pcNothing,
  rmSync: pcNothing,
  renameSync: pcNothing,
  copyFileSync: pcNothing,
}

function pcRequire(name) {
  var id = String(name).replace(/^node:/, '')
  if (id === 'fs') return pcFs
  if (id === 'path') return pcPath
  var e = new Error("Cannot find module '" + name + "'")
  e.code = 'MODULE_NOT_FOUND'
  throw e
}

var pcProcess = {
  platform: 'browser',
  env: {},
  argv: [],
  versions: {},
  execPath: '',
  mainModule: { path: '.', filename: 'index.html' },
  cwd: function () {
    return '.'
  },
  on: pcNothing,
}

// Each script's load event, caught on its way down: the one after RPG Maker's core.
var pcAdded = false
window.addEventListener(
  'load',
  function () {
    var utils = window.Utils
    if (pcAdded || !utils || !utils.RPGMAKER_NAME || typeof utils.isNwjs !== 'function') return
    pcAdded = true
    if (utils.isNwjs()) return
    utils.isNwjs = function () {
      return false
    }
    if (typeof window.require === 'undefined') window.require = pcRequire
    if (typeof window.process === 'undefined') window.process = pcProcess
  },
  true,
)
