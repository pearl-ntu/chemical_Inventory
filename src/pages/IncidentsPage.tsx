import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { EmptyState, Field, LoadingScreen, Modal, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABEL,
  type IncidentReport,
  type IncidentReportInput,
  type IncidentSeverity,
} from '../lib/types'
import { cx, formatRelative, todayISO } from '../lib/utils'

const SEVERITY_TONE: Record<IncidentSeverity, string> = {
  near_miss: 'bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300',
  minor: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300',
  major: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300',
}

const BLANK: IncidentReportInput = {
  resource_type: null,
  resource_id: null,
  severity: 'near_miss',
  description: '',
  occurred_at: new Date().toISOString(),
  actions_taken: null,
}

/**
 * Any approved member can file one of these, including a viewer-only
 * account — safety reporting isn't something to gate behind edit rights.
 * Admins/PI get notified the moment one's filed (in-app, plus Teams if
 * that's configured).
 */
export default function IncidentsPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const [reports, setReports] = useState<IncidentReport[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<IncidentReportInput>(BLANK)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.listIncidentReports().then(setReports).finally(() => setLoading(false))
  }, [])

  const sorted = useMemo(() => reports, [reports])

  async function submit() {
    if (!profile || !form.description.trim()) {
      toast.error('Describe what happened.')
      return
    }
    setSaving(true)
    try {
      const created = await api.createIncidentReport(form, profile)
      setReports((prev) => [created, ...prev])
      setForm(BLANK)
      setFormOpen(false)
      toast.success('Report filed — admins have been notified.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not file that report.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingScreen label="Loading incident reports…" />

  return (
    <div>
      <PageHeader
        title="Incidents & Near Misses"
        description="Anyone can file one — this isn't gated by role. Admins and the PI are notified immediately."
        actions={
          <button className="btn-primary" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" /> Report an incident
          </button>
        }
      />

      {sorted.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title="No incidents reported"
          description="Good sign — but if something almost went wrong, file it anyway. Near misses matter."
        />
      ) : (
        <div className="space-y-2">
          {sorted.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx('badge', SEVERITY_TONE[r.severity])}>{INCIDENT_SEVERITY_LABEL[r.severity]}</span>
                <span className="text-xs text-ink-400">
                  {r.reported_by_name ?? 'Unknown'} · {formatRelative(r.occurred_at)}
                </span>
              </div>
              <p className="mt-2 text-sm text-ink-700 dark:text-ink-200">{r.description}</p>
              {r.actions_taken && (
                <p className="mt-1.5 text-xs text-ink-500">
                  <span className="font-medium">Actions taken:</span> {r.actions_taken}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Report an incident or near miss"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={saving} onClick={() => void submit()}>
              {saving ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} File report
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Severity">
            <div className="flex gap-1.5">
              {INCIDENT_SEVERITIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, severity: s }))}
                  className={cx(
                    'rounded-full border px-3 py-1 text-xs font-medium',
                    form.severity === s
                      ? 'border-pearl-400 bg-pearl-50 text-pearl-800 dark:border-pearl-500/40 dark:bg-pearl-500/10 dark:text-pearl-200'
                      : 'border-ink-200 text-ink-500 dark:border-ink-700',
                  )}
                >
                  {INCIDENT_SEVERITY_LABEL[s]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="What happened?">
            <textarea
              className="input min-h-[100px] resize-y"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Describe what happened, or what almost happened…"
            />
          </Field>
          <Field label="When">
            <input
              type="date"
              className="input"
              value={(form.occurred_at || todayISO()).slice(0, 10)}
              onChange={(e) => setForm((f) => ({ ...f, occurred_at: new Date(e.target.value).toISOString() }))}
            />
          </Field>
          <Field label="Actions taken (optional)">
            <textarea
              className="input min-h-[60px] resize-y"
              value={form.actions_taken ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, actions_taken: e.target.value || null }))}
              placeholder="What was done about it, if anything…"
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
