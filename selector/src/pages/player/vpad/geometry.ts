import type { PadControl, PadLayout } from '@shared/controls'

export interface Area {
  w: number
  h: number
  insets: { top: number; right: number; bottom: number; left: number }
}

/** The controls for the screen's shape now: portrait and landscape are laid out apart. */
export const controlsOf = (layout: PadLayout, area: Area): PadControl[] => (area.h > area.w ? layout.portrait : layout.landscape)

/** Where a control sits in pixels: its box, kept inside the safe area. */
export function place(c: PadControl, area: Area): { left: number; top: number; d: number } {
  const d = Math.round(c.size * Math.min(area.w, area.h))
  const { insets } = area
  const cx = Math.min(Math.max(c.x * area.w, insets.left + d / 2), area.w - insets.right - d / 2)
  const cy = Math.min(Math.max(c.y * area.h, insets.top + d / 2), area.h - insets.bottom - d / 2)
  return { left: Math.round(cx - d / 2), top: Math.round(cy - d / 2), d }
}

/** The arrow keys a d-pad point means, eight ways, nothing near its middle. */
export function dpadKeys(dx: number, dy: number, radius: number): string[] {
  if (Math.hypot(dx, dy) < radius * 0.2) return []
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4))
  const ways: Record<number, string[]> = {
    0: ['ArrowRight'], 1: ['ArrowRight', 'ArrowDown'], 2: ['ArrowDown'], 3: ['ArrowLeft', 'ArrowDown'],
    4: ['ArrowLeft'], [-4]: ['ArrowLeft'], [-3]: ['ArrowLeft', 'ArrowUp'], [-2]: ['ArrowUp'], [-1]: ['ArrowRight', 'ArrowUp'],
  }
  return ways[sector] ?? []
}
