import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, MessageSquare, Send } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import {
  PROJECT_UPDATE_STATUSES,
  PROJECT_UPDATE_STATUS_LABEL,
  type Project,
  type ProjectUpdate,
  type ProjectUpdateStatus,
  type ProjectWorkspace,
} from '../lib/types'
import { cx, formatRelative } from '../lib/utils'
import { CommentThread } from './CommentThread'
import { Spinner } from './ui'

const STATUS_DOT: Record<ProjectUpdateStatus, string> = {
  on_track: 'bg-emerald-500',
  blocked: 'bg-rose-500',
  done: 'bg-pearl-500',
  paused: 'bg-ink-400',
}

/**
 * The one thing this whole feature hinges on: posting a project status
 * update has to be faster than not bothering. One field for the project
 * name (autocompletes existing ones), three status pills, a short summary,
 * submit — meant to take less time than typing it into a group chat, so it
 * actually gets used every week instead of becoming another ignored form.
 */
export function ProjectUpdateWidget({ workspace }: { workspace: ProjectWorkspace }) {
  const { profile, canEdit } = useAuth()
  const toast = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [mine, setMine] = useState<ProjectUpdate[]>([])
  const [name, setName] = useState('')
  const [status, setStatus] = useState<ProjectUpdateStatus>('on_track')
  const [summary, setSummary] = useState('')
  const [posting, setPosting] = useState(false)
  const [showComments, setShowComments] = useState(false)

  useEffect(() => {
    void api.listProjects().then(setProjects).catch(() => setProjects([]))
  }, [])

  useEffect(() => {
    if (!profile) return
    void api
      .listRecentProjectUpdates(40)
      .then((rows) => setMine(rows.filter((r) => r.author_id === profile.id).slice(0, 3)))
      .catch(() => setMine([]))
  }, [profile])

  const projectNames = useMemo(() => projects.map((p) => p.name), [projects])
  const matchedProject = useMemo(
    () => projects.find((p) => p.name.toLowerCase() === name.trim().toLowerCase()) ?? null,
    [projects, name],
  )

  useEffect(() => {
    setShowComments(false)
  }, [matchedProject?.id])

  async function submit() {
    if (!profile) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('Give the project a name first.')
      return
    }
    if (!summary.trim()) {
      toast.error('Add a one-line summary of what happened this week.')
      return
    }
    setPosting(true)
    try {
      const project = await api.findOrCreateProject(trimmedName, workspace, profile)
      const update = await api.addProjectUpdate({ project_id: project.id, status, summary: summary.trim() }, profile)
      setMine((prev) => [update, ...prev].slice(0, 3))
      setProjects((prev) => (prev.some((p) => p.id === project.id) ? prev : [...prev, project]))
      setSummary('')
      toast.success('Update posted.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not post that update.')
    } finally {
      setPosting(false)
    }
  }

  if (!canEdit) return null

  return (
    <section className="card p-4">
      <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">Post a project update</h2>
      <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
        What you worked on, what's pending, what's blocked — takes ten seconds, and it's what the PI dashboard reads from.
      </p>

      <div className="mt-3 space-y-2.5">
        <input
          className="input"
          list="pearl-project-names"
          placeholder="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <datalist id="pearl-project-names">
          {projectNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        {matchedProject && (
          <div>
            <button
              type="button"
              className="btn-ghost py-1 text-xs"
              onClick={() => setShowComments((v) => !v)}
            >
              <MessageSquare className="h-3.5 w-3.5" /> {showComments ? 'Hide' : 'Discuss'} "{matchedProject.name}"
            </button>
            {showComments && (
              <div className="mt-2">
                <CommentThread resourceType="project" resourceId={matchedProject.id} />
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {PROJECT_UPDATE_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cx(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                status === s
                  ? 'border-pearl-300 bg-pearl-50 text-pearl-800 dark:border-pearl-500/40 dark:bg-pearl-500/10 dark:text-pearl-200'
                  : 'border-ink-200 text-ink-500 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800',
              )}
            >
              <span className={cx('h-1.5 w-1.5 rounded-full', STATUS_DOT[s])} />
              {PROJECT_UPDATE_STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <textarea
          className="input min-h-[70px] resize-y"
          placeholder="e.g. Finished the TD-DFT scan for the naphthamide series, waiting on HPC queue for the rest."
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />

        <button type="button" className="btn-primary" disabled={posting} onClick={() => void submit()}>
          {posting ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          {posting ? 'Posting…' : 'Post update'}
        </button>
      </div>

      {mine.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-ink-100 pt-3 dark:border-ink-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Your recent updates</p>
          {mine.map((u) => (
            <div key={u.id} className="flex items-start gap-2 text-xs">
              <span className={cx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[u.status])} />
              <p className="min-w-0 flex-1 truncate text-ink-600 dark:text-ink-300">{u.summary}</p>
              <span className="shrink-0 text-ink-400">{formatRelative(u.created_at)}</span>
            </div>
          ))}
        </div>
      )}
      {mine.length === 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-400">
          <CheckCircle2 className="h-3.5 w-3.5" /> No updates from you yet — the first one starts the log.
        </p>
      )}
    </section>
  )
}
