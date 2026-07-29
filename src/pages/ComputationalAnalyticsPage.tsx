import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Database } from 'lucide-react'
import { BarList, Timeline } from '../components/charts'
import { PageHeader } from '../components/Layout'
import { EmptyState, LoadingScreen } from '../components/ui'
import { api } from '../lib/api'
import type { ResearchAsset, ResearchAssetChemicalLink, ResearchAssetVersion } from '../lib/types'
import { cx, formatDate } from '../lib/utils'

function tally(rows: ResearchAsset[], get: (asset: ResearchAsset) => string | null, limit = 10) {
  const map = new Map<string, number>()
  for (const row of rows) {
    const key = get(row)
    if (!key) continue
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }))
}

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

function monthLabel(month: string) {
  return new Date(month + '-01T00:00:00').toLocaleDateString('en-SG', {
    month: 'short',
    year: '2-digit',
  })
}

function duplicateKey(asset: ResearchAsset) {
  return asset.title
    .toLowerCase()
    .replace(/\.(csv|xlsx|h5|hdf5|chk|log|out|zip|tar|gz|pkl|pt|pth)$/i, '')
    .replace(/[_\-\s]+/g, ' ')
    .trim()
}

function duplicateConfidence(rows: ResearchAsset[]) {
  const checksums = rows.map((row) => row.checksum).filter(Boolean)
  if (checksums.length > 1 && new Set(checksums).size === 1) return 'high - same checksum'
  const sizes = rows.map((row) => row.size_bytes).filter((value): value is number => value != null)
  if (sizes.length > 1 && new Set(sizes).size === 1) return 'medium - same size'
  return 'possible - similar name'
}

function pct(done: number, total: number) {
  return total ? Math.round((done / total) * 100) : 100
}

function daysSince(date: string | null) {
  if (!date) return Number.POSITIVE_INFINITY
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
}

