import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileWarning,
  PlayCircle,
  Server,
} from 'lucide-react'
import { BarList } from '../components/charts'
import { PageHeader } from '../components/Layout'
import { EmptyState, LoadingScreen, SearchInput } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { privateResearchAssets } from '../lib/researchAssetPrivacy'
import type { ResearchAsset, ResearchAssetStatus } from '../lib/types'
import { cx, download, formatDate } from '../lib/utils'

function daysSince(date: string | null) {
  if (!date) return Number.POSITIVE_INFINITY
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
}

function tally(rows: ResearchAsset[], get: (asset: ResearchAsset) => string | null, limit = 8) {
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

function textFor(asset: ResearchAsset) {
  return [asset.metrics, asset.notes, asset.description, asset.access_notes].filter(Boolean).join('\n')
}

function finalEnergy(asset: ResearchAsset) {
  const text = textFor(asset)
  const match =
    text.match(/final energy:\s*(-?\d+(?:\.\d+)?)/i) ||
    text.match(/parsed energies:\s*(-?\d+(?:\.\d+)?)/i) ||
    text.match(/scf done:\s*e\([^)]+\)\s*=\s*(-?\d+(?:\.\d+)?)/i) ||
    text.match(/total energy\s*=\s*(-?\d+(?:\.\d+)?)/i)
  return match?.[1] ?? null
}

function warningText(asset: ResearchAsset) {
  const text = textFor(asset)
  const warnings = [
    /warning/i.test(text) ? 'warning' : null,
    /error/i.test(text) || asset.status === 'failed' ? 'error' : null,
    /imaginary/i.test(text) ? 'imaginary frequency' : null,
    daysSince(asset.last_verified_at) > 30 && asset.status === 'running' ? 'stale running job' : null,
    !asset.output_link && !asset.external_path && !asset.storage_link ? 'missing path' : null,
  ].filter(Boolean)
  return [...new Set(warnings)].join(', ')
}

