import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Beaker,
  BookOpen,
  Check,
  Database,
  Plus,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { CommentThread } from '../components/CommentThread'
import { LoadingScreen, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import { computeProjectHealth, PROJECT_HEALTH_DOT, PROJECT_HEALTH_LABEL } from '../lib/projectHealth'
import {
  MILESTONE_STATUSES,
  MILESTONE_STATUS_LABEL,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  type MilestoneStatus,
  type Profile,
  type Project,
  type ProjectMember,
  type ProjectMilestone,
  type ProjectStatus,
  type ProjectUpdate,
  type ProjectWorkspace,
} from '../lib/types'
import { cx, formatSize } from '../lib/utils'

const WORKSPACE_LABEL: Record<ProjectWorkspace, string> = {
  experimental: 'Experimental',
  computational: 'Computational',
  both: 'Both',
}

function EditableField({
  label,
  value,
  onSave,
  multiline,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string
  onSave: (next: string) => Promise<void>
  multiline?: boolean
  type?: string
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  async function save() {
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that.')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div>
        <label className="label">{label}</label>
        <div className="flex items-start gap-1.5">
          {multiline ? (
            <textarea
              className="input min-h-[70px] resize-y text-sm"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
          ) : (
            <input
              type={type}
              className="input text-sm"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
          )}
          <button type="button" className="btn-primary shrink-0 px-2 py-2" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button type="button" className="btn-ghost shrink-0 px-2 py-2" onClick={() => setEditing(false)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <p className="label mb-1">{label}</p>
      <button
        type="button"
        className="block w-full rounded-md px-1 py-1 text-left text-sm text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800"
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
      >
        {value || <span className="text-ink-400">{placeholder ?? 'Click to add'}</span>}
      </button>
    </div>
  )
}

const HEALTH_LABEL_FOR = PROJECT_HEALTH_LABEL

export default function PiProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const toast = useToast()
  const { chemicals } = useInventory()

  const [project, setProject] = useState<Project | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [assignments, setAssignments] = useState<ProjectMember[]>([])
  const [assets, setAssets] = useState<{ id: string; title: string; status: string; type: string; project: string | null }[]>([])
  const [updates, setUpdates] = useState<ProjectUpdate[]>([])
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([])
  const [loading, setLoading] = useState(true)
  const [addingMember, setAddingMember] = useState(false)
  const [pendingMemberId, setPendingMemberId] = useState('')
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('')
  const [newMilestoneAssignee, setNewMilestoneAssignee] = useState('')
  const [newMilestoneDue, setNewMilestoneDue] = useState('')
  const [addingMilestone, setAddingMilestone] = useState(false)

  async function load() {
    if (!id) return
    const [p, m, a, r, u, ms] = await Promise.all([
      api.getProject(id),
      api.listProfiles(),
      api.listAllProjectMembers(),
      api.listResearchAssets(),
      api.listProjectUpdates(id),
      api.listMilestones(id),
    ])
    setProject(p)
    setMembers(m.filter((row) => row.approved))
    setAssignments(a.filter((row) => row.project_id === id))
    setAssets(r.map((asset) => ({ id: asset.id, title: asset.title, status: asset.status, type: asset.type, project: asset.project })))
    setUpdates(u)
    setMilestones(ms)
  }

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const assignedMembers = useMemo(
    () => assignments.map((a) => memberById.get(a.profile_id)).filter((m): m is Profile => Boolean(m)),
    [assignments, memberById],
  )
  const available = useMemo(
    () => members.filter((m) => !assignments.some((a) => a.profile_id === m.id)),
    [members, assignments],
  )

  const linkedChemicals = useMemo(() => {
    if (!project) return []
    const needle = project.name.trim().toLowerCase()
    return chemicals.filter((c) => (c.project ?? '').trim().toLowerCase() === needle)
  }, [chemicals, project])

  const linkedAssets = useMemo(() => {
    if (!project) return []
    const needle = project.name.trim().toLowerCase()
    return assets.filter((a) => (a.project ?? '').trim().toLowerCase() === needle)
  }, [assets, project])

  const publications = useMemo(() => linkedAssets.filter((a) => a.type === 'publication'), [linkedAssets])

  const daysSinceUpdate = useMemo(() => {
    if (updates.length === 0) return Infinity
    const latest = updates.reduce((a, b) => (a.created_at > b.created_at ? a : b))
    return Math.floor((Date.now() - new Date(latest.created_at).getTime()) / 86_400_000)
  }, [updates])

  const health = project ? computeProjectHealth(project, daysSinceUpdate) : 'green'

  async function saveField(patch: Partial<Project>) {
    if (!project) return
    const updated = await api.updateProject(project, patch)
    setProject(updated)
  }

  async function assign() {
    if (!profile || !project || !pendingMemberId) return
    try {
      const row = await api.assignMember(project.id, pendingMemberId, profile)
      setAssignments((prev) => [...prev, row])
      setPendingMemberId('')
      setAddingMember(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not assign that member.')
    }
  }

  async function unassign(profileId: string) {
    if (!project) return
    try {
      await api.unassignMember(project.id, profileId)
      setAssignments((prev) => prev.filter((a) => a.profile_id !== profileId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove that assignment.')
    }
  }

  async function addMilestone() {
    if (!project || !newMilestoneTitle.trim()) return
    setAddingMilestone(true)
    try {
      const row = await api.createMilestone({
        project_id: project.id,
        title: newMilestoneTitle.trim(),
        assignee_member_id: newMilestoneAssignee || null,
        due_date: newMilestoneDue || null,
      })
      setMilestones((prev) => [...prev, row])
      setNewMilestoneTitle('')
      setNewMilestoneAssignee('')
      setNewMilestoneDue('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add that milestone.')
    } finally {
      setAddingMilestone(false)
    }
  }

  async function moveMilestone(milestone: ProjectMilestone, status: MilestoneStatus) {
    try {
      const updated = await api.updateMilestone(milestone, { status })
      setMilestones((prev) => prev.map((m) => (m.id === milestone.id ? updated : m)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move that milestone.')
    }
  }

  async function removeMilestone(milestone: ProjectMilestone) {
    try {
      await api.deleteMilestone(milestone)
      setMilestones((prev) => prev.filter((m) => m.id !== milestone.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete that milestone.')
    }
  }

  if (loading) return <LoadingScreen label="Loading project…" />
  if (!project) {
    return (
      <div>
        <button type="button" className="btn-ghost text-xs" onClick={() => navigate('/pi-dashboard/projects')}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Projects
        </button>
        <p className="mt-4 text-sm text-ink-500">That project doesn't exist (or was archived and removed).</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <button type="button" className="btn-ghost text-xs" onClick={() => navigate('/pi-dashboard/projects')}>
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Projects
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <span className={cx('h-2.5 w-2.5 rounded-full', PROJECT_HEALTH_DOT[health])} />
        <h2 className="text-xl font-bold text-ink-900 dark:text-white">{project.name}</h2>
        <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">
          {HEALTH_LABEL_FOR[health]}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <div className="card grid gap-4 p-4 sm:grid-cols-2">
            <EditableField
              label="Description"
              value={project.description ?? ''}
              multiline
              placeholder="What is this project about?"
              onSave={(v) => saveField({ description: v })}
            />
            <div>
              <label className="label">Status</label>
              <select
                className="input"
                value={project.status}
                onChange={(e) => void saveField({ status: e.target.value as ProjectStatus })}
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Workspace</label>
              <select
                className="input"
                value={project.workspace}
                onChange={(e) => void saveField({ workspace: e.target.value as ProjectWorkspace })}
              >
                {(['both', 'experimental', 'computational'] as ProjectWorkspace[]).map((w) => (
                  <option key={w} value={w}>
                    {WORKSPACE_LABEL[w]}
                  </option>
                ))}
              </select>
            </div>
            <EditableField
              label="Target date"
              type="date"
              value={project.target_date ?? ''}
              placeholder="No target date set"
              onSave={(v) => saveField({ target_date: v || null })}
            />
            <EditableField
              label="Budget (manual entry)"
              type="number"
              value={project.budget_amount != null ? String(project.budget_amount) : ''}
              placeholder="No budget recorded"
              onSave={(v) => saveField({ budget_amount: v ? Number(v) : null })}
            />
          </div>

          <div className="card p-4">
            <h3 className="mb-2 text-sm font-bold text-ink-800 dark:text-ink-100">Milestones</h3>
            <div className="mb-3 flex flex-wrap items-end gap-1.5">
              <input
                className="input min-w-[160px] flex-1 text-sm"
                placeholder="New milestone title"
                value={newMilestoneTitle}
                onChange={(e) => setNewMilestoneTitle(e.target.value)}
              />
              <select
                className="input text-sm"
                value={newMilestoneAssignee}
                onChange={(e) => setNewMilestoneAssignee(e.target.value)}
              >
                <option value="">Unassigned</option>
                {assignedMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="input text-sm"
                value={newMilestoneDue}
                onChange={(e) => setNewMilestoneDue(e.target.value)}
              />
              <button type="button" className="btn-primary text-xs" disabled={addingMilestone} onClick={() => void addMilestone()}>
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {MILESTONE_STATUSES.map((status) => (
                <div key={status} className="rounded-lg bg-ink-50 p-2.5 dark:bg-ink-950/40">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
                    {MILESTONE_STATUS_LABEL[status]} ({milestones.filter((m) => m.status === status).length})
                  </p>
                  <div className="space-y-1.5">
                    {milestones
                      .filter((m) => m.status === status)
                      .map((m) => (
                        <div key={m.id} className="rounded-lg border border-ink-200 bg-white p-2 text-xs dark:border-ink-800 dark:bg-ink-900">
                          <p className="font-medium text-ink-800 dark:text-ink-100">{m.title}</p>
                          <p className="mt-0.5 text-ink-400">
                            {m.assignee_member_id ? memberById.get(m.assignee_member_id)?.full_name ?? 'Unknown' : 'Unassigned'}
                            {m.due_date && ` · due ${m.due_date}`}
                          </p>
                          <div className="mt-1.5 flex gap-1">
                            {MILESTONE_STATUSES.filter((s) => s !== status).map((s) => (
                              <button
                                key={s}
                                type="button"
                                className="btn-ghost px-1.5 py-0.5 text-[10px]"
                                onClick={() => void moveMilestone(m, s)}
                              >
                                → {MILESTONE_STATUS_LABEL[s]}
                              </button>
                            ))}
                            <button
                              type="button"
                              className="btn-ghost ml-auto px-1 py-0.5 text-rose-500"
                              onClick={() => void removeMilestone(m)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-3">
            <CommentThread resourceType="project" resourceId={project.id} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink-800 dark:text-ink-100">Assigned members</h3>
              {!addingMember && (
                <button
                  type="button"
                  className={cx('btn-ghost py-1 text-xs', available.length === 0 && 'pointer-events-none opacity-40')}
                  onClick={() => setAddingMember(true)}
                >
                  <UserPlus className="h-3.5 w-3.5" /> Add
                </button>
              )}
            </div>
            {addingMember && (
              <div className="mb-2 flex gap-1.5">
                <select className="input py-1 text-xs" value={pendingMemberId} onChange={(e) => setPendingMemberId(e.target.value)}>
                  <option value="">Choose a member…</option>
                  {available.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-primary py-1 text-xs" onClick={() => void assign()}>
                  Add
                </button>
                <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setAddingMember(false)}>
                  Cancel
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {assignedMembers.length === 0 && <p className="text-xs text-ink-400">Nobody assigned yet.</p>}
              {assignedMembers.map((m) => (
                <span
                  key={m.id}
                  className="flex items-center gap-1 rounded-full bg-pearl-50 py-1 pl-2.5 pr-1 text-xs font-medium text-pearl-800 dark:bg-pearl-500/10 dark:text-pearl-200"
                >
                  {m.full_name}
                  <button type="button" className="rounded-full p-0.5 hover:bg-white/60 dark:hover:bg-ink-900/40" onClick={() => void unassign(m.id)}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-ink-800 dark:text-ink-100">
                <Beaker className="h-4 w-4" /> Linked chemicals ({linkedChemicals.length})
              </h3>
              {linkedChemicals.length > 0 && (
                <Link
                  to={`/inventory?q=${encodeURIComponent(project.name)}`}
                  className="flex items-center gap-1 text-xs font-medium text-pearl-700 hover:underline dark:text-pearl-300"
                >
                  Open <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
            {linkedChemicals.length === 0 ? (
              <p className="text-xs text-ink-400">No chemicals tagged with this project name yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {linkedChemicals.slice(0, 8).map((c) => (
                  <li key={c.id} className="flex items-center justify-between text-ink-700 dark:text-ink-200">
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 text-xs text-ink-400">{formatSize(c)}</span>
                  </li>
                ))}
                {linkedChemicals.length > 8 && (
                  <li className="text-xs text-ink-400">+{linkedChemicals.length - 8} more</li>
                )}
              </ul>
            )}
          </div>

          <div className="card p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink-800 dark:text-ink-100">
              <Database className="h-4 w-4" /> Linked research assets ({linkedAssets.length})
            </h3>
            {linkedAssets.length === 0 ? (
              <p className="text-xs text-ink-400">No research assets tagged with this project name yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {linkedAssets.slice(0, 8).map((a) => (
                  <li key={a.id} className="flex items-center justify-between text-ink-700 dark:text-ink-200">
                    <span className="truncate">{a.title}</span>
                    <span className="shrink-0 text-xs capitalize text-ink-400">{a.type}</span>
                  </li>
                ))}
                {linkedAssets.length > 8 && <li className="text-xs text-ink-400">+{linkedAssets.length - 8} more</li>}
              </ul>
            )}
          </div>

          {publications.length > 0 && (
            <div className="card p-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink-800 dark:text-ink-100">
                <BookOpen className="h-4 w-4" /> Publications ({publications.length})
              </h3>
              <ul className="space-y-1 text-sm">
                {publications.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-ink-700 dark:text-ink-200">
                    <span className="truncate">{p.title}</span>
                    <span className="shrink-0 text-xs capitalize text-ink-400">{p.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
