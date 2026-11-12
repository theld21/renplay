import { Check, Circle, Gamepad2, RotateCcw, Trash2 } from 'lucide-react'
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { PAD_KEYS, type PadControl, type PadMode } from '@shared/controls'
import { Pill, Seg } from '../../../lantern/controls'
import { cx } from '../../../lantern/ui'
import { controlsOf, place, type Area } from './geometry'
import type { Pad } from './usePad'

/**
 * This fork's own layout editor, over the game: drag a control to move it, drag its handle to size
 * it, tap it to choose its key, label and how it presses. Portrait and landscape are laid out
 * apart: what is edited is the screen's shape now. Every change is kept as it is made.
 */
export default function PadEditor({ pad, area }: { pad: Pad; area: Area }) {
  const portrait = area.h > area.w
  const controls = controlsOf(pad.layout, area)
  const [picked, setPicked] = useState<string | null>(controls[0]?.id ?? null)
  const drag = useRef<{ id: string; pointer: number; grow: boolean; x: number; y: number; start: PadControl } | null>(null)
  const set = (next: PadControl[]) => pad.setLayout({ ...pad.layout, [portrait ? 'portrait' : 'landscape']: next })
  const change = (id: string, patch: Partial<PadControl>) => set(controls.map((c) => (c.id === id ? ({ ...c, ...patch } as PadControl) : c)))
  const add = (kind: 'button' | 'dpad') => {
    const id = `${kind}-${Date.now().toString(36)}`
    const c: PadControl = kind === 'dpad' ? { id, kind, x: 0.2, y: 0.6, size: 0.4 } : { id, kind, key: 'Enter', label: 'Enter', mode: 'tap', x: 0.5, y: 0.5, size: 0.15 }
    set([...controls, c])
    setPicked(id)
  }
  const one = controls.find((c) => c.id === picked)

  const start = (e: ReactPointerEvent, c: PadControl, grow: boolean) => {
    e.preventDefault()
    e.stopPropagation()
    setPicked(c.id)
    drag.current = { id: c.id, pointer: e.pointerId, grow, x: e.clientX, y: e.clientY, start: c }
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {}
  }
  const move = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d || d.pointer !== e.pointerId) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (d.grow) change(d.id, { size: Math.min(0.8, Math.max(0.06, d.start.size + (dx + dy) / Math.min(area.w, area.h))) })
    else change(d.id, { x: Math.min(1, Math.max(0, d.start.x + dx / area.w)), y: Math.min(1, Math.max(0, d.start.y + dy / area.h)) })
  }
  const end = (e: ReactPointerEvent) => {
    if (drag.current?.pointer === e.pointerId) drag.current = null
  }

  return (
    <div className="vpad editing" onPointerDown={() => setPicked(null)} onContextMenu={(e) => e.preventDefault()}>
      <div className="vpad-bar" style={{ top: 8 + area.insets.top }} onPointerDown={(e) => e.stopPropagation()}>
        <Pill size="sm" icon={<Circle />} onClick={() => add('button')}>Button</Pill>
        <Pill size="sm" icon={<Gamepad2 />} onClick={() => add('dpad')}>Arrows</Pill>
        <Pill size="sm" variant="q" icon={<RotateCcw />} onClick={() => pad.reset()}>Default</Pill>
        <Pill size="sm" variant="p" icon={<Check />} onClick={() => pad.setEditing(false)}>Done</Pill>
      </div>
      {controls.map((c) => {
        const { left, top, d } = place(c, area)
        return (
          <div
            key={c.id}
            className={cx('vpad-c', c.kind === 'dpad' && 'vpad-dpad', picked === c.id && 'picked')}
            style={{ left, top, width: d, height: d, fontSize: Math.max(11, Math.min(18, d / 4)) }}
            onPointerDown={(e) => start(e, c, false)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            {c.kind === 'dpad' ? 'Arrows' : c.label || c.key}
            {picked === c.id && <span className="vpad-grow" aria-label="Drag to resize" onPointerDown={(e) => start(e, c, true)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />}
          </div>
        )
      })}
      {one ? (
        <div className="vpad-inspect" style={{ bottom: 8 + area.insets.bottom }} onPointerDown={(e) => e.stopPropagation()}>
          {one.kind === 'button' && (
            <>
              <select
                aria-label="Key"
                value={one.key}
                onChange={(e) => {
                  const key = PAD_KEYS.find((k) => k.key === e.target.value)!
                  // A label that was the old key's name follows the new key.
                  const named = PAD_KEYS.find((k) => k.key === one.key)?.label === one.label || !one.label
                  change(one.id, { key: key.key, ...(named ? { label: key.label } : {}) })
                }}
              >
                {PAD_KEYS.map((k) => (
                  <option key={k.key} value={k.key}>{k.label}</option>
                ))}
              </select>
              <input aria-label="Label" maxLength={12} value={one.label} onChange={(e) => change(one.id, { label: e.target.value })} />
              <Seg<PadMode>
                small
                label="How it presses"
                value={one.mode}
                onChange={(mode) => change(one.id, { mode })}
                options={[
                  { value: 'tap', label: 'Tap' },
                  { value: 'hold', label: 'Hold' },
                  { value: 'toggle', label: 'On and off' },
                ]}
              />
            </>
          )}
          <Pill size="sm" variant="q" icon={<Trash2 />} onClick={() => (set(controls.filter((c) => c.id !== one.id)), setPicked(null))}>
            Remove
          </Pill>
        </div>
      ) : (
        <p className="vpad-inspect small" style={{ bottom: 8 + area.insets.bottom }}>
          Drag to move. Tap one to change it. Laying out for {portrait ? 'portrait' : 'landscape'}.
        </p>
      )}
    </div>
  )
}
