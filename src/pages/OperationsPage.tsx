import { useMemo } from 'react'
import { AlertTriangle, ClipboardList, Download, FileWarning, PackageSearch, Repeat2, ShieldAlert } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { useInventory } from '../context/InventoryContext'
import { HAZARDS, type Chemical } from '../lib/types'
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
  const { chemicals } = useInventory()

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

    return { stocked, expiring, openedLong, reorder, missingDocs, disposal, conflicts }
  }, [chemicals])

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
      </div>
    </>
  )
}
