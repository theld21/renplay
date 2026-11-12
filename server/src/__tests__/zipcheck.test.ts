import { expect, it } from 'vitest'
import yazl from 'yazl'
import { notInstallable, uploadRefusal, zipNames } from '../../../selector/src/lib/zipcheck.js'

function zip(paths: string[], zip64 = false): Promise<Blob> {
  return new Promise((resolve) => {
    const z = new yazl.ZipFile()
    for (const p of paths) z.addBuffer(Buffer.from('x'), p, { forceZip64Format: zip64 })
    z.end()
    const chunks: Buffer[] = []
    z.outputStream.on('data', (c: Buffer) => chunks.push(c))
    z.outputStream.on('end', () => resolve(new Blob([Buffer.concat(chunks)])))
  })
}
const named = async (name: string, paths: string[]) => new File([await zip(paths)], name)

it('reads the file list at the end of a zip, ZIP64 too', async () => {
  const paths = ['Game/Game.exe', 'Game/Game_Data/globalgamemanagers', 'Game/UnityPlayer.dll']
  expect(await zipNames(await zip(paths))).toEqual(paths)
  expect(await zipNames(await zip(paths, true))).toEqual(paths)
  expect(await zipNames(new Blob(['not a zip']))).toBeNull()
})

it('refuses PC builds browsers cannot run before they are sent', async () => {
  expect(await uploadRefusal(await named('Kaiju.zip', ['Kaiju/Kaiju.exe', 'Kaiju/UnityPlayer.dll', 'Kaiju/Kaiju_Data/data.unity3d']))).toMatch(/Unity game’s PC build/)
  expect(notInstallable(['Old/Game.exe', 'Old/Game.rgss3a'])).toMatch(/RPG Maker XP, VX or VX Ace/)
  expect(notInstallable(['G/game.exe', 'G/game.pck'])).toMatch(/Godot game’s PC build/)
})

it('sends what Renplay plays, and what it cannot tell', async () => {
  expect(notInstallable(['VN-1.0-pc/game/script.rpyc', 'VN-1.0-pc/lib/py3-windows-x86_64/UnityPlayer.dll'])).toBeNull()
  expect(notInstallable(['RPG/www/js/rmmz_core.js', 'RPG/Game.exe'])).toBeNull()
  expect(notInstallable(['Web/index.html', 'Web/Build/Web.loader.js', 'Web/Build/Web.data'])).toBeNull()
  expect(notInstallable(['G/index.html', 'G/index.pck', 'G/index.wasm'])).toBeNull()
  expect(await uploadRefusal(new File(['7z'], 'game.7z'))).toBeNull()
  expect(await uploadRefusal(new File(['broken'], 'game.zip'))).toBeNull()
})
