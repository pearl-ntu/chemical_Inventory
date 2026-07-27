import { useMemo } from 'react'
import { BarList, Timeline } from '../components/charts'
import { PageHeader } from '../components/Layout'
import { LoadingScreen } from '../components/ui'
import { useInventory } from '../context/InventoryContext'
import type { Chemical } from '../lib/types'
import { trimNumber } from '../lib/utils'

function tally(rows: Chemical[], get: (c: Chemical) => string | null, limit = 10) {
  const map = new Map<string, number>()
  for (const r of rows) {
    const key = get(r)
    if (!key) continue
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }))
}

/** Sums pack sizes per unit, folding kg→g and L→mL so totals are comparable. */
function totalsByUnit(rows: Chemical[]) {
  let g = 0
  let ml = 0
  let other = 0

  for (const r of rows) {
    if (r.size_value == null) continue
    const amount = r.size_value * (r.quantity || 1)
    switch (r.size_unit) {
      case 'kg':
        g += amount * 1000
        break
      case 'g':
        g += amount
        break
      case 'mg':
        g += amount / 1000
        break
      case 'L':
        ml += amount * 1000
        break
      case 'mL':
        ml += amount
        break
      case 'µL':
        ml += amount / 1000
        break
      default:
        other += amount
    }
  }
  return { grams: g, millilitres: ml, other }
}

/** Headline totals get one decimal — the source pack sizes are not precise
 *  enough to justify more, and four decimals just looks like noise. */
function humanAmount(value: number, small: string, big: string): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} ${big}` : `${trimNumber(Math.round(value))} ${small}`
}

export default function AnalyticsPage() {
  // Analytics describe the confirmed shelf, not submissions still in review.
  const { approvedChemicals: chemicals, loading } = useInventory()

  const data = useMemo(() => {
    const inStock = chemicals.filter((c) => c.status === 'active' || c.status === 'low')
    const totals = totalsByUnit(inStock)

    const byMonth = new Map<string, number>()
    for (const c of chemicals) {
      if (!c.registration_date) continue
      const k = c.registration_date.slice(0, 7)
      byMonth.set(k, (byMonth.get(k) ?? 0) + 1)
    }

    return {
      inStock,
      totals,
      suppliers: tally(inStock, (c) => c.supplier, 12),
      systems: tally(inStock, (c) => c.system, 6),
      owners: tally(inStock, (c) => c.owner, 8),
      projects: tally(inStock, (c) => c.project, 8),
      units: tally(inStock, (c) => c.size_unit, 8),
      hazards: (() => {
        const map = new Map<string, number>()
        for (const c of inStock) for (const h of c.hazards) map.set(h, (map.get(h) ?? 0) + 1)
        return [...map.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([label, value]) => ({ label, value }))
      })(),
      timeline: [...byMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, value]) => ({
          label: new Date(k + '-01T00:00:00').toLocaleDateString('en-SG', {
            month: 'short',
            year: '2-digit',
          }),
          value,
        })),
    }
  }, [chemicals])

  if (loading) return <LoadingScreen label="Crunching the numbers…" />

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Where the group's reagents come from, who holds them, and how much is on the shelf."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Solids on hand</p>
          <p className="mt-1 text-2xl font-bold text-ink-900 dark:text-ink-50">
            {humanAmount(data.totals.grams, 'g', 'kg')}
          </p>
          <p className="text-xs text-ink-400">summed across every in-stock container</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Liquids on hand</p>
          <p className="mt-1 text-2xl font-bold text-ink-900 dark:text-ink-50">
            {humanAmount(data.totals.millilitres, 'mL', 'L')}
          </p>
          <p className="text-xs text-ink-400">volumetric units, normalised</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Distinct compounds
          </p>
          <p className="mt-1 text-2xl font-bold text-ink-900 dark:text-ink-50">
            {new Set(data.inStock.map((c) => c.cas || c.name.toLowerCase())).size}
          </p>
          <p className="text-xs text-ink-400">by CAS number where recorded</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-4 text-sm font-semibold text-ink-800 dark:text-ink-100">
            Top suppliers
          </h2>
          <BarList data={data.suppliers} />
        </section>

        <section className="card p-4">
          <h2 className="mb-4 text-sm font-semibold text-ink-800 dark:text-ink-100">
            Who holds what
          </h2>
          <BarList data={data.owners} emptyLabel="No owners recorded" />
        </section>

        <section className="card p-4">
          <h2 className="mb-4 text-sm font-semibold text-ink-800 dark:text-ink-100">
            Purchasing route
          </h2>
          <BarList data={data.systems} emptyLabel="No purchasing systems recorded" />
        </section>

        <section className="card p-4">
          <h2 className="mb-4 text-sm font-semibold text-ink-800 dark:text-ink-100">
            Hazard classes on the shelf
          </h2>
          <BarList
            data={data.hazards}
            emptyLabel="No hazard tags yet — add them from a chemical's edit form to power the segregation checks."
          />
        </section>

        <section className="card p-4">
          <h2 className="mb-4 text-sm font-semibold text-ink-800 dark:text-ink-100">
            Projects drawing on the store
          </h2>
          <BarList data={data.projects} emptyLabel="No projects recorded" />
        </section>

        <section className="card p-4">
          <h2 className="mb-4 text-sm font-semibold text-ink-800 dark:text-ink-100">
            Pack-size units
          </h2>
          <BarList data={data.units} />
        </section>
      </div>

      <section className="card mt-4 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-800 dark:text-ink-100">
          Registrations per month
        </h2>
        <Timeline points={data.timeline} height={200} />
      </section>
    </>
  )
}
