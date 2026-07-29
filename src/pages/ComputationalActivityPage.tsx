import { useEffect, useMemo, useState } from 'react'
import { Activity as ActivityIcon, Database, FilePlus2, FileX2, Pencil } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { EmptyState, LoadingScreen } from '../components/ui'
import { api } from '../lib/api'
import type { ActivityEntry } from '../lib/types'
import { formatRelative } from '../lib/utils'

function isResearchAssetEntry(entry: ActivityEntry) {
  return /research asset/i.test(entry.details ?? '')
}

export default function ComputationalActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listActivity(300)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  const researchEntries = useMemo(() => entries.filter(isResearchAssetEntry), [entries])

  if (loading) return <LoadingScreen label="Loading computational activity..." />

  return (
    <>
      <PageHeader
        title="Computational Activity"
        description="Changes to datasets, models, simulations, code, notebooks, and compute resources only."
      />

      {error ? (
        <EmptyState icon={<ActivityIcon className="h-6 w-6" />} title="Could not load the log" description={error} />
      ) : researchEntries.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Database className="h-6 w-6" />}
            title="No computational activity yet"
            description="Research asset changes will appear here separately from chemical inventory activity."
          />
        </div>
      ) : (
        <div className="card divide-y divide-ink-100 dark:divide-ink-800">
          {researchEntries.map((entry) => {
            const Icon = entry.action === 'deleted' ? FileX2 : entry.action === 'created' ? FilePlus2 : Pencil
            return (
              <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 rounded-lg bg-ink-100 p-1.5 text-ink-500 dark:bg-ink-800 dark:text-ink-400">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-800 dark:text-ink-100">{entry.details}</p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {entry.user_name ?? 'Someone'} - {formatRelative(entry.created_at)}
                  </p>
                </div>
                <span className="hidden shrink-0 text-xs text-ink-400 sm:block">
                  {entry.action.replace('_', ' ')}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
