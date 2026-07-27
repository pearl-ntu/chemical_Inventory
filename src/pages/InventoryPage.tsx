import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Download,
  FlaskConical,
  Plus,
  Upload,
} from 'lucide-react'
import { ChemicalDrawer } from '../components/ChemicalDrawer'
import { ChemicalForm } from '../components/ChemicalForm'
import { HazardBadges } from '../components/HazardBadges'
import { ImportDialog } from '../components/ImportDialog'
import { PageHeader } from '../components/Layout'
import { LazyMolfileSvgRenderer } from '../components/LazyStructure'
import { ConfirmDialog, EmptyState, LoadingScreen, MultiSelect, SearchInput } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import { toCSV } from '../lib/csv'
import {
  EMPTY_FILTERS,
  HAZARDS,
  STATUSES,
  STATUS_LABEL,
  type Chemical,
  type Filters,
  type Sort,
  type SortKey,
  type Status,
} from '../lib/types'
import {
  cx,
  download,
  formatDate,
  formatSize,
  matchesQuery,
  statusTone,
  todayISO,
  uniqueSorted,
} from '../lib/utils'

const PAGE_SIZE = 25

export default function InventoryPage() {
  const { chemicals, loading, error, markEmpty } = useInventory()
  const { canEdit } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 'asc' })
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Tracked by id, not by object reference — deriving the live row below
  // means the open drawer always reflects the latest state (e.g. right after
  // "Mark empty") instead of freezing on whatever it looked like when opened.
  const [detailId, setDetailId] = useState<string | null>(null)
  const detail = useMemo(() => chemicals.find((c) => c.id === detailId) ?? null, [chemicals, detailId])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Chemical | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [bulkEmpty, setBulkEmpty] = useState(false)
  const [busy, setBusy] = useState(false)

  // Deep link from a scanned QR sticker: ?code=PEARL-0042 opens that record.
  useEffect(() => {
    const code = params.get('code')
    if (!code || chemicals.length === 0) return
    const hit = chemicals.find((c) => c.code === code)
    if (hit) {
      setDetailId(hit.id)
      setParams({}, { replace: true })
    } else {
      toast.error(`No container with the code ${code}.`)
      setParams({}, { replace: true })
    }
  }, [params, chemicals, setParams, toast])

  const options = useMemo(
    () => ({
      location: uniqueSorted(chemicals.map((c) => c.location)),
      supplier: uniqueSorted(chemicals.map((c) => c.supplier)),
      system: uniqueSorted(chemicals.map((c) => c.system)),
      owner: uniqueSorted(chemicals.map((c) => c.owner)),
    }),
    [chemicals],
  )

  const counts = useMemo(() => {
    const tally = (get: (c: Chemical) => string | null) => {
      const out: Record<string, number> = {}
      for (const c of chemicals) {
        const k = get(c)
        if (k) out[k] = (out[k] ?? 0) + 1
      }
      return out
    }
    return {
      location: tally((c) => c.location),
      supplier: tally((c) => c.supplier),
      system: tally((c) => c.system),
      owner: tally((c) => c.owner),
    }
  }, [chemicals])

  const filtered = useMemo(() => {
    const rows = chemicals.filter((c) => {
      if (!matchesQuery(c, filters.q)) return false
      if (filters.location.length && !filters.location.includes(c.location ?? '')) return false
      if (filters.supplier.length && !filters.supplier.includes(c.supplier ?? '')) return false
      if (filters.system.length && !filters.system.includes(c.system ?? '')) return false
      if (filters.owner.length && !filters.owner.includes(c.owner ?? '')) return false
      if (filters.status.length && !filters.status.includes(c.status)) return false
      if (filters.hazard.length && !filters.hazard.some((h) => c.hazards.includes(h))) return false
      return true
    })

    const dir = sort.dir === 'asc' ? 1 : -1
    return rows.sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      if (av == null && bv == null) return 0
      if (av == null) return 1 // blanks always sink, whichever way we sort
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv), 'en', { numeric: true, sensitivity: 'base' }) * dir
    })
  }, [chemicals, filters, sort])

  useEffect(() => setPage(0), [filters, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visible = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const activeFilterCount =
    filters.location.length +
    filters.supplier.length +
    filters.status.length +
    filters.system.length +
    filters.owner.length +
    filters.hazard.length

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exportCSV() {
    const rows = selected.size > 0 ? filtered.filter((c) => selected.has(c.id)) : filtered
    download(`pearl-inventory-${todayISO()}.csv`, toCSV(rows), 'text/csv;charset=utf-8')
    toast.success(`Exported ${rows.length} rows.`)
  }

  async function runBulkEmpty() {
    setBusy(true)
    try {
      const rows = filtered.filter((c) => selected.has(c.id) && c.status !== 'empty')
      for (const row of rows) await markEmpty(row)
      toast.success(`${rows.length} container${rows.length === 1 ? '' : 's'} marked empty.`)
      setSelected(new Set())
      setBulkEmpty(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk update failed.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <LoadingScreen label="Loading the inventory…" />

  if (error) {
    return (
      <EmptyState
        icon={<FlaskConical className="h-6 w-6" />}
        title="The inventory could not be loaded"
        description={error}
      />
    )
  }

  return (
    <>
      <PageHeader
        title="Inventory"
        description={`${filtered.length} of ${chemicals.length} containers${
          activeFilterCount ? ' match the current filters' : ''
        }`}
        actions={
          <>
            <button className="btn-secondary" onClick={exportCSV}>
              <Download className="h-4 w-4" />
              Export{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
            {canEdit && (
              <>
                <button className="btn-secondary" onClick={() => setImportOpen(true)}>
                  <Upload className="h-4 w-4" /> Import
                </button>
                <button
                  className="btn-primary"
                  onClick={() => {
                    setEditing(null)
                    setFormOpen(true)
                  }}
                >
                  <Plus className="h-4 w-4" /> Add chemical
                </button>
              </>
            )}
          </>
        }
      />

      {/* filter bar ------------------------------------------------------- */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput
          value={filters.q}
          onChange={(q) => setFilters((f) => ({ ...f, q }))}
          placeholder="Search by name, CAS, code, supplier, shelf…"
        />
        <div className="flex flex-wrap gap-2">
          <MultiSelect
            label="Location"
            options={options.location}
            selected={filters.location}
            counts={counts.location}
            onChange={(location) => setFilters((f) => ({ ...f, location }))}
          />
          <MultiSelect
            label="Status"
            options={STATUSES.map((s) => STATUS_LABEL[s])}
            selected={filters.status.map((s) => STATUS_LABEL[s])}
            onChange={(labels) =>
              setFilters((f) => ({
                ...f,
                status: STATUSES.filter((s) => labels.includes(STATUS_LABEL[s])) as Status[],
              }))
            }
          />
          <MultiSelect
            label="Supplier"
            options={options.supplier}
            selected={filters.supplier}
            counts={counts.supplier}
            onChange={(supplier) => setFilters((f) => ({ ...f, supplier }))}
          />
          <MultiSelect
            label="Hazard"
            options={[...HAZARDS]}
            selected={filters.hazard}
            onChange={(hazard) => setFilters((f) => ({ ...f, hazard }))}
          />
          <MultiSelect
            label="Owner"
            options={options.owner}
            selected={filters.owner}
            counts={counts.owner}
            onChange={(owner) => setFilters((f) => ({ ...f, owner }))}
          />
          {activeFilterCount > 0 && (
            <button className="btn-ghost" onClick={() => setFilters({ ...EMPTY_FILTERS, q: filters.q })}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* bulk bar --------------------------------------------------------- */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-pearl-200 bg-pearl-50 px-4 py-2.5 text-sm dark:border-pearl-500/30 dark:bg-pearl-500/10">
          <span className="font-semibold text-pearl-900 dark:text-pearl-100">
            {selected.size} selected
          </span>
          {canEdit && (
            <button className="btn-ghost py-1" onClick={() => setBulkEmpty(true)}>
              <CircleSlash className="h-4 w-4" /> Mark empty
            </button>
          )}
          <button className="btn-ghost py-1" onClick={exportCSV}>
            <Download className="h-4 w-4" /> Export selected
          </button>
          <button className="btn-ghost ml-auto py-1" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {/* table ------------------------------------------------------------ */}
      <div className="card overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            icon={<FlaskConical className="h-6 w-6" />}
            title={chemicals.length === 0 ? 'The inventory is empty' : 'Nothing matches those filters'}
            description={
              chemicals.length === 0
                ? 'Add your first container, or import the lab spreadsheet to get started.'
                : 'Try a broader search, or clear the filters.'
            }
            action={
              chemicals.length === 0 && canEdit ? (
                <button className="btn-primary mt-2" onClick={() => setImportOpen(true)}>
                  <Upload className="h-4 w-4" /> Import a spreadsheet
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="border-b border-ink-200 bg-ink-50 dark:border-ink-800 dark:bg-ink-950/50">
                <tr>
                  <th className="w-10 px-3">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      className="h-4 w-4 rounded border-ink-300 text-pearl-600 focus:ring-pearl-500"
                      checked={visible.every((c) => selected.has(c.id))}
                      onChange={(e) => {
                        const next = new Set(selected)
                        visible.forEach((c) => (e.target.checked ? next.add(c.id) : next.delete(c.id)))
                        setSelected(next)
                      }}
                    />
                  </th>
                  <th className="th w-14" aria-hidden="true" />
                  {(
                    [
                      ['name', 'Chemical'],
                      ['cas', 'CAS'],
                      ['location', 'Location'],
                      ['size_value', 'Amount'],
                      ['supplier', 'Supplier'],
                      ['status', 'Status'],
                      ['registration_date', 'Registered'],
                    ] as Array<[SortKey, string]>
                  ).map(([key, label]) => (
                    <th key={key} className="th">
                      <button
                        className="inline-flex items-center gap-1 hover:text-ink-800 dark:hover:text-ink-100"
                        onClick={() => toggleSort(key)}
                      >
                        {label}
                        <ArrowDownUp
                          className={cx(
                            'h-3 w-3 transition-opacity',
                            sort.key === key ? 'opacity-100 text-pearl-600' : 'opacity-25',
                          )}
                        />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {visible.map((c) => (
                  <tr
                    key={c.id}
                    className={cx(
                      'cursor-pointer transition-colors hover:bg-pearl-50/60 dark:hover:bg-pearl-500/5',
                      selected.has(c.id) && 'bg-pearl-50 dark:bg-pearl-500/10',
                      c.status === 'empty' && 'opacity-60',
                    )}
                    onClick={() => setDetailId(c.id)}
                  >
                    <td className="px-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.name}`}
                        className="h-4 w-4 rounded border-ink-300 text-pearl-600 focus:ring-pearl-500"
                        checked={selected.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                      />
                    </td>
                    <td className="td">
                      {c.structure_molfile ? (
                        <div className="viz-root flex h-9 w-12 items-center justify-center overflow-hidden rounded bg-white ring-1 ring-ink-200 dark:ring-ink-700">
                          <Suspense fallback={null}>
                            <LazyMolfileSvgRenderer molfile={c.structure_molfile} width={48} height={36} />
                          </Suspense>
                        </div>
                      ) : (
                        <div className="h-9 w-12 rounded bg-ink-50 dark:bg-ink-800/50" />
                      )}
                    </td>
                    <td className="td max-w-[22rem]">
                      <div className="truncate font-medium text-ink-900 dark:text-ink-50">
                        {c.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-ink-400">{c.code}</span>
                        <HazardBadges hazards={c.hazards} max={2} />
                      </div>
                    </td>
                    <td className="td whitespace-nowrap font-mono text-xs">{c.cas ?? '—'}</td>
                    <td className="td whitespace-nowrap">
                      {c.location ?? '—'}
                      {c.sub_location && (
                        <span className="block text-xs text-ink-400">{c.sub_location}</span>
                      )}
                    </td>
                    <td className="td whitespace-nowrap tabular-nums">{formatSize(c)}</td>
                    <td className="td max-w-[12rem] truncate">{c.supplier ?? '—'}</td>
                    <td className="td">
                      <span className={cx('badge', statusTone(c.status))}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td className="td whitespace-nowrap text-xs text-ink-500">
                      {formatDate(c.registration_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 && (
          <div className="flex items-center justify-between border-t border-ink-200 px-4 py-2.5 text-sm dark:border-ink-800">
            <span className="text-ink-500">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of{' '}
              {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                className="btn-ghost p-2"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2 text-ink-600 dark:text-ink-300">
                {page + 1} / {pageCount}
              </span>
              <button
                className="btn-ghost p-2"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <ChemicalDrawer
        chemical={detail}
        onClose={() => setDetailId(null)}
        onEdit={(c) => {
          setEditing(c)
          setDetailId(null)
          setFormOpen(true)
        }}
      />

      <ChemicalForm open={formOpen} editing={editing} onClose={() => setFormOpen(false)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      <ConfirmDialog
        open={bulkEmpty}
        title={`Mark ${selected.size} container${selected.size === 1 ? '' : 's'} empty?`}
        confirmLabel="Mark empty"
        busy={busy}
        message="Each one is stamped with today's date and stays in the records for reordering and audits."
        onCancel={() => setBulkEmpty(false)}
        onConfirm={() => void runBulkEmpty()}
      />
    </>
  )
}