function statusTone(status: ResearchAssetStatus) {
  if (status === 'complete') return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300'
  if (status === 'failed') return 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300'
  if (status === 'running') return 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300'
  return 'bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300'
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export default function ComputationalJobsPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [assets, setAssets] = useState<ResearchAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<ResearchAssetStatus | 'all'>('all')

  useEffect(() => {
    api
      .listResearchAssets()
      .then((rows) => setAssets(privateResearchAssets(rows, profile).filter((row) => row.type === 'simulation')))
      .catch(() => setAssets([]))
      .finally(() => setLoading(false))
  }, [profile])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return assets
      .filter((asset) => status === 'all' || asset.status === status)
      .filter((asset) => {
        if (!needle) return true
        return [
          asset.title,
          asset.project,
          asset.software,
          asset.method,
          asset.external_path,
          asset.storage_link,
          asset.notes,
        ].some((value) => value?.toLowerCase().includes(needle))
      })
      .sort((a, b) => {
        const toneA = a.status === 'failed' ? 0 : a.status === 'running' ? 1 : 2
        const toneB = b.status === 'failed' ? 0 : b.status === 'running' ? 1 : 2
        return toneA - toneB || (b.last_verified_at ?? '').localeCompare(a.last_verified_at ?? '')
      })
  }, [assets, q, status])

  const data = useMemo(() => {
    const failed = assets.filter((asset) => asset.status === 'failed')
    const running = assets.filter((asset) => asset.status === 'running')
    const staleRunning = running.filter((asset) => daysSince(asset.last_verified_at) > 30)
    const complete = assets.filter((asset) => asset.status === 'complete')
    const warned = assets.filter((asset) => warningText(asset))
    return {
      failed,
      running,
      staleRunning,
      complete,
      warned,
      software: tally(assets, (asset) => asset.software ?? 'Unknown'),
      methods: tally(assets, (asset) => asset.method ?? 'Unknown'),
      projects: tally(assets, (asset) => asset.project ?? 'Unassigned'),
    }
  }, [assets])

  function exportCsv() {
    const header = ['title', 'project', 'software', 'method', 'status', 'final_energy', 'warnings', 'path', 'last_verified']
    const body = rows.map((asset) => [
      asset.title,
      asset.project,
      asset.software,
      asset.method,
      asset.status,
      finalEnergy(asset),
      warningText(asset),
      asset.external_path || asset.storage_link || asset.output_link,
      asset.last_verified_at,
    ])
    download('pearl-computational-jobs.csv', [header, ...body].map((line) => line.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8')
  }

  if (loading) return <LoadingScreen label="Reading calculation jobs..." />

  return (
    <>
      <PageHeader
        title="Job Monitor"
        description="Private view of your imported calculations: status, final energies, warnings, stale runs, and cleanup targets."
        actions={
          <>
            <button className="btn-secondary" onClick={() => navigate('/computational/hpc-sync')}>
              <Server className="h-4 w-4" /> Sync HPC
            </button>
            <button className="btn-primary" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4" /> Export jobs
            </button>
          </>
        }
      />

      {assets.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Database className="h-6 w-6" />}
            title="No calculation jobs yet"
            description="Import simulations from Linux/HPC Sync, or add simulation assets manually."
            action={
              <button className="btn-primary" onClick={() => navigate('/computational/hpc-sync')}>
                <Server className="h-4 w-4" /> Open HPC Sync
              </button>
            }
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card grid grid-cols-2 divide-y divide-ink-100 p-0 md:grid-cols-5 md:divide-x md:divide-y-0 dark:divide-ink-800">
            <Kpi icon={<Database className="h-4 w-4" />} label="Jobs" value={assets.length} />
            <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Complete" value={data.complete.length} tone="good" />
            <Kpi icon={<PlayCircle className="h-4 w-4" />} label="Running" value={data.running.length} tone="info" />
            <Kpi icon={<FileWarning className="h-4 w-4" />} label="Failed" value={data.failed.length} tone="bad" />
            <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Needs review" value={data.warned.length + data.staleRunning.length} tone="warn" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
            <section className="card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">Calculation queue</h2>
                  <p className="mt-1 text-xs text-ink-500">Failures and running jobs stay at the top.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'running', 'complete', 'failed', 'archived'] as const).map((value) => (
                    <button
                      key={value}
                      className={cx('rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize', status === value ? 'border-pearl-600 bg-pearl-600 text-white' : 'border-ink-200 text-ink-600 hover:bg-ink-50 dark:border-ink-800 dark:text-ink-300 dark:hover:bg-ink-900')}
                      onClick={() => setStatus(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-3 max-w-lg">
                <SearchInput value={q} onChange={setQ} placeholder="Search title, project, software, method, path..." />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px]">
                  <thead className="border-b border-ink-200 text-left text-xs text-ink-400 dark:border-ink-800">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Job</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Method</th>
                      <th className="py-2 pr-3 font-medium">Energy</th>
                      <th className="py-2 pr-3 font-medium">Review</th>
                      <th className="py-2 font-medium">Verified</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                    {rows.slice(0, 80).map((asset) => (
                      <tr key={asset.id} className="hover:bg-ink-50 dark:hover:bg-ink-900/60">
                        <td className="max-w-[22rem] py-2.5 pr-3">
                          <p className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">{asset.title}</p>
                          <p className="truncate text-xs text-ink-500">{asset.project || 'Unassigned'} - {asset.external_path || asset.storage_link || 'No path'}</p>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className={cx('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1', statusTone(asset.status))}>{asset.status}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-ink-500">{[asset.software, asset.method].filter(Boolean).join(' / ') || '-'}</td>
                        <td className="py-2.5 pr-3 font-mono text-xs text-ink-600 dark:text-ink-300">{finalEnergy(asset) ?? '-'}</td>
                        <td className="max-w-[13rem] truncate py-2.5 pr-3 text-xs text-ink-500">{warningText(asset) || 'OK'}</td>
                        <td className="py-2.5 text-xs text-ink-500">{asset.last_verified_at ? formatDate(asset.last_verified_at) : 'Never'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="space-y-4">
              <section className="card p-4">
                <h2 className="mb-3 text-sm font-bold text-ink-900 dark:text-ink-50">Software</h2>
                <BarList data={data.software} emptyLabel="No software recorded" />
              </section>
              <section className="card p-4">
                <h2 className="mb-3 text-sm font-bold text-ink-900 dark:text-ink-50">Methods</h2>
                <BarList data={data.methods} emptyLabel="No methods recorded" />
              </section>
              <section className="card p-4">
                <h2 className="mb-3 text-sm font-bold text-ink-900 dark:text-ink-50">Projects</h2>
                <BarList data={data.projects} emptyLabel="No projects recorded" />
              </section>
            </aside>
          </div>
        </div>
      )}
    </>
  )
}

function Kpi({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode
  label: string
  value: number
  tone?: 'default' | 'good' | 'info' | 'bad' | 'warn'
}) {
  const toneClass = {
    default: 'text-ink-900 dark:text-ink-50',
    good: 'text-emerald-700 dark:text-emerald-300',
    info: 'text-sky-700 dark:text-sky-300',
    bad: 'text-rose-700 dark:text-rose-300',
    warn: 'text-amber-700 dark:text-amber-300',
  }[tone]
  return (
    <div className="flex min-h-[108px] items-center gap-3 px-5 py-4">
      <span className={toneClass}>{icon}</span>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
        <p className={cx('mt-1 text-2xl font-bold leading-none tabular-nums', toneClass)}>{value}</p>
      </div>
    </div>
  )
}
