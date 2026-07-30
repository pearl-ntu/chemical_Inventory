import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, ArrowRight, LayoutList, Plus, RotateCcw, TimerReset } from 'lucide-react'
import { ConfirmDialog, LoadingScreen, Spinner } from '../components/ui'
import { ProjectTimeline } from '../components/ProjectTimeline'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import { computeProjectHealth, PROJECT_HEALTH_DOT, PROJECT_HEALTH_LABEL } from '../lib/projectHealth'
import { PROJECT_STATUS_LABEL, type Project, type ProjectUpdate, type ProjectWorkspace } from '../lib/types'
import { cx } from '../lib/utils'

const WORKSPACE_LABEL: Record<ProjectWorkspace, string> = {
  experimental: 'Experimental',
  computational: 'Computational',
  both: 'Both',
}

/**
 * The project list — kept compact on purpose. Everything you'd actually
 * edit (description, status, target date, budget, who's assigned, linked
 * inventory, milestones, comments) lives on the detail page one click away;
 * this view's job is scanning the whole roster at a glance, not editing it.
 */
export default function PiProjectsPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [updates, setUpdates] = useState<ProjectUpdate[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [workspace, setWorkspace] = useState<ProjectWorkspace>('both')
  const [creating, setCreating] = useState(false)
  const [archived, setArchived] = useState<Project[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [toArchive, setToArchive] = useState<Project | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [view, setView] = useState<'list' | 'timeline'>('list')

  async function load() {
    const [p, u] = await Promise.all([api.listProjects(), api.listRecentProjectUpdates(500)])
    setProjects(p)
    setUpdates(u)
  }

  async function loadArchived() {
    setArchived(await api.listArchivedProjects())
  }

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [])

  const latestUpdateByProject = useMemo(() => {
    const map = new Map<string, ProjectUpdate>()
    for (const u of updates) {
      const existing = map.get(u.project_id)
      if (!existing || u.created_at > existing.created_at) map.set(u.project_id, u)
    }
    return map
  }, [updates])

  function daysSince(project: Project): number {
    const latest = latestUpdateByProject.get(project.id)
    if (!latest) return Infinity
    return Math.floor((Date.now() - new Date(latest.created_at).getTime()) / 86_400_000)
  }

  async function createProject() {
    if (!profile) return
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Give the project a name.')
      return
    }
    const alreadyExisted = projects.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())
    setCreating(true)
    try {
      const project = await api.createProject(trimmed, workspace, profile)
      setProjects((prev) => (prev.some((p) => p.id === project.id) ? prev : [...prev, project]))
      setName('')
      toast.success(alreadyExisted ? `"${project.name}" already existed — showing it below.` : 'Project created.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create that project.')
    } finally {
      setCreating(false)
    }
  }

  async function confirmArchive() {
    if (!toArchive) return
    setArchiving(true)
    try {
      await api.archiveProject(toArchive)
      setProjects((prev) => prev.filter((p) => p.id !== toArchive.id))
      toast.success(`${toArchive.name} archived — find it under "Show archived" to bring it back.`)
      setToArchive(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not archive that project.')
    } finally {
      setArchiving(false)
    }
  }

  async function restore(project: Project) {
    try {
      const restored = await api.unarchiveProject(project)
      setArchived((prev) => prev.filter((p) => p.id !== project.id))
      setProjects((prev) => [...prev, restored])
      toast.success(`${project.name} restored.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not restore that project.')
    }
  }

  if (loading) return <LoadingScreen label="Loading projects…" />

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900 dark:text-white">Projects</h2>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">Create a project, then open it to manage everything about it.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-ink-200 p-0.5 dark:border-ink-700">
          <button
            type="button"
            className={cx('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium', view === 'list' ? 'bg-pearl-600 text-white' : 'text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-800')}
            onClick={() => setView('list')}
          >
            <LayoutList className="h-3.5 w-3.5" /> List
          </button>
          <button
            type="button"
            className={cx('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium', view === 'timeline' ? 'bg-pearl-600 text-white' : 'text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-800')}
            onClick={() => setView('timeline')}
          >
            <TimerReset className="h-3.5 w-3.5" /> Timeline
          </button>
        </div>
      </div>

      <div className="card mb-4 flex flex-wrap items-end gap-2 p-4">
        <div className="min-w-[200px] flex-1">
          <label className="label">Project name</label>
          <input
            className="input"
            list="pearl-pi-project-names"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. TICT emitters — existing projects show as you type"
          />
          <datalist id="pearl-pi-project-names">
            {projects.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="label">Workspace</label>
          <select className="input" value={workspace} onChange={(e) => setWorkspace(e.target.value as ProjectWorkspace)}>
            <option value="both">Both</option>
            <option value="experimental">Experimental</option>
            <option value="computational">Computational</option>
          </select>
        </div>
        <button type="button" className="btn-primary" disabled={creating} onClick={() => void createProject()}>
          {creating ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Create project
        </button>
      </div>

      {view === 'timeline' && (
        <ProjectTimeline projects={projects} health={(project) => computeProjectHealth(project, daysSince(project))} />
      )}

      {view === 'list' && (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => {
          const health = computeProjectHealth(project, daysSince(project))
          return (
            <div key={project.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={cx('h-2 w-2 shrink-0 rounded-full', PROJECT_HEALTH_DOT[health])} title={PROJECT_HEALTH_LABEL[health]} />
                    <h3 className="truncate font-semibold text-ink-900 dark:text-ink-50">{project.name}</h3>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">
                      {WORKSPACE_LABEL[project.workspace]}
                    </span>
                    <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">
                      {PROJECT_STATUS_LABEL[project.status]}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost shrink-0 p-1.5 text-ink-400 hover:text-rose-600"
                  title="Archive project"
                  onClick={() => setToArchive(project)}
                >
                  <Archive className="h-4 w-4" />
                </button>
              </div>

              <p className="mt-2 line-clamp-2 flex-1 text-sm text-ink-500 dark:text-ink-400">
                {project.description || 'No description yet.'}
              </p>

              <Link
                to={`/pi-dashboard/projects/${project.id}`}
                className="btn-secondary mt-3 justify-center text-xs"
              >
                View details <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )
        })}
      </div>
      )}

      <div className="mt-5">
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => {
            const next = !showArchived
            setShowArchived(next)
            if (next && archived.length === 0) void loadArchived()
          }}
        >
          {showArchived ? 'Hide archived' : 'Show archived'}
        </button>
        {showArchived && (
          <div className="mt-2 space-y-2">
            {archived.length === 0 ? (
              <p className="text-xs text-ink-400">No archived projects.</p>
            ) : (
              archived.map((project) => (
                <div key={project.id} className="card flex items-center justify-between p-3">
                  <div>
                    <p className="text-sm font-medium text-ink-700 dark:text-ink-200">{project.name}</p>
                    <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">
                      {WORKSPACE_LABEL[project.workspace]}
                    </span>
                  </div>
                  <button type="button" className="btn-secondary py-1 text-xs" onClick={() => void restore(project)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Restore
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={toArchive !== null}
        title="Archive this project?"
        confirmLabel="Archive"
        destructive
        busy={archiving}
        message={
          toArchive && (
            <p>
              <strong>{toArchive.name}</strong> will be hidden from the main list. You can bring it back any time from
              "Show archived" below.
            </p>
          )
        }
        onConfirm={() => void confirmArchive()}
        onCancel={() => setToArchive(null)}
      />
    </div>
  )
}
