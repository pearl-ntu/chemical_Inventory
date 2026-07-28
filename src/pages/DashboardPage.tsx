import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check,
  CircleSlash,
  Database,
  FilePlus2,
  MapPin,
  Pencil,
  Plus,
  ShieldAlert,
  Sparkles,
  Upload,
} from 'lucide-react'
import { ChemicalDrawer } from '../components/ChemicalDrawer'
import { ChemicalForm } from '../components/ChemicalForm'
import { BarList, Donut, Timeline } from '../components/charts'
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
  invited: Sparkles,
  role_changed: ShieldAlert,
}

/** What kind of thing needs a look — drives both the rail's Views/Queues
 *  rows and the attention table's filter pills, so clicking either one
 *  scopes the exact same list. */
type IssueCategory = 'all' | 'low' | 'expiring' | 'duplicate' | 'no-location' | 'no-cas' | 'no-hazard'

interface AttentionRow {
  key: string
  chemical: Chemical
  category: IssueCategory
  issueLabel: string
  detail: string
  risk: 'critical' | 'warning' | 'info'
}

export default function DashboardPage() {
  const { chemicals, loading, loadStarterData } = useInventory()
  const { profile, canEdit } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [recent, setRecent] = useState<ActivityEntry[]>([])
  // Tracked by id and derived live (see InventoryPage for why) so the drawer
  // never freezes on a pre-mutation snapshot.
  const [detailId, setDetailId] = useState<string | null>(null)
  const detail = useMemo(() => chemicals.find((c) => c.id === detailId) ?? null, [chemicals, detailId])
  const [formOpen, setFormOpen] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [category, setCategory] = useState<IssueCategory>('all')

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

    // Data-hygiene gaps — only among stock that's still actually on a shelf;
    // a disposed bottle's missing CAS isn't a problem worth chasing anymore.
    const onShelf = [...active, ...low]
    const noLocation = onShelf.filter((c) => !c.location)
    const noCas = onShelf.filter((c) => !c.cas)
    const noHazard = onShelf.filter((c) => c.hazards.length === 0)
    const completeness = (missing: number) =>
      onShelf.length ? Math.round(((onShelf.length - missing) / onShelf.length) * 100) : 100

    const hazardTally = new Map<string, number>()
    for (const c of onShelf) for (const h of c.hazards) hazardTally.set(h, (hazardTally.get(h) ?? 0) + 1)
    const topHazards = [...hazardTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)

    const attentionRows: AttentionRow[] = [
      ...low.map((c) => ({
        key: `low-${c.id}`,
        chemical: c,
        category: 'low' as const,
        issueLabel: 'Running low',
        detail: `${formatSize(c)} left — reorder before it runs out`,
        risk: 'warning' as const,
      })),
      ...expiring.map((c) => ({
        key: `expiring-${c.id}`,
        chemical: c,
        category: 'expiring' as const,
        issueLabel: 'Expiring soon',
        detail: `Expires ${c.expiry_date}`,
        risk: (expiringUrgent.includes(c) ? 'critical' : 'warning') as AttentionRow['risk'],
      })),
      ...duplicates.map((group) => ({
        key: `duplicate-${group[0].cas}`,
        chemical: group[0],
        category: 'duplicate' as const,
        issueLabel: 'Held more than once',
        detail: `${group.length} bottles · ${[...new Set(group.map((g) => g.location ?? 'unassigned'))].join(', ')}`,
        risk: 'info' as const,
      })),
      ...noLocation.map((c) => ({
        key: `no-location-${c.id}`,
        chemical: c,
        category: 'no-location' as const,
        issueLabel: 'No location assigned',
        detail: 'Won’t show up on the shelf map until this is set',
        risk: 'info' as const,
      })),
      ...noCas.map((c) => ({
        key: `no-cas-${c.id}`,
        chemical: c,
        category: 'no-cas' as const,
        issueLabel: 'No CAS number',
        detail: 'Duplicate-holding checks and SDS lookups miss this bottle',
        risk: 'info' as const,
      })),
      ...noHazard.map((c) => ({
        key: `no-hazard-${c.id}`,
        chemical: c,
        category: 'no-hazard' as const,
        issueLabel: 'No hazard class tagged',
        detail: 'Segregation checks skip this bottle until it’s tagged',
        risk: 'info' as const,
      })),
    ]

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
      noLocation,
      noCas,
      noHazard,
      onShelfCount: onShelf.length,
      casPct: completeness(noCas.length),
      locationPct: completeness(noLocation.length),
      hazardPct: completeness(noHazard.length),
      topHazards,
      attentionRows,
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

  function jumpToAttention(next: IssueCategory) {
    setCategory(next)
    document.getElementById('attention-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const topLocation = stats.locations[0]

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
          onClick={() => jumpToAttention('all')}
        />
      </div>

      {/* KPI strip — one bordered surface, five equal columns, never wraps */}
      <div className="mt-4 animate-slide-up" style={stagger(1)}>
        <div className="card grid grid-cols-2 divide-y divide-ink-100 p-0 sm:grid-cols-3 sm:divide-x sm:divide-y-0 xl:grid-cols-5 dark:divide-ink-800">
          <Kpi
            label="In stock"
            value={stats.active.length}
            sub={
              stats.thisMonth > 0
                ? `${stats.thisMonth > stats.lastMonth ? '+' : ''}${stats.thisMonth - stats.lastMonth} vs last month`
                : `across ${stats.locations.length} locations`
            }
            onClick={() => navigate('/inventory?status=active')}
          />
          <Kpi
            label="Running low"
            value={stats.low.length}
            sub={stats.low.length ? 'reorder before they run out' : 'nothing flagged'}
            tone={stats.low.length ? 'warning' : 'good'}
            onClick={() => jumpToAttention('low')}
          />
          <Kpi
            label="Expiring soon"
            value={stats.expiring.length}
            sub={stats.expiring.length ? 'within the next 3 months' : 'nothing in 3 months'}
            tone={stats.expiringUrgent.length ? 'critical' : stats.expiring.length ? 'warning' : 'good'}
            onClick={() => jumpToAttention('expiring')}
          />
          <Kpi
            label="Duplicates"
            value={stats.duplicates.length}
            sub={stats.duplicates.length ? 'check before reordering' : 'no repeat holdings'}
            tone={stats.duplicates.length ? 'info' : 'good'}
            onClick={() => jumpToAttention('duplicate')}
          />
          <Kpi
            label="Suppliers"
            value={stats.suppliers}
            sub="distinct vendors"
            onClick={() => navigate('/analytics')}
          />
        </div>
      </div>

      {/* control toolbar — saved views, cleanup queues, and hazard-class
          lenses in one horizontal strip, so the page stays full-width below
          instead of losing a column to a permanent side rail */}
      <div className="mt-4 animate-slide-up" style={stagger(2)}>
        <ControlToolbar
          counts={{
            low: stats.low.length,
            expiring: stats.expiring.length,
            duplicate: stats.duplicates.length,
            noLocation: stats.noLocation.length,
            noCas: stats.noCas.length,
            noHazard: stats.noHazard.length,
          }}
          topHazards={stats.topHazards}
          category={category}
          onCategory={jumpToAttention}
          onHazard={(h) => navigate(`/inventory?hazard=${encodeURIComponent(h)}`)}
        />
      </div>

      <div className="space-y-4">
          <div className="mt-4 grid animate-slide-up gap-4 lg:grid-cols-[1.85fr_1fr]" style={stagger(3)}>
            {/* storage coverage ------------------------------------------------ */}
            <section className="card p-4">
              <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">Storage coverage</h2>
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                How containers are spread across locations, and where stock is thin.
              </p>

              {/* Deliberately stacked, not side-by-side: this column's actual
                  rendered width depends on the rail+analytical-row split
                  above, not the viewport directly, so a viewport breakpoint
                  here can't know whether there's really room — that's
                  exactly what squeezed location names down to "Fridg…"
                  before. */}
              <div className="mt-4">
                <div className="mx-auto w-full max-w-[220px]">
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
                </div>
                <div className="mt-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                      Where things are kept
                    </h3>
                    <button
                      className="text-xs font-medium text-pearl-700 hover:underline dark:text-pearl-400"
                      onClick={() => navigate('/locations')}
                    >
                      See the shelf map
                    </button>
                  </div>
                  <BarList
                    data={stats.locations.slice(0, 6).map((d) => ({
                      ...d,
                      onClick: () => navigate('/locations'),
                    }))}
                    unit=""
                  />
                </div>
              </div>

              <div className="mt-5 grid gap-5 border-t border-ink-100 pt-4 dark:border-ink-800 sm:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                    Coverage read
                  </h3>
                  <ul className="mt-2 space-y-1.5 text-sm text-ink-600 dark:text-ink-300">
                    <li>
                      {stats.active.length} containers in stock across {stats.locations.length}{' '}
                      locations.
                    </li>
                    {topLocation && (
                      <li>
                        {topLocation.label} holds the most, at {topLocation.value} containers.
                      </li>
                    )}
                    <li>{stats.suppliers} distinct suppliers on record.</li>
                  </ul>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                    Pressure points
                  </h3>
                  <ul className="mt-2 space-y-1.5 text-sm text-ink-600 dark:text-ink-300">
                    <li className={stats.low.length ? 'text-amber-700 dark:text-amber-400' : undefined}>
                      {stats.low.length} bottle{stats.low.length === 1 ? '' : 's'} running low right now.
                    </li>
                    <li className={stats.expiringUrgent.length ? 'text-rose-700 dark:text-rose-400' : undefined}>
                      {stats.expiringUrgent.length} expiring within a month.
                    </li>
                    <li>
                      {stats.duplicates.length} chemical{stats.duplicates.length === 1 ? '' : 's'} held in
                      more than one bottle.
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            {/* data quality ----------------------------------------------------- */}
            <section className="card flex flex-col p-4">
              <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">Data quality</h2>
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                How complete the record set is for stock still on the shelf.
              </p>

              <div className="mt-4 space-y-3">
                <ProgressRow label="Has a CAS number" pct={stats.casPct} />
                <ProgressRow label="Has a storage location" pct={stats.locationPct} />
                <ProgressRow label="Has a hazard class tagged" pct={stats.hazardPct} />
              </div>

              <div className="mt-4 border-t border-ink-100 pt-4 dark:border-ink-800">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Cleanup queue
                </h3>
                <ul className="mt-2 space-y-1">
                  <QueueRow
                    label="No location assigned"
                    count={stats.noLocation.length}
                    onClick={() => jumpToAttention('no-location')}
                  />
                  <QueueRow
                    label="No CAS number"
                    count={stats.noCas.length}
                    onClick={() => jumpToAttention('no-cas')}
                  />
                  <QueueRow
                    label="No hazard tagged"
                    count={stats.noHazard.length}
                    onClick={() => jumpToAttention('no-hazard')}
                  />
                </ul>
              </div>

              <div className="mt-4 flex-1 border-t border-ink-100 pt-4 dark:border-ink-800">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Needs a look first
                </h3>
                {stats.attentionRows.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-400">Nothing outstanding — well kept.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {[...stats.attentionRows]
                      .sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk])
                      .slice(0, 3)
                      .map((row) => (
                        <li key={row.key}>
                          <button
                            className="w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink-50 dark:hover:bg-ink-800"
                            onClick={() => setDetailId(row.chemical.id)}
                          >
                            <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">
                              {row.chemical.name}
                            </p>
                            <p className="truncate text-xs text-ink-500 dark:text-ink-400">
                              {row.issueLabel} — {row.detail}
                            </p>
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          {/* attention table -------------------------------------------------- */}
          <section id="attention-table" className="card animate-slide-up p-4" style={stagger(4)}>
            <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">Needs a look this week</h2>
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
              Every bottle with an open issue — running low, expiring, held twice, or missing a
              detail — before the next stock check.
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {(
                [
                  ['all', 'All'],
                  ['low', 'Running low'],
                  ['expiring', 'Expiring soon'],
                  ['duplicate', 'Held twice'],
                  ['no-location', 'No location'],
                  ['no-cas', 'No CAS'],
                  ['no-hazard', 'No hazard'],
                ] as Array<[IssueCategory, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setCategory(key)}
                  className={cx(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    category === key
                      ? 'border-pearl-600 bg-pearl-600 text-white'
                      : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300 dark:hover:bg-ink-800',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <AttentionTable
              rows={stats.attentionRows.filter((r) => category === 'all' || r.category === category)}
              onOpen={(id) => setDetailId(id)}
            />
          </section>

          {/* timeline + activity ----------------------------------------------- */}
          <section className="grid animate-slide-up gap-4 lg:grid-cols-3" style={stagger(5)}>
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
            <section className="grid animate-slide-up gap-4 sm:grid-cols-2" style={stagger(6)}>
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
                          onClick={() => setDetailId(c.id)}
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
          <p className="flex items-center gap-2 text-xs text-ink-400">
            <Sparkles className="h-3.5 w-3.5" />
            Nothing needs your attention right now — mark a bottle “Running low” from its detail
            panel and it'll show up here the moment it does.
          </p>
        )}
      </div>

      <ChemicalDrawer
        chemical={detail}
        onClose={() => setDetailId(null)}
        onEdit={() => {
          setDetailId(null)
          setFormOpen(true)
        }}
      />
      <ChemicalForm open={formOpen} onClose={() => setFormOpen(false)} />
    </>
  )
}

const RISK_RANK: Record<AttentionRow['risk'], number> = { critical: 0, warning: 1, info: 2 }

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

/** Counts up from 0 on mount instead of snapping straight to the final
 *  value — the one animation that reliably makes a stat card feel alive
 *  rather than a static label. Skipped entirely for non-numeric values. */
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0)
  const raf = useRef(0)

  useEffect(() => {
    const start = performance.now()
    const duration = 700
    const from = 0
    const to = value

    function tick(now: number) {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - (1 - t) * (1 - t) // ease-out
      setDisplay(Math.round(from + (to - from) * eased))
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return <>{display}</>
}

/** One KPI cell inside the shared bordered strip — no card of its own, the
 *  strip is the card, so five of these read as one instrument, not five. */
function Kpi({
  label,
  value,
  sub,
  tone = 'default',
  onClick,
}: {
  label: string
  value: string | number
  sub: string
  tone?: 'default' | 'good' | 'warning' | 'critical' | 'info'
  onClick?: () => void
}) {
  const valueTone = {
    default: 'text-ink-900 dark:text-ink-50',
    good: 'text-emerald-700 dark:text-emerald-400',
    warning: 'text-amber-700 dark:text-amber-400',
    critical: 'text-rose-700 dark:text-rose-400',
    info: 'text-sky-700 dark:text-sky-400',
  }[tone]

  return (
    <button
      onClick={onClick}
      className="group flex min-h-[110px] flex-col justify-center px-5 py-4 text-left transition-all duration-150 hover:z-10 hover:-translate-y-0.5 hover:bg-ink-50 hover:shadow-pop dark:hover:bg-ink-800/50"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className={cx('mt-1.5 text-[22px] font-bold leading-none tabular-nums', valueTone)}>
        {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
      </p>
      <p className="mt-1.5 truncate text-xs text-ink-500 dark:text-ink-400">{sub}</p>
    </button>
  )
}

const TOOLBAR_PILLS: Array<[IssueCategory, string]> = [
  ['all', 'Overview'],
  ['low', 'Running low'],
  ['expiring', 'Expiring soon'],
  ['duplicate', 'Held twice'],
  ['no-location', 'No location'],
  ['no-cas', 'No CAS'],
  ['no-hazard', 'No hazard'],
]

/** Replaces what used to be a permanent left-hand rail: the same saved
 *  views and cleanup queues, as one horizontal strip near the page title
 *  instead of a column eating width from every panel below it. Hazard-class
 *  lenses sit on the right since they jump to Inventory rather than
 *  filtering the scope in place. */
function ControlToolbar({
  counts,
  topHazards,
  category,
  onCategory,
  onHazard,
}: {
  counts: {
    low: number
    expiring: number
    duplicate: number
    noLocation: number
    noCas: number
    noHazard: number
  }
  topHazards: Array<[string, number]>
  category: IssueCategory
  onCategory: (c: IssueCategory) => void
  onHazard: (h: string) => void
}) {
  const countFor: Record<IssueCategory, number | undefined> = {
    all: undefined,
    low: counts.low,
    expiring: counts.expiring,
    duplicate: counts.duplicate,
    'no-location': counts.noLocation,
    'no-cas': counts.noCas,
    'no-hazard': counts.noHazard,
  }

  return (
    <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto">
        {TOOLBAR_PILLS.map(([key, label]) => {
          const count = countFor[key]
          const active = category === key
          return (
            <button
              key={key}
              onClick={() => onCategory(key)}
              className={cx(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'bg-pearl-600 text-white'
                  : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800',
              )}
            >
              {label}
              {count != null && (
                <span
                  className={cx(
                    'rounded-full px-1.5 text-[11px] tabular-nums',
                    active ? 'bg-white/20' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {topHazards.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">
            Lenses
          </span>
          {topHazards.map(([h, n]) => (
            <button
              key={h}
              onClick={() => onHazard(h)}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-2.5 py-1 text-xs text-ink-600 transition-colors hover:border-pearl-300 hover:bg-pearl-50 dark:border-ink-700 dark:text-ink-300 dark:hover:border-pearl-600 dark:hover:bg-pearl-500/10"
            >
              {h}
              <span className="text-ink-400">{n}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ProgressRow({ label, pct }: { label: string; pct: number }) {
  const tone = pct >= 90 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm text-ink-600 dark:text-ink-300">{label}</span>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-800 dark:text-ink-100">
          {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
        <div
          className={cx('h-full rounded-full transition-[width] duration-500 ease-out', tone)}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
    </div>
  )
}

function QueueRow({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-600 transition-colors hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800"
      >
        <span className="min-w-0 truncate">{label}</span>
        <span
          className={cx(
            'shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
            count
              ? 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200'
              : 'text-emerald-600 dark:text-emerald-400',
          )}
        >
          {count}
        </span>
      </button>
    </li>
  )
}

const RISK_BADGE: Record<AttentionRow['risk'], string> = {
  critical: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20',
  warning:
    'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
}

function AttentionTable({ rows, onOpen }: { rows: AttentionRow[]; onOpen: (id: string) => void }) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-400">
        Nothing in this scope — every bottle checks out.
      </p>
    )
  }

  return (
    <div className="mt-3 -mx-4 overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <thead className="border-b border-ink-200 text-left text-xs text-ink-400 dark:border-ink-800">
          <tr>
            <th className="px-4 py-2 font-medium">Chemical</th>
            <th className="px-4 py-2 font-medium">Registered by</th>
            <th className="px-4 py-2 font-medium">Issue</th>
            <th className="px-4 py-2 font-medium">Detail</th>
            <th className="px-4 py-2 font-medium">Last touch</th>
            <th className="px-4 py-2 font-medium">Risk</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
          {rows.slice(0, 20).map((row) => (
            <tr
              key={row.key}
              className="group cursor-pointer transition-colors hover:bg-ink-50 dark:hover:bg-ink-800/50"
              onClick={() => onOpen(row.chemical.id)}
            >
              <td className="max-w-[16rem] truncate px-4 py-2.5 text-sm font-medium text-ink-800 transition-transform duration-150 group-hover:translate-x-1 dark:text-ink-100">
                {row.chemical.name}
              </td>
              <td className="max-w-[10rem] truncate px-4 py-2.5 text-sm text-ink-500 dark:text-ink-400">
                {row.chemical.registered_by ?? '—'}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-sm text-ink-700 dark:text-ink-200">
                {row.issueLabel}
              </td>
              <td className="max-w-[18rem] truncate px-4 py-2.5 text-xs text-ink-500 dark:text-ink-400">
                {row.detail}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-400">
                {formatRelative(row.chemical.updated_at)}
              </td>
              <td className="px-4 py-2.5">
                <span className={cx('badge', RISK_BADGE[row.risk])}>{row.risk}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 20 && (
        <p className="px-4 pt-2 text-xs text-ink-400">+{rows.length - 20} more in this scope</p>
      )}
    </div>
  )
}
