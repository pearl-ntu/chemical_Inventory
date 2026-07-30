import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Briefcase, ShieldCheck } from 'lucide-react'
import { LoadingScreen } from '../components/ui'
import { PiNotesPanel } from '../components/PiNotesPanel'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { computeProjectHealth, PROJECT_HEALTH_DOT, PROJECT_HEALTH_LABEL } from '../lib/projectHealth'
import {
  PROJECT_STATUS_LABEL,
  type ActivityEntry,
  type Profile,
  type Project,
  type ProjectMember,
  type ProjectUpdate,
} from '../lib/types'
import { cx, formatRelative } from '../lib/utils'

const CHECK_IN_DAYS = 14

export default function PiMemberProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile: viewer } = useAuth()

  const [member, setMember] = useState<Profile | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [assignments, setAssignments] = useState<ProjectMember[]>([])
  const [updates, setUpdates] = useState<ProjectUpdate[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([
      api.listProfiles(),
      api.listProjects(),
      api.listAllProjectMembers(),
      api.listRecentProjectUpdates(500),
      api.listActivity(1000),
    ])
      .then(([members, p, a, u, act]) => {
        setMember(members.find((m) => m.id === id) ?? null)
        setProjects(p)
        setAssignments(a.filter((row) => row.profile_id === id))
        setUpdates(u)
        setActivity(act.filter((row) => row.user_id === id))
      })
      .finally(() => setLoading(false))
  }, [id])

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const latestUpdateByProject = useMemo(() => {
    const map = new Map<string, ProjectUpdate>()
    for (const u of updates) {
      const existing = map.get(u.project_id)
      if (!existing || u.created_at > existing.created_at) map.set(u.project_id, u)
    }
    return map
  }, [updates])

  const assignedProjects = useMemo(
    () => assignments.map((a) => projectById.get(a.project_id)).filter((p): p is Project => Boolean(p)),
    [assignments, projectById],
  )

  const workload = assignedProjects.filter((p) => p.status === 'active').length

  const daysSinceActivity = useMemo(() => {
    if (activity.length === 0) return Infinity
    // activity is already newest-first from the API.
    return Math.floor((Date.now() - new Date(activity[0].created_at).getTime()) / 86_400_000)
  }, [activity])

  const needsCheckIn = workload > 0 && daysSinceActivity >= CHECK_IN_DAYS

  if (loading) return <LoadingScreen label="Loading member…" />
  if (!member) {
    return (
      <div>
        <button type="button" className="btn-ghost text-xs" onClick={() => navigate('/pi-dashboard/members')}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Members
        </button>
        <p className="mt-4 text-sm text-ink-500">Couldn't find that member.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <button type="button" className="btn-ghost text-xs" onClick={() => navigate('/pi-dashboard/members')}>
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Members
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold text-ink-900 dark:text-white">{member.full_name}</h2>
        {member.is_pi && (
          <span title="PI">
            <ShieldCheck className="h-4 w-4 text-amber-500" />
          </span>
        )}
        <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300 capitalize">
          {member.lab_position || member.role}
        </span>
        {needsCheckIn && (
          <span className="badge bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300">
            <AlertTriangle className="h-3 w-3" /> Needs a check-in
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink-800 dark:text-ink-100">
              <Briefcase className="h-4 w-4" /> Assigned projects ({workload} active)
            </h3>
            {assignedProjects.length === 0 ? (
              <p className="text-xs text-ink-400">Not assigned to any project yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {assignedProjects.map((p) => {
                  const latest = latestUpdateByProject.get(p.id)
                  const daysSince = latest ? Math.floor((Date.now() - new Date(latest.created_at).getTime()) / 86_400_000) : Infinity
                  const health = computeProjectHealth(p, daysSince)
                  return (
                    <li key={p.id}>
                      <Link
                        to={`/pi-dashboard/projects/${p.id}`}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-50 dark:hover:bg-ink-800"
                      >
                        <span className={cx('h-2 w-2 shrink-0 rounded-full', PROJECT_HEALTH_DOT[health])} title={PROJECT_HEALTH_LABEL[health]} />
                        <span className="flex-1 truncate text-ink-800 dark:text-ink-100">{p.name}</span>
                        <span className="shrink-0 text-xs text-ink-400">{PROJECT_STATUS_LABEL[p.status]}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="card p-4">
            <h3 className="mb-2 text-sm font-bold text-ink-800 dark:text-ink-100">Activity trail</h3>
            {activity.length === 0 ? (
              <p className="text-xs text-ink-400">No activity logged yet.</p>
            ) : (
              <ul className="max-h-96 space-y-1.5 overflow-y-auto text-sm">
                {activity.slice(0, 100).map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2 border-b border-ink-100 pb-1.5 dark:border-ink-800">
                    <span className="text-ink-600 dark:text-ink-300">
                      <span className="font-medium capitalize">{a.action.replace(/_/g, ' ')}</span>
                      {a.chemical_name && ` — ${a.chemical_name}`}
                      {a.details && !a.chemical_name && ` — ${a.details}`}
                    </span>
                    <span className="shrink-0 text-xs text-ink-400">{formatRelative(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>{member.id !== viewer?.id && <PiNotesPanel memberId={member.id} />}</div>
      </div>
    </div>
  )
}
