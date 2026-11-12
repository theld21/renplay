import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { Game } from '@shared/api'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'

/**
 * This fork's own: a game without art gets a picture of its title screen. Once the game is ready
 * the player asks its runtime for one (runtime/renplay-title.js), and uploads it for everyone, as
 * an admin's own upload would be. Only for an admin, once a visit, never over a picture it has.
 */
export function useTitlePicture(game: Game | undefined, ready: boolean, frame: React.RefObject<HTMLIFrameElement | null>, send: (msg: Record<string, unknown>) => void) {
  const admin = useAuth().data?.user.role === 'admin'
  const qc = useQueryClient()
  const asked = useRef(false)
  const bare = !!game && !game.art.grid && !game.art.wide && !game.art.hero
  const id = game?.id
  // The game's answer may change while the picture is taken (its last played time): the request
  // stands on the game's id, not on the answer.
  useEffect(() => {
    if (!ready || !admin || !bare || !id || asked.current) return
    asked.current = true
    const onMessage = (e: MessageEvent) => {
      const d = e.data
      if (e.source !== frame.current?.contentWindow || !d || d.type !== 'renplay:title-picture') return
      if (typeof d.data !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(d.data) || d.data.length > 20 << 20) return
      window.removeEventListener('message', onMessage)
      void fetch(d.data)
        .then((r) => r.blob())
        .then((picture) => api(`/api/games/${id}/art/upload?kind=wide&scope=everyone`, { method: 'POST', body: picture, headers: { 'content-type': picture.type } }))
        .then(() => {
          void qc.invalidateQueries({ queryKey: ['game', id] })
          void qc.invalidateQueries({ queryKey: ['games'] })
        })
        .catch(() => {})
    }
    window.addEventListener('message', onMessage)
    send({ type: 'renplay:title-picture' })
    return () => window.removeEventListener('message', onMessage)
  }, [ready, admin, bare, id, frame, send, qc])
}
