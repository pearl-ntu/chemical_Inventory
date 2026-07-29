import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ClipboardList, Download, FileWarning, PackageSearch, Plus, Repeat2, ShieldAlert, X } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { Field, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import { HAZARDS, type Chemical, type ChemicalRequest, type ChemicalRequestInput } from '../lib/types'
import { download, formatDate, formatSize, todayISO } from '../lib/utils'

const INCOMPATIBLE: Array<[string, string, string]> = [
  ['Flammable', 'Oxidising', 'Fire risk'],
  ['Corrosive', 'Flammable', 'Vapour/ignition risk'],
  ['Acute toxic', 'Flammable', 'Emergency response concern'],
  ['Compressed gas', 'Flammable', 'Cylinder segregation'],
]

function active(c: Chemical) {
  return c.status !== 'empty' && c.status !== 'disposed'
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5 dark:border-ink-800 dark:bg-ink-950/50">
        <span className="text-pearl-600">{icon}</span>
        <h2 className="text-sm font-semibold text-ink-800 dark:text-ink-100">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

export default function OperationsPage() {
  const { profile, isAdmin, canEdit } = useAuth()
  const { chemicals } = useInventory()
  const toast = useToast()
  const [requests, setRequests] = useState<ChemicalRequest[]>([])
  const [requestForm, setRequestForm] = useState<ChemicalRequestInput>({
    chemical_name_or_cas: '',
    quantity: '',
    supplier: '',
    justification_project: '',
    notes: '',
  })
  const [busy, setBusy] = useState(false)

  async function loadRequests() {
    try {
      setRequests(await api.listChemicalRequests())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load chemical requests.')
    }
  }

  useEffect(() => {
    void loadRequests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const data = useMemo(() => {
    const stocked = chemicals.filter(active)
    const soon = new Date()
    soon.setMonth(soon.getMonth() + 3)
    const oldOpened = new Date()
    oldOpened.setMonth(oldOpened.getMonth() - 12)

    const expiring = stocked
      .filter((c) => c.expiry_date && new Date(c.expiry_date) <= soon)
      .sort((a, b) => (a.expiry_date ?? '').localeCompare(b.expiry_date ?? ''))
    const openedLong = stocked
      .filter((c) => c.opened_date && new Date(c.opened_date) <= oldOpened)
      .sort((a, b) => (a.opened_date ?? '').localeCompare(b.opened_date ?? ''))
    const reorder = stocked.filter((c) => c.status === 'low' || c.reorder_priority !== 'none')
    const missingDocs = stocked.filter((c) => !c.sds_url)
    const disposal = chemicals.filter((c) => c.status === 'disposed' || c.disposal_date)

    const byLocation = new Map<string, Chemical[]>()
    for (const c of stocked) {
      const key = c.location ?? 'Unassigned'
      byLocation.set(key, [...(byLocation.get(key) ?? []), c])
    }
    const conflicts = [...byLocation.entries()].flatMap(([location, rows]) => {
      const hazards = new Set(rows.flatMap((c) => c.hazards))
      return INCOMPATIBLE.filter(([a, b]) => hazards.has(a) && hazards.has(b)).map(([a, b, reason]) => ({
        location,
        pair: `${a} + ${b}`,
        reason,
        count: rows.length,
      }))
    })

    const requestNames = new Set(requests.map((request) => request.chemical_name_or_cas.toLowerCase().trim()).filter(Boolean))
    const duplicates = [...new Map(stocked.map((c) => [c.cas || c.name.toLowerCase(), stocked.filter((x) => (x.cas || x.name.toLowerCase()) === (c.cas || c.name.toLowerCase()))])).values()]
      .filter((rows) => rows.length > 1)
    const underuse = duplicates
      .map((rows) => ({
        key: rows[0].cas || rows[0].name,
        rows,
        totalContainers: rows.reduce((sum, row) => sum + row.quantity, 0),
        locations: new Set(rows.map((row) => row.location ?? 'Unassigned')).size,
        requestedRecently: requestNames.has(rows[0].cas?.toLowerCase() ?? '') || requestNames.has(rows[0].name.toLowerCase()),
      }))
      .filter((group) => group.totalContainers >= 3 && group.locations >= 2 && !group.requestedRecently)
      .slice(0, 12)

    return { stocked, expiring, openedLong, reorder, missingDocs, disposal, conflicts, underuse }
  }, [chemicals, requests])

  const pendingRequests = requests.filter((request) => request.status === 'pending')
  const myRequests = profile ? requests.filter((request) => request.requested_by === profile.id) : []

  async function submitRequest() {
    if (!profile || !canEdit) return
    if (!requestForm.chemical_name_or_cas.trim()) return toast.error('Enter a chemical name or CAS number.')
    setBusy(true)
    try {
      const row = await api.createChemicalRequest({
        chemical_name_or_cas: requestForm.chemical_name_or_cas.trim(),
        quantity: requestForm.quantity?.trim() || null,
        supplier: requestForm.supplier?.trim() || null,
        justification_project: requestForm.justification_project?.trim() || null,
        notes: requestForm.notes?.trim() || null,
      }, profile)
      setRequests((prev) => [row, ...prev])
      setRequestForm({ chemical_name_or_cas: '', quantity: '', supplier: '', justification_project: '', notes: '' })
      toast.success('Request submitted.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not submit request.')
    } finally {
      setBusy(false)
    }
  }

  async function setRequestStatus(row: ChemicalRequest, status: ChemicalRequest['status'], receivedId: string | null = null) {
    if (!profile) return
    setBusy(true)
    try {
      const updated = await api.updateChemicalRequest(row.id, { status, received_container_id: receivedId }, profile)
      setRequests((prev) => prev.map((request) => request.id === row.id ? updated : request))
      toast.success(`Request marked ${status}.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update request.')
    } finally {
      setBusy(false)
    }
  }

  function exportAudit() {
    const rows = data.stocked.map((c) => ({
      Code: c.code,
      Name: c.name,
      CAS: c.cas ?? '',
      Location: c.location ?? '',
      Status: c.status,
      Hazards: c.hazards.join('; '),
      'Storage class': c.storage_class ?? '',
      'SDS link': c.sds_url ?? '',
      Owner: c.owner ?? '',
      Amount: formatSize(c),
    }))
    const csv = [
      Object.keys(rows[0] ?? { Code: '' }).join(','),
      ...rows.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')
    download(`pearl-safety-audit-${todayISO()}.csv`, csv, 'text/csv;charset=utf-8')
  }

  const table = (rows: Chemical[], detail: (c: Chemical) => string) =>
    rows.length ? (
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {rows.slice(0, 30).map((c) => (
              <tr key={c.id}>
                <td className="py-2 pr-3 font-medium text-ink-900 dark:text-ink-50">{c.name}</td>
                <td className="py-2 pr-3 text-xs text-ink-500">{c.location ?? 'Unassigned'}</td>
                <td className="py-2 text-xs text-ink-500">{detail(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="text-sm text-ink-500">Nothing needs attention here.</p>
    )

  return (
    <>
      <PageHeader
        title="Operations"
        description="Safety queues, reorder work, disposal records, and inspection exports."
        actions={
          <button className="btn-primary" onClick={exportAudit}>
            <Download className="h-4 w-4" /> Export safety audit
          </button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-5">
        {[
          ['Reorder', data.reorder.length],
          ['Expiring', data.expiring.length],
          ['Old opened', data.openedLong.length],
          ['Missing SDS', data.missingDocs.length],
          ['Conflicts', data.conflicts.length],
        ].map(([label, value]) => (
          <div key={label} className="card px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
            <p className="mt-1 text-2xl font-bold text-ink-900 dark:text-ink-50">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {canEdit && (
          <Card title="Request chemical" icon={<Plus className="h-4 w-4" />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Chemical name or CAS" required>
                <input className="input" value={requestForm.chemical_name_or_cas} onChange={(e) => setRequestForm((f) => ({ ...f, chemical_name_or_cas: e.target.value }))} placeholder="acetone, 67-64-1..." />
              </Field>
              <Field label="Quantity">
                <input className="input" value={requestForm.quantity ?? ''} onChange={(e) => setRequestForm((f) => ({ ...f, quantity: e.target.value }))} placeholder="2 x 2.5 L" />
              </Field>
              <Field label="Supplier">
                <input className="input" value={requestForm.supplier ?? ''} onChange={(e) => setRequestForm((f) => ({ ...f, supplier: e.target.value }))} />
              </Field>
              <Field label="Project / justification">
                <input className="input" value={requestForm.justification_project ?? ''} onChange={(e) => setRequestForm((f) => ({ ...f, justification_project: e.target.value }))} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className="input min-h-[72px]" value={requestForm.notes ?? ''} onChange={(e) => setRequestForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
            <div className="mt-3 flex justify-end">
              <button className="btn-primary" onClick={() => void submitRequest()} disabled={busy}>
                {busy ? <Spinner /> : <Plus className="h-4 w-4" />} Submit request
              </button>
            </div>
          </Card>
        )}
        <Card title={isAdmin ? 'Pending approvals' : 'My requests'} icon={<ClipboardList className="h-4 w-4" />}>
          <RequestList
            rows={isAdmin ? pendingRequests : myRequests}
            chemicals={chemicals}
            isAdmin={isAdmin}
            busy={busy}
            onStatus={(row, status, receivedId) => void setRequestStatus(row, status, receivedId)}
          />
        </Card>
        <Card title="Low stock / reorder list" icon={<PackageSearch className="h-4 w-4" />}>
          {table(data.reorder, (c) => `${formatSize(c)} - ${c.supplier ?? 'no supplier'} - ${c.reorder_priority}`)}
        </Card>
        <Card title="Expiry and opened-date alerts" icon={<AlertTriangle className="h-4 w-4" />}>
          {table([...data.expiring, ...data.openedLong], (c) =>
            c.expiry_date ? `expires ${formatDate(c.expiry_date)}` : `opened ${formatDate(c.opened_date)}`,
          )}
        </Card>
        <Card title="Hazard segregation flags" icon={<ShieldAlert className="h-4 w-4" />}>
          {data.conflicts.length ? (
            <ul className="space-y-2 text-sm">
              {data.conflicts.map((c, i) => (
                <li key={i} className="rounded border border-amber-200 bg-amber-50 p-2 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <strong>{c.location}</strong>: {c.pair} <span className="text-ink-500">({c.reason})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-500">No simple segregation conflicts detected from tagged hazards.</p>
          )}
        </Card>
        <Card title="Document gaps" icon={<FileWarning className="h-4 w-4" />}>
          {table(data.missingDocs, (c) => `missing SDS - ${c.hazards.filter((h) => HAZARDS.includes(h as any)).join(', ') || 'untagged'}`)}
        </Card>
        <Card title="Owner handover queue" icon={<Repeat2 className="h-4 w-4" />}>
          {table(data.stocked.filter((c) => !c.owner), () => 'no responsible person assigned')}
        </Card>
        <Card title="Disposal log" icon={<ClipboardList className="h-4 w-4" />}>
          {table(data.disposal, (c) => `${c.disposal_date ? formatDate(c.disposal_date) : 'not dated'} - ${c.disposal_waste_class ?? 'waste class missing'}`)}
        </Card>
        <Card title="Usage / duplication intelligence" icon={<PackageSearch className="h-4 w-4" />}>
          {data.underuse.length ? (
            <div className="space-y-2">
              {data.underuse.map((group) => (
                <div key={group.key} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="font-semibold text-amber-900 dark:text-amber-100">{group.key}</p>
                  <p className="mt-1 text-amber-800/80 dark:text-amber-200/75">
                    {group.totalContainers} containers across {group.locations} locations, with no matching recent request. Consider consolidating before reordering.
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-500">No obvious hoarding/underuse signals from the current request and inventory data.</p>
          )}
        </Card>
      </div>
    </>
  )
}

function RequestList({
  rows,
  chemicals,
  isAdmin,
  busy,
  onStatus,
}: {
  rows: ChemicalRequest[]
  chemicals: Chemical[]
  isAdmin: boolean
  busy: boolean
  onStatus: (row: ChemicalRequest, status: ChemicalRequest['status'], receivedId?: string | null) => void
}) {
  const [receivedByRequest, setReceivedByRequest] = useState<Record<string, string>>({})
  if (rows.length === 0) return <p className="text-sm text-ink-500">No requests here.</p>
  return (
    <div className="max-h-96 overflow-auto">
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold text-ink-900 dark:text-ink-50">{row.chemical_name_or_cas}</p>
                <p className="mt-1 text-xs text-ink-500">
                  {row.quantity || 'quantity not specified'} - {row.supplier || 'supplier not specified'} - requested by {row.requested_by_name ?? 'unknown'}
                </p>
                {row.justification_project && <p className="mt-1 text-sm text-ink-700 dark:text-ink-300">{row.justification_project}</p>}
                {row.notes && <p className="mt-1 text-xs text-ink-500">{row.notes}</p>}
              </div>
              <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300">{row.status}</span>
            </div>
            {isAdmin && row.status === 'pending' && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button className="btn-secondary py-1.5 text-xs text-emerald-700" onClick={() => onStatus(row, 'approved')} disabled={busy}>
                  <Check className="h-3.5 w-3.5" /> Approve
                </button>
                <button className="btn-secondary py-1.5 text-xs text-rose-700" onClick={() => onStatus(row, 'declined')} disabled={busy}>
                  <X className="h-3.5 w-3.5" /> Decline
                </button>
                <select className="input max-w-xs py-1.5 text-xs" value={receivedByRequest[row.id] ?? ''} onChange={(e) => setReceivedByRequest((prev) => ({ ...prev, [row.id]: e.target.value }))}>
                  <option value="">Link received container...</option>
                  {chemicals.slice(0, 300).map((chemical) => (
                    <option key={chemical.id} value={chemical.id}>{chemical.code} - {chemical.name}</option>
                  ))}
                </select>
                <button className="btn-primary py-1.5 text-xs" onClick={() => onStatus(row, 'received', receivedByRequest[row.id] || null)} disabled={busy}>
                  Mark received
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
