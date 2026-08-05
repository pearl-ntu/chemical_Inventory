import { Suspense, useEffect, useMemo, useState } from 'react'
import { MapPin, Printer, QrCode, UserRound } from 'lucide-react'
import { LazyMolfileSvgRenderer } from '../components/LazyStructure'
import { PageHeader } from '../components/Layout'
import { EmptyState, LoadingScreen, MultiSelect, SearchInput } from '../components/ui'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import { containerDeepLink, locationDeepLink, memberDeepLink, qrDataUrl } from '../lib/qr'
import type { Chemical, Profile } from '../lib/types'
import { useLabLocations } from '../lib/useLabLocations'
import { formatSize, matchesQuery } from '../lib/utils'

type LabelMode = 'container' | 'location' | 'member'

type PrintableLabel =
  | {
      kind: 'container'
      id: string
      key: string
      title: string
      subtitle: string
      detail: string
      chemical: Chemical
      url: string
    }
  | {
      kind: 'location'
      id: string
      key: string
      title: string
      subtitle: string
      detail: string
      count: number
      url: string
    }
  | {
      kind: 'member'
      id: string
      key: string
      title: string
      subtitle: string
      detail: string
      profile: Profile
      url: string
    }

function matchesLabel(item: Pick<PrintableLabel, 'title' | 'subtitle' | 'detail' | 'kind'>, q: string) {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return [item.kind, item.title, item.subtitle, item.detail].some((value) => value.toLowerCase().includes(needle))
}

/**
 * Printable QR stickers. Container labels open records, location labels filter
 * shelves/cabinets, and member labels can prefill the responsible person.
 */
const MAX_LABELS_AT_ONCE = 300

