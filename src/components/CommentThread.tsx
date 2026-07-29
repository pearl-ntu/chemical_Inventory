import { useEffect, useState } from 'react'
import { MessageSquare, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import type { Comment, CommentResourceType } from '../lib/types'
import { formatRelative } from '../lib/utils'
import { Spinner } from './ui'

export function CommentThread({
  resourceType,
  resourceId,
}: {
  resourceType: CommentResourceType
  resourceId: string
}) {
  const { profile, canEdit, isAdmin } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState<Comment[]>([])
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true)
    api
      .listComments(resourceType, resourceId)
      .then((comments) => live && setRows(comments))
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not load comments.'))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [resourceId, resourceType, toast])

  async function add() {
    if (!profile || !body.trim()) return
    setBusy(true)
    try {
      const row = await api.createComment({ resource_type: resourceType, resource_id: resourceId, body: body.trim() }, profile)
      setRows((prev) => [...prev, row])
      setBody('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add comment.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: Comment) {
    if (!profile) return
    setBusy(true)
    try {
      await api.deleteComment(row, profile)
      setRows((prev) => prev.filter((item) => item.id !== row.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete comment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">
        <MessageSquare className="h-3.5 w-3.5" /> Handoff notes
      </h3>
      {loading ? (
        <div className="py-4"><Spinner className="h-4 w-4 text-ink-400" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-500">No comments yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border border-ink-200 p-2.5 dark:border-ink-800">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-ink-700 dark:text-ink-200">
                    {row.author_name ?? 'Unknown'} <span className="font-normal text-ink-400">{formatRelative(row.created_at)}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{row.body}</p>
                </div>
                {(isAdmin || row.author_id === profile?.id) && (
                  <button className="btn-ghost p-1 text-rose-600" disabled={busy} onClick={() => void remove(row)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-3 flex gap-2">
          <input className="input text-sm" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note..." />
          <button className="btn-primary shrink-0" disabled={busy || !body.trim()} onClick={() => void add()}>
            Add
          </button>
        </div>
      )}
    </section>
  )
}
