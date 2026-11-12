import { mkdir } from 'node:fs/promises'
import { hashArchive } from './library/archives.js'
import { downloadCatalogGame } from './library/itch.js'
import { ArtStore } from './art/store.js'
import { GameArt } from './art/fromgame.js'
import { GameTitles } from './games/titles.js'
import { Accounts } from './accounts/accounts.js'
import { SaveBackups } from './saves/backups.js'
import { Builds } from './games/builds.js'
import { Catalog } from './catalog/catalog.js'
import type { Config } from './config.js'
import { ContentMode } from './content/mode.js'
import { Db } from './db.js'
import { EngineStore } from './engines.js'
import { JobManager } from './jobs/manager.js'
import { ProgressStore } from './progress/store.js'
import { Overlays } from './games/mods.js'
import { applyMods } from './pipeline/applymods.js'
import { runImport } from './pipeline/import.js'
import { Telemetry } from './telemetry/telemetry.js'
import type { SaveStore } from './saves/store.js'
import { SaveStores } from './saves/stores.js'
import { Purger } from './util/purge.js'
import { VERSION } from './util/version.js'

/**
 * What the server's parts share, made once at start. Every router and job gets it. The signed-in
 * person comes from the request (accounts/context.ts), so `saves` is that person's.
 */
export interface Services {
  cfg: Config
  db: Db
  version: string
  content: ContentMode
  accounts: Accounts
  progress: ProgressStore
  /** The signed-in person's saves. */
  readonly saves: SaveStore
  /** Everyone's saves, with their notes. */
  saveStores: SaveStores
  purger: Purger
  jobs: JobManager
  builds: Builds
  engines: EngineStore
  overlays: Overlays
  art: ArtStore
  /** This fork's own: art from a game's build for games without any. */
  gameArt: GameArt
  /** This fork's own: names an admin gave games. */
  titles: GameTitles
  catalog: Catalog
  backups: SaveBackups
  telemetry: Telemetry
}

export async function createServices(cfg: Config): Promise<Services> {
  const db = Db.open(cfg.dataDir, cfg.backupDir)
  for (const d of [cfg.dataDir, cfg.walkthroughsDir, cfg.overlaysDir, cfg.internalDir, cfg.workDir, cfg.archivesDir, cfg.uploadsDir, cfg.enginesDir, cfg.purgeDir]) await mkdir(d, { recursive: true })
  // The content mode asks the catalog which save folders are adult; the catalog needs the content mode.
  let catalog: Catalog | null = null
  const content = new ContentMode(cfg, db, () => catalog?.adultSaveDirs() ?? [])
  const progress = new ProgressStore(db)
  const saveStores = new SaveStores(cfg, db)
  const art = new ArtStore(cfg, db, content)
  const accounts = new Accounts(db, cfg, content, saveStores)
  try {
    await accounts.init()
  } catch (error) {
    db.close()
    throw error
  }
  const purger = new Purger(cfg.purgeDir)
  catalog = new Catalog(cfg, db, content, art)
  await catalog.init()
  const builds = new Builds(cfg, db, purger)
  const linked = catalog
  const s: Services = {
    cfg,
    db,
    version: VERSION,
    content,
    accounts,
    progress,
    get saves() {
      return saveStores.of(accounts.current().id)
    },
    purger,
    jobs: new JobManager(db, cfg),
    builds,
    engines: new EngineStore(cfg, db, purger),
    overlays: new Overlays(cfg),
    art,
    titles: new GameTitles(cfg.dataDir),
    gameArt: new GameArt(art, builds, (row) => linked.gameSubject(row).pictures.length > 0),
    catalog,
    saveStores,
    backups: new SaveBackups(cfg, db, saveStores),
    telemetry: new Telemetry({ cfg, db, catalog, content, accounts, saveStores, version: VERSION }),
  }
  s.jobs.register('import', 'Install', async (ctx) => {
    const result = await s.telemetry.install(ctx, async () => (await runImport(ctx, s)) as { recipe?: string | null; engine?: string; game?: string })
    // A game outside the catalog gets its title screen as its art.
    const row = result?.game ? db.getGame(result.game) : null
    if (row) await s.gameArt.give(row).catch(() => {})
    return result
  })
  s.jobs.register('apply-mods', 'Mod build', async (ctx) => {
    const built = await applyMods(ctx, s)
    s.telemetry.feature('modBuilds')
    return built
  })
  s.jobs.register('hash-archive', 'Checksum', (ctx) => hashArchive(ctx, s))
  s.jobs.register('catalog-download', 'Download', (ctx) => downloadCatalogGame(ctx, s))
  return s
}
