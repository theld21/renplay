import { useQuery } from '@tanstack/react-query'
import { Move, RotateCcw } from 'lucide-react'
import type { PadGames } from '@shared/api'
import { Pill } from '../../../lantern/controls'
import { Switch, errorText, useToast } from '../../../lantern/ui'
import { api } from '../../../lib/api'
import type { Pad } from './usePad'

/** This fork's own: the on-screen controls in the player's options. */
export default function PadPanel({ pad, gameId, onEdit }: { pad: Pad; gameId: string; onEdit: () => void }) {
  const toast = useToast()
  const others = useQuery({ queryKey: ['controls'], queryFn: () => api<PadGames>('/api/controls') })
  const from = (others.data?.games ?? []).filter((g) => g.id !== gameId)
  const { layout } = pad
  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="mb-0 text-xs font-medium text-zinc-400">On-screen buttons</p>
      <Switch checked={layout.on} onChange={(on) => pad.setLayout({ ...layout, on })} label="Show buttons over the game" hint="Arrows and buttons that press the game's keys. This game keeps its own layout." />
      {layout.on && (
        <>
          <label className="small muted" style={{ display: 'block' }}>
            How much they show
            <input aria-label="How much the buttons show" type="range" min="10" max="100" step="5" value={Math.round(layout.opacity * 100)} onChange={(e) => pad.setLayout({ ...layout, opacity: Number(e.target.value) / 100 })} className="mt-2 min-h-11 w-full" />
          </label>
          <div className="actions">
            <Pill size="sm" icon={<Move className="size-4" />} onClick={onEdit}>
              Lay them out
            </Pill>
            <Pill size="sm" variant="q" icon={<RotateCcw className="size-4" />} onClick={() => pad.reset()}>
              Default layout
            </Pill>
          </div>
        </>
      )}
      {from.length > 0 && (
        <label className="small muted" style={{ display: 'block' }}>
          Copy the layout of another game
          <select
            aria-label="Copy the layout of another game"
            className="input mt-2 w-full"
            value=""
            onChange={(e) => {
              const id = e.target.value
              if (id) void pad.copyFrom(id).then(() => toast('Layout copied', 'success'), (err) => toast(errorText(err), 'error'))
            }}
          >
            <option value="">Choose a game</option>
            {from.map((g) => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
