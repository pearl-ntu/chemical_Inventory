import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Database, FlaskConical, Link2, Search, Users } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { EmptyState, LoadingScreen, SearchInput } from '../components/ui'
import { useInventory } from '../context/InventoryContext'
import { api } from '../lib/api'
import type { Chemical, ResearchAsset } from '../lib/types'

function projectName(value: string | null | undefined) {
  return value?.trim() || 'Unassigned'
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n >= 10 || i === 0 ? n.toFixed(0) : n.toFixed(1)} ${units[i]}`
}

interface ProjectGroup {
  name: string
  chemicals: Chemical[]
  assets: ResearchAsset[]
  owners: string[]
  storageBytes: number
  missing: string[]
}

export default function ProjectMapPage() {
  const { chemicals, loading: inventoryLoading } = useInventory()
  const [assets, setAssets] = useState<ResearchAsset[]>([])
  const [loadingAssets, setLoadingAssets] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    api
      .listResearchAssets()
      .then(setAssets)
      .catch(() => setAssets([]))
      .finally(() => setLoadingAssets(false))
  }, [])

  const projects = useMemo<ProjectGroup[]>(() => {
    const names = new Set<string>()
    for (const chemical of chemicals) names.add(projectName(chemical.project))
    for (const asset of assets) names.add(projectName(asset.project))

    return [...names]
      .map((name) => {
        const projectChemicals = chemicals.filter((chemical) => projectName(chemical.project) === name)
        const projectAssets = assets.filter((asset) => projectName(asset.project) === name)
        const owners = [
          ...new Set(
            [
              ...projectChemicals.map((chemical) => chemical.owner),
              ...projectAssets.map((asset) => asset.owner),
            ]
              .map((value) => value?.trim())
              .filter((value): value is string => Boolean(value)),
          ),
        ].sort((a, b) => a.localeCompare(b))
        const missing = [
          projectChemicals.some((chemical) => !chemical.cas) ? 'CAS gaps' : null,
          projectChemicals.some((chemical) => !chemical.location) ? 'location gaps' : null,
          projectChemicals.some((chemical) => chemical.hazards.length === 0) ? 'hazard gaps' : null,
          projectAssets.some((asset) => !asset.storage_link && !asset.repo_link && !asset.output_link) ? 'asset link gaps' : null,
          projectAssets.some((asset) => !asset.last_verified_at) ? 'verification gaps' : null,
        ].filter((value): value is string => Boolean(value))
        return {
          name,
          chemicals: projectChemicals,
          assets: projectAssets,
          owners,
          storageBytes: projectAssets.reduce((sum, asset) => sum + (asset.size_bytes ?? 0), 0),
          missing,
        }
      })
      .filter((project) => {
        const needle = q.trim().toLowerCase()
        if (!needle) return true
        return [
          project.name,
          ...project.owners,
          ...project.chemicals.map((chemical) => chemical.name),
          ...project.assets.map((asset) => asset.title),
        ].some((value) => value.toLowerCase().includes(needle))
      })
      .sort((a, b) => (b.chemicals.length + b.assets.length) - (a.chemicals.length + a.assets.length))
  }, [assets, chemicals, q])

  if (inventoryLoading || loadingAssets) return <LoadingScreen label="Drawing project map..." />

  return (
    <>
      <PageHeader
        title="Project Map"
        description="Wet-lab chemicals, computational assets, owners, and cleanup gaps grouped by project."
      />

      <div className="mb-4 max-w-xl">
        <SearchInput value={q} onChange={setQ} placeholder="Search projects, people, chemicals, or assets..." />
      </div>

      {projects.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Search className="h-6 w-6" />} title="No project records found" />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {projects.map((project) => (
            <section key={project.name} className="card overflow-hidden">
              <div className="border-b border-ink-200 bg-ink-50 px-4 py-3 dark:border-ink-800 dark:bg-ink-950/50">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-bold text-ink-900 dark:text-ink-50">{project.name}</h2>
                    <p className="mt-1 text-xs text-ink-500">
                      {project.owners.length ? project.owners.join(', ') : 'No owner recorded'}
                    </p>
                  </div>
                  <span className="rounded-lg bg-pearl-50 px-2 py-1 text-xs font-semibold text-pearl-700 dark:bg-pearl-500/10 dark:text-pearl-200">
                    {project.chemicals.length + project.assets.length} records
                  </span>
                </div>
                {project.missing.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {project.missing.map((gap) => (
                      <span key={gap} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                        {gap}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-0 divide-y divide-ink-100 dark:divide-ink-800 md:grid-cols-3 md:divide-x md:divide-y-0">
                <Metric icon={<FlaskConical className="h-4 w-4" />} label="Chemicals" value={project.chemicals.length} />
                <Metric icon={<Database className="h-4 w-4" />} label="Assets" value={project.assets.length} />
                <Metric icon={<Link2 className="h-4 w-4" />} label="Storage" value={project.storageBytes ? formatBytes(project.storageBytes) : 'Unknown'} />
              </div>

              <div className="grid gap-4 p-4 md:grid-cols-2">
                <ListBlock title="Chemicals" empty="No chemicals linked" rows={project.chemicals.slice(0, 6).map((chemical) => ({
                  title: chemical.name,
                  detail: [chemical.code, chemical.location, chemical.owner].filter(Boolean).join(' - '),
                }))} />
                <ListBlock title="Computational assets" empty="No assets linked" rows={project.assets.slice(0, 6).map((asset) => ({
                  title: asset.title,
                  detail: [asset.type, asset.software, asset.status].filter(Boolean).join(' - '),
                }))} />
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="text-pearl-600">{icon}</span>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
        <p className="text-sm font-bold text-ink-900 dark:text-ink-50">{value}</p>
      </div>
    </div>
  )
}

function ListBlock({
  title,
  empty,
  rows,
}: {
  title: string
  empty: string
  rows: Array<{ title: string; detail: string }>
}) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
        <Users className="h-3.5 w-3.5" /> {title}
      </h3>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-200 px-3 py-4 text-center text-xs text-ink-400 dark:border-ink-800">
          {empty}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={`${row.title}:${row.detail}`} className="rounded-lg bg-ink-50 px-3 py-2 dark:bg-ink-900/50">
              <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{row.title}</p>
              <p className="mt-0.5 truncate text-xs text-ink-500">{row.detail || 'No detail'}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
