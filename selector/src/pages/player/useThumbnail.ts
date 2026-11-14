import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { errorText } from '../../lantern/ui'

/** How long the game has to answer with its picture. */
const WAIT_MS = 10_000

/**
 * This fork's own: the screen as it is now becomes the game's thumbnail. The player asks the game's
 * runtime for a picture (runtime/renplay-title.js) and uploads it as the tile's picture and the wide
 * one. An admin's is for everyone, as the title picture is, anyone else's for themselves.
 */
export function useThumbnail(gameId: string | undefined, frame: React.RefObject<HTMLIFrameElement | null>, send: (msg: Record<string, unknown>) => void, toast: (text: string, tone?: 'success' | 'error' | 'info') => void) {
  const admin = useAuth().data?.user.role === 'admin'
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  const take = useCallback(async () => {
    if (!gameId || busy) return
    setBusy(true)
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const stop = () => {
          clearTimeout(timer)
          window.removeEventListener('message', onMessage)
        }
        const timer = setTimeout(() => {
          stop()
          reject(new Error('The game did not answer. Try again in a moment.'))
        }, WAIT_MS)
        const onMessage = (e: MessageEvent) => {
          const d = e.data
          if (e.source !== frame.current?.contentWindow || !d || d.type !== 'renplay:snap' || d.id !== id) return
          stop()
          if (typeof d.data === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(d.data) && d.data.length <= 20 << 20) resolve(d.data)
          else reject(new Error('The game could not take a picture of its screen.'))
        }
        window.addEventListener('message', onMessage)
        send({ type: 'renplay:snap', id })
      })
      const picture = await (await fetch(data)).blob()
      const scope = admin ? 'everyone' : 'me'
      for (const kind of ['grid', 'wide']) {
        await api(`/api/games/${gameId}/art/upload?kind=${kind}&scope=${scope}`, { method: 'POST', body: picture, headers: { 'content-type': picture.type } })
      }
      void qc.invalidateQueries({ queryKey: ['game', gameId] })
      void qc.invalidateQueries({ queryKey: ['games'] })
      toast('Thumbnail set from this screen.', 'success')
    } catch (error) {
      toast(errorText(error), 'error')
    } finally {
      setBusy(false)
    }
  }, [gameId, busy, frame, send, admin, qc, toast])

  return { take, busy }
}
