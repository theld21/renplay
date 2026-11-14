import { expect, it, vi } from 'vitest'
import { htmlRuntime } from './runtime-browser.js'

// Plugins of RPG Maker PC downloads that use NW.js without checking for it first.

it('lets a plugin find the game\'s saves on disk, while RPG Maker still knows it runs in a browser', () => {
  const page = htmlRuntime(1, (w) => {
    w.Utils = { RPGMAKER_NAME: 'MZ', isNwjs: () => false }
    w.StorageManager = { exists: (name: string) => name === 'file1' || name === 'global' }
  })
  // Nothing before RPG Maker's core has loaded: the engine's libraries see a plain browser.
  expect([page.window.require, page.window.process]).toEqual([undefined, undefined])
  page.fire('load')
  const { require, process } = page.window
  const fs = require('fs')
  const path = require('node:path')
  const save = (n: number) => path.join(process.mainModule.path, 'save', `file${n}.rmmzsave`)
  expect([fs.existsSync(save(1)), fs.existsSync(save(2)), fs.existsSync('www\\save\\global.rmmzsave')]).toEqual([true, false, true])
  expect(page.window.Utils.isNwjs()).toBe(false)
  // Other files are missing, writes go nowhere, other modules are not there.
  expect(() => fs.readFileSync('gameupdate/patch-config.txt')).toThrow(expect.objectContaining({ code: 'ENOENT' }))
  expect(fs.writeFileSync('gameupdate/previous_patch_sha.txt', 'x')).toBeUndefined()
  expect(() => require('child_process')).toThrow(expect.objectContaining({ code: 'MODULE_NOT_FOUND' }))
  expect([path.basename('save/file1.rmmzsave', '.rmmzsave'), path.extname('a/b.json'), path.dirname('a/b/c.png')]).toEqual(['file1', '.json', 'a/b'])
})

it('finds RPG Maker MV\'s numbered saves', () => {
  const page = htmlRuntime(1, (w) => {
    w.Utils = { RPGMAKER_NAME: 'MV', isNwjs: () => false }
    w.StorageManager = { exists: (id: number) => id === 3 || id === -1 }
  })
  page.fire('load')
  const fs = page.window.require('fs')
  expect(['save/file3.rpgsave', 'save/file4.rpgsave', 'save/config.rpgsave', 'save/global.rpgsave'].map((p) => fs.existsSync(p))).toEqual([true, false, true, false])
})

it('adds nothing to a page that is not RPG Maker', () => {
  const page = htmlRuntime(1)
  page.fire('load')
  expect([page.window.require, page.window.process]).toEqual([undefined, undefined])
})

it('sends a picture of the title screen once it has stood a few seconds, once', async () => {
  class Scene_Title {}
  const page = htmlRuntime(1, (w) => {
    w.Scene_Title = Scene_Title
    w.SceneManager = { _scene: null, snap: () => ({ canvas: { toDataURL: () => 'data:image/jpeg;base64,AAAA' } }) }
  })
  const before = page.intervals.length
  const pictures = () => page.post.mock.calls.map(([m]) => m).filter((m) => m.type === 'renplay:title-picture')
  // Half-second checks.
  const checks = async (n: number) => {
    for (let i = 0; i < n; i++) {
      for (const fn of page.intervals.slice(before)) fn()
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  page.message({ type: 'renplay:title-picture' })
  page.message({ type: 'renplay:title-picture' })
  expect(page.intervals.length - before).toBe(1)
  // A splash first, then the title screen for two seconds.
  await checks(3)
  page.window.SceneManager._scene = new Scene_Title()
  await checks(4)
  expect(pictures()).toEqual([])
  await checks(4)
  expect(pictures()).toEqual([expect.objectContaining({ data: 'data:image/jpeg;base64,AAAA' })])
})

it('sends a picture of the screen as it is now when the player asks, for the thumbnail', async () => {
  let scene: object | null = {}
  const page = htmlRuntime(1, (w) => {
    w.SceneManager = { get _scene() { return scene }, snap: () => ({ canvas: { toDataURL: () => 'data:image/jpeg;base64,BBBB' } }) }
    w.document.getElementsByTagName = () => []
  })
  const snaps = () => page.post.mock.calls.map(([m]) => m).filter((m) => m.type === 'renplay:snap')
  page.message({ type: 'renplay:snap', id: 'one' })
  await vi.waitFor(() => expect(snaps()).toEqual([expect.objectContaining({ id: 'one', data: 'data:image/jpeg;base64,BBBB' })]))
  // No scene and no canvas: no picture, and the player hears so.
  scene = null
  page.message({ type: 'renplay:snap', id: 'two' })
  await vi.waitFor(() => expect(snaps()[1]).toEqual(expect.objectContaining({ id: 'two', data: null })))
})
