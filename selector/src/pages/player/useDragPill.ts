import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react'

const KEY = 'renplay:menu-pill'
/** Moving less than this is a tap, not a drag. */
const SLOP = 8
/** A click this soon after a drag ends belongs to the drag. */
const CLICK_AFTER_DRAG_MS = 400
/** The pills stay this far inside the window. */
const MARGIN = 6

/** The pills' top left corner, as shares of the window's width and height. */
type Spot = { x: number; y: number }

function readSpot(): Spot | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Spot | null
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null
  } catch {
    return null
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * This fork's own: the menu pills over a game can be dragged anywhere on the screen. The place is
 * kept on this device as shares of the window, so it holds when the phone turns, and the pills
 * always stay inside the window. A drag is not a tap: the pills open nothing after one.
 */
export function useDragPill() {
  const [spot, setSpot] = useState<Spot | null>(readSpot)
  const latest = useRef(spot)
  latest.current = spot
  const size = useRef({ w: 44, h: 44 })
  const drag = useRef<{ id: number; x0: number; y0: number; left: number; top: number; moved: boolean } | null>(null)
  const dragEnded = useRef(0)
  const [, redraw] = useState(0)
  useEffect(() => {
    const onResize = () => redraw((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const place = (left: number, top: number): Spot => ({
    x: clamp(left, MARGIN, innerWidth - size.current.w - MARGIN) / innerWidth,
    y: clamp(top, MARGIN, innerHeight - size.current.h - MARGIN) / innerHeight,
  })

  const handlers = {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      const box = e.currentTarget.getBoundingClientRect()
      size.current = { w: box.width, h: box.height }
      drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, left: box.left, top: box.top, moved: false }
      dragEnded.current = 0
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      const dx = e.clientX - d.x0
      const dy = e.clientY - d.y0
      if (!d.moved && Math.hypot(dx, dy) < SLOP) return
      if (!d.moved) {
        d.moved = true
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {}
      }
      setSpot(place(d.left + dx, d.top + dy))
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      drag.current = null
      if (!d.moved) return
      dragEnded.current = Date.now()
      try {
        localStorage.setItem(KEY, JSON.stringify(latest.current))
      } catch {}
    },
    onPointerCancel() {
      drag.current = null
    },
    // The click that ends a drag opens nothing. A phone often sends none, so a later tap still opens.
    onClickCapture(e: ReactMouseEvent<HTMLElement>) {
      if (!dragEnded.current || Date.now() - dragEnded.current > CLICK_AFTER_DRAG_MS) return
      dragEnded.current = 0
      e.stopPropagation()
      e.preventDefault()
    },
  }

  // Where it was put, kept inside the window as it is now.
  const style: CSSProperties | null = spot
    ? {
        left: clamp(spot.x * innerWidth, MARGIN, innerWidth - size.current.w - MARGIN),
        top: clamp(spot.y * innerHeight, MARGIN, innerHeight - size.current.h - MARGIN),
        right: 'auto',
      }
    : null

  return { style, handlers }
}
