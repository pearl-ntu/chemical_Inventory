import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Boxes,
  CalendarClock,
  Check,
  CircleSlash,
  Copy,
  Database,
  FilePlus2,
  MapPin,
  Pencil,
  Plus,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Upload,
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
import type { ActivityAction, ActivityEntry, Chemical } from '../lib/types'
import { cx, formatRelative, formatSize, normalisedAmount } from '../lib/utils'

/** Staggers each section's entrance so the page reads top-to-bottom instead
 *  of popping in all at once — the single biggest "feels static" fix. */
function stagger(i: number): CSSProperties {
  return { animationDelay: `${i * 60}ms`, animationFillMode: 'backwards' }
}

const ACTIVITY_ICON: Record<ActivityAction, typeof Pencil> = {
  created: FilePlus2,
  updated: Pencil,
  deleted: CircleSlash,
  marked_empty: CircleSlash,
  restocked: Check,
  imported: Upload,
  signed_up: Sparkles,
}

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

    // Registrations per month, oldest first — also drives the "vs last month" delta.
    const byMonth = new Map<string, number>()
    for (const c of chemicals) {
      if (!c.registration_date) continue
      const key = c.registration_date.slice(0, 7)
      byMonth.set(key, (byMonth.get(key) ?? 0) + 1)
    }
    const monthEntries = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
    const timeline = monthEntries.map(([key, value]) => ({
      label: new Date(key + '-01T00:00:00').toLocaleDateString('en-SG', {
        month: 'short',
        year: '2-digit',
      }),
      value,
    }))
    const thisMonth = monthEntries[monthEntries.length - 1]?.[1] ?? 0
    const lastMonth = monthEntries[monthEntries.length - 2]?.[1] ?? 0

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
    const urgentDate = new Date()
    urgentDate.setMonth(urgentDate.getMonth() + 1)
    const expiringUrgent = expiring.filter((c) => c.expiry_date && new Date(c.expiry_date) <= urgentDate)

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
      thisMonth,
      lastMonth,
      largestSolids: rankBy('mass'),
      largestLiquids: rankBy('volume'),
      locations: [...byLocation.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({ label, value })),
      timeline,
      duplicates,
      expiring,
      expiringUrgent,
      suppliers: new Set(chemicals.map((c) => c.supplier).filter(Boolean)).size,
    }
  }, [chemicals])

  if (loading) return <LoadingScreen label="Building your dashboard…" />

  const firstName = profile?.full_name.split(' ')[0] ?? 'there'
  const attentionCount = stats.low.length + stats.duplicates.length + stats.expiring.length

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

      {/* attention banner — the single "what do I actually need to do" line */}
      <div className="animate-slide-up" style={stagger(0)}>
        <AttentionBanner
          low={stats.low.length}
          duplicates={stats.duplicates.length}
          expiring={stats.expiring.length}
          expiringUrgent={stats.expiringUrgent.length}
          onClick={() => navigate('/inventory')}
        />
      </div>

      <div className="mt-4 grid animate-slide-up gap-3 sm:grid-cols-2 xl:grid-cols-4" style={stagger(1)}>
        <StatTile
          label="In stock"
          value={stats.active.length}
          sub={
            stats.thisMonth > 0
              ? `${stats.thisMonth > stats.lastMonth ? '+' : ''}${stats.thisMonth - stats.lastMonth} vs last month`
              : `across ${stats.locations.length} locations`
          }
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
        <section className="card animate-slide-up p-4 lg:col-span-1" style={stagger(2)}>
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

        <section className="card animate-slide-up p-4 lg:col-span-2" style={stagger(3)}>
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
        <section className="mt-4 grid animate-slide-up gap-4 lg:grid-cols-2" style={stagger(4)}>
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
      <section className="mt-4 grid animate-slide-up gap-4 lg:grid-cols-3" style={stagger(5)}>
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
            <ul className="space-y-3">
              {recent.map((a) => {
                const Icon = ACTIVITY_ICON[a.action] ?? Pencil
                return (
                  <li key={a.id} className="flex gap-2.5">
                    <span
                      className={cx(
                        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                        a.action === 'deleted'
                          ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
                          : 'bg-pearl-50 text-pearl-700 dark:bg-pearl-500/10 dark:text-pearl-300',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink-700 dark:text-ink-200">{a.details}</p>
                      <p className="text-xs text-ink-400">
                        {a.user_name} · {formatRelative(a.created_at)}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      {/* quick reference ---------------------------------------------------- */}
      {/* Solids and liquids are ranked separately — "500 g" and "500 mL" are
          not comparable quantities, and one combined list would imply they are. */}
      {(stats.largestSolids.length > 0 || stats.largestLiquids.length > 0) && (
        <section className="mt-4 grid animate-slide-up gap-4 sm:grid-cols-2" style={stagger(6)}>
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
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2 text-left transition-colors hover:border-pearl-300 hover:bg-pearl-50/50 dark:border-ink-800 dark:hover:border-pearl-600 dark:hover:bg-pearl-500/5"
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
      )}

      {attentionCount === 0 && (
        <p className="mt-4 flex items-center gap-2 text-xs text-ink-400">
          <Sparkles className="h-3.5 w-3.5" />
          Nothing needs your attention right now — mark a bottle “Running low” from its detail
          panel and it'll show up here the moment it does.
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

/**
 * One line, up front: is there anything to actually do today? Replaces
 * scanning three separate panels to piece that together yourself.
 */
function AttentionBanner({
  low,
  duplicates,
  expiring,
  expiringUrgent,
  onClick,
}: {
  low: number
  duplicates: number
  expiring: number
  expiringUrgent: number
  onClick: () => void
}) {
  const total = low + duplicates + expiring

  if (total === 0) {
    return (
      <div className="card flex items-center gap-3 border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          <Check className="h-4.5 w-4.5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
            Everything's in order
          </p>
          <p className="text-xs text-emerald-700/80 dark:text-emerald-300/70">
            Nothing running low, no duplicates, nothing expiring soon.
          </p>
        </div>
      </div>
    )
  }

  const chips: Array<{ label: string; count: number; tone: string }> = [
    ...(low ? [{ label: 'running low', count: low, tone: 'amber' }] : []),
    ...(expiringUrgent
      ? [{ label: 'expiring within a month', count: expiringUrgent, tone: 'rose' }]
      : []),
    ...(expiring - expiringUrgent > 0
      ? [{ label: 'expiring within 3 months', count: expiring - expiringUrgent, tone: 'amber' }]
      : []),
    ...(duplicates ? [{ label: 'held more than once', count: duplicates, tone: 'sky' }] : []),
  ]

  const TONE: Record<string, string> = {
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    rose: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
    sky: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
  }

  return (
    <button
      onClick={onClick}
      className="card flex w-full flex-wrap items-center gap-3 border-amber-200 bg-amber-50/60 p-4 text-left transition-colors hover:bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/5 dark:hover:bg-amber-500/10"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
        <ShieldAlert className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          {total} thing{total === 1 ? '' : 's'} worth a look
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.label}
              className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', TONE[chip.tone])}
            >
              {chip.count} {chip.label}
            </span>
          ))}
        </div>
      </div>
    </button>
  )
}
