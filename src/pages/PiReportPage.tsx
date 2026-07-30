import { useEffect, useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { LoadingScreen } from '../components/ui'
import { useInventory } from '../context/InventoryContext'
import { api } from '../lib/api'
import { LAB_NAME, LAB_SUBTITLE } from '../lib/config'
import { computeProjectHealth, PROJECT_HEALTH_LABEL } from '../lib/projectHealth'
import { rollupPublications } from '../lib/publicationRollup'
import {
  PROJECT_STATUS_LABEL,
  type Profile,
  type Project,
  type ProjectMember,
  type ProjectUpdate,
  type ResearchAsset,
} from '../lib/types'
import { formatDate, todayISO } from '../lib/utils'

const DAY_MS = 86_400_000

/**
 * The whole point: everything below already exists once Features 1–7 are
 * in place, so this is purely a compiled read of the same data — no new
 * tracking, no new state. "Print" is the export mechanism (Cmd/Ctrl+P →
 * Save as PDF) rather than a bundled PDF library, which keeps this to a
 * page of straightforward queries instead of a new dependency.
 */
export default function PiReportPage() {
  const { chemicals } = useInventory()
  const [projects, setProjects] = useState<Project[]>([])
  const [members, setMembers] = useState<Profile[]>([])
  const [assignments, setAssignments] = useState<ProjectMember[]>([])
  const [updates, setUpdates] = useState<ProjectUpdate[]>([])
  const [assets, setAssets] = useState<ResearchAsset[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.listProjects(),
      api.listProfiles(),
      api.listAllProjectMembers(),
      api.listRecentProjectUpdates(500),
      api.listResearchAssets(),
    ])
      .then(([p, m, a, u, r]) => {
        setProjects(p)
        setMembers(m.filter((row) => row.approved))
        setAssignments(a)
        setUpdates(u)
        setAssets(r)
      })
      .finally(() => setLoading(false))
  }, [])

  const latestUpdateByProject = useMemo(() => {
    const map = new Map<string, ProjectUpdate>()
    for (const u of updates) {
      const existing = map.get(u.project_id)
      if (!existing || u.created_at > existing.created_at) map.set(u.project_id, u)
    }
    return map
  }, [updates])

  const projectRows = useMemo(
    () =>
      projects.map((p) => {
        const latest = latestUpdateByProject.get(p.id)
        const daysSince = latest ? Math.floor((Date.now() - new Date(latest.created_at).getTime()) / DAY_MS) : Infinity
        return { project: p, health: computeProjectHealth(p, daysSince) }
      }),
    [projects, latestUpdateByProject],
  )

  const workloadByMember = useMemo(() => {
    const activeProjectIds = new Set(projects.filter((p) => p.status === 'active').map((p) => p.id))
    const map = new Map<string, number>()
    for (const a of assignments) {
      if (activeProjectIds.has(a.project_id)) map.set(a.profile_id, (map.get(a.profile_id) ?? 0) + 1)
    }
    return map
  }, [projects, assignments])

  const inventoryStats = useMemo(() => {
    const active = chemicals.filter((c) => c.status === 'active')
    const low = chemicals.filter((c) => c.status === 'low')
    const stocked = [...active, ...low]
    const soon = new Date(Date.now() + 90 * DAY_MS)
    const expiring = stocked.filter((c) => c.expiry_date && new Date(c.expiry_date) <= soon)
    const missingSds = stocked.filter((c) => !c.sds_url)
    return { active: active.length, low: low.length, expiring: expiring.length, missingSds: missingSds.length }
  }, [chemicals])

  const compStats = useMemo(() => {
    const byStatus = new Map<string, number>()
    for (const a of assets) byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1)
    const staleBefore = new Date(Date.now() - 90 * DAY_MS)
    const stale = assets.filter((a) => (a.status === 'active' || a.status === 'running') && new Date(a.updated_at) <= staleBefore)
    return { byStatus, stale: stale.length }
  }, [assets])

  const publications = useMemo(() => rollupPublications(assets), [assets])

  if (loading) return <LoadingScreen label="Compiling report…" />

  return (
    <div className="mx-auto max-w-3xl text-ink-900 dark:text-ink-100">
      <div className="no-print mb-6 flex justify-end">
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </button>
      </div>

      <header className="mb-6 border-b border-ink-300 pb-4 dark:border-ink-700">
        <h1 className="text-2xl font-bold">{LAB_NAME} — PI Report</h1>
        <p className="text-sm text-ink-500 dark:text-ink-400">{LAB_SUBTITLE}</p>
        <p className="mt-1 text-xs text-ink-400">Generated {formatDate(todayISO())}</p>
      </header>

      <section className="mb-6">
        <h2 className="mb-2 text-base font-bold">Projects</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-300 text-left text-xs uppercase text-ink-500 dark:border-ink-700">
              <th className="py-1 pr-2">Name</th>
              <th className="py-1 pr-2">Workspace</th>
              <th className="py-1 pr-2">Status</th>
              <th className="py-1 pr-2">Health</th>
              <th className="py-1">Target date</th>
            </tr>
          </thead>
          <tbody>
            {projectRows.map(({ project, health }) => (
              <tr key={project.id} className="border-b border-ink-100 dark:border-ink-800">
                <td className="py-1 pr-2 font-medium">{project.name}</td>
                <td className="py-1 pr-2 capitalize">{project.workspace}</td>
                <td className="py-1 pr-2">{PROJECT_STATUS_LABEL[project.status]}</td>
                <td className="py-1 pr-2">{PROJECT_HEALTH_LABEL[health]}</td>
                <td className="py-1">{project.target_date ? formatDate(project.target_date) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-base font-bold">Member roster</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-300 text-left text-xs uppercase text-ink-500 dark:border-ink-700">
              <th className="py-1 pr-2">Name</th>
              <th className="py-1 pr-2">Role</th>
              <th className="py-1 pr-2">Position</th>
              <th className="py-1">Active projects</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-ink-100 dark:border-ink-800">
                <td className="py-1 pr-2 font-medium">{m.full_name}</td>
                <td className="py-1 pr-2 capitalize">{m.role}</td>
                <td className="py-1 pr-2">{m.lab_position || '—'}</td>
                <td className="py-1">{workloadByMember.get(m.id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-base font-bold">Inventory &amp; computational snapshot</h2>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-ink-400">In stock</p><p className="font-bold">{inventoryStats.active}</p></div>
          <div><p className="text-xs text-ink-400">Running low</p><p className="font-bold">{inventoryStats.low}</p></div>
          <div><p className="text-xs text-ink-400">Expiring (90d)</p><p className="font-bold">{inventoryStats.expiring}</p></div>
          <div><p className="text-xs text-ink-400">Missing SDS</p><p className="font-bold">{inventoryStats.missingSds}</p></div>
          <div><p className="text-xs text-ink-400">Comp. active</p><p className="font-bold">{compStats.byStatus.get('active') ?? 0}</p></div>
          <div><p className="text-xs text-ink-400">Comp. running</p><p className="font-bold">{compStats.byStatus.get('running') ?? 0}</p></div>
          <div><p className="text-xs text-ink-400">Comp. failed</p><p className="font-bold">{compStats.byStatus.get('failed') ?? 0}</p></div>
          <div><p className="text-xs text-ink-400">Comp. stale (90d+)</p><p className="font-bold">{compStats.stale}</p></div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-base font-bold">Publications</h2>
        {publications.length === 0 ? (
          <p className="text-sm text-ink-400">None tracked yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-300 text-left text-xs uppercase text-ink-500 dark:border-ink-700">
                <th className="py-1 pr-2">Project</th>
                <th className="py-1 pr-2">Total</th>
                <th className="py-1">By status</th>
              </tr>
            </thead>
            <tbody>
              {publications.map((g) => (
                <tr key={g.project} className="border-b border-ink-100 dark:border-ink-800">
                  <td className="py-1 pr-2 font-medium">{g.project}</td>
                  <td className="py-1 pr-2">{g.total}</td>
                  <td className="py-1">{Object.entries(g.byStatus).map(([s, c]) => `${s} (${c})`).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
