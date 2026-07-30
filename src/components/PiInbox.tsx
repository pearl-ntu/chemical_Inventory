import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Beaker, Database, ShoppingCart, UserCheck } from 'lucide-react'
import { useInventory } from '../context/InventoryContext'
import { api } from '../lib/api'
import type { ResearchAsset } from '../lib/types'
import { cx } from '../lib/utils'
import { EmptyState } from './ui'

interface InboxItem {
  key: string
  icon: ReactNode
  label: string
  count: number
  to: string
  urgency: 0 | 1 | 2 // 2 = most urgent
}

/**
 * "Needs your attention" — one list instead of five pages. Everything here
 * already exists elsewhere in the app; this just surfaces the counts and a
 * direct link, ranked by urgency, so the PI doesn't have to go looking.
 */
export function PiInbox({
  attentionProjects,
}: {
  attentionProjects: Array<{ id: string; name: string; health: 'red' | 'amber' }>
}) {
  const { chemicals } = useInventory()
  const [pendingRequests, setPendingRequests] = useState(0)
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [assets, setAssets] = useState<ResearchAsset[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.listChemicalRequests(), api.listProfiles(), api.listResearchAssets()])
      .then(([requests, profiles, r]) => {
        setPendingRequests(requests.filter((req) => req.status === 'pending').length)
        setPendingApprovals(profiles.filter((p) => !p.approved).length)
        setAssets(r)
      })
      .finally(() => setLoading(false))
  }, [])

  const orphanedChemicals = useMemo(
    () => chemicals.filter((c) => (c.status === 'active' || c.status === 'low') && !c.project?.trim()),
    [chemicals],
  )
  const orphanedAssets = useMemo(() => assets.filter((a) => a.status !== 'archived' && !a.project?.trim()), [assets])

  const redProjects = attentionProjects.filter((p) => p.health === 'red')
  const amberProjects = attentionProjects.filter((p) => p.health === 'amber')

  const items: InboxItem[] = [
    {
      key: 'requests',
      icon: <ShoppingCart className="h-4 w-4" />,
      label: 'Chemical purchase requests awaiting approval',
      count: pendingRequests,
      to: '/operations',
      urgency: 2 as const,
    },
    {
      key: 'approvals',
      icon: <UserCheck className="h-4 w-4" />,
      label: 'Members waiting for approval',
      count: pendingApprovals,
      to: '/members',
      urgency: 2 as const,
    },
    {
      key: 'red-projects',
      icon: <AlertTriangle className="h-4 w-4" />,
      label: 'Projects needing attention (red)',
      count: redProjects.length,
      to: '/pi-dashboard/projects',
      urgency: 2 as const,
    },
    {
      key: 'amber-projects',
      icon: <AlertTriangle className="h-4 w-4" />,
      label: 'Projects going stale (amber)',
      count: amberProjects.length,
      to: '/pi-dashboard/projects',
      urgency: 1 as const,
    },
    {
      key: 'orphaned-chemicals',
      icon: <Beaker className="h-4 w-4" />,
      label: 'Chemicals with no project tag',
      count: orphanedChemicals.length,
      to: '/project-map',
      urgency: 0 as const,
    },
    {
      key: 'orphaned-assets',
      icon: <Database className="h-4 w-4" />,
      label: 'Research assets with no project tag',
      count: orphanedAssets.length,
      to: '/project-map',
      urgency: 0 as const,
    },
  ]
    .filter((item) => item.count > 0)
    .sort((a, b) => b.urgency - a.urgency || b.count - a.count)

  if (loading) return null

  return (
    <section className="card p-4">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-ink-900 dark:text-ink-50">
        <AlertTriangle className="h-4 w-4 text-amber-500" /> Needs your attention
      </h2>
      {items.length === 0 ? (
        <EmptyState title="All clear" description="Nothing needs your attention right now." />
      ) : (
        <ul className="mt-2 divide-y divide-ink-100 dark:divide-ink-800">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                to={item.to}
                className="flex items-center gap-3 py-2.5 text-sm text-ink-700 transition-colors hover:text-pearl-700 dark:text-ink-200 dark:hover:text-pearl-300"
              >
                <span
                  className={cx(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                    item.urgency === 2
                      ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300'
                      : item.urgency === 1
                        ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300'
                        : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400',
                  )}
                >
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                <span className="badge bg-ink-100 text-ink-700 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-200">
                  {item.count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
