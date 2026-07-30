import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Lock, ShieldCheck, UserPlus, X } from 'lucide-react'
import { LoadingScreen } from '../components/ui'
import { PiNotesPanel } from '../components/PiNotesPanel'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import type { Profile, Project, ProjectMember } from '../lib/types'
import { cx } from '../lib/utils'

/**
 * The PI's "who's who" — every approved member and exactly which projects
 * they're on, with a one-click way to change it. Account-level actions
 * (approve, invite, change role) stay on the full Members page rather than
 * being duplicated here — this view is about assignment, not administration.
 */
export default function PiMembersPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const [members, setMembers] = useState<Profile[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [assignments, setAssignments] = useState<ProjectMember[]>([])
  const [loading, setLoading] = useState(true)
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [pendingProject, setPendingProject] = useState('')
  const [notesFor, setNotesFor] = useState<string | null>(null)

  async function load() {
    const [m, p, a] = await Promise.all([api.listProfiles(), api.listProjects(), api.listAllProjectMembers()])
    setMembers(m.filter((row) => row.approved))
    setProjects(p)
    setAssignments(a)
  }

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [])

  const projectsByMember = useMemo(() => {
    const map = new Map<string, ProjectMember[]>()
    for (const a of assignments) {
      const list = map.get(a.profile_id) ?? []
      list.push(a)
      map.set(a.profile_id, list)
    }
    return map
  }, [assignments])

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  async function assign(member: Profile) {
    if (!profile || !pendingProject) return
    try {
      const row = await api.assignMember(pendingProject, member.id, profile)
      setAssignments((prev) => [...prev, row])
      setAddingFor(null)
      setPendingProject('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not assign that project.')
    }
  }

  async function unassign(member: Profile, projectId: string) {
    try {
      await api.unassignMember(projectId, member.id)
      setAssignments((prev) => prev.filter((a) => !(a.profile_id === member.id && a.project_id === projectId)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove that assignment.')
    }
  }

  if (loading) return <LoadingScreen label="Loading members…" />

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900 dark:text-white">Members</h2>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">Who's assigned to what — approvals, invites, and roles live on the full Members page.</p>
        </div>
        <Link to="/members" className="btn-secondary text-xs">
          Manage roles &amp; invites <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="space-y-2.5">
        {members.map((member) => {
          const assigned = projectsByMember.get(member.id) ?? []
          const assignedIds = new Set(assigned.map((a) => a.project_id))
          const available = projects.filter((p) => !assignedIds.has(p.id))
          const isSelf = member.id === profile?.id
          return (
            <div key={member.id} className="card p-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-[160px]">
                  <Link
                    to={`/pi-dashboard/members/${member.id}`}
                    className="flex items-center gap-1.5 font-semibold text-ink-900 hover:underline dark:text-ink-50"
                  >
                    {member.full_name}
                    {member.is_pi && (
                      <span title="PI">
                        <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
                      </span>
                    )}
                  </Link>
                  <p className="text-xs text-ink-400 capitalize">
                    {member.lab_position || member.role}
                  </p>
                </div>

                <div className="flex flex-1 flex-wrap items-center gap-1.5">
                  {assigned.length === 0 && <p className="text-xs text-ink-400">No projects assigned.</p>}
                  {assigned.map((a) => {
                    const project = projectById.get(a.project_id)
                    return (
                      <span
                        key={a.project_id}
                        className="flex items-center gap-1 rounded-full bg-pearl-50 py-1 pl-2.5 pr-1 text-xs font-medium text-pearl-800 dark:bg-pearl-500/10 dark:text-pearl-200"
                      >
                        {project?.name ?? 'Unknown'}
                        <button
                          type="button"
                          className="rounded-full p-0.5 hover:bg-white/60 dark:hover:bg-ink-900/40"
                          onClick={() => void unassign(member, a.project_id)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )
                  })}
                </div>

                {addingFor === member.id ? (
                  <div className="flex gap-1.5">
                    <select className="input py-1 text-xs" value={pendingProject} onChange={(e) => setPendingProject(e.target.value)}>
                      <option value="">Choose a project…</option>
                      {available.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn-primary py-1 text-xs" onClick={() => void assign(member)}>
                      Add
                    </button>
                    <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setAddingFor(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={cx('btn-ghost shrink-0 py-1 text-xs', available.length === 0 && 'pointer-events-none opacity-40')}
                    onClick={() => setAddingFor(member.id)}
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Assign
                  </button>
                )}

                {!isSelf && (
                  <button
                    type="button"
                    className="btn-ghost shrink-0 py-1 text-xs"
                    onClick={() => setNotesFor(notesFor === member.id ? null : member.id)}
                  >
                    <Lock className="h-3.5 w-3.5" /> Notes
                  </button>
                )}
              </div>

              {notesFor === member.id && (
                <div className="mt-3">
                  <PiNotesPanel memberId={member.id} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
