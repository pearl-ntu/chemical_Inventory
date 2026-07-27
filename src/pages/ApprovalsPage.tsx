import { useState } from 'react'
import { CalendarDays, Check, ClipboardCheck, MapPin, ShieldCheck, User, X } from 'lucide-react'
import { ChemicalDrawer } from '../components/ChemicalDrawer'
import { PageHeader } from '../components/Layout'
import { EmptyState, Field, LoadingScreen, Modal, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import type { Chemical } from '../lib/types'
import { formatRelative, formatSize } from '../lib/utils'

export default function ApprovalsPage() {
  const { isAdmin } = useAuth()
  const { pendingChemicals, loading, approve, reject } = useInventory()
  const toast = useToast()

  const [detail, setDetail] = useState<Chemical | null>(null)
  const [rejecting, setRejecting] = useState<Chemical | null>(null)
  const [reason, setReason] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  if (!isAdmin) {
    return (
      <EmptyState
        icon={<ShieldCheck className="h-6 w-6" />}
        title="Admins only"
        description="Ask an admin in the group if you think a submission of yours needs a nudge."
      />
    )
  }

  if (loading) return <LoadingScreen label="Loading the approval queue…" />

  async function onApprove(row: Chemical) {
    setBusyId(row.id)
    try {
      await approve(row)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not approve that submission.')
    } finally {
      setBusyId(null)
    }
  }

  async function onConfirmReject() {
    if (!rejecting) return
    if (!reason.trim()) return toast.error('Add a short reason so the submitter knows what to fix.')
    setBusyId(rejecting.id)
    try {
      await reject(rejecting, reason.trim())
      setRejecting(null)
      setReason('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reject that submission.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          pendingChemicals.length === 0
            ? 'Nothing waiting on you right now.'
            : `${pendingChemicals.length} submission${pendingChemicals.length === 1 ? '' : 's'} waiting for a decision, oldest first.`
        }
      />

      {pendingChemicals.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ClipboardCheck className="h-6 w-6" />}
            title="Queue is clear"
            description="New submissions from members will show up here before they join the shared shelf."
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {pendingChemicals.map((c) => (
            <li key={c.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => setDetail(c)}>
                  <p className="truncate font-semibold text-ink-900 dark:text-ink-50">{c.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500 dark:text-ink-400">
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" /> {c.registered_by ?? 'Unknown'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {c.location ?? 'No location given'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" /> {formatRelative(c.created_at)}
                    </span>
                    <span className="font-mono">{formatSize(c)}</span>
                  </div>
                </button>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="btn-secondary py-1.5 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                    disabled={busyId === c.id}
                    onClick={() => {
                      setRejecting(c)
                      setReason('')
                    }}
                  >
                    <X className="h-4 w-4" /> Reject
                  </button>
                  <button
                    className="btn-primary py-1.5"
                    disabled={busyId === c.id}
                    onClick={() => void onApprove(c)}
                  >
                    {busyId === c.id ? <Spinner /> : <Check className="h-4 w-4" />}
                    Approve
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ChemicalDrawer chemical={detail} onClose={() => setDetail(null)} onEdit={() => setDetail(null)} />

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting?.name ?? ''}`}
        description="This goes back to the submitter, who can fix it and resubmit."
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRejecting(null)}>
              Cancel
            </button>
            <button className="btn-danger" onClick={() => void onConfirmReject()} disabled={!!busyId}>
              {busyId && <Spinner />}
              Reject submission
            </button>
          </>
        }
      >
        <Field label="Reason" required hint="Be specific — this is what the submitter sees.">
          <textarea
            autoFocus
            className="input min-h-[88px] resize-y"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Wrong CAS number — please double-check against the bottle label."
          />
        </Field>
      </Modal>
    </>
  )
}
