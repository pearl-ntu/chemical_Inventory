import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, ArrowRight, Beaker, BookOpen, Database, FileWarning } from 'lucide-react'
import { BarList } from '../components/charts'
import { DashboardSkeleton } from '../components/ui'
import { useInventory } from '../context/InventoryContext'
import { api } from '../lib/api'
import { rollupPublications } from '../lib/publicationRollup'
import type { ActivityEntry, Profile, ResearchAsset } from '../lib/types'
import { cx, formatRelative } from '../lib/utils'

const DAY_MS = 86_400_000

function Kpi({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode
  label: string
  value: number
  tone?: 'good' | 'warning' | 'critical'
}) {
  const toneClass =
    tone === 'critical'
      ? 'text-rose-600 dark:text-rose-400'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'good'
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-ink-900 dark:text-ink-50'
  return (
    <div className="p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-400">
        {icon} {label}
      </p>
      <p className={cx('mt-1 text-2xl font-bold', toneClass)}>{value}</p>
    </div>
  )
}

/**
 * The PI's connection into the actual lab data — not a parallel bookkeeping
 * system. Everything here reads live off `chemicals`, `research_assets`,
 * and `activity_log`, the same tables the rest of the app already writes
 * to, so it can't drift from what's really in the inventory.
 */
export default function PiAnalyticsPage() {
  const { chemicals, loading: chemicalsLoading } = useInventory()
  const [assets, setAssets] = useState<ResearchAsset[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [members, setMembers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.listResearchAssets(), api.listActivity(1000), api.listProfiles()])
      .then(([a, act, m]) => {
        setAssets(a)
        setActivity(act)
        setMembers(m.filter((row) => row.approved))
      })
      .finally(() => setLoading(false))
  }, [])

  const expStats = useMemo(() => {
    const active = chemicals.filter((c) => c.status === 'active')
    const low = chemicals.filter((c) => c.status === 'low')
    const empty = chemicals.filter((c) => c.status === 'empty')
    const disposed = chemicals.filter((c) => c.status === 'disposed')
    const stocked = [...active, ...low]
    const soon = new Date(Date.now() + 90 * DAY_MS)
    const expiring = stocked.filter((c) => c.expiry_date && new Date(c.expiry_date) <= soon)
    const missingSds = stocked.filter((c) => !c.sds_url)
    return { active, low, empty, disposed, stocked, expiring, missingSds }
  }, [chemicals])

  const compStats = useMemo(() => {
    const byStatus = new Map<string, number>()
    for (const a of assets) byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1)
    const staleBefore = new Date(Date.now() - 90 * DAY_MS)
    const stale = assets.filter(
      (a) => (a.status === 'active' || a.status === 'running') && new Date(a.updated_at) <= staleBefore,
    )
    return { byStatus, stale, failed: assets.filter((a) => a.status === 'failed') }
  }, [assets])

  const memberRows = useMemo(() => {
    const since30 = Date.now() - 30 * DAY_MS
    return members
      .map((m) => {
        const myActivity = activity.filter((a) => a.user_id === m.id)
        const recent = myActivity.filter((a) => new Date(a.created_at).getTime() >= since30)
        const lastActive = myActivity[0]?.created_at ?? null // activity is already newest-first
        const chemicalsOwned = chemicals.filter(
          (c) => c.created_by === m.id || (c.owner && c.owner === m.full_name),
        ).length
        const assetsCreated = assets.filter((a) => a.created_by === m.id).length
        return {
          member: m,
          activityCount: recent.length,
          totalActivity: myActivity.length,
          chemicalsOwned,
          assetsCreated,
          lastActive,
        }
      })
      .sort((a, b) => (b.lastActive ?? '').localeCompare(a.lastActive ?? ''))
  }, [members, activity, chemicals, assets])

  const publications = useMemo(() => rollupPublications(assets), [assets])

  const topActive = useMemo(
    () =>
      memberRows
        .filter((r) => r.activityCount > 0)
        .sort((a, b) => b.activityCount - a.activityCount)
        .slice(0, 8)
        .map((r) => ({ label: r.member.full_name, value: r.activityCount })),
    [memberRows],
  )

  if (loading || chemicalsLoading) return <DashboardSkeleton />

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-ink-900 dark:text-white">Analytics</h2>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Live off the actual inventory and activity log — who's doing what, and where things stand.
        </p>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink-800 dark:text-ink-100">Experimental</h3>
          <Link to="/inventory" className="flex items-center gap-1 text-xs font-medium text-pearl-700 hover:underline dark:text-pearl-300">
            Open Inventory <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="card grid grid-cols-2 divide-y divide-ink-100 p-0 sm:grid-cols-3 md:grid-cols-6 sm:divide-x sm:divide-y-0 dark:divide-ink-800">
          <Kpi icon={<Beaker className="h-4 w-4" />} label="In stock" value={expStats.active.length} />
          <Kpi icon={<Beaker className="h-4 w-4" />} label="Running low" value={expStats.low.length} tone={expStats.low.length ? 'warning' : 'good'} />
          <Kpi icon={<Beaker className="h-4 w-4" />} label="Empty" value={expStats.empty.length} />
          <Kpi icon={<Beaker className="h-4 w-4" />} label="Disposed" value={expStats.disposed.length} />
          <Kpi
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Expiring (90d)"
            value={expStats.expiring.length}
            tone={expStats.expiring.length ? 'warning' : 'good'}
          />
          <Kpi
            icon={<FileWarning className="h-4 w-4" />}
            label="Missing SDS"
            value={expStats.missingSds.length}
            tone={expStats.missingSds.length ? 'warning' : 'good'}
          />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink-800 dark:text-ink-100">Computational</h3>
          <Link to="/computational" className="flex items-center gap-1 text-xs font-medium text-pearl-700 hover:underline dark:text-pearl-300">
            Open Computational <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="card grid grid-cols-2 divide-y divide-ink-100 p-0 sm:grid-cols-3 md:grid-cols-5 sm:divide-x sm:divide-y-0 dark:divide-ink-800">
          <Kpi icon={<Database className="h-4 w-4" />} label="Active" value={compStats.byStatus.get('active') ?? 0} />
          <Kpi icon={<Database className="h-4 w-4" />} label="Running" value={compStats.byStatus.get('running') ?? 0} />
          <Kpi icon={<Database className="h-4 w-4" />} label="Complete" value={compStats.byStatus.get('complete') ?? 0} />
          <Kpi
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Failed"
            value={compStats.byStatus.get('failed') ?? 0}
            tone={compStats.failed.length ? 'critical' : 'good'}
          />
          <Kpi
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Stale (90d+)"
            value={compStats.stale.length}
            tone={compStats.stale.length ? 'warning' : 'good'}
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="card p-4">
          <h3 className="mb-1 text-sm font-bold text-ink-800 dark:text-ink-100">Who's doing what</h3>
          <p className="mb-3 text-xs text-ink-500 dark:text-ink-400">
            Chemicals/assets attributed to each member, plus activity-log actions in the last 30 days.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-400">
                  <th className="pb-2 font-medium">Member</th>
                  <th className="pb-2 font-medium">Chemicals</th>
                  <th className="pb-2 font-medium">Assets</th>
                  <th className="pb-2 font-medium">Active (30d)</th>
                  <th className="pb-2 font-medium">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {memberRows.map((row) => (
                  <tr key={row.member.id}>
                    <td className="py-1.5 pr-2 font-medium text-ink-800 dark:text-ink-100">{row.member.full_name}</td>
                    <td className="py-1.5 pr-2 text-ink-600 dark:text-ink-300">{row.chemicalsOwned}</td>
                    <td className="py-1.5 pr-2 text-ink-600 dark:text-ink-300">{row.assetsCreated}</td>
                    <td className="py-1.5 pr-2 text-ink-600 dark:text-ink-300">{row.activityCount}</td>
                    <td className="py-1.5 text-xs text-ink-400">
                      {row.lastActive ? formatRelative(row.lastActive) : 'no activity yet'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-ink-800 dark:text-ink-100">
            <Activity className="h-4 w-4" /> Most active (30d)
          </h3>
          <BarList data={topActive} emptyLabel="Nobody's logged activity in the last 30 days." />
        </div>
      </section>

      <section className="card p-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-ink-800 dark:text-ink-100">
          <BookOpen className="h-4 w-4" /> Publications by project
        </h3>
        <p className="mb-3 text-xs text-ink-500 dark:text-ink-400">
          Research assets tagged type "publication," grouped by project. Counted by their actual status — there's no
          separate submitted/published stage tracked yet.
        </p>
        {publications.length === 0 ? (
          <p className="text-xs text-ink-400">No publications tracked yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-400">
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 font-medium">Total</th>
                  <th className="pb-2 font-medium">By status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {publications.map((group) => (
                  <tr key={group.project}>
                    <td className="py-1.5 pr-2 font-medium text-ink-800 dark:text-ink-100">{group.project}</td>
                    <td className="py-1.5 pr-2 text-ink-600 dark:text-ink-300">{group.total}</td>
                    <td className="py-1.5 text-xs text-ink-500 dark:text-ink-400">
                      {Object.entries(group.byStatus)
                        .map(([status, count]) => `${status} (${count})`)
                        .join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
