import { useEffect, useState } from 'react'
import {
  Activity as ActivityIcon,
  FilePlus2,
  FileX2,
  PackagePlus,
  Pencil,
  ShieldCheck,
  Upload,
  UserPlus,
} from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { EmptyState, LoadingScreen } from '../components/ui'
import { api } from '../lib/api'
import type { ActivityAction, ActivityEntry } from '../lib/types'
import { formatRelative } from '../lib/utils'

const ICON: Record<ActivityAction, typeof Pencil> = {
  created: FilePlus2,
  updated: Pencil,
  deleted: FileX2,
  marked_empty: FileX2,
  restocked: PackagePlus,
  imported: Upload,
  signed_up: UserPlus,
  invited: UserPlus,
  role_changed: ShieldCheck,
}

export default function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listActivity(200)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingScreen label="Loading the audit trail…" />

  return (
    <>
      <PageHeader
        title="Activity"
        description="An append-only record of every change, so the group can always answer “who moved that bottle?”"
      />

      {error ? (
        <EmptyState icon={<ActivityIcon className="h-6 w-6" />} title="Could not load the log" description={error} />
      ) : entries.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ActivityIcon className="h-6 w-6" />}
            title="No activity yet"
            description="Entries appear here as people add, edit and finish containers."
          />
        </div>
      ) : (
        <div className="card divide-y divide-ink-100 dark:divide-ink-800">
          {entries.map((e) => {
            const Icon = ICON[e.action] ?? Pencil
            return (
              <div key={e.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 rounded-lg bg-ink-100 p-1.5 text-ink-500 dark:bg-ink-800 dark:text-ink-400">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-800 dark:text-ink-100">{e.details}</p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {e.user_name ?? 'Someone'} · {formatRelative(e.created_at)}
                  </p>
                </div>
                <span className="hidden shrink-0 text-xs text-ink-400 sm:block">
                  {e.action.replace('_', ' ')}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
