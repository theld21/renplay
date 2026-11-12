import { createWriteStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { writeFileAtomic } from '../util/fsx.js'
import { HttpError } from '../util/paths.js'

/** Byte ranges [start, end) of an upload the server has, sorted and merged. */
export type Ranges = Array<[number, number]>

interface UploadMeta {
  name: string
  size: number
  ranges?: Ranges
}

function merge(ranges: Ranges): Ranges {
  const out: Ranges = []
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** How much of the file the server has from its start. */
export const contiguous = (ranges: Ranges) => (ranges[0]?.[0] === 0 ? ranges[0][1] : 0)

/**
 * Chunked uploads that may arrive in any order and at once: a browser sends a few chunks side by
 * side, so one that stalls (iPhone Safari does) does not hold the others up. Each chunk is written
 * at its offset; the ranges the server has are kept beside the file. Uploads from before ranges
 * were kept had their chunks in order: their file's length is what arrived.
 */
export class Uploads {
  private writes = new Map<string, Promise<void>>()
  // Chunks arrive at once: they must all update the one copy of an upload's ranges.
  private live = new Map<string, Promise<UploadMeta & { ranges: Ranges }>>()

  constructor(private readonly dir: string) {}

  meta = (id: string) => join(this.dir, `${id}.json`)
  part = (id: string) => join(this.dir, `${id}.part`)

  read(id: string): Promise<UploadMeta & { ranges: Ranges }> {
    if (!/^u[a-z0-9]+$/.test(id)) return Promise.reject(new HttpError(400, 'Invalid upload id'))
    let meta = this.live.get(id)
    if (!meta) {
      meta = this.load(id)
      this.live.set(id, meta)
      meta.catch(() => this.live.delete(id))
    }
    return meta
  }

  private async load(id: string): Promise<UploadMeta & { ranges: Ranges }> {
    let meta: UploadMeta
    try {
      meta = JSON.parse(await readFile(this.meta(id), 'utf-8')) as UploadMeta
    } catch {
      throw new HttpError(404, 'Upload not found')
    }
    if (!meta.ranges) {
      const length = (await stat(this.part(id)).catch(() => null))?.size ?? 0
      meta.ranges = length ? [[0, length]] : []
    }
    return meta as UploadMeta & { ranges: Ranges }
  }

  /** Writes one chunk at its offset and records it once all of it is on disk. */
  async write(id: string, offset: number, length: number, body: Readable): Promise<Ranges> {
    const meta = await this.read(id)
    let written = 0
    const count = new Transform({
      transform(chunk: Buffer, _enc, done) {
        written += chunk.length
        done(null, chunk)
      },
    })
    await pipeline(body, count, createWriteStream(this.part(id), { flags: 'r+', start: offset }))
    if (written !== length) throw new HttpError(400, `The chunk had ${written} of ${length} bytes`)
    meta.ranges = merge([...meta.ranges, [offset, offset + length]])
    await this.save(id, meta)
    return meta.ranges
  }

  /** Saves one upload's ranges, one write at a time, the newest last. */
  private save(id: string, meta: UploadMeta): Promise<void> {
    const next = (this.writes.get(id) ?? Promise.resolve()).then(() => (this.live.has(id) ? writeFileAtomic(this.meta(id), JSON.stringify(meta)) : undefined))
    this.writes.set(id, next.catch(() => {}))
    return next
  }

  forget(id: string): void {
    this.live.delete(id)
    this.writes.delete(id)
  }
}
