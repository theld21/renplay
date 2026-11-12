import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '../util/fsx.js'

/**
 * This fork's own: the names an admin gives games, shown over the catalog's and the one the game
 * declares. Kept in titles.json in the data folder, so a reinstall keeps them.
 */
export class GameTitles {
  private readonly file: string
  private titles: Record<string, string> = {}
  private saving: Promise<void> = Promise.resolve()

  constructor(dataDir: string) {
    this.file = join(dataDir, 'titles.json')
    try {
      const read = JSON.parse(readFileSync(this.file, 'utf-8')) as unknown
      if (read && typeof read === 'object') for (const [id, t] of Object.entries(read)) if (typeof t === 'string' && t) this.titles[id] = t
    } catch {}
  }

  get(id: string): string | undefined {
    return Object.hasOwn(this.titles, id) ? this.titles[id] : undefined
  }

  /** Names a game, or with an empty name gives it back its own. */
  set(id: string, title: string): Promise<void> {
    if (title) this.titles[id] = title
    else delete this.titles[id]
    const text = JSON.stringify(this.titles, null, 2)
    this.saving = this.saving.catch(() => {}).then(() => writeFileAtomic(this.file, text))
    return this.saving
  }
}
