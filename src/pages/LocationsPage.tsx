import { useMemo, useState } from 'react'
import { ChevronDown, MapPin, Refrigerator, ShieldAlert, Warehouse } from 'lucide-react'
import { ChemicalDrawer } from '../components/ChemicalDrawer'
import { HazardBadges } from '../components/HazardBadges'
import { PageHeader } from '../components/Layout'
import { EmptyState, LoadingScreen, SearchInput } from '../components/ui'
import { useInventory } from '../context/InventoryContext'
import { INCOMPATIBLE_PAIRS } from '../lib/hazardHints'
import { STATUS_LABEL, type Chemical } from '../lib/types'
import { cx, formatSize, locationGroup, matchesQuery, statusTone } from '../lib/utils'

const GROUP_ICON: Record<string, typeof MapPin> = {
  'Cold storage': Refrigerator,
  Cabinets: Warehouse,
  'Flammables store': ShieldAlert,
}

export default function LocationsPage() {
  const { chemicals, loading } = useInventory()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [detail, setDetail] = useState<Chemical | null>(null)

  const groups = useMemo(() => {
    const rows = chemicals.filter((c) => c.status !== 'empty' && c.status !== 'disposed')
    const byLocation = new Map<string, Chemical[]>()
    for (const c of rows) {
      const key = c.location ?? 'Unassigned'
      byLocation.set(key, [...(byLocation.get(key) ?? []), c])
    }

    const byGroup = new Map<string, Array<{ location: string; items: Chemical[] }>>()
    for (const [location, items] of byLocation) {
      const g = locationGroup(location)
      byGroup.set(g, [...(byGroup.get(g) ?? []), { location, items }])
    }

    for (const list of byGroup.values()) {
      list.sort((a, b) => a.location.localeCompare(b.location, 'en', { numeric: true }))
    }

    const order = ['Cold storage', 'Cabinets', 'Flammables store', 'Other', 'Unassigned']
    const rank = (name: string) => {
      const i = order.indexOf(name)
      return i === -1 ? order.length : i
    }
    return [...byGroup.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
  }, [chemicals])

  /** Flags shelves holding classes that should not sit together. */
  function segregationWarnings(items: Chemical[]): string[] {
    const present = new Set(items.flatMap((i) => i.hazards))
    return INCOMPATIBLE_PAIRS.filter(([a, b]) => present.has(a) && present.has(b)).map(
      ([, , message]) => message,
    )
  }

  if (loading) return <LoadingScreen label="Mapping the shelves…" />

  return (
    <>
      <PageHeader
        title="Locations"
        description="Every shelf, fridge and cabinet, with what is currently sitting in it."
      />

      <div className="mb-4 max-w-md">
        <SearchInput value={q} onChange={setQ} placeholder="Find a chemical across all shelves…" />
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={<MapPin className="h-6 w-6" />} title="No locations recorded yet" />
      ) : (
        <div className="space-y-6">
          {groups.map(([groupName, locations]) => {
            const Icon = GROUP_ICON[groupName] ?? MapPin
            const total = locations.reduce((s, l) => s + l.items.length, 0)
            return (
              <section key={groupName}>
                <h2 className="mb-2.5 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  <Icon className="h-4 w-4" /> {groupName}
                  <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-500 dark:bg-ink-800">
                    {total}
                  </span>
                </h2>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {locations.map(({ location, items }) => {
                    const isOpen = open.has(location)
                    const matches = q ? items.filter((c) => matchesQuery(c, q)) : items
                    const warnings = segregationWarnings(items)
                    const shown = q ? matches : isOpen ? items : items.slice(0, 4)

                    if (q && matches.length === 0) return null

                    return (
                      <div key={location} className="card flex flex-col p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="font-semibold text-ink-900 dark:text-ink-50">
                              {location}
                            </h3>
                            <p className="text-xs text-ink-400">
                              {items.length} container{items.length === 1 ? '' : 's'}
                              {q && ` · ${matches.length} matching`}
                            </p>
                          </div>
                          <span className="rounded-lg bg-pearl-50 px-2 py-1 text-sm font-bold text-pearl-700 dark:bg-pearl-500/10 dark:text-pearl-300">
                            {items.length}
                          </span>
                        </div>

                        {warnings.length > 0 && (
                          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-500/25 dark:bg-amber-500/10">
                            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200">
                              <ShieldAlert className="h-3.5 w-3.5" /> Segregation check
                            </p>
                            <ul className="mt-1 space-y-0.5 text-[11px] leading-snug text-amber-800 dark:text-amber-200/80">
                              {warnings.map((w) => (
                                <li key={w}>{w}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <ul className="mt-3 flex-1 space-y-1">
                          {shown.map((c) => (
                            <li key={c.id}>
                              <button
                                onClick={() => setDetail(c)}
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-ink-50 dark:hover:bg-ink-800"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm text-ink-800 dark:text-ink-100">
                                    {c.name}
                                  </span>
                                  <span className="flex items-center gap-1.5">
                                    <span className="text-[11px] text-ink-400">
                                      {formatSize(c)}
                                    </span>
                                    <HazardBadges hazards={c.hazards} max={1} />
                                  </span>
                                </span>
                                {c.status !== 'active' && (
                                  <span className={cx('badge shrink-0', statusTone(c.status))}>
                                    {STATUS_LABEL[c.status]}
                                  </span>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>

                        {!q && items.length > 4 && (
                          <button
                            onClick={() =>
                              setOpen((prev) => {
                                const next = new Set(prev)
                                if (next.has(location)) next.delete(location)
                                else next.add(location)
                                return next
                              })
                            }
                            className="mt-2 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold text-pearl-700 hover:bg-pearl-50 dark:text-pearl-400 dark:hover:bg-pearl-500/10"
                          >
                            {isOpen ? 'Show less' : `Show all ${items.length}`}
                            <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <ChemicalDrawer chemical={detail} onClose={() => setDetail(null)} onEdit={() => setDetail(null)} />
    </>
  )
}
