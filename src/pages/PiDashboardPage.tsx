import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Copy, FileText, MessageSquare, Send, ShieldCheck, Users } from 'lucide-react'
import { CommentThread } from '../components/CommentThread'
import { PiInbox } from '../components/PiInbox'
import { DashboardSkeleton, EmptyState, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import { computeProjectHealth, PROJECT_HEALTH_DOT, PROJECT_HEALTH_LABEL } from '../lib/projectHealth'
import {
  PROJECT_UPDATE_STATUS_LABEL,
  type Profile,
  type Project,
  type ProjectUpdate,
  type ProjectUpdateStatus,
} from '../lib/types'
import { cx, formatRelative } from '../lib/utils'

const STATUS_TONE: Record<ProjectUpdateStatus, string> = {
  on_track: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300',
  blocked: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300',
  done: 'bg-pearl-50 text-pearl-700 ring-pearl-600/20 dark:bg-pearl-500/10 dark:text-pearl-300',
  paused: 'bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300',
}

const STALE_DAYS = 7

interface ProjectRow {
  project: Project
  updates: ProjectUpdate[]
  latest: ProjectUpdate | null
  authors: string[]
  staleDays: number
}

function PingBox({ project, members }: { project: Project; members: Profile[] }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [recipientId, setRecipientId] = useState(members[0]?.id ?? '')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [open, setOpen] = useState(false)

  async function send() {
    if (!profile || !recipientId || !message.trim()) return
    setSending(true)
    try {
      await api.pingAboutProject(project.id, recipientId, message.trim(), profile)
      toast.success('Comment posted and the recipient was pinged.')
      setMessage('')
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send that.')
    } finally {
      setSending(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setOpen(true)}>
        <Send className="h-3.5 w-3.5" /> Comment / ping
      </button>
    )
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-ink-200 bg-ink-50 p-2.5 dark:border-ink-800 dark:bg-ink-950/50">
      <select className="input py-1 text-xs" value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.full_name} {m.lab_position ? `— ${m.lab_position}` : ''}
          </option>
        ))}
      </select>
      <textarea
        className="input min-h-[50px] resize-y text-xs"
        placeholder="e.g. Can you post an update on this by Friday's meeting?"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <div className="flex gap-2">
        <button type="button" className="btn-primary py-1 text-xs" disabled={sending} onClick={() => void send()}>
          {sending ? <Spinner className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />} Send
        </button>
        <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * The one screen the PI actually needs: every project, who's touched it,
 * what the latest status is, and how stale it's gotten — plus a way to
 * comment/ping without leaving the page. Only ever rendered for `is_pi`
 * accounts; everyone else's visibility into projects stays exactly what it
 * already was (the weekly log is readable lab-wide, same as the rest of the
 * app — this page is just the PI's aggregated view of it).
 */
export default function PiDashboardPage() {
  const toast = useToast()
  const [members, setMembers] = useState<Profile[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [updates, setUpdates] = useState<ProjectUpdate[]>([])
  const [loading, setLoading] = useState(true)
  const [authorFilter, setAuthorFilter] = useState('')

  useEffect(() => {
    let live = true
    setLoading(true)
    Promise.all([api.listProfiles(), api.listProjects(), api.listRecentProjectUpdates(500)])
      .then(([m, p, u]) => {
        if (!live) return
        setMembers(m.filter((row) => row.approved))
        setProjects(p)
        setUpdates(u)
      })
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [])

  const rows = useMemo<ProjectRow[]>(() => {
    const byProject = new Map<string, ProjectUpdate[]>()
    for (const u of updates) {
      const list = byProject.get(u.project_id) ?? []
      list.push(u)
      byProject.set(u.project_id, list)
    }
    return projects
      .map((project) => {
        const list = (byProject.get(project.id) ?? []).sort((a, b) => b.created_at.localeCompare(a.created_at))
        const latest = list[0] ?? null
        const authors = [...new Set(list.map((u) => u.author_name).filter(Boolean))] as string[]
        const staleDays = latest ? Math.floor((Date.now() - new Date(latest.created_at).getTime()) / 86400000) : Infinity
        return { project, updates: list, latest, authors, staleDays }
      })
      .filter((row) => !authorFilter || row.authors.some((a) => a.toLowerCase().includes(authorFilter.toLowerCase())))
      .sort((a, b) => a.staleDays === b.staleDays ? 0 : a.staleDays > b.staleDays ? -1 : 1)
  }, [projects, updates, authorFilter])

  const attentionProjects = useMemo(
    () =>
      rows
        .map((r) => ({ id: r.project.id, name: r.project.name, health: computeProjectHealth(r.project, r.staleDays) }))
        .filter((r): r is { id: string; name: string; health: 'red' | 'amber' } => r.health !== 'green'),
    [rows],
  )

  const stale = rows.filter((r) => r.staleDays >= STALE_DAYS)
  const blocked = rows.filter((r) => r.latest?.status === 'blocked')
  const silent = projects.length === 0 && members.length > 0

  async function copyWeeklySummary() {
    const today = new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })
    const lines = [`PEARL weekly summary — ${today}`, '']
    for (const row of rows) {
      lines.push(`${row.project.name} (${row.project.workspace}) — ${row.latest ? PROJECT_UPDATE_STATUS_LABEL[row.latest.status] : 'no updates yet'}`)
      if (row.latest) {
        lines.push(`  ${row.latest.summary}`)
        lines.push(`  — ${row.authors.join(', ') || 'unknown'}, ${formatRelative(row.latest.created_at)}`)
      }
      lines.push('')
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast.success('Weekly summary copied — paste it into your meeting notes.')
    } catch {
      toast.error('Clipboard is blocked in this browser.')
    }
  }

  if (loading) return <DashboardSkeleton />

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900 dark:text-white">Overview</h2>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            Every project, who's on it, and how fresh the last update is — across both experimental and computational work.
          </p>
        </div>
        <div className="flex gap-2">
          {rows.length > 0 && (
            <button type="button" className="btn-secondary text-xs" onClick={() => void copyWeeklySummary()}>
              <Copy className="h-3.5 w-3.5" /> Copy weekly summary
            </button>
          )}
          <Link to="/pi-dashboard/report" className="btn-primary text-xs">
            <FileText className="h-3.5 w-3.5" /> Generate report
          </Link>
        </div>
      </div>

      <div className="mb-4">
        <PiInbox attentionProjects={attentionProjects} />
      </div>

      <div className="card grid grid-cols-2 divide-y divide-ink-100 p-0 sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-ink-800">
        <Kpi icon={<Users className="h-4 w-4" />} label="Active members" value={members.length} />
        <Kpi icon={<ShieldCheck className="h-4 w-4" />} label="Projects" value={projects.length} />
        <Kpi
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Blocked"
          value={blocked.length}
          tone={blocked.length ? 'critical' : 'good'}
        />
        <Kpi
          icon={<AlertTriangle className="h-4 w-4" />}
          label={`Stale (${STALE_DAYS}+ days)`}
          value={stale.length}
          tone={stale.length ? 'warning' : 'good'}
        />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Filter by member name…"
          value={authorFilter}
          onChange={(e) => setAuthorFilter(e.target.value)}
        />
        {authorFilter && (
          <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setAuthorFilter('')}>
            Clear
          </button>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-6 w-6" />}
            title={silent ? 'Nobody has posted an update yet' : 'No projects match that filter'}
            description={
              silent
                ? "Projects show up here as soon as someone posts their first weekly update from the Experimental or Computational dashboard."
                : undefined
            }
          />
        ) : (
          rows.map((row) => (
            <div key={row.project.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cx('h-2 w-2 shrink-0 rounded-full', PROJECT_HEALTH_DOT[computeProjectHealth(row.project, row.staleDays)])}
                      title={PROJECT_HEALTH_LABEL[computeProjectHealth(row.project, row.staleDays)]}
                    />
                    <Link
                      to={`/pi-dashboard/projects/${row.project.id}`}
                      className="font-semibold text-ink-900 hover:underline dark:text-ink-50"
                    >
                      {row.project.name}
                    </Link>
                    <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">
                      {row.project.workspace}
                    </span>
                    {row.latest && (
                      <span className={cx('badge', STATUS_TONE[row.latest.status])}>
                        {PROJECT_UPDATE_STATUS_LABEL[row.latest.status]}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {row.authors.length > 0 ? row.authors.join(', ') : 'No updates yet'}
                    {row.latest && (
                      <span className={cx(row.staleDays >= STALE_DAYS && 'font-semibold text-amber-600 dark:text-amber-400')}>
                        {' '}
                        · last update {formatRelative(row.latest.created_at)}
                      </span>
                    )}
                  </p>
                </div>
                <PingBox project={row.project} members={members} />
              </div>

              {row.latest && (
                <p className="mt-2.5 text-sm text-ink-700 dark:text-ink-200">{row.latest.summary}</p>
              )}

              {row.updates.length > 1 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-ink-400 hover:text-ink-600 dark:hover:text-ink-300">
                    {row.updates.length - 1} earlier update{row.updates.length - 1 === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-2 space-y-1.5 border-l border-ink-200 pl-3 dark:border-ink-800">
                    {row.updates.slice(1, 8).map((u) => (
                      <li key={u.id} className="text-xs text-ink-500">
                        <span className={cx('badge mr-1.5', STATUS_TONE[u.status])}>
                          {PROJECT_UPDATE_STATUS_LABEL[u.status]}
                        </span>
                        {u.summary} <span className="text-ink-400">— {u.author_name}, {formatRelative(u.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <details className="mt-3 border-t border-ink-100 pt-3 dark:border-ink-800">
                <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200">
                  <MessageSquare className="h-3.5 w-3.5" /> Comments — this is where a ping actually shows up
                </summary>
                <div className="mt-2">
                  <CommentThread resourceType="project" resourceId={row.project.id} />
                </div>
              </details>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Kpi({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode
  label: string
  value: number
  tone?: 'good' | 'warning' | 'critical'
}) {
  const toneClass =
    tone === 'critical'
      ? 'text-rose-600 dark:text-rose-400'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'good'
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-ink-900 dark:text-ink-50'

  return (
    <div className="p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-400">
        {icon} {label}
      </p>
      <p className={cx('mt-1 text-2xl font-bold', toneClass)}>{value}</p>
    </div>
  )
}
