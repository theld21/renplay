import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { NO_INSETS, safeInsets, type Insets } from '../../lib/display'

/** An element's size, measured again when it resizes. `key` changes when the element is a new one. */
export function useElementSize(ref: RefObject<HTMLElement | null>, key: unknown): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return size
}

/** The screen's real safe area (camera cutout, rounded corners, home indicator), per orientation. */
export function useSafeInsets(): Insets {
  const [insets, setInsets] = useState<Insets>(NO_INSETS)
  useEffect(() => {
    const update = () => setInsets(safeInsets())
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  return insets
}

/**
 * A pinch zooms nothing while a game is played: zooming the page made an iPhone draw the game's
 * canvas again at the larger size, run out of memory and load the game again. Pinches inside the
 * game are stopped by the game's runtime (runtime/renplay-player.js).
 */
export function useNoPinch(): void {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    const was = meta?.content
    if (meta && was) meta.content = `${was.replace(/,\s*(maximum-scale|user-scalable)=[^,]*/g, '')}, maximum-scale=1, user-scalable=no`
    const stop = (e: Event) => e.preventDefault()
    const twoFingers = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault()
    }
    document.addEventListener('gesturestart', stop, { passive: false })
    document.addEventListener('gesturechange', stop, { passive: false })
    document.addEventListener('touchmove', twoFingers, { passive: false })
    return () => {
      if (meta && was) meta.content = was
      document.removeEventListener('gesturestart', stop)
      document.removeEventListener('gesturechange', stop)
      document.removeEventListener('touchmove', twoFingers)
    }
  }, [])
}

/** Keeps the screen on while `on` (reading a long scene is not "idle"). */
export function useWakeLock(on: boolean): void {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let done = false
    const take = async () => {
      try {
        if (!done && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen')
      } catch {}
    }
    void take()
    document.addEventListener('visibilitychange', take)
    return () => {
      done = true
      document.removeEventListener('visibilitychange', take)
      void lock?.release().catch(() => {})
    }
  }, [on])
}
