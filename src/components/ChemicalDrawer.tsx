import { Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Beaker,
  BookOpen,
  Building2,
  CalendarDays,
  Camera,
  CircleSlash,
  Copy,
  Database,
  ExternalLink,
  FileText,
  History,
  MapPin,
  PackagePlus,
  Pencil,
  Send,
  Trash2,
  User,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import { resolveDeliveryPhotoUrl } from '../lib/deliveryPhoto'
import { resolveDocUrl } from '../lib/labDocuments'
import * as pubchem from '../lib/pubchem'
import { containerDeepLink, qrDataUrl } from '../lib/qr'
import { STATUS_LABEL, type Chemical, type ResearchAsset } from '../lib/types'
import { cx, formatDate, formatSize, statusTone, todayISO } from '../lib/utils'
import { useLabLocations } from '../lib/useLabLocations'
import { HazardBadges } from './HazardBadges'
import { LazyMolfileSvgRenderer, LazyReactionViewer } from './LazyStructure'
import { ConfirmDialog, Drawer, Field, Modal, Spinner } from './ui'
import { CommentThread } from './CommentThread'
import { ChemicalHistoryPanel } from './ChemicalHistoryPanel'
import { Molecule3DViewer } from './Molecule3DViewer'
import { PubChemStructureImage } from './PubChemStructureImage'

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
  const { chemicals, markEmpty, restock, remove, update } = useInventory()
  const labLocations = useLabLocations(chemicals)
  const toast = useToast()

  const [qr, setQr] = useState<string | null>(null)
  const [info, setInfo] = useState<pubchem.PubChemInfo | null>(null)
  const [sdf3d, setSdf3d] = useState<string | null>(null)
  const [sdf2d, setSdf2d] = useState<string | null>(null)
  const [pubchemImageOk, setPubchemImageOk] = useState(true)
  const [structureView, setStructureView] = useState<'2d' | '3d'>('2d')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [relatedAssets, setRelatedAssets] = useState<ResearchAsset[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveLocation, setMoveLocation] = useState('')
  const [moveSubLocation, setMoveSubLocation] = useState('')
  const [moveNote, setMoveNote] = useState('')
  const [disposeOpen, setDisposeOpen] = useState(false)
  const [wasteClass, setWasteClass] = useState('')
  const [disposalReason, setDisposalReason] = useState('')
  const [borrowOpen, setBorrowOpen] = useState(false)
  const [borrower, setBorrower] = useState('')
  const [returnDate, setReturnDate] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setQr(null)
    setInfo(null)
    setSdf3d(null)
    setSdf2d(null)
    setPubchemImageOk(true)
    setStructureView('2d')
    setPhotoUrl(null)
    setRelatedAssets([])
    setMoveLocation(chemical?.location ?? '')
    setMoveSubLocation(chemical?.sub_location ?? '')
    setMoveNote('')
    setWasteClass(chemical?.disposal_waste_class ?? '')
    setDisposalReason(chemical?.disposal_reason ?? '')
    setBorrower('')
    setReturnDate('')
    if (!chemical) return

    let live = true
    void qrDataUrl(containerDeepLink(chemical.code), 220).then((url) => live && setQr(url))
    void pubchem.lookup(chemical.cas, chemical.name).then((res) => {
      if (!live) return
      setInfo(res)
      if (res?.cid) {
        void pubchem.fetch3dSdf(res.cid).then((sdf) => live && setSdf3d(sdf))
        void pubchem.fetch2dSdf(res.cid).then((sdf) => live && setSdf2d(sdf))
      }
    })
    void api
      .listResearchAssetsForChemical(chemical.id)
      .then((rows) => live && setRelatedAssets(rows))
      .catch(() => {
        if (live) setRelatedAssets([])
      })
    if (chemical.delivery_photo_path) {
      void resolveDeliveryPhotoUrl(chemical.delivery_photo_path)
        .then((url) => live && setPhotoUrl(url))
        .catch(() => {
          /* private bucket, no session, or the file's gone — just skip the preview */
        })
    }
    return () => {
      live = false
    }
  }, [chemical])

  if (!chemical) return null

  const c = chemical
  const canDelete = isAdmin || c.created_by === profile?.id
  const viewerSdf = sdf3d ?? sdf2d ?? c.structure_molfile

  async function openDoc(value: string | null | undefined, label: string) {
    try {
      const url = await resolveDocUrl(value)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not open the ${label}.`)
    }
  }

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

  async function saveMove() {
    const from = [c.location, c.sub_location].filter(Boolean).join(' / ') || 'Unassigned'
    const to = [moveLocation || null, moveSubLocation || null].filter(Boolean).join(' / ') || 'Unassigned'
    await act(async () => {
      await update(
        c.id,
        { location: moveLocation || null, sub_location: moveSubLocation || null },
        `Moved ${c.name} from ${from} to ${to}${moveNote.trim() ? ` - ${moveNote.trim()}` : ''}`,
      )
      setMoveOpen(false)
      toast.success(`Moved to ${to}.`)
    })
  }

  async function saveDisposal() {
    await act(async () => {
      await update(
        c.id,
        {
          status: 'disposed',
          quantity: 0,
          date_emptied: todayISO(),
          disposal_date: todayISO(),
          disposal_waste_class: wasteClass || null,
          disposal_reason: disposalReason || 'Disposed from drawer workflow',
        },
        `Disposed ${c.name}${wasteClass ? ` as ${wasteClass}` : ''}`,
      )
      setDisposeOpen(false)
      toast.success(`${c.name} marked disposed.`)
    })
  }

  async function saveBorrowed() {
    const stamp = `Borrowed by ${borrower.trim() || 'unknown'}${returnDate ? `; expected return ${returnDate}` : ''}; recorded ${todayISO()} by ${profile?.full_name ?? 'PEARL'}`
    await act(async () => {
      await update(
        c.id,
        { remarks: [c.remarks, stamp].filter(Boolean).join('\n') },
        `Checkout note added for ${c.name}: ${stamp}`,
      )
      setBorrowOpen(false)
      toast.success('Borrow note added.')
    })
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
              <button className="btn-secondary" onClick={() => setMoveOpen(true)} disabled={busy}>
                <MapPin className="h-4 w-4" /> Move
              </button>
              <button className="btn-secondary" onClick={() => setBorrowOpen(true)} disabled={busy}>
                <Send className="h-4 w-4" /> Borrow
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
              {c.status !== 'disposed' && (
                <button className="btn-secondary" disabled={busy} onClick={() => setDisposeOpen(true)}>
                  <CircleSlash className="h-4 w-4" /> Dispose
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
            <div className="viz-root card flex min-h-[220px] flex-col justify-center overflow-hidden bg-white p-3">
              <div className="mb-2 flex justify-end gap-1">
                <button type="button" className={structureView === '2d' ? 'btn-primary py-1 text-xs' : 'btn-secondary py-1 text-xs'} onClick={() => setStructureView('2d')}>2D</button>
                <button type="button" className={structureView === '3d' ? 'btn-primary py-1 text-xs' : 'btn-secondary py-1 text-xs'} onClick={() => setStructureView('3d')}>3D</button>
              </div>
              <div className="flex flex-1 items-center justify-center">
                {structureView === '3d' ? (
                  <Molecule3DViewer sdf={viewerSdf} coordinates={sdf3d ? '3d' : '2d'} />
                ) : c.structure_molfile ? (
                  <Suspense fallback={<Spinner className="h-5 w-5 text-ink-300" />}>
                    <LazyMolfileSvgRenderer molfile={c.structure_molfile} width={220} height={150} />
                  </Suspense>
                ) : pubchemImageOk ? (
                  <PubChemStructureImage
                    cas={c.cas}
                    name={c.name}
                    cid={info?.cid}
                    alt={`Structure of ${c.name}`}
                    className="max-h-36 w-auto object-contain dark:brightness-95 dark:invert-[.92] dark:hue-rotate-180"
                    onExhausted={() => setPubchemImageOk(false)}
                  />
                ) : (
                  <p className="px-3 text-center text-xs text-ink-400">
                    No structure available offline. Draw one from the edit form, or it's looked up
                    from PubChem when the network allows.
                  </p>
                )}
              </div>
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

          {/* synthesis scheme ---------------------------------------------- */}
          {c.reaction_rxnfile && (
            <div className="card p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">
                <Beaker className="h-3.5 w-3.5" /> Synthesis scheme
              </p>
              <div className="viz-root flex min-h-[140px] items-center justify-center overflow-hidden rounded bg-white p-2">
                <Suspense fallback={<Spinner className="h-5 w-5 text-ink-300" />}>
                  <LazyReactionViewer rxnfile={c.reaction_rxnfile} />
                </Suspense>
              </div>
            </div>
          )}

          {/* computational links ------------------------------------------- */}
          {relatedAssets.length > 0 && (
            <div className="card p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">
                <Database className="h-3.5 w-3.5" /> Related computational assets
              </p>
              <div className="space-y-2">
                {relatedAssets.slice(0, 6).map((asset) => (
                  <div key={asset.id} className="rounded-lg border border-ink-200 p-2.5 dark:border-ink-800">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="badge bg-pearl-50 text-pearl-700 ring-pearl-600/20 dark:bg-pearl-500/10 dark:text-pearl-300">
                        {asset.type}
                      </span>
                      {asset.source && (
                        <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">
                          {asset.source}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm font-semibold text-ink-900 dark:text-ink-50">{asset.title}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {[asset.project, asset.owner, asset.software].filter(Boolean).join(' - ') || 'No extra metadata'}
                    </p>
                  </div>
                ))}
                {relatedAssets.length > 6 && (
                  <p className="text-xs text-ink-400">+{relatedAssets.length - 6} more linked assets</p>
                )}
              </div>
            </div>
          )}

          {/* delivery photo -------------------------------------------------- */}
          {c.delivery_photo_path && (
            <div className="card p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">
                <Camera className="h-3.5 w-3.5" /> Delivery photo
              </p>
              <div className="flex min-h-[100px] items-center justify-center overflow-hidden rounded bg-ink-50 dark:bg-ink-900">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt="Delivery order"
                    className="max-h-64 w-auto object-contain"
                  />
                ) : (
                  <Spinner className="h-5 w-5 text-ink-300" />
                )}
              </div>
            </div>
          )}

          {/* external ----------------------------------------------------- */}
          <div className="flex flex-wrap gap-2">
            {c.sds_url ? (
              <button type="button" className="btn-secondary" onClick={() => void openDoc(c.sds_url, 'SDS')}>
                <FileText className="h-4 w-4" /> Open SDS
                <ExternalLink className="h-3 w-3 opacity-60" />
              </button>
            ) : (
              <a
                href={pubchem.sdsSearchUrl(c.name, c.cas, c.supplier)}
                target="_blank"
                rel="noreferrer noopener"
                className="btn-secondary"
              >
                <FileText className="h-4 w-4" /> Find the SDS
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            )}
            {c.coa_url && (
              <button type="button" className="btn-secondary" onClick={() => void openDoc(c.coa_url, 'CoA')}>
                <FileText className="h-4 w-4" /> Open CoA
                <ExternalLink className="h-3 w-3 opacity-60" />
              </button>
            )}
            {c.invoice_url && (
              <button type="button" className="btn-secondary" onClick={() => void openDoc(c.invoice_url, 'invoice/DO')}>
                <FileText className="h-4 w-4" /> Open invoice/DO
                <ExternalLink className="h-3 w-3 opacity-60" />
              </button>
            )}
            {info && (
              <a href={info.pageUrl} target="_blank" rel="noreferrer noopener" className="btn-secondary">
                PubChem CID {info.cid}
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            )}
            <Link to={`/sops?chemical=${c.id}`} className="btn-secondary">
              <BookOpen className="h-4 w-4" /> SOPs for this chemical
            </Link>
          </div>

          <details className="card p-3">
            <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-400 hover:text-ink-600 dark:hover:text-ink-300">
              <History className="h-3.5 w-3.5" /> History
            </summary>
            <div className="mt-2">
              <ChemicalHistoryPanel chemicalId={c.id} />
            </div>
          </details>

          <CommentThread resourceType="chemical" resourceId={c.id} />
        </div>
      </Drawer>

      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title="Move chemical"
        description={`Record a location change for ${c.code}.`}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setMoveOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={() => void saveMove()} disabled={busy}>
              {busy ? <Spinner /> : <MapPin className="h-4 w-4" />} Save move
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="New location">
            <input
              className="input"
              list="drawer-locations"
              value={moveLocation}
              onChange={(event) => setMoveLocation(event.target.value)}
            />
            <datalist id="drawer-locations">
              {labLocations.locations.map((location) => (
                <option key={location} value={location} />
              ))}
            </datalist>
          </Field>
          <Field label="Shelf / position">
            <input
              className="input"
              list="drawer-sub-locations"
              value={moveSubLocation}
              onChange={(event) => setMoveSubLocation(event.target.value)}
            />
            <datalist id="drawer-sub-locations">
              {labLocations.subLocations.map((location) => (
                <option key={location} value={location} />
              ))}
            </datalist>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Move note">
              <input
                className="input"
                value={moveNote}
                onChange={(event) => setMoveNote(event.target.value)}
                placeholder="Optional reason, e.g. safety audit or owner handover"
              />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={disposeOpen}
        onClose={() => setDisposeOpen(false)}
        title="Disposal log"
        description="Mark this record disposed and keep the waste class/reason attached to the container history."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDisposeOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={() => void saveDisposal()} disabled={busy}>
              {busy ? <Spinner /> : <CircleSlash className="h-4 w-4" />} Mark disposed
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Waste class">
            <input
              className="input"
              value={wasteClass}
              onChange={(event) => setWasteClass(event.target.value)}
              placeholder="Halogenated solvent, acidic waste..."
            />
          </Field>
          <Field label="Reason">
            <input
              className="input"
              value={disposalReason}
              onChange={(event) => setDisposalReason(event.target.value)}
              placeholder="Expired, empty, contaminated..."
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={borrowOpen}
        onClose={() => setBorrowOpen(false)}
        title="Borrow / checkout note"
        description="Adds a visible note to the record without changing stock or deleting history."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setBorrowOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={() => void saveBorrowed()} disabled={busy || !borrower.trim()}>
              {busy ? <Spinner /> : <Send className="h-4 w-4" />} Add note
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Borrowed by">
            <input
              className="input"
              value={borrower}
              onChange={(event) => setBorrower(event.target.value)}
              placeholder="Name or group"
            />
          </Field>
          <Field label="Expected return">
            <input
              className="input"
              type="date"
              value={returnDate}
              onChange={(event) => setReturnDate(event.target.value)}
            />
          </Field>
        </div>
      </Modal>

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
