import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  CircleSlash,
  Copy,
  Database,
  MapPin,
  Plus,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react'
import { ChemicalDrawer } from '../components/ChemicalDrawer'
import { ChemicalForm } from '../components/ChemicalForm'
import { BarList, Donut, StatTile, Timeline } from '../components/charts'
import { PageHeader } from '../components/Layout'
import { EmptyState, LoadingScreen, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import type { ActivityEntry, Chemical } from '../lib/types'
import { cx, formatRelative, formatSize, normalisedAmount } from '../lib/utils'

export default function DashboardPage() {
  const { chemicals, loading, loadStarterData } = useInventory()
  const { profile, canEdit } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [recent, setRecent] = useState<ActivityEntry[]>([])
  const [detail, setDetail] = useState<Chemical | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [seeding, setSeeding] = useState(false)

  useEffect(() => {
    void api.listActivity(8).then(setRecent).catch(() => setRecent([]))
  }, [chemicals.length])

  const stats = useMemo(() => {
    const active = chemicals.filter((c) => c.status === 'active')
    const low = chemicals.filter((c) => c.status === 'low')
    const empty = chemicals.filter((c) => c.status === 'empty' || c.status === 'disposed')

    const byLocation = new Map<string, number>()
    for (const c of chemicals) {
      if (c.status === 'empty' || c.status === 'disposed') continue
      const key = c.location ?? 'Unassigned'
      byLocation.set(key, (byLocation.get(key) ?? 0) + 1)
    }

    // Registrations per month, oldest first.
    const byMonth = new Map<string, number>()
    for (const c of chemicals) {
      if (!c.registration_date) continue
      const key = c.registration_date.slice(0, 7)
      byMonth.set(key, (byMonth.get(key) ?? 0) + 1)
    }
    const timeline = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({
        label: new Date(key + '-01T00:00:00').toLocaleDateString('en-SG', {
          month: 'short',
          year: '2-digit',
        }),
        value,
      }))

    // Same CAS held more than once and still in stock — a reorder trap.
    const casGroups = new Map<string, Chemical[]>()
    for (const c of active) {
      if (!c.cas) continue
      const list = casGroups.get(c.cas) ?? []
      list.push(c)
      casGroups.set(c.cas, list)
    }
    const duplicates = [...casGroups.values()].filter((g) => g.length > 1)

    const soon = new Date()
    soon.setMonth(soon.getMonth() + 3)
    const expiring = active
      .filter((c) => c.expiry_date && new Date(c.expiry_date) <= soon)
      .sort((a, b) => (a.expiry_date ?? '').localeCompare(b.expiry_date ?? ''))

    const rankBy = (family: 'mass' | 'volume') =>
      active
        .map((c) => ({ c, n: normalisedAmount(c) }))
        .filter((x): x is { c: Chemical; n: { family: 'mass' | 'volume'; base: number } } =>
          x.n?.family === family,
        )
        .sort((a, b) => b.n.base - a.n.base)
        .slice(0, 5)
        .map((x) => x.c)

    return {
      active,
      low,
      empty,
      largestSolids: rankBy('mass'),
      largestLiquids: rankBy('volume'),
      locations: [...byLocation.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({ label, value })),
      timeline,
      duplicates,
      expiring,
      suppliers: new Set(chemicals.map((c) => c.supplier).filter(Boolean)).size,
    }
  }, [chemicals])

  if (loading) return <LoadingScreen label="Building your dashboard…" />

  const firstName = profile?.full_name.split(' ')[0] ?? 'there'

  if (chemicals.length === 0) {
    return (
      <>
        <PageHeader title={`Welcome, ${firstName}`} description="The inventory is empty — let's fix that." />
        <div className="card">
          <EmptyState
            icon={<Database className="h-6 w-6" />}
            title="Load the lab's starter inventory"
            description="The 235 containers from the group's July 2026 spreadsheet are bundled with the app. Load them in one click, then edit from there — or start from scratch and add bottles as you go."
            action={
              canEdit ? (
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <button
                    className="btn-primary"
                    disabled={seeding}
                    onClick={async () => {
                      setSeeding(true)
                      try {
                        const n = await loadStarterData()
                        toast.success(`Loaded ${n} containers.`)
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Could not load the data.')
                      } finally {
                        setSeeding(false)
                      }
                    }}
                  >
                    {seeding ? <Spinner /> : <Database className="h-4 w-4" />}
                    Load 235 starter containers
                  </button>
                  <button className="btn-secondary" onClick={() => setFormOpen(true)}>
                    <Plus className="h-4 w-4" /> Add one manually
                  </button>
                </div>
              ) : undefined
            }
          />
        </div>
        <ChemicalForm open={formOpen} onClose={() => setFormOpen(false)} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="What the group is holding right now."
        actions={
          canEdit && (
            <button className="btn-primary" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" /> Add chemical
            </button>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="In stock"
          value={stats.active.length}
          sub={`across ${stats.locations.length} locations`}
          icon={<Boxes className="h-5 w-5" />}
          onClick={() => navigate('/inventory')}
        />
        <StatTile
          label="Running low"
          value={stats.low.length}
          sub={stats.low.length ? 'reorder before they run out' : 'nothing flagged'}
          tone={stats.low.length ? 'warning' : 'good'}
          icon={<TriangleAlert className="h-5 w-5" />}
          onClick={() => navigate('/inventory')}
        />
        <StatTile
          label="Finished"
          value={stats.empty.length}
          sub="kept for purchase history"
          icon={<CircleSlash className="h-5 w-5" />}
        />
        <StatTile
          label="Suppliers"
          value={stats.suppliers}
          sub="distinct vendors on record"
          icon={<TrendingUp className="h-5 w-5" />}
          onClick={() => navigate('/analytics')}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="card p-4 lg:col-span-1">
          <h2 className="mb-4 text-sm font-semibold text-ink-800 dark:text-ink-100">
            Stock by status
          </h2>
          <Donut
            centerValue={chemicals.length}
            centerLabel="containers"
            data={[
              { label: 'In stock', value: stats.active.length, color: 'var(--viz-good)' },
              { label: 'Running low', value: stats.low.length, color: 'var(--viz-warning)' },
              {
                label: 'Empty',
                value: chemicals.filter((c) => c.status === 'empty').length,
                color: 'var(--viz-neutral)',
              },
              {
                label: 'Disposed',
                value: chemicals.filter((c) => c.status === 'disposed').length,
                color: 'var(--viz-critical)',
              },
            ]}
          />
        </section>

        <section className="card p-4 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-800 dark:text-ink-100">
              Where things are kept
            </h2>
            <button
              className="text-xs font-medium text-pearl-700 hover:underline dark:text-pearl-400"
              onClick={() => navigate('/locations')}
            >
              See the shelf map
            </button>
          </div>
          <BarList
            data={stats.locations.slice(0, 8).map((d) => ({
              ...d,
              onClick: () => navigate('/locations'),
            }))}
            unit=""
          />
        </section>
      </div>

      {/* alerts ------------------------------------------------------------ */}
      {(stats.duplicates.length > 0 || stats.expiring.length > 0) && (
        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          {stats.duplicates.length > 0 && (
            <div className="card p-4">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-800 dark:text-ink-100">
                <Copy className="h-4 w-4 text-amber-600" />
                Held more than once
              </h2>
              <p className="mb-3 text-xs text-ink-500">
                Same CAS number, more than one bottle in stock. Worth checking before the next order.
              </p>
              <ul className="space-y-1.5">
                {stats.duplicates.slice(0, 5).map((group) => (
                  <li key={group[0].cas}>
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink-50 dark:hover:bg-ink-800"
                      onClick={() => setDetail(group[0])}
                    >
                      <span className="flex-1 truncate text-sm text-ink-800 dark:text-ink-100">
                        {group[0].name}
                      </span>
                      <span className="badge bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20">
                        {group.length} bottles
                      </span>
                      <span className="hidden text-xs text-ink-400 sm:block">
                        {[...new Set(group.map((g) => g.location ?? '—'))].join(', ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {stats.duplicates.length > 5 && (
                <p className="mt-2 px-2 text-xs text-ink-400">
                  +{stats.duplicates.length - 5} more
                </p>
              )}
            </div>
          )}

          {stats.expiring.length > 0 && (
            <div className="card p-4">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-800 dark:text-ink-100">
                <CalendarClock className="h-4 w-4 text-rose-600" />
                Expiring within three months
              </h2>
              <ul className="mt-3 space-y-1.5">
                {stats.expiring.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink-50 dark:hover:bg-ink-800"
                      onClick={() => setDetail(c)}
                    >
                      <span className="flex-1 truncate text-sm">{c.name}</span>
                      <span className="text-xs text-ink-400">{c.location}</span>
                      <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                        {c.expiry_date}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* timeline + activity ----------------------------------------------- */}
      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-ink-800 dark:text-ink-100">
            Containers registered over time
          </h2>
          <Timeline points={stats.timeline} />
        </div>

        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-800 dark:text-ink-100">
            Recent activity
          </h2>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-xs text-ink-400">
              Nothing yet. Changes appear here as the group uses the app.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {recent.map((a) => (
                <li key={a.id} className="flex gap-2.5">
                  <span
                    className={cx(
                      'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      a.action === 'deleted' ? 'bg-rose-500' : 'bg-pearl-500',
                    )}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink-700 dark:text-ink-200">{a.details}</p>
                    <p className="text-xs text-ink-400">
                      {a.user_name} · {formatRelative(a.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* quick reference ---------------------------------------------------- */}
      {/* Solids and liquids are ranked separately — "500 g" and "500 mL" are
          not comparable quantities, and one combined list would imply they are. */}
      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        {(
          [
            ['Largest solid holdings', stats.largestSolids],
            ['Largest liquid holdings', stats.largestLiquids],
          ] as const
        ).map(([heading, rows]) =>
          rows.length === 0 ? null : (
            <div key={heading} className="card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-800 dark:text-ink-100">
                <MapPin className="h-4 w-4 text-pearl-600" />
                {heading}
              </h2>
              <div className="space-y-2">
                {rows.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setDetail(c)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2 text-left hover:border-pearl-300 hover:bg-pearl-50/50 dark:border-ink-800 dark:hover:border-pearl-600 dark:hover:bg-pearl-500/5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink-800 dark:text-ink-100">
                        {c.name}
                      </span>
                      <span className="text-xs text-ink-400">{c.location}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-pearl-700 dark:text-pearl-400">
                      {formatSize(c)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ),
        )}
      </section>

      {stats.low.length > 0 && (
        <p className="mt-4 flex items-center gap-2 text-xs text-ink-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          Tip: mark a bottle “Running low” from its detail panel and it shows up here for whoever
          places the next order.
        </p>
      )}

      <ChemicalDrawer
        chemical={detail}
        onClose={() => setDetail(null)}
        onEdit={() => {
          setDetail(null)
          setFormOpen(true)
        }}
      />
      <ChemicalForm open={formOpen} onClose={() => setFormOpen(false)} />
    </>
  )
}
