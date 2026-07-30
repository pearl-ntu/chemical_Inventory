import { useEffect, useState } from 'react'
import { Lock, Send, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import type { PiNote } from '../lib/types'
import { formatRelative } from '../lib/utils'
import { Spinner } from './ui'

/**
 * Private supervision notes about one member — admin-only, and the RLS
 * behind this (pi_notes table) explicitly excludes the member being noted
 * about even if they're an admin themselves. Never render this for the
 * signed-in user's own row: they can't read their own notes and showing an
 * empty/broken panel there would just be confusing.
 */
export function PiNotesPanel({ memberId }: { memberId: string }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [notes, setNotes] = useState<PiNote[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true)
    api
      .listPiNotes(memberId)
      .then((rows) => live && setNotes(rows))
      .catch(() => live && setNotes([]))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [memberId])

  async function add() {
    if (!profile || !body.trim()) return
    setPosting(true)
    try {
      const note = await api.addPiNote(memberId, body.trim(), profile)
      setNotes((prev) => [note, ...prev])
      setBody('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that note.')
    } finally {
      setPosting(false)
    }
  }

  async function remove(note: PiNote) {
    try {
      await api.deletePiNote(note)
      setNotes((prev) => prev.filter((n) => n.id !== note.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete that note.')
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/20 dark:bg-amber-500/5">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        <Lock className="h-3 w-3" /> Private PI notes — only admins see this, never the member themselves
      </p>
      {loading ? (
        <Spinner className="h-4 w-4 text-ink-400" />
      ) : notes.length === 0 ? (
        <p className="text-xs text-ink-400">No notes yet.</p>
      ) : (
        <ul className="mb-2 space-y-1.5">
          {notes.map((note) => (
            <li key={note.id} className="rounded-md bg-white/70 p-2 text-xs dark:bg-ink-950/40">
              <div className="flex items-start justify-between gap-2">
                <p className="whitespace-pre-wrap text-ink-700 dark:text-ink-200">{note.body}</p>
                <button type="button" className="btn-ghost shrink-0 p-1 text-rose-500" onClick={() => void remove(note)}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <p className="mt-1 text-ink-400">{note.author_name} · {formatRelative(note.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        <input
          className="input py-1 text-xs"
          placeholder="Add a private note..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button type="button" className="btn-secondary py-1 text-xs" disabled={posting || !body.trim()} onClick={() => void add()}>
          {posting ? <Spinner className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  )
}
