import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import type { Comment, CommentResourceType, Profile } from '../lib/types'
import { formatRelative } from '../lib/utils'
import { Spinner } from './ui'

/** Finds the `@partial` token the cursor is currently sitting inside of, if
 *  any — null once a space breaks it, so it only looks like a mention while
 *  you're still typing the name. */
function activeMentionQuery(value: string, cursor: number): string | null {
  const upToCursor = value.slice(0, cursor)
  const at = upToCursor.lastIndexOf('@')
  if (at === -1) return null
  const between = upToCursor.slice(at + 1)
  if (/\s/.test(between)) return null
  return between
}

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
  const [members, setMembers] = useState<Profile[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

  // Only project comments support @mentions (that's the only place the
  // backend notifies mentioned members) — no point fetching the member
  // list for every chemical/asset/equipment comment thread in the app.
  useEffect(() => {
    if (resourceType !== 'project') return
    let live = true
    void api.listProfiles().then((rows) => {
      if (live) setMembers(rows.filter((r) => r.approved && r.id !== profile?.id))
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceType])

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return []
    const needle = mentionQuery.toLowerCase()
    return members.filter((m) => m.full_name.toLowerCase().includes(needle)).slice(0, 5)
  }, [mentionQuery, members])

  function onBodyChange(e: React.ChangeEvent<HTMLInputElement>) {
    setBody(e.target.value)
    setMentionQuery(activeMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length))
  }

  /** Replaces the in-progress `@partial` with the picked member's exact
   *  full name — chosen from a list, so there's no ambiguity between
   *  similarly-named accounts and no need to type an exact match by hand. */
  function pickMention(member: Profile) {
    const input = inputRef.current
    const cursor = input?.selectionStart ?? body.length
    const upToCursor = body.slice(0, cursor)
    const at = upToCursor.lastIndexOf('@')
    if (at === -1) return
    const next = `${body.slice(0, at)}@${member.full_name} ${body.slice(cursor)}`
    setBody(next)
    setMentionQuery(null)
    requestAnimationFrame(() => {
      const pos = at + member.full_name.length + 2
      input?.focus()
      input?.setSelectionRange(pos, pos)
    })
  }

  async function add() {
    if (!profile || !body.trim()) return
    setBusy(true)
    try {
      const row = await api.createComment({ resource_type: resourceType, resource_id: resourceId, body: body.trim() }, profile)
      setRows((prev) => [...prev, row])
      setBody('')
      setMentionQuery(null)
      toast.success('Comment posted.')
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
        <div className="relative mt-3 flex gap-2">
          <input
            ref={inputRef}
            className="input text-sm"
            value={body}
            onChange={onBodyChange}
            onKeyDown={(e) => e.key === 'Escape' && setMentionQuery(null)}
            onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
            placeholder={resourceType === 'project' ? 'Add a note... type @ to mention someone' : 'Add a note...'}
          />
          <button className="btn-primary shrink-0" disabled={busy || !body.trim()} onClick={() => void add()}>
            Add
          </button>

          {mentionQuery !== null && mentionMatches.length > 0 && (
            <div className="absolute bottom-full left-0 z-10 mb-1 w-64 max-w-full rounded-lg border border-ink-200 bg-white p-1 shadow-pop dark:border-ink-700 dark:bg-ink-900">
              {mentionMatches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800"
                  // onMouseDown (not onClick) fires before the input's onBlur closes the dropdown.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickMention(m)
                  }}
                >
                  {m.full_name}
                  {m.lab_position && <span className="text-xs text-ink-400">— {m.lab_position}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
