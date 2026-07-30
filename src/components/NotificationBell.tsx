import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import type { AppNotification } from '../lib/types'
import { cx, formatRelative } from '../lib/utils'
import { CommentThread } from './CommentThread'
import { Modal } from './ui'

const POLL_MS = 60_000

/** The "ping" landing spot — in-app only for now, no email/Slack dependency.
 *  Polls rather than subscribing to realtime: notifications are infrequent
 *  enough (a PI comment, not a firehose) that a minute of staleness is fine,
 *  and it keeps this component from needing its own websocket channel. */
export function NotificationBell() {
  const { profile } = useAuth()
  const [items, setItems] = useState<AppNotification[]>([])
  const [projectNames, setProjectNames] = useState<Map<string, string>>(new Map())
  const [open, setOpen] = useState(false)
  const [thread, setThread] = useState<{ id: string; name: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!profile) return
    let live = true
    const load = () => void api.listNotifications().then((rows) => live && setItems(rows)).catch(() => {})
    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [profile])

  useEffect(() => {
    if (!profile) return
    void api.listProjects().then((rows) => setProjectNames(new Map(rows.map((p) => [p.id, p.name])))).catch(() => {})
  }, [profile])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const unread = items.filter((n) => !n.read_at)

  async function openPanel() {
    setOpen((o) => !o)
    if (unread.length === 0) return
    // Mark read as soon as they're seen, not per-click — the badge's job is
    // "something happened," not tracking which specific message was read.
    await Promise.all(unread.map((n) => api.markNotificationRead(n.id)))
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })))
  }

  if (!profile) return null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => void openPanel()}
        className="btn-ghost relative p-2"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {unread.length > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[85vw] rounded-xl border border-ink-200 bg-white p-1.5 shadow-pop animate-slide-up dark:border-ink-700 dark:bg-ink-900">
          <p className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Notifications</p>
          {items.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-sm text-ink-400">Nothing yet.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {items.map((n) => {
                const projectName = n.project_id ? projectNames.get(n.project_id) : null
                return (
                  <button
                    key={n.id}
                    type="button"
                    disabled={!n.project_id}
                    onClick={() => {
                      if (!n.project_id) return
                      setThread({ id: n.project_id, name: projectName ?? 'Project' })
                      setOpen(false)
                    }}
                    className={cx(
                      'block w-full rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                      !n.read_at && 'bg-pearl-50 dark:bg-pearl-500/10',
                      n.project_id && 'hover:bg-ink-100 dark:hover:bg-ink-800',
                    )}
                  >
                    <p className="text-ink-700 dark:text-ink-200">
                      {n.actor_name && <span className="font-semibold">{n.actor_name}: </span>}
                      {n.message}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-400">
                      {formatRelative(n.created_at)}
                      {projectName && ` · ${projectName} — tap to reply`}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      <Modal
        open={thread !== null}
        onClose={() => setThread(null)}
        title={thread?.name ?? 'Project'}
        description="Reply here — visible to everyone on the project, same as the PI console."
      >
        {thread && <CommentThread resourceType="project" resourceId={thread.id} />}
      </Modal>
    </div>
  )
}