export default function ComputationalAnalyticsPage() {
  const navigate = useNavigate()
  const [assets, setAssets] = useState<ResearchAsset[]>([])
  const [links, setLinks] = useState<ResearchAssetChemicalLink[]>([])
  const [versions, setVersions] = useState<ResearchAssetVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.listResearchAssets(), api.listResearchAssetChemicalLinks(), api.listResearchAssetVersions()])
      .then(([assetRows, linkRows, versionRows]) => {
        setAssets(assetRows)
        setLinks(linkRows)
        setVersions(versionRows)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  const data = useMemo(() => {
    const datasets = assets.filter((asset) => asset.type === 'dataset')
    const totalBytes = assets.reduce((sum, asset) => sum + (asset.size_bytes ?? 0), 0)
    const byMonth = new Map<string, number>()
    for (const asset of assets) {
      const month = (asset.created_at || asset.updated_at).slice(0, 7)
      if (!month) continue
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1)
    }

    const duplicateGroups = new Map<string, ResearchAsset[]>()
    for (const asset of datasets) {
      const key = duplicateKey(asset)
      if (!key) continue
      duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), asset])
    }
    const duplicates = [...duplicateGroups.entries()]
      .map(([key, rows]) => ({ key, rows }))
      .filter((group) => group.rows.length > 1)
      .sort((a, b) => b.rows.length - a.rows.length)

    const linkedAssetIds = new Set(links.map((link) => link.research_asset_id))
    const versionedAssetIds = new Set(versions.map((version) => version.research_asset_id))
    const withDescription = assets.filter((asset) => asset.description || asset.notes).length
    const withTags = assets.filter((asset) => asset.tags?.length > 0).length
    const withChemical = assets.filter((asset) => asset.related_chemical_id || linkedAssetIds.has(asset.id)).length
    const withVersionHistory = assets.filter((asset) => versionedAssetIds.has(asset.id)).length
    const recentlyVerified = assets.filter((asset) => daysSince(asset.last_verified_at) <= 90).length
    const stale = assets.filter((asset) => daysSince(asset.last_verified_at) > 90)
    const missingDescription = assets.filter((asset) => !(asset.description || asset.notes))
    const missingTags = assets.filter((asset) => !asset.tags || asset.tags.length === 0)
    const missingLinks = assets.filter((asset) => !asset.storage_link && !asset.repo_link && !asset.output_link)
    const missingVersions = assets.filter((asset) => !versionedAssetIds.has(asset.id))
    const cleanup = [...new Map([...stale, ...missingDescription, ...missingTags, ...missingLinks, ...missingVersions].map((asset) => [asset.id, asset])).values()]

    return {
      datasets,
      totalBytes,
      sources: tally(assets, (asset) => asset.source ?? 'manual', 10),
      owners: tally(assets, (asset) => asset.owner, 10),
      types: tally(assets, (asset) => asset.type, 10),
      software: tally(assets, (asset) => asset.software, 10),
      duplicates,
      stale,
      missingDescription,
      missingTags,
      missingLinks,
      versionedAssetIds,
      cleanup,
      descriptionPct: pct(withDescription, assets.length),
      tagsPct: pct(withTags, assets.length),
      chemicalPct: pct(withChemical, assets.length),
      versionPct: pct(withVersionHistory, assets.length),
      verifiedPct: pct(recentlyVerified, assets.length),
      timeline: [...byMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, value]) => ({ label: monthLabel(label), value })),
    }
  }, [assets, links, versions])

  if (loading) return <LoadingScreen label="Building computational dashboard..." />

  return (
    <>
      <PageHeader
        title="Computational Analytics"
        description="Storage coverage, duplicate datasets, metadata quality, and cleanup queues for research assets."
        actions={
          <button className="btn-primary" onClick={() => navigate('/research-assets')}>
            <Database className="h-4 w-4" /> Open registry
          </button>
        }
      />

      {error ? (
        <div className="card">
          <EmptyState title="Could not load computational analytics" description={error} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card grid grid-cols-2 divide-y divide-ink-100 p-0 sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-ink-800">
            <Kpi label="Assets" value={assets.length} sub="tracked records" />
            <Kpi label="Datasets" value={data.datasets.length} sub="metadata only" />
            <Kpi label="Tracked storage" value={data.totalBytes ? formatBytes(data.totalBytes) : 'Unknown'} sub="from size fields" />
            <Kpi
              label="Duplicates"
              value={data.duplicates.length}
              sub={data.duplicates.length ? 'check before re-running' : 'none flagged'}
              tone={data.duplicates.length ? 'warning' : 'good'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <section className="card p-4">
              <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">Coverage</h2>
              <p className="mt-1 text-xs text-ink-500">Where computational assets live and who owns them.</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">By source</h3>
                  <BarList data={data.sources} emptyLabel="No sources recorded" />
                </div>
                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">By owner</h3>
                  <BarList data={data.owners} emptyLabel="No owners recorded" />
                </div>
              </div>
            </section>

            <section className="card p-4">
              <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">Data quality</h2>
              <p className="mt-1 text-xs text-ink-500">How easy these assets will be to reuse later.</p>
              <div className="mt-4 space-y-4">
                <ProgressRow label="Description" pct={data.descriptionPct} />
                <ProgressRow label="Tags" pct={data.tagsPct} />
                <ProgressRow label="Linked chemical" pct={data.chemicalPct} />
                <ProgressRow label="Version history" pct={data.versionPct} />
                <ProgressRow label="Verified within 90 days" pct={data.verifiedPct} />
              </div>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-bold text-ink-900 dark:text-ink-50">Duplicate dataset watch</h2>
              {data.duplicates.length === 0 ? (
                <CleanState text="No duplicate dataset names detected." />
              ) : (
                <div className="space-y-2">
                  {data.duplicates.slice(0, 8).map((group) => (
                    <div key={group.key} className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                      <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">{group.key}</p>
                      <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/75">
                        {group.rows.length} records: {duplicateConfidence(group.rows)}. Owners: {group.rows.map((asset) => asset.owner ?? 'Unknown').join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card p-4">
              <h2 className="mb-3 text-sm font-bold text-ink-900 dark:text-ink-50">Cleanup queue</h2>
              {data.cleanup.length === 0 ? (
                <CleanState text="Everything has enough metadata for now." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px]">
                    <thead className="border-b border-ink-200 text-left text-xs text-ink-400 dark:border-ink-800">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Asset</th>
                        <th className="py-2 pr-3 font-medium">Owner</th>
                        <th className="py-2 pr-3 font-medium">Reason</th>
                        <th className="py-2 font-medium">Verified</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                      {data.cleanup.slice(0, 12).map((asset) => (
                        <tr key={asset.id} className="text-sm">
                          <td className="max-w-[16rem] truncate py-2 pr-3 font-medium text-ink-900 dark:text-ink-50">{asset.title}</td>
                          <td className="py-2 pr-3 text-xs text-ink-500">{asset.owner ?? '-'}</td>
                          <td className="py-2 pr-3 text-xs text-ink-500">{cleanupReason(asset, data.versionedAssetIds)}</td>
                          <td className="py-2 text-xs text-ink-500">{asset.last_verified_at ? formatDate(asset.last_verified_at) : 'Never'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink-800 dark:text-ink-100">Asset types</h2>
              <BarList data={data.types} emptyLabel="No assets yet" />
            </section>
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink-800 dark:text-ink-100">Software</h2>
              <BarList data={data.software} emptyLabel="No software recorded" />
            </section>
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink-800 dark:text-ink-100">Assets added over time</h2>
              <Timeline points={data.timeline} height={180} />
            </section>
          </div>
        </div>
      )}
    </>
  )
}

function Kpi({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: string | number
  sub: string
  tone?: 'default' | 'good' | 'warning'
}) {
  const valueTone = {
    default: 'text-ink-900 dark:text-ink-50',
    good: 'text-emerald-700 dark:text-emerald-400',
    warning: 'text-amber-700 dark:text-amber-400',
  }[tone]
  return (
    <div className="flex min-h-[110px] flex-col justify-center px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className={cx('mt-1.5 text-[22px] font-bold leading-none tabular-nums', valueTone)}>
        {value}
      </p>
      <p className="mt-1.5 truncate text-xs text-ink-500 dark:text-ink-400">{sub}</p>
    </div>
  )
}

function ProgressRow({ label, pct }: { label: string; pct: number }) {
  const tone = pct >= 90 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm text-ink-600 dark:text-ink-300">{label}</span>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-800 dark:text-ink-100">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
        <div className={cx('h-full rounded-full', tone)} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  )
}

function CleanState({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <p className="text-sm text-emerald-900 dark:text-emerald-100">{text}</p>
    </div>
  )
}

function cleanupReason(asset: ResearchAsset, versionedAssetIds: Set<string>) {
  if (daysSince(asset.last_verified_at) > 90) return 'Needs verification'
  if (!(asset.description || asset.notes)) return 'No description'
  if (!asset.tags || asset.tags.length === 0) return 'No tags'
  if (!versionedAssetIds.has(asset.id)) return 'No version history'
  if (!asset.storage_link && !asset.repo_link && !asset.output_link) return 'No link'
  return 'Review'
}
