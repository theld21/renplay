import { join } from 'node:path'
import sharp from 'sharp'
import type { GameRow } from '../db.js'
import type { Builds } from '../games/builds.js'
import { baseOf } from '../games/builds.js'
import { PackReader } from '../pipeline/pack.js'
import { decryptedRpgMaker } from '../play/rpgmaker.js'
import type { ArtKind } from '../shared/recipe.js'
import { log } from '../util/log.js'
import { readZipEntries } from '../util/zip.js'
import { EVERYONE, type ArtStore } from './store.js'

/**
 * This fork's own art for games outside the catalog: the game's title screen, its window icon and
 * its logo, taken from its build and uploaded for everyone as an admin would, so the art pipeline
 * makes every format from them. Only for a game that has no picture at all, never over a choice.
 */

const IMAGE = /\.(png|jpe?g|webp)$/i
const ZIP_LIMITS = { files: 1_000_000, fileBytes: 256 << 20, totalBytes: Number.MAX_SAFE_INTEGER }
/** A picture this small is a plain colour (Ren'Py's own main_menu.png), not art. */
const MIN_BYTES = 30 << 10

interface GamePicture {
  kind: ArtKind
  data: Buffer
  from: string
}

/** How much a Ren'Py picture's path looks like its title screen, 0 for not at all. */
function titleScore(path: string): number {
  if (/(^|\/)(overlay|phone|icons?|buttons?|frames?|bars?)\//i.test(path)) return 0
  const base = path.slice(path.lastIndexOf('/') + 1).replace(IMAGE, '').toLowerCase()
  if (/(button|btn|idle|hover|insensitive|selected|icon|logo|overlay|frame|slider|scroll)/.test(base)) return 0
  if (/^(main_?menu|title([ _-]?(bg|screen|background|game))?|menu[ _-]?(bg|background))[ _-]?\d*$/.test(base)) return 3
  if (/(cover|key_?art|splash|poster)/.test(base)) return 2
  // A picture in the main menu's own folder: images/menus/mainmenu/trio_intro.jpg.
  if (/(^|\/)(main_?menu|title(_?screen)?)\//i.test(path)) return 2
  if (/(title|main_?menu)/.test(base)) return 1
  return 0
}

async function sizeOf(data: Buffer): Promise<{ width: number; height: number; alpha: boolean } | null> {
  const m = await sharp(data, { failOn: 'none' }).metadata().catch(() => null)
  return m?.width && m.height ? { width: m.width, height: m.height, alpha: !!m.hasAlpha } : null
}
const isScreen = (s: { width: number; height: number }) => s.width >= 640 && s.height >= 360 && s.width / s.height >= 1.2 && s.width / s.height <= 2.5

/** A Ren'Py build's pictures: in its pack by their path in game/, or in game.zip under game/. */
async function renpyPictures(dir: string, pack: PackReader): Promise<GamePicture[]> {
  const inPack = new Set([...(await pack.index().catch(() => new Map<string, [number, number]>())).keys()].filter((n) => IMAGE.test(n)))
  const names = new Set(inPack)
  const zip = join(dir, 'game.zip')
  await readZipEntries(zip, (n) => {
    if (n.startsWith('game/') && IMAGE.test(n)) names.add(n.slice(5))
    return false
  }, ZIP_LIMITS).catch(() => null)
  const all = [...names]
  const titles = all.map((n) => [n, titleScore(n)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 16)
  const icon = all.find((n) => /(^|\/)gui\/window_icon\.\w+$/i.test(n))
  const logo = all.filter((n) => /(^|\/)(game_?)?logo\.(png|webp)$/i.test(n)).sort((a, b) => a.split('/').length - b.split('/').length)[0]
  const wanted = new Set([...titles.map(([n]) => n), icon, logo].filter((n): n is string => !!n && !inPack.has(n)))
  const zipped = wanted.size ? await readZipEntries(zip, (n) => n.startsWith('game/') && wanted.has(n.slice(5)), ZIP_LIMITS).catch(() => new Map<string, Buffer>()) : new Map<string, Buffer>()
  const bytes = async (n: string) => (inPack.has(n) ? await pack.read(n) : zipped.get(`game/${n}`) ?? null)

  const out: GamePicture[] = []
  let best: { from: string; data: Buffer; score: number; area: number } | null = null
  for (const [from, score] of titles) {
    const data = await bytes(from)
    const size = data && data.length >= MIN_BYTES ? await sizeOf(data) : null
    if (!data || !size || !isScreen(size)) continue
    const area = size.width * size.height
    if (!best || score > best.score || (score === best.score && area > best.area)) best = { from, data, score, area }
  }
  if (best) out.push({ kind: 'wide', data: best.data, from: best.from })
  const iconData = icon ? await bytes(icon) : null
  const iconSize = iconData ? await sizeOf(iconData) : null
  if (iconData && iconSize && iconSize.width >= 128 && Math.abs(iconSize.width - iconSize.height) <= iconSize.width * 0.1) out.push({ kind: 'icon', data: iconData, from: icon! })
  const logoData = logo ? await bytes(logo) : null
  const logoSize = logoData ? await sizeOf(logoData) : null
  if (logoData && logoSize?.alpha && logoSize.width >= 200) out.push({ kind: 'logo', data: logoData, from: logo! })
  return out
}

/** An RPG Maker MV or MZ game's title picture, as its System.json names it (decrypted when it is). */
async function rpgMakerPictures(pack: PackReader): Promise<GamePicture[]> {
  const system = await pack.read('data/System.json').catch(() => null)
  if (!system) return []
  let name = ''
  try {
    name = String((JSON.parse(system.toString('utf-8').replace(/^﻿/, '')) as { title1Name?: unknown }).title1Name ?? '')
  } catch {
    return []
  }
  if (!name) return []
  // The picture it names, or else the ones named after it (title01, title02 for a plugin that picks one).
  const index = await pack.index().catch(() => new Map<string, [number, number]>())
  const prefix = `img/titles1/${name}`.toLowerCase()
  const named = [...index.keys()]
    .filter((n) => n.toLowerCase().startsWith(prefix) && /\.(png|rpgmvp|png_)$/i.test(n))
    .map((n) => n.replace(/\.(rpgmvp|png_)$/i, '.png'))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
  for (const from of [...new Set([`img/titles1/${name}.png`, ...named])].slice(0, 6)) {
    const data = (await pack.read(from).catch(() => null)) ?? (await decryptedRpgMaker(pack, from).catch(() => null))
    const size = data && data.length >= MIN_BYTES ? await sizeOf(data) : null
    if (data && size && isScreen(size)) return [{ kind: 'wide', data, from }]
  }
  return []
}

/** The pictures a game's build has for its art. */
async function picturesFromBuild(dir: string, family: string): Promise<GamePicture[]> {
  const pack = new PackReader(join(dir, 'assets.pack'), join(dir, 'assets.json'))
  if (family === 'renpy') return renpyPictures(dir, pack)
  if (family === 'html') return rpgMakerPictures(pack)
  return []
}

export class GameArt {
  constructor(
    private readonly art: ArtStore,
    private readonly builds: Builds,
    /** Whether a game already has a picture: the catalog's or an upload. */
    private readonly hasPictures: (row: GameRow) => boolean,
  ) {}

  /** Gives a game without pictures the ones its build has. */
  async give(row: GameRow): Promise<void> {
    if (!row.build || row.status !== 'installed' || this.hasPictures(row)) return
    for (const p of await picturesFromBuild(this.builds.dir(row.id, baseOf(row.build)), row.family).catch(() => [])) {
      try {
        const { id } = await this.art.upload(row.id, p.kind, p.data, null, EVERYONE)
        this.art.choose(row.id, p.kind, id, EVERYONE)
        log('art', `${row.title}: its ${p.kind} picture from ${p.from}`)
      } catch (e) {
        log('art', `${row.title}: ${p.from} could not be used (${(e as Error).message})`, 'warn')
      }
    }
  }

  /** Every game, one after another, in the background after a start. */
  async backfill(rows: GameRow[]): Promise<void> {
    for (const row of rows) await this.give(row).catch(() => {})
  }
}
