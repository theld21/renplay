import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { PackReader, PackWriter, writeIndex } from '../pipeline/pack.js'

it('finds a game file asked for in another case, as Windows does', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-case-'))
  try {
    const pack = new PackWriter(join(dir, 'assets.pack'))
    await pack.add('data/items.json', Buffer.from('[null]'))
    await pack.add('data/Items.json.bak', Buffer.from('old'))
    await pack.close()
    await writeIndex(join(dir, 'assets.json'), pack.index)
    const reader = new PackReader(join(dir, 'assets.pack'), join(dir, 'assets.json'))
    expect((await reader.read('data/Items.json'))?.toString()).toBe('[null]')
    expect((await reader.read('DATA/ITEMS.JSON'))?.toString()).toBe('[null]')
    expect(await reader.entry('data/Weapons.json')).toBeNull()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('gives the plain picture or sound for a file RPG Maker ships encrypted', async () => {
  const { decryptedRpgMaker } = await import('../play/rpgmaker.js')
  const dir = mkdtempSync(join(tmpdir(), 'pack-rpgm-'))
  try {
    const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
    const png = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n0000IHDR', 'latin1'), Buffer.from('rest of the picture')])
    const scrambled = Buffer.from(png)
    for (let i = 0; i < 16; i++) scrambled[i]! ^= key[i]!
    const header = Buffer.from('5250474d560000000003010000000000', 'hex')
    const pack = new PackWriter(join(dir, 'assets.pack'))
    await pack.add('data/System.json', Buffer.from(JSON.stringify({ hasEncryptedImages: true, encryptionKey: key.toString('hex') })))
    await pack.add('img/pictures/tati_01_1.rpgmvp', Buffer.concat([header, scrambled]))
    await pack.add('audio/se/hit.ogg_', Buffer.concat([header, scrambled]))
    await pack.close()
    await writeIndex(join(dir, 'assets.json'), pack.index)
    const reader = new PackReader(join(dir, 'assets.pack'), join(dir, 'assets.json'))
    expect(await decryptedRpgMaker(reader, 'img/pictures/tati_01_1.png')).toEqual(png)
    expect(await decryptedRpgMaker(reader, 'audio/se/hit.ogg')).toEqual(png)
    expect(await decryptedRpgMaker(reader, 'img/pictures/missing.png')).toBeNull()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
