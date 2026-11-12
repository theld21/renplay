/**
 * This fork's own check before an upload. A zip lists its files at its end, so the browser reads
 * that list (a few kilobytes, not the download) and refuses a game Renplay cannot install before
 * any of it is sent. Anything else, and other archive types, go up as before: the server decides.
 */

const EOCD = 0x06054b50
const ZIP64_LOCATOR = 0x07064b50
const ZIP64_EOCD = 0x06064b50
const CENTRAL = 0x02014b50
/** The end record, its longest comment and the ZIP64 locator before it. */
const TAIL = 22 + 0xffff + 20
/** A list longer than this is not read: the server still checks the game. */
const MAX_LIST = 64 << 20

async function bytesAt(file: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await file.slice(start, end).arrayBuffer())
}

/** The paths a zip lists, or null when it is not a zip this can read. */
export async function zipNames(file: Blob): Promise<string[] | null> {
  const tailStart = Math.max(0, file.size - TAIL)
  const tail = await bytesAt(file, tailStart, file.size)
  let end = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD) {
      end = i
      break
    }
  }
  if (end < 0) return null
  let count = tail.getUint16(end + 10, true)
  let size = tail.getUint32(end + 12, true)
  let offset = tail.getUint32(end + 16, true)
  if ((size === 0xffffffff || offset === 0xffffffff || count === 0xffff) && end >= 20 && tail.getUint32(end - 20, true) === ZIP64_LOCATOR) {
    const at = Number(tail.getBigUint64(end - 12, true))
    const record = await bytesAt(file, at, at + 56)
    if (record.getUint32(0, true) !== ZIP64_EOCD) return null
    count = Number(record.getBigUint64(32, true))
    size = Number(record.getBigUint64(40, true))
    offset = Number(record.getBigUint64(48, true))
  }
  if (size > MAX_LIST || offset + size > file.size) return null
  const list = await bytesAt(file, offset, offset + size)
  const decode = new TextDecoder()
  const names: string[] = []
  let p = 0
  for (let n = 0; n < count && p + 46 <= list.byteLength; n++) {
    if (list.getUint32(p, true) !== CENTRAL) return null
    const nameLength = list.getUint16(p + 28, true)
    const skip = nameLength + list.getUint16(p + 30, true) + list.getUint16(p + 32, true)
    names.push(decode.decode(new Uint8Array(list.buffer, list.byteOffset + p + 46, nameLength)).replace(/\\/g, '/'))
    p += 46 + skip
  }
  return names
}

/**
 * Why Renplay cannot install the game these paths make, or null when it may. The same signs as
 * the server's detection (server/src/pipeline/family.ts), for the PC builds browsers cannot run.
 */
export function notInstallable(names: string[]): string | null {
  const files = names.filter((n) => !n.endsWith('/') && !n.includes('__MACOSX/'))
  const has = (re: RegExp) => files.some((n) => re.test(n))
  // Games Renplay plays, and web builds.
  if (has(/(^|\/)game\/[^/]+\.(rpyc|rpy|rpa)$/i) || has(/(^|\/)js\/(rpg_core|rmmz_core)\.js$/i)) return null
  if (has(/(^|\/)Build\/([^/]*\.loader\.js|UnityLoader\.js)$/i)) return null
  const pcks = files.filter((n) => /\.pck$/i.test(n))
  if (pcks.length) {
    if (pcks.some((pck) => files.includes(pck.replace(/\.pck$/i, '.wasm')))) return null
    return 'This is a Godot game’s PC build. Renplay plays Godot games from their web build, the version you can play in the browser on itch.io.'
  }
  if (has(/_Data\/(globalgamemanagers|data\.unity3d)$/i) || has(/(^|\/)UnityPlayer\.(dll|so)$/i)) {
    return 'This is a Unity game’s PC build. Unity games play in a browser only from a WebGL build, which the developer makes.'
  }
  if (has(/(^|\/)Game\.rgss(ad|2a|3a)$/i) || has(/(^|\/)System\/RGSS\d+\w*\.dll$/i)) {
    return 'This is an RPG Maker XP, VX or VX Ace game, a Windows program that browsers cannot run.'
  }
  return null
}

/** Why this download is not sent, or null to send it. A list that cannot be read never stops it. */
export async function uploadRefusal(file: File): Promise<string | null> {
  if (!/\.zip$/i.test(file.name)) return null
  try {
    const names = await zipNames(file)
    return names ? notInstallable(names) : null
  } catch {
    return null
  }
}
