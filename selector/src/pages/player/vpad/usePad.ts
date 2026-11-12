import { useCallback, useEffect, useRef, useState } from 'react'
import type { Game, PadLayoutAnswer } from '@shared/api'
import { defaultLayout, normalizeLayout, type PadLayout } from '@shared/controls'
import { api, del, put } from '../../../lib/api'

/** Which default a game gets: RPG Maker walks with arrows, Ren'Py plays by touch. */
function engineOf(game: Game | undefined): 'rpgmaker' | 'renpy' | 'other' {
  if (!game) return 'other'
  if (game.family === 'renpy') return 'renpy'
  return /^RPGM \((MV|MZ)/.test(game.engineLabel ?? '') ? 'rpgmaker' : 'other'
}

const mirrorKey = (id: string) => `renplay:pad:${id}`
function mirrored(id: string): PadLayout | null {
  try {
    return normalizeLayout(JSON.parse(localStorage.getItem(mirrorKey(id)) ?? 'null'))
  } catch {
    return null
  }
}

export interface Pad {
  layout: PadLayout
  /** Changes the layout here at once, and on the server a moment later. */
  setLayout: (layout: PadLayout) => void
  editing: boolean
  setEditing: (on: boolean) => void
  /** Hidden for now from the screen's own toggle, until shown again. */
  hidden: boolean
  setHidden: (on: boolean) => void
  press: (key: string, down: boolean) => void
  releaseAll: () => void
  /** Counts the times every key was let go, so toggles show up again. */
  released: number
  copyFrom: (game: string) => Promise<void>
  reset: () => void
}

/**
 * This fork's own on-screen controls for one game: its layout (this person's, mirrored on this
 * device so a slow network never holds it up, else the default for its engine) and the keys they
 * hold down in the game.
 */
export function usePad(game: Game | undefined, touch: boolean, send: (msg: Record<string, unknown>) => void): Pad {
  const id = game?.id ?? ''
  const engine = engineOf(game)
  const fallback = useCallback(() => defaultLayout(engine, touch), [engine, touch])
  const [layout, setState] = useState<PadLayout>(() => (id && mirrored(id)) || fallback())
  const [editing, setEditing] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [released, setReleased] = useState(0)
  const held = useRef(new Set<string>())
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!id) return
    setState(mirrored(id) ?? fallback())
    let live = true
    api<PadLayoutAnswer>(`/api/games/${id}/controls`)
      .then(({ layout: saved }) => {
        if (!live || !saved) return
        setState(saved)
        localStorage.setItem(mirrorKey(id), JSON.stringify(saved))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [id, fallback])

  const setLayout = useCallback((next: PadLayout) => {
    setState(next)
    if (!id) return
    localStorage.setItem(mirrorKey(id), JSON.stringify(next))
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void put(`/api/games/${id}/controls`, { layout: next }).catch(() => {}), 600)
  }, [id])

  const press = useCallback((key: string, down: boolean) => {
    if (down === held.current.has(key)) return
    if (down) held.current.add(key)
    else held.current.delete(key)
    send({ type: 'renplay:key', key, down })
  }, [send])

  const releaseAll = useCallback(() => {
    for (const key of [...held.current]) press(key, false)
    send({ type: 'renplay:keys-release' })
    setReleased((n) => n + 1)
  }, [press, send])

  const copyFrom = useCallback(async (other: string) => {
    const { layout: copied } = await api<PadLayoutAnswer>(`/api/games/${other}/controls`)
    if (copied) setLayout({ ...copied, on: true })
  }, [setLayout])

  const reset = useCallback(() => {
    if (!id) return
    localStorage.removeItem(mirrorKey(id))
    window.clearTimeout(timer.current)
    void del(`/api/games/${id}/controls`).catch(() => {})
    setState({ ...fallback(), on: true })
  }, [id, fallback])

  return { layout, setLayout, editing, setEditing, hidden, setHidden, press, releaseAll, released, copyFrom, reset }
}