export default function LabelsPage() {
  const { chemicals, loading } = useInventory()
  const labLocations = useLabLocations(chemicals)
  const toast = useToast()

  const [mode, setMode] = useState<LabelMode>('container')
  const [q, setQ] = useState('')
  const [locations, setLocations] = useState<string[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [qrs, setQrs] = useState<Record<string, string>>({})
  const [profiles, setProfiles] = useState<Profile[]>([])

  const locationOptions = labLocations.locations

  useEffect(() => {
    let live = true
    api
      .listProfiles()
      .then((rows) => live && setProfiles(rows))
      .catch(() => live && setProfiles([]))
    return () => {
      live = false
    }
  }, [])

  const allLabels = useMemo<PrintableLabel[]>(() => {
    if (mode === 'location') {
      return labLocations.locations
        .map((location) => {
          const rows = chemicals.filter((c) => c.location === location)
          return {
            kind: 'location' as const,
            id: location,
            key: `location:${location}`,
            title: location,
            subtitle: `${rows.length} record${rows.length === 1 ? '' : 's'}`,
            detail: 'Scan to filter inventory by this place',
            count: rows.length,
            url: locationDeepLink(location),
          }
        })
        .filter((item) => matchesLabel(item, q))
    }

    if (mode === 'member') {
      return profiles
        .filter((p) => p.approved)
        .map((profile) => ({
          kind: 'member' as const,
          id: profile.id,
          key: `member:${profile.id}`,
          title: profile.full_name || profile.email,
          subtitle: profile.email,
          detail: 'Scan to filter or prefill responsible person',
          profile,
          url: memberDeepLink(profile.full_name || profile.email, true),
        }))
        .filter((item) => matchesLabel(item, q))
        .sort((a, b) => a.title.localeCompare(b.title))
    }

    return chemicals
      .filter((c) => c.status !== 'empty' && c.status !== 'disposed')
      .filter((c) => matchesQuery(c, q))
      .filter((c) => locations.length === 0 || locations.includes(c.location ?? ''))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((chemical) => ({
        kind: 'container' as const,
        id: chemical.id,
        key: `container:${chemical.code}`,
        title: chemical.name,
        subtitle: chemical.code,
        detail: chemical.location ?? 'No location',
        chemical,
        url: containerDeepLink(chemical.code),
      }))
  }, [chemicals, labLocations.locations, locations, mode, profiles, q])

  const selected = useMemo(() => allLabels.filter((item) => picked.has(item.id)), [allLabels, picked])

  useEffect(() => {
    let live = true
    const missing = selected.filter((item) => !qrs[item.key])
    if (missing.length === 0) return

    void Promise.all(missing.map(async (item) => [item.key, await qrDataUrl(item.url, 180)] as const)).then(
      (pairs) => {
        if (!live) return
        setQrs((prev) => ({ ...prev, ...Object.fromEntries(pairs) }))
      },
    )
    return () => {
      live = false
    }
  }, [selected, qrs])

  if (loading) return <LoadingScreen label="Loading labels..." />

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="QR labels"
          description="Print stickers for bottles, storage places, or people. Scanning routes the user to the right inventory view."
          actions={
            <button className="btn-primary" onClick={() => window.print()} disabled={selected.length === 0}>
              <Printer className="h-4 w-4" /> Print {selected.length || ''} label
              {selected.length === 1 ? '' : 's'}
            </button>
          }
        />

        <div className="mb-4 flex flex-col gap-2">
          <div className="inline-flex w-fit rounded-lg border border-ink-200 bg-white p-1 dark:border-ink-800 dark:bg-ink-900">
            {(['container', 'location', 'member'] as LabelMode[]).map((nextMode) => (
              <button
                key={nextMode}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize transition ${
                  mode === nextMode
                    ? 'bg-pearl-600 text-white'
                    : 'text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800'
                }`}
                onClick={() => {
                  setMode(nextMode)
                  setPicked(new Set())
                }}
              >
                {nextMode === 'container' && <QrCode className="mr-1.5 inline h-4 w-4" />}
                {nextMode === 'location' && <MapPin className="mr-1.5 inline h-4 w-4" />}
                {nextMode === 'member' && <UserRound className="mr-1.5 inline h-4 w-4" />}
                {nextMode}s
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput value={q} onChange={setQ} placeholder={`Find ${mode}s to label...`} />
            {mode === 'container' && (
              <MultiSelect
                label="Location"
                options={locationOptions}
                selected={locations}
                onChange={setLocations}
              />
            )}
            <button
              className="btn-secondary"
              onClick={() => {
                const capped = allLabels.slice(0, MAX_LABELS_AT_ONCE)
                setPicked(new Set(capped.map((item) => item.id)))
                if (allLabels.length > MAX_LABELS_AT_ONCE) {
                  toast.error(`Selected the first ${MAX_LABELS_AT_ONCE} of ${allLabels.length} — printing more than that in one batch would freeze the page. Narrow your search or location filter, then select all again for the rest.`)
                }
              }}
              disabled={allLabels.length === 0}
            >
              Select all {allLabels.length}
            </button>
            {picked.size > 0 && (
              <button className="btn-ghost" onClick={() => setPicked(new Set())}>
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="card mb-6 max-h-64 overflow-y-auto">
          {allLabels.length === 0 ? (
            <EmptyState icon={<QrCode className="h-6 w-6" />} title="Nothing matches" />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {allLabels.map((item) => (
                <li key={item.key}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-ink-50 dark:hover:bg-ink-800">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-ink-300 text-pearl-600 focus:ring-pearl-500"
                      checked={picked.has(item.id)}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev)
                          if (next.has(item.id)) next.delete(item.id)
                          else next.add(item.id)
                          return next
                        })
                      }
                    />
                    <span className="w-24 shrink-0 font-mono text-xs text-ink-400">{item.kind}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                    <span className="hidden shrink-0 text-xs text-ink-400 sm:block">{item.detail}</span>
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
            Preview - {selected.length} label{selected.length === 1 ? '' : 's'}. Use your browser's
            print dialog and choose "Fit to page"; the dashed lines are cut guides.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {selected.map((item) => (
              <LabelCell key={item.key} item={item} qr={qrs[item.key]} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function LabelCell({ item, qr }: { item: PrintableLabel; qr?: string }) {
  if (item.kind !== 'container') {
    return (
      <div className="label-cell flex items-center gap-3 rounded-lg border border-ink-200 bg-white p-3 text-ink-900 dark:border-ink-700 dark:bg-white">
        <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center">
          {qr ? <img src={qr} alt="" className="h-full w-full" /> : <div className="h-full w-full animate-pulse rounded bg-ink-100" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold leading-tight">{item.title}</p>
          <p className="mt-0.5 truncate text-[10px] text-ink-500">{item.subtitle}</p>
          <p className="mt-1 text-[10px] font-semibold leading-tight text-ink-700">{item.detail}</p>
          {item.kind === 'location' && <p className="mt-1 font-mono text-[10px] text-ink-500">{item.count} records</p>}
          {item.kind === 'member' && <p className="mt-1 font-mono text-[10px] text-ink-500">{item.profile.role}</p>}
        </div>
      </div>
    )
  }

  const chemical = item.chemical
  return (
    <div className="label-cell flex items-center gap-3 rounded-lg border border-ink-200 bg-white p-3 dark:border-ink-700 dark:bg-white">
      <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center">
        {qr ? <img src={qr} alt="" className="h-full w-full" /> : <div className="h-full w-full animate-pulse rounded bg-ink-100" />}
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
          {chemical.cas && ' - '}
          {formatSize(chemical)}
        </p>
        <p className="text-[10px] font-semibold text-ink-700">{chemical.location ?? '-'}</p>
        {chemical.hazards.length > 0 && (
          <p className="mt-0.5 truncate text-[9px] uppercase tracking-wide text-rose-700">
            {chemical.hazards.join(' - ')}
          </p>
        )}
      </div>
    </div>
  )
}
