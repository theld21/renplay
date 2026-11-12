import { Router } from 'express'
import type { Services } from '../services.js'
import { normalizeLayout } from '../shared/controls.js'
import type { PadGames, PadLayoutAnswer } from '../shared/api.js'
import { HttpError } from '../util/paths.js'
import { ControlStore } from './store.js'

/** This fork's own: a person's on-screen control layout for each game. */
export function createControlsRouter(s: Services): Router {
  const { accounts, content, db } = s
  const store = new ControlStore(s.cfg.dataDir)
  const router = Router({ caseSensitive: true, strict: true })
  const me = () => accounts.current().id

  // The games to copy a layout from: those this person laid out and may see.
  router.get('/controls', async (_req, res) => {
    const games = []
    for (const { game, updatedAt } of await store.games(me())) {
      const row = db.getGame(game)
      if (row && !content.hides(row)) games.push({ id: row.id, title: s.titles.get(row.id) ?? row.title, updatedAt })
    }
    res.json({ games } satisfies PadGames)
  })

  router.get('/games/:id/controls', async (req, res) => {
    const g = content.game(req.params.id)
    res.json({ layout: await store.get(me(), g.id) } satisfies PadLayoutAnswer)
  })

  router.put('/games/:id/controls', async (req, res) => {
    const g = content.game(req.params.id)
    if (JSON.stringify(req.body ?? null).length > 64 << 10) throw new HttpError(413, 'This layout is too big')
    const layout = normalizeLayout(req.body?.layout)
    if (!layout) throw new HttpError(400, 'Send a layout')
    await store.set(me(), g.id, layout)
    res.json({ layout } satisfies PadLayoutAnswer)
  })

  router.delete('/games/:id/controls', async (req, res) => {
    const g = content.game(req.params.id)
    await store.remove(me(), g.id)
    res.json({ layout: null } satisfies PadLayoutAnswer)
  })

  return router
}
