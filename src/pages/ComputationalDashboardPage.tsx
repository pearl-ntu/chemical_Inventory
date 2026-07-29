import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, BookMarked, Check, Database, Link2, ListChecks, Plus, Server, Tags } from 'lucide-react'
import { BarList, Timeline } from '../components/charts'
import { PageHeader } from '../components/Layout'
import { EmptyState, LoadingScreen } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { privateResearchAssets } from '../lib/researchAssetPrivacy'
import type { ResearchAsset, ResearchAssetChemicalLink } from '../lib/types'
import { cx, formatDate } from '../lib/utils'

function daysSince(date: string | null) {
  if (!date) return Number.POSITIVE_INFINITY
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
}

function keyFor(asset: ResearchAsset) {
  return asset.title.toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_\-\s]+/g, ' ').trim()
}

function tally(rows: ResearchAsset[], get: (a: ResearchAsset) => string | null, limit = 8) {
  const map = new Map<string, number>()
  for (const row of rows) {
    const key = get(row)
    if (!key) continue
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, value]) => ({ label, value }))
}

export default function ComputationalDashboardPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [assets, setAssets] = useState<ResearchAsset[]>([])
  const [links, setLinks] = useState<ResearchAssetChemicalLink[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.listResearchAssets(), api.listResearchAssetChemicalLinks()])
      .then(([assetRows, linkRows]) => {
        const privateRows = privateResearchAssets(assetRows, profile)
        const privateIds = new Set(privateRows.map((row) => row.id))
        setAssets(privateRows)
        setLinks(linkRows.filter((link) => privateIds.has(link.research_asset_id)))
      })
      .catch(() => {
        setAssets([])
        setLinks([])
      })
      .finally(() => setLoading(false))
  }, [profile])

  const stats = useMemo(() => {
    const linked = new Set(links.map((link) => link.research_asset_id))
    const missingDescription = assets.filter((asset) => !(asset.description || asset.notes))
    const missingTags = assets.filter((asset) => !asset.tags || asset.tags.length === 0)
    const missingChemical = assets.filter((asset) => !asset.related_chemical_id && !linked.has(asset.id))
    const stale = assets.filter((asset) => daysSince(asset.last_verified_at) > 90)
    const duplicateMap = new Map<string, ResearchAsset[]>()
    for (const asset of assets.filter((a) => a.type === 'dataset')) {
      const key = keyFor(asset)
      duplicateMap.set(key, [...(duplicateMap.get(key) ?? []), asset])
    }
    const duplicates = [...duplicateMap.values()].filter((rows) => rows.length > 1)
    const byMonth = new Map<string, number>()
    for (const asset of assets) {
      const month = asset.created_at.slice(0, 7)
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1)
    }
    return {
      datasets: assets.filter((a) => a.type === 'dataset'),
      models: assets.filter((a) => a.type === 'model'),
      simulations: assets.filter((a) => a.type === 'simulation'),
      failedJobs: assets.filter((a) => a.type === 'simulation' && a.status === 'failed'),
      runningJobs: assets.filter((a) => a.type === 'simulation' && a.status === 'running'),
      duplicates,
      missingDescription,
      missingTags,
      missingChemical,
      stale,
      attention: [...new Set([...duplicates.flat(), ...missingDescription, ...missingTags, ...missingChemical, ...stale])],
      sources: tally(assets, (a) => a.source ?? 'manual'),
      owners: tally(assets, (a) => a.owner),
      timeline: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => ({
        label: new Date(k + '-01T00:00:00').toLocaleDateString('en-SG', { month: 'short', year: '2-digit' }),
        value,
      })),
    }
  }, [assets, links])

  if (loading) return <LoadingScreen label="Opening computational suite..." />

  if (assets.length === 0) {
    return (
      <>
        <PageHeader title="Computational Dashboard" description="Datasets, models, simulations, code, notebooks, and storage pointers." />
        <div className="card">
          <EmptyState
            icon={<Database className="h-6 w-6" />}
            title="Start the computational registry"
            description="Add a dataset, model, simulation or code asset. Store the link and metadata here, not the raw files."
            action={
              <button className="btn-primary" onClick={() => navigate('/research-assets')}>
                <Plus className="h-4 w-4" /> Add first asset
              </button>
            }
          />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Computational Dashboard"
        description="Your private computational records, cleanup queue, and reusable metadata health."
        actions={
          <>
            <button className="btn-secondary" onClick={() => navigate('/computational/storage')}>
              <Server className="h-4 w-4" /> Linux/HPC Sync
            </button>
            <button className="btn-secondary" onClick={() => navigate('/computational/jobs')}>
              <ListChecks className="h-4 w-4" /> Job Monitor
            </button>
            <button className="btn-secondary" onClick={() => navigate('/computational/protocols')}>
              <BookMarked className="h-4 w-4" /> Methods
            </button>
            <button className="btn-primary" onClick={() => navigate('/research-assets')}>
              <Plus className="h-4 w-4" /> Add asset
            </button>
          </>
        }
      />

      <div className="card grid grid-cols-2 divide-y divide-ink-100 p-0 sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-ink-800">
        <Kpi label="Assets" value={assets.length} sub="indexed records" />
        <Kpi label="Datasets" value={stats.datasets.length} sub="metadata pointers" />
        <Kpi label="Simulations" value={stats.simulations.length} sub={`${stats.runningJobs.length} running, ${stats.failedJobs.length} failed`} tone={stats.failedJobs.length ? 'warning' : 'default'} />
        <Kpi label="Needs attention" value={stats.attention.length} sub="cleanup queue" tone={stats.attention.length ? 'warning' : 'good'} />
      </div>

      <section className="mt-4">
        {stats.attention.length === 0 ? (
          <div className="card flex items-start gap-3 border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/5">
            <Check className="mt-0.5 h-5 w-5 text-emerald-600" />
            <div>
              <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Computational registry looks healthy</p>
              <p className="text-xs text-emerald-700/80 dark:text-emerald-300/70">No stale, untagged, unlinked or duplicate dataset records flagged.</p>
            </div>
          </div>
        ) : (
          <button
            className="card flex w-full items-start gap-3 border-amber-200 bg-amber-50/60 p-4 text-left hover:bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/5"
            onClick={() => navigate('/computational/analytics')}
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" />
            <div>
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">{stats.attention.length} computational records need a look</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Chip icon={<Database className="h-3 w-3" />} label={`${stats.duplicates.length} duplicate groups`} />
                <Chip icon={<Tags className="h-3 w-3" />} label={`${stats.missingTags.length} no tags`} />
                <Chip icon={<Link2 className="h-3 w-3" />} label={`${stats.missingChemical.length} no chemical link`} />
                <Chip icon={<AlertTriangle className="h-3 w-3" />} label={`${stats.stale.length} stale`} />
              </div>
            </div>
          </button>
        )}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-bold text-ink-900 dark:text-ink-50">Coverage</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <BarList data={stats.sources} emptyLabel="No sources recorded" />
            <BarList data={stats.owners} emptyLabel="No owners recorded" />
          </div>
        </section>
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-bold text-ink-900 dark:text-ink-50">Assets added over time</h2>
          <Timeline points={stats.timeline} height={190} />
        </section>
      </div>

      <section className="card mt-4 p-4">
        <h2 className="mb-3 text-sm font-bold text-ink-900 dark:text-ink-50">Cleanup queue</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-ink-200 text-left text-xs text-ink-400 dark:border-ink-800">
              <tr>
                <th className="py-2 pr-3 font-medium">Asset</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Owner</th>
                <th className="py-2 pr-3 font-medium">Reason</th>
                <th className="py-2 font-medium">Verified</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {stats.attention.slice(0, 12).map((asset) => (
                <tr key={asset.id} className="cursor-pointer hover:bg-ink-50 dark:hover:bg-ink-800/50" onClick={() => navigate('/research-assets')}>
                  <td className="max-w-[18rem] truncate py-2.5 pr-3 text-sm font-medium text-ink-900 dark:text-ink-50">{asset.title}</td>
                  <td className="py-2.5 pr-3 text-xs text-ink-500">{asset.type}</td>
                  <td className="py-2.5 pr-3 text-xs text-ink-500">{asset.owner ?? '-'}</td>
                  <td className="py-2.5 pr-3 text-xs text-ink-500">{reason(asset, links)}</td>
                  <td className="py-2.5 text-xs text-ink-500">{asset.last_verified_at ? formatDate(asset.last_verified_at) : 'Never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function Kpi({ label, value, sub, tone = 'default' }: { label: string; value: number; sub: string; tone?: 'default' | 'good' | 'warning' }) {
  const color = tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : tone === 'warning' ? 'text-amber-700 dark:text-amber-400' : 'text-ink-900 dark:text-ink-50'
  return (
    <div className="flex min-h-[110px] flex-col justify-center px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className={cx('mt-1.5 text-[22px] font-bold leading-none tabular-nums', color)}>{value}</p>
      <p className="mt-1.5 truncate text-xs text-ink-500">{sub}</p>
    </div>
  )
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">{icon}{label}</span>
}

function reason(asset: ResearchAsset, links: ResearchAssetChemicalLink[]) {
  if (daysSince(asset.last_verified_at) > 90) return 'Needs verification'
  if (!asset.tags || asset.tags.length === 0) return 'No tags'
  if (!(asset.description || asset.notes)) return 'No description'
  if (!asset.related_chemical_id && !links.some((link) => link.research_asset_id === asset.id)) return 'No chemical link'
  return 'Possible duplicate'
}
