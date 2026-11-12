import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Game } from '@shared/api'
import { Pill } from '../lantern/controls'
import { errorText, useToast } from '../lantern/ui'
import { put } from '../lib/api'
import { useAuth } from '../lib/auth'

/** This fork's own: an admin names a game as the library shows it, or gives it back its own name. */
export default function GameName({ game }: { game: Game }) {
  const admin = useAuth().data?.user.role === 'admin'
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(game.title)
  const [saving, setSaving] = useState(false)
  if (!admin) return null
  const save = async (title: string) => {
    setSaving(true)
    try {
      const { game: changed } = await put<{ game: Game }>(`/api/games/${game.id}/title`, { title })
      setName(changed.title)
      void qc.invalidateQueries({ queryKey: ['game', game.id] })
      void qc.invalidateQueries({ queryKey: ['games'] })
      toast(title ? 'Name saved' : 'The game has its own name again', 'success')
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setSaving(false)
    }
  }
  const trimmed = name.replace(/\s+/g, ' ').trim()
  return (
    <section className="panel">
      <h3 className="h3" style={{ marginBottom: 8 }}>Name</h3>
      <form
        className="stack"
        style={{ gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed) void save(trimmed)
        }}
      >
        <input aria-label="Name in the library" className="input" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="actions">
          <Pill type="submit" size="sm" variant="p" loading={saving} disabled={!trimmed || trimmed === game.title}>
            Save name
          </Pill>
          {game.renamed && (
            <Pill type="button" size="sm" variant="q" disabled={saving} onClick={() => void save('')}>
              Use its own name
            </Pill>
          )}
        </div>
        <p className="small muted">Shown in your library for everyone. A reinstall keeps it.</p>
      </form>
    </section>
  )
}
