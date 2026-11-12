import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Gamepad2 } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { PadButton, PadDpad } from '@shared/controls'
import { cx } from '../../../lantern/ui'
import { controlsOf, dpadKeys, place, type Area } from './geometry'
import PadEditor from './PadEditor'
import type { Pad } from './usePad'
import './vpad.css'

/** A tap still reaches games that read their keys once a frame. */
const TAP_MS = 90

/**
 * This fork's own on-screen controls over a game. Each control follows its own finger, so a d-pad
 * and a button work together. A touch never takes the focus from the game, and every key is let go
 * when the page hides, loses the window or the controls go away.
 */
export default function VirtualPad({ pad, insets }: { pad: Pad; insets: Area['insets'] }) {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  const { layout, editing, hidden, releaseAll } = pad
  const active = layout.on && !hidden && !editing
  useEffect(() => {
    if (!active) return releaseAll()
    const letGo = () => releaseAll()
    const onHide = () => document.visibilityState === 'hidden' && releaseAll()
    window.addEventListener('blur', letGo)
    window.addEventListener('pagehide', letGo)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('blur', letGo)
      window.removeEventListener('pagehide', letGo)
      document.removeEventListener('visibilitychange', onHide)
      releaseAll()
    }
  }, [active, releaseAll])

  const area: Area = { ...size, insets }
  if (editing) return <PadEditor pad={pad} area={area} />
  if (!layout.on) return null
  return (
    <div className="vpad" onContextMenu={(e) => e.preventDefault()}>
      <button
        type="button"
        className="vpad-toggle"
        style={{ left: '50%', marginLeft: -20, top: 8 + insets.top }}
        aria-label={hidden ? 'Show the on-screen buttons' : 'Hide the on-screen buttons'}
        aria-pressed={!hidden}
        onClick={() => pad.setHidden(!hidden)}
      >
        <Gamepad2 aria-hidden="true" style={hidden ? { opacity: 0.6 } : undefined} />
      </button>
      {!hidden && controlsOf(layout, area).map((c) => (c.kind === 'dpad' ? <Dpad key={c.id} c={c} area={area} pad={pad} /> : <Button key={c.id} c={c} area={area} pad={pad} />))}
    </div>
  )
}

/** The pointer handlers every control shares: its own finger only, and no focus or selection taken. */
function useFinger(onDown: (e: ReactPointerEvent<HTMLDivElement>) => void, onMove: (e: ReactPointerEvent<HTMLDivElement>) => void, onUp: () => void) {
  const finger = useRef<number | null>(null)
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      if (finger.current !== null) return
      finger.current = e.pointerId
      // The control keeps its finger even when it slides off. A pointer the page did not see cannot be held.
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {}
      onDown(e)
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerId === finger.current) onMove(e)
    },
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerId !== finger.current) return
      finger.current = null
      onUp()
    },
    onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerId !== finger.current) return
      finger.current = null
      onUp()
    },
    onLostPointerCapture: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerId !== finger.current) return
      finger.current = null
      onUp()
    },
  }
}

function Button({ c, area, pad }: { c: PadButton; area: Area; pad: Pad }) {
  const [down, setDown] = useState(false)
  const [latched, setLatched] = useState(false)
  const since = useRef(0)
  const { left, top, d } = place(c, area)
  // When the pad lets go of every key (the page hid, the drawer opened), a toggle is up again.
  useEffect(() => setLatched(false), [pad.released])
  const handlers = useFinger(
    () => {
      setDown(true)
      if (c.mode === 'toggle') {
        const next = !latched
        setLatched(next)
        pad.press(c.key, next)
        return
      }
      since.current = Date.now()
      pad.press(c.key, true)
    },
    () => {},
    () => {
      setDown(false)
      if (c.mode === 'toggle') return
      const wait = c.mode === 'tap' ? Math.max(0, TAP_MS - (Date.now() - since.current)) : 0
      if (wait) window.setTimeout(() => pad.press(c.key, false), wait)
      else pad.press(c.key, false)
    },
  )
  return (
    <div
      role="button"
      aria-label={c.label || c.key}
      aria-pressed={c.mode === 'toggle' ? latched : undefined}
      className={cx('vpad-c', down && 'on', latched && 'latched')}
      style={{ left, top, width: d, height: d, opacity: pad.layout.opacity, fontSize: Math.max(11, Math.min(18, d / 4)) }}
      {...handlers}
    >
      {c.label || c.key}
    </div>
  )
}

const ARMS = [
  { key: 'ArrowUp', icon: ChevronUp, style: { top: '4%', left: '33%' } },
  { key: 'ArrowDown', icon: ChevronDown, style: { bottom: '4%', left: '33%' } },
  { key: 'ArrowLeft', icon: ChevronLeft, style: { left: '4%', top: '33%' } },
  { key: 'ArrowRight', icon: ChevronRight, style: { right: '4%', top: '33%' } },
] as const

function Dpad({ c, area, pad }: { c: PadDpad; area: Area; pad: Pad }) {
  const [lit, setLit] = useState<string[]>([])
  const keys = useRef<string[]>([])
  const box = useRef<HTMLDivElement>(null)
  const { left, top, d } = place(c, area)
  // Sliding the finger changes direction without lifting it: only the keys that change are sent.
  const aim = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = box.current!.getBoundingClientRect()
    const next = dpadKeys(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width / 2)
    for (const k of keys.current) if (!next.includes(k)) pad.press(k, false)
    for (const k of next) if (!keys.current.includes(k)) pad.press(k, true)
    keys.current = next
    setLit(next)
  }
  const handlers = useFinger(aim, aim, () => {
    for (const k of keys.current) pad.press(k, false)
    keys.current = []
    setLit([])
  })
  return (
    <div ref={box} role="group" aria-label="Arrow keys" className="vpad-c vpad-dpad" style={{ left, top, width: d, height: d, opacity: pad.layout.opacity }} {...handlers}>
      {ARMS.map(({ key, icon: Icon, style }) => (
        <span key={key} className={cx('arm', lit.includes(key) && 'lit')} style={style}>
          <Icon aria-hidden="true" />
        </span>
      ))}
    </div>
  )
}
