import { Suspense, useEffect, useMemo, useState } from 'react'
import { Printer, QrCode } from 'lucide-react'
import { LazyMolfileSvgRenderer } from '../components/LazyStructure'
import { PageHeader } from '../components/Layout'
import { EmptyState, LoadingScreen, MultiSelect, SearchInput } from '../components/ui'
import { useInventory } from '../context/InventoryContext'
import { qrDataUrl } from '../lib/qr'
import type { Chemical } from '../lib/types'
import { formatSize, matchesQuery, uniqueSorted } from '../lib/utils'

/**
 * Printable QR stickers. Each label carries the code, the name, the shelf and a
 * QR that deep-links back to the record, so a phone camera at the bench opens
 * the right page. The grid is sized for a standard A4 sheet of 8×3 labels but
 * prints fine on plain paper cut by hand.
 */
export default function LabelsPage() {
  const { chemicals, loading } = useInventory()

  const [q, setQ] = useState('')
  const [locations, setLocations] = useState<string[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [qrs, setQrs] = useState<Record<string, string>>({})

  const locationOptions = useMemo(() => uniqueSorted(chemicals.map((c) => c.location)), [chemicals])

  const matches = useMemo(
    () =>
      chemicals
        .filter((c) => c.status !== 'empty' && c.status !== 'disposed')
        .filter((c) => matchesQuery(c, q))
        .filter((c) => locations.length === 0 || locations.includes(c.location ?? ''))
        .sort((a, b) => a.code.localeCompare(b.code)),
    [chemicals, q, locations],
  )

  const selected = useMemo(
    () => chemicals.filter((c) => picked.has(c.id)).sort((a, b) => a.code.localeCompare(b.code)),
    [chemicals, picked],
  )

  // Render QR images only for what is actually on the sheet.
  useEffect(() => {
    let live = true
    const missing = selected.filter((c) => !qrs[c.code])
    if (missing.length === 0) return

    void Promise.all(missing.map(async (c) => [c.code, await qrDataUrl(c.code, 180)] as const)).then(
      (pairs) => {
        if (!live) return
        setQrs((prev) => ({ ...prev, ...Object.fromEntries(pairs) }))
      },
    )
    return () => {
      live = false
    }
  }, [selected, qrs])

  if (loading) return <LoadingScreen label="Loading containers…" />

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="QR labels"
          description="Print a sticker for each bottle. Scanning it with any phone camera opens that container's record."
          actions={
            <button
              className="btn-primary"
              onClick={() => window.print()}
              disabled={selected.length === 0}
            >
              <Printer className="h-4 w-4" /> Print {selected.length || ''} label
              {selected.length === 1 ? '' : 's'}
            </button>
          }
        />

        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Find containers to label…" />
          <MultiSelect
            label="Location"
            options={locationOptions}
            selected={locations}
            onChange={setLocations}
          />
          <button
            className="btn-secondary"
            onClick={() => setPicked(new Set(matches.map((c) => c.id)))}
            disabled={matches.length === 0}
          >
            Select all {matches.length}
          </button>
          {picked.size > 0 && (
            <button className="btn-ghost" onClick={() => setPicked(new Set())}>
              Clear
            </button>
          )}
        </div>

        <div className="card mb-6 max-h-64 overflow-y-auto">
          {matches.length === 0 ? (
            <EmptyState icon={<QrCode className="h-6 w-6" />} title="Nothing matches" />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {matches.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-ink-50 dark:hover:bg-ink-800">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-ink-300 text-pearl-600 focus:ring-pearl-500"
                      checked={picked.has(c.id)}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev)
                          if (next.has(c.id)) next.delete(c.id)
                          else next.add(c.id)
                          return next
                        })
                      }
                    />
                    <span className="w-24 shrink-0 font-mono text-xs text-ink-400">{c.code}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                    <span className="hidden shrink-0 text-xs text-ink-400 sm:block">
                      {c.location}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {selected.length > 0 && (
        <div className="print-sheet">
          <p className="no-print mb-3 text-sm text-ink-500">
            Preview — {selected.length} label{selected.length === 1 ? '' : 's'}. Use your browser’s
            print dialog and choose “Fit to page”; the dashed lines are cut guides.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {selected.map((c) => (
              <LabelCell key={c.id} chemical={c} qr={qrs[c.code]} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function LabelCell({ chemical, qr }: { chemical: Chemical; qr?: string }) {
  return (
    <div className="label-cell flex items-center gap-3 rounded-lg border border-ink-200 bg-white p-3 dark:border-ink-700 dark:bg-white">
      <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center">
        {qr ? (
          <img src={qr} alt="" className="h-full w-full" />
        ) : (
          <div className="h-full w-full animate-pulse rounded bg-ink-100" />
        )}
      </div>
      {chemical.structure_molfile && (
        <div className="viz-root flex h-[72px] w-[54px] shrink-0 items-center justify-center overflow-hidden rounded border border-ink-100 bg-white">
          <Suspense fallback={null}>
            <LazyMolfileSvgRenderer molfile={chemical.structure_molfile} width={52} height={70} />
          </Suspense>
        </div>
      )}
      <div className="min-w-0 flex-1 text-ink-900">
        <p className="truncate text-[13px] font-bold leading-tight">{chemical.name}</p>
        <p className="mt-0.5 font-mono text-[10px] text-ink-500">{chemical.code}</p>
        <p className="mt-1 text-[10px] leading-tight text-ink-600">
          {chemical.cas && <span className="font-mono">{chemical.cas}</span>}
          {chemical.cas && ' · '}
          {formatSize(chemical)}
        </p>
        <p className="text-[10px] font-semibold text-ink-700">{chemical.location ?? '—'}</p>
        {chemical.hazards.length > 0 && (
          <p className="mt-0.5 truncate text-[9px] uppercase tracking-wide text-rose-700">
            {chemical.hazards.join(' · ')}
          </p>
        )}
      </div>
    </div>
  )
}
