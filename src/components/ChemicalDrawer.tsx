import { useEffect, useState } from 'react'
import {
  Building2,
  CalendarDays,
  CircleSlash,
  Copy,
  ExternalLink,
  FileText,
  MapPin,
  PackagePlus,
  Pencil,
  Trash2,
  User,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import * as pubchem from '../lib/pubchem'
import { qrDataUrl } from '../lib/qr'
import { STATUS_LABEL, type Chemical } from '../lib/types'
import { cx, formatDate, formatSize, statusTone } from '../lib/utils'
import { HazardBadges } from './HazardBadges'
import { ConfirmDialog, Drawer, Spinner } from './ui'

function Row({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3 py-2">
      <div className="mt-0.5 w-4 shrink-0 text-ink-400">{icon}</div>
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</dt>
        <dd className="mt-0.5 break-words text-sm text-ink-800 dark:text-ink-100">{children}</dd>
      </div>
    </div>
  )
}

export function ChemicalDrawer({
  chemical,
  onClose,
  onEdit,
}: {
  chemical: Chemical | null
  onClose: () => void
  onEdit: (c: Chemical) => void
}) {
  const { canEdit, isAdmin, profile } = useAuth()
  const { markEmpty, restock, remove } = useInventory()
  const toast = useToast()

  const [qr, setQr] = useState<string | null>(null)
  const [info, setInfo] = useState<pubchem.PubChemInfo | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setQr(null)
    setInfo(null)
    if (!chemical) return

    let live = true
    void qrDataUrl(chemical.code, 220).then((url) => live && setQr(url))
    void pubchem.lookup(chemical.cas, chemical.name).then((res) => live && setInfo(res))
    return () => {
      live = false
    }
  }, [chemical])

  if (!chemical) return null

  const c = chemical
  const canDelete = isAdmin || c.created_by === profile?.id

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(c.code)
      toast.success(`${c.code} copied.`)
    } catch {
      toast.error('Clipboard is blocked in this browser.')
    }
  }

  async function act(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={c.name}
        footer={
          canEdit ? (
            <>
              <button className="btn-secondary" onClick={() => onEdit(c)} disabled={busy}>
                <Pencil className="h-4 w-4" /> Edit
              </button>
              {c.status === 'empty' ? (
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => void act(() => restock(c, Math.max(1, c.quantity || 1)))}
                >
                  <PackagePlus className="h-4 w-4" /> Mark back in stock
                </button>
              ) : (
                <button className="btn-secondary" disabled={busy} onClick={() => void act(() => markEmpty(c))}>
                  <CircleSlash className="h-4 w-4" /> Mark empty
                </button>
              )}
              {canDelete && (
                <button
                  className="btn-ghost ml-auto text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              )}
            </>
          ) : (
            <p className="text-xs text-ink-400">
              Your account has view-only access. Ask an admin for edit rights.
            </p>
          )
        }
      >
        <div className="space-y-5">
          {/* header ------------------------------------------------------- */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('badge', statusTone(c.status))}>{STATUS_LABEL[c.status]}</span>
            <button
              onClick={() => void copyCode()}
              className="badge bg-ink-100 font-mono text-ink-700 ring-ink-500/20 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-200 dark:ring-ink-700"
              title="Copy code"
            >
              {c.code} <Copy className="h-3 w-3" />
            </button>
            <HazardBadges hazards={c.hazards} />
          </div>

          {/* structure + qr ---------------------------------------------- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card flex min-h-[160px] items-center justify-center overflow-hidden p-3">
              {info ? (
                <img
                  src={info.imageUrl}
                  alt={`Structure of ${c.name}`}
                  className="max-h-36 w-auto object-contain dark:brightness-95 dark:invert-[.92] dark:hue-rotate-180"
                  loading="lazy"
                />
              ) : (
                <p className="px-3 text-center text-xs text-ink-400">
                  No structure available offline. Structures come from PubChem when the network
                  allows.
                </p>
              )}
            </div>
            <div className="card flex flex-col items-center justify-center gap-2 p-3">
              {qr ? (
                <img src={qr} alt={`QR code for ${c.code}`} className="h-28 w-28" />
              ) : (
                <Spinner className="h-5 w-5 text-ink-400" />
              )}
              <p className="text-center text-[11px] leading-tight text-ink-400">
                Scan to open this record
              </p>
            </div>
          </div>

          {/* amount ------------------------------------------------------- */}
          <div className="card divide-y divide-ink-100 px-4 dark:divide-ink-800">
            <Row icon={<PackagePlus className="h-4 w-4" />} label="Amount on hand">
              <span className="text-base font-semibold">{formatSize(c)}</span>
              {c.purity && <span className="ml-2 text-ink-500">· {c.purity}</span>}
            </Row>
            <Row icon={<MapPin className="h-4 w-4" />} label="Location">
              {c.location ?? '—'}
              {c.sub_location && (
                <span className="text-ink-500 dark:text-ink-400"> · {c.sub_location}</span>
              )}
              {c.storage_class && (
                <span className="mt-1 block text-xs text-ink-500">
                  Storage class: {c.storage_class}
                </span>
              )}
            </Row>
            <Row icon={<User className="h-4 w-4" />} label="Responsible">
              {c.owner ?? '—'}
              {c.project && (
                <span className="mt-0.5 block text-xs text-ink-500">Project: {c.project}</span>
              )}
            </Row>
          </div>

          {/* identity ----------------------------------------------------- */}
          <div className="card divide-y divide-ink-100 px-4 dark:divide-ink-800">
            <Row label="CAS number">
              <span className="font-mono">{c.cas ?? '—'}</span>
            </Row>
            <Row label="Formula / molar mass">
              <span className="font-mono">{c.formula ?? info?.formula ?? '—'}</span>
              {(c.mol_weight ?? info?.molecularWeight) && (
                <span className="ml-2 text-ink-500">
                  {(c.mol_weight ?? info?.molecularWeight)?.toFixed(2)} g/mol
                </span>
              )}
            </Row>
            <Row icon={<Building2 className="h-4 w-4" />} label="Supplier">
              {c.supplier ?? '—'}
              {c.catalog_no && <span className="ml-2 font-mono text-ink-500">#{c.catalog_no}</span>}
              {c.system && <span className="mt-0.5 block text-xs text-ink-500">via {c.system}</span>}
            </Row>
            <Row icon={<CalendarDays className="h-4 w-4" />} label="Dates">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <span className="text-ink-500">Registered</span>
                <span>{formatDate(c.registration_date)}</span>
                {c.opened_date && (
                  <>
                    <span className="text-ink-500">Opened</span>
                    <span>{formatDate(c.opened_date)}</span>
                  </>
                )}
                {c.expiry_date && (
                  <>
                    <span className="text-ink-500">Expires</span>
                    <span>{formatDate(c.expiry_date)}</span>
                  </>
                )}
                {c.date_emptied && (
                  <>
                    <span className="text-ink-500">Emptied</span>
                    <span>{formatDate(c.date_emptied)}</span>
                  </>
                )}
              </div>
            </Row>
            {c.price != null && (
              <Row label="Purchase price">
                {c.currency} {c.price.toFixed(2)}
              </Row>
            )}
            {c.remarks && (
              <Row icon={<FileText className="h-4 w-4" />} label="Remarks">
                <p className="whitespace-pre-wrap">{c.remarks}</p>
              </Row>
            )}
            <Row label="Registered by">
              {c.registered_by ?? '—'}
              <span className="ml-2 text-xs text-ink-400">
                · last edited {formatDate(c.updated_at.slice(0, 10))}
              </span>
            </Row>
          </div>

          {/* external ----------------------------------------------------- */}
          <div className="flex flex-wrap gap-2">
            <a
              href={pubchem.sdsSearchUrl(c.name, c.cas, c.supplier)}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-secondary"
            >
              <FileText className="h-4 w-4" /> Find the SDS
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
            {info && (
              <a href={info.pageUrl} target="_blank" rel="noreferrer noopener" className="btn-secondary">
                PubChem CID {info.cid}
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            )}
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this record?"
        destructive
        confirmLabel="Delete permanently"
        busy={busy}
        message={
          <>
            <p>
              <strong>{c.name}</strong> ({c.code}) will be removed from the inventory. This cannot be
              undone.
            </p>
            <p className="mt-2">
              If the bottle is simply finished, use <em>Mark empty</em> instead — that keeps the
              purchase history for reordering and audits.
            </p>
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          void act(async () => {
            await remove(c)
            toast.success(`${c.name} deleted.`)
            setConfirmDelete(false)
            onClose()
          })
        }
      />
    </>
  )
}
