/**
 * This fork's own on-screen controls: buttons and a d-pad over a game that press its keys, laid
 * out per game and per person. The player draws them (selector/src/pages/player/vpad), the game's
 * runtime presses the keys (runtime/renplay-keys.js), the server keeps the layouts.
 */

/** Tap presses once, hold presses while the finger is down, toggle presses until tapped again. */
export type PadMode = 'tap' | 'hold' | 'toggle'

export interface PadButton {
  id: string
  kind: 'button'
  /** A key of PAD_KEYS. */
  key: string
  label: string
  mode: PadMode
  /** The centre, as a share of the screen's width and height. */
  x: number
  y: number
  /** The diameter, as a share of the screen's shorter side. */
  size: number
}

export interface PadDpad {
  id: string
  kind: 'dpad'
  x: number
  y: number
  size: number
}

export type PadControl = PadButton | PadDpad

export interface PadLayout {
  v: 1
  /** Shown over the game. */
  on: boolean
  /** How much the controls show while not pressed, from 0.1 to 1. */
  opacity: number
  landscape: PadControl[]
  portrait: PadControl[]
}

/** The keys a button can press: what a keyboard sends, as KeyboardEvent.key names them. */
export const PAD_KEYS: Array<{ key: string; label: string }> = [
  { key: 'Enter', label: 'Enter' },
  { key: 'Escape', label: 'Esc' },
  { key: ' ', label: 'Space' },
  { key: 'Shift', label: 'Shift' },
  { key: 'Control', label: 'Ctrl' },
  { key: 'Alt', label: 'Alt' },
  { key: 'Tab', label: 'Tab' },
  { key: 'Backspace', label: 'Backspace' },
  { key: 'ArrowUp', label: 'Up' },
  { key: 'ArrowDown', label: 'Down' },
  { key: 'ArrowLeft', label: 'Left' },
  { key: 'ArrowRight', label: 'Right' },
  { key: 'PageUp', label: 'Page up' },
  { key: 'PageDown', label: 'Page down' },
  { key: 'Home', label: 'Home' },
  { key: 'End', label: 'End' },
  { key: 'Insert', label: 'Insert' },
  { key: 'Delete', label: 'Delete' },
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((k) => ({ key: k, label: k.toUpperCase() })),
  ...'0123456789'.split('').map((k) => ({ key: k, label: k })),
  ...Array.from({ length: 12 }, (_, i) => ({ key: `F${i + 1}`, label: `F${i + 1}` })),
]
const KEYS = new Set(PAD_KEYS.map((k) => k.key))
const MODES: PadMode[] = ['tap', 'hold', 'toggle']

const button = (id: string, key: string, label: string, mode: PadMode, x: number, y: number, size: number): PadButton => ({ id, kind: 'button', key, label, mode, x, y, size })
const dpad = (x: number, y: number, size: number): PadDpad => ({ id: 'dpad', kind: 'dpad', x, y, size })

/**
 * The layout a game starts with. RPG Maker walks with arrows: a d-pad, OK, Cancel and Dash. Ren'Py
 * plays by touch already: a few of its keys, off until switched on. Portrait puts them under the game.
 */
export function defaultLayout(engine: 'rpgmaker' | 'renpy' | 'other', touch: boolean): PadLayout {
  if (engine === 'rpgmaker') {
    return {
      v: 1,
      on: touch,
      opacity: 0.45,
      landscape: [dpad(0.13, 0.7, 0.4), button('ok', 'Enter', 'OK', 'tap', 0.9, 0.74, 0.17), button('cancel', 'Escape', 'Back', 'tap', 0.78, 0.86, 0.15), button('dash', 'Shift', 'Dash', 'hold', 0.92, 0.48, 0.13)],
      portrait: [dpad(0.27, 0.8, 0.42), button('ok', 'Enter', 'OK', 'tap', 0.82, 0.76, 0.2), button('cancel', 'Escape', 'Back', 'tap', 0.66, 0.88, 0.17), button('dash', 'Shift', 'Dash', 'hold', 0.88, 0.92, 0.15)],
    }
  }
  const renpy = [button('skip', 'Control', 'Skip', 'toggle', 0.93, 0.3, 0.12), button('hide', 'h', 'Hide', 'tap', 0.93, 0.47, 0.12), button('back', 'PageUp', 'Back', 'tap', 0.93, 0.64, 0.12), button('menu', 'Escape', 'Menu', 'tap', 0.93, 0.81, 0.12)]
  return {
    v: 1,
    on: false,
    opacity: 0.45,
    landscape: engine === 'renpy' ? renpy : [dpad(0.13, 0.7, 0.4), button('ok', 'Enter', 'Enter', 'tap', 0.9, 0.74, 0.17)],
    portrait: engine === 'renpy' ? renpy.map((b, i) => ({ ...b, x: 0.2 + i * 0.2, y: 0.9, size: 0.17 })) : [dpad(0.27, 0.8, 0.42), button('ok', 'Enter', 'Enter', 'tap', 0.8, 0.8, 0.2)],
  }
}

const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback)

function control(c: unknown, i: number): PadControl | null {
  if (!c || typeof c !== 'object') return null
  const o = c as Record<string, unknown>
  const id = typeof o['id'] === 'string' && o['id'] ? o['id'].slice(0, 40) : `c${i}`
  const x = num(o['x'], 0, 1, 0.5)
  const y = num(o['y'], 0, 1, 0.5)
  if (o['kind'] === 'dpad') return { id, kind: 'dpad', x, y, size: num(o['size'], 0.15, 0.8, 0.4) }
  if (o['kind'] !== 'button' || typeof o['key'] !== 'string' || !KEYS.has(o['key'])) return null
  const mode = MODES.includes(o['mode'] as PadMode) ? (o['mode'] as PadMode) : 'tap'
  const label = typeof o['label'] === 'string' ? o['label'].slice(0, 12) : ''
  return { id, kind: 'button', key: o['key'], label, mode, x, y, size: num(o['size'], 0.06, 0.5, 0.15) }
}

/** A layout as stored or sent, made safe: unknown keys and controls dropped, numbers in range. Null when it is no layout. */
export function normalizeLayout(value: unknown): PadLayout | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 32).map(control).filter((c): c is PadControl => !!c) : [])
  return { v: 1, on: o['on'] === true, opacity: num(o['opacity'], 0.1, 1, 0.45), landscape: list(o['landscape']), portrait: list(o['portrait']) }
}
