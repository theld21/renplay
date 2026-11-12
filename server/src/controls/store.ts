import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeLayout, type PadLayout } from '../shared/controls.js'
import { writeFileAtomic } from '../util/fsx.js'

type Saved = Record<string, { layout: PadLayout; updatedAt: number }>

/** Each person's on-screen control layouts, one file per person in the data folder's controls/. */
export class ControlStore {
  private readonly dir: string
  private readonly cache = new Map<number, Promise<Saved>>()
  private readonly writes = new Map<number, Promise<void>>()

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'controls')
  }

  private file(user: number): string {
    return join(this.dir, `${user}.json`)
  }

  private read(user: number): Promise<Saved> {
    let hit = this.cache.get(user)
    if (!hit) {
      hit = readFile(this.file(user), 'utf-8')
        .then((text) => {
          const out: Saved = {}
          for (const [game, v] of Object.entries(JSON.parse(text) as Record<string, { layout?: unknown; updatedAt?: unknown }>)) {
            const layout = normalizeLayout(v?.layout)
            if (layout) out[game] = { layout, updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0 }
          }
          return out
        })
        .catch(() => ({}))
      this.cache.set(user, hit)
    }
    return hit
  }

  private write(user: number, saved: Saved): Promise<void> {
    const text = JSON.stringify(saved)
    const next = (this.writes.get(user) ?? Promise.resolve()).catch(() => {}).then(() => writeFileAtomic(this.file(user), text))
    this.writes.set(user, next)
    return next
  }

  async get(user: number, game: string): Promise<PadLayout | null> {
    return (await this.read(user))[game]?.layout ?? null
  }

  async set(user: number, game: string, layout: PadLayout): Promise<void> {
    const saved = await this.read(user)
    saved[game] = { layout, updatedAt: Date.now() }
    await this.write(user, saved)
  }

  async remove(user: number, game: string): Promise<void> {
    const saved = await this.read(user)
    if (!(game in saved)) return
    delete saved[game]
    await this.write(user, saved)
  }

  /** The games this person laid out, newest first. */
  async games(user: number): Promise<Array<{ game: string; updatedAt: number }>> {
    return Object.entries(await this.read(user)).map(([game, v]) => ({ game, updatedAt: v.updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt)
  }
}
