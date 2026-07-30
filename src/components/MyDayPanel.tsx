import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Bell, Briefcase, CheckSquare, Sun } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { api } from '../lib/api'
import { computeProjectHealth, PROJECT_HEALTH_DOT } from '../lib/projectHealth'
import type { AppNotification, Project, ProjectMember, ProjectMilestone, ProjectUpdate } from '../lib/types'
import { cx } from '../lib/utils'
import { EmptyState } from './ui'

const DAY_MS = 86_400_000

/**
 * The PI inbox's little sibling — same "one list instead of five pages"
 * idea, just scoped to whoever's actually signed in: their projects, their
 * open milestones, their chemicals that need action, and anything waiting
 * on them. Every approved member sees this, not just the PI.
 */
export function MyDayPanel() {
  const { profile } = useAuth()
  const { chemicals } = useInventory()
  const [projects, setProjects] = useState<Project[]>([])
  const [assignments, setAssignments] = useState<ProjectMember[]>([])
  const [updates, setUpdates] = useState<ProjectUpdate[]>([])
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([])
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    Promise.all([
      api.listProjects(),
      api.listAllProjectMembers(),
      api.listRecentProjectUpdates(500),
      api.listNotifications(),
    ])
      .then(([p, a, u, n]) => {
        setProjects(p)
        setAssignments(a.filter((row) => row.profile_id === profile.id))
        setUpdates(u)
        setNotifications(n)
      })
      .finally(() => setLoading(false))
  }, [profile])

  // Milestones need per-project fetches (no "all milestones" endpoint, by
  // design — the PI console only ever looks at one project at a time). For
  // "my day" we only care about the handful of projects this member is on,
  // so fetch just those.
  useEffect(() => {
    if (assignments.length === 0) return
    Promise.all(assignments.map((a) => api.listMilestones(a.project_id))).then((lists) => {
      setMilestones(lists.flat())
    })
  }, [assignments])

  const myProjects = useMemo(
    () => assignments.map((a) => projects.find((p) => p.id === a.project_id)).filter((p): p is Project => Boolean(p)),
    [assignments, projects],
  )

  const latestUpdateByProject = useMemo(() => {
    const map = new Map<string, ProjectUpdate>()
    for (const u of updates) {
      const existing = map.get(u.project_id)
      if (!existing || u.created_at > existing.created_at) map.set(u.project_id, u)
    }
    return map
  }, [updates])

  const myMilestones = useMemo(
    () =>
      milestones.filter((m) => m.assignee_member_id === profile?.id && m.status !== 'done').sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')),
    [milestones, profile],
  )

  const myChemicalsNeedingAction = useMemo(() => {
    if (!profile) return []
    const soon = new Date(Date.now() + 30 * DAY_MS)
    return chemicals.filter(
      (c) =>
        (c.owner === profile.full_name || c.created_by === profile.id) &&
        (c.status === 'low' || (c.expiry_date && new Date(c.expiry_date) <= soon)),
    )
  }, [chemicals, profile])

  const unreadCount = notifications.filter((n) => !n.read_at).length

  if (loading || !profile) return null

  const hasNothing = myProjects.length === 0 && myMilestones.length === 0 && myChemicalsNeedingAction.length === 0 && unreadCount === 0

  return (
    <section className="card p-4">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-ink-900 dark:text-ink-50">
        <Sun className="h-4 w-4 text-amber-500" /> My day
      </h2>
      {hasNothing ? (
        <EmptyState
          title="Nothing needs you right now"
          description="Assigned projects, your open milestones, and chemicals you own that need attention will show up here."
        />
      ) : (
        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
              <Briefcase className="h-3.5 w-3.5" /> My projects ({myProjects.length})
            </p>
            {myProjects.length === 0 ? (
              <p className="text-xs text-ink-400">Not assigned to any project.</p>
            ) : (
              <ul className="space-y-1">
                {myProjects.map((p) => {
                  const latest = latestUpdateByProject.get(p.id)
                  const daysSince = latest ? Math.floor((Date.now() - new Date(latest.created_at).getTime()) / DAY_MS) : Infinity
                  const health = computeProjectHealth(p, daysSince)
                  return (
                    <li key={p.id} className="flex items-center gap-1.5 text-sm">
                      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', PROJECT_HEALTH_DOT[health])} />
                      <span className="truncate text-ink-700 dark:text-ink-200">{p.name}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
              <CheckSquare className="h-3.5 w-3.5" /> My milestones ({myMilestones.length})
            </p>
            {myMilestones.length === 0 ? (
              <p className="text-xs text-ink-400">Nothing open assigned to you.</p>
            ) : (
              <ul className="space-y-1">
                {myMilestones.slice(0, 5).map((m) => (
                  <li key={m.id} className="truncate text-sm text-ink-700 dark:text-ink-200">
                    {m.title}
                    {m.due_date && <span className="text-xs text-ink-400"> — due {m.due_date}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
              <AlertTriangle className="h-3.5 w-3.5" /> Your chemicals needing action ({myChemicalsNeedingAction.length})
            </p>
            {myChemicalsNeedingAction.length === 0 ? (
              <p className="text-xs text-ink-400">Nothing of yours is low or expiring soon.</p>
            ) : (
              <ul className="space-y-1">
                {myChemicalsNeedingAction.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link to={`/inventory?code=${encodeURIComponent(c.code)}`} className="truncate text-sm text-pearl-700 hover:underline dark:text-pearl-300">
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
              <Bell className="h-3.5 w-3.5" /> Waiting on you
            </p>
            {unreadCount === 0 ? (
              <p className="text-xs text-ink-400">No unread pings.</p>
            ) : (
              <p className="text-sm text-ink-700 dark:text-ink-200">
                {unreadCount} unread notification{unreadCount === 1 ? '' : 's'} — check the bell icon above.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
