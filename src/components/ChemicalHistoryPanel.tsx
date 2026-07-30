import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { ChemicalHistoryEntry } from '../lib/types'
import { formatRelative } from '../lib/utils'
import { Spinner } from './ui'

function formatFieldName(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * A real before/after view — populated entirely by a database trigger on
 * every chemicals UPDATE, so it can never drift from what actually
 * happened and there's no client-side diffing logic to get wrong.
 */
export function ChemicalHistoryPanel({ chemicalId }: { chemicalId: string }) {
  const [entries, setEntries] = useState<ChemicalHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    api
      .listChemicalHistory(chemicalId)
      .then((rows) => live && setEntries(rows))
      .catch(() => live && setEntries([]))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [chemicalId])

  if (loading) {
    return (
      <div className="py-3">
        <Spinner className="h-4 w-4 text-ink-400" />
      </div>
    )
  }

  if (entries.length === 0) {
    return <p className="text-sm text-ink-500">No changes recorded yet — this fills in as the record gets edited.</p>
  }

  return (
    <ul className="space-y-2">
      {entries.map((entry) => {
        const fields = Object.entries(entry.diff)
        return (
          <li key={entry.id} className="rounded-lg border border-ink-200 p-2.5 dark:border-ink-800">
            <p className="text-xs font-semibold text-ink-700 dark:text-ink-200">
              {entry.changed_by_name ?? 'Unknown'} <span className="font-normal text-ink-400">{formatRelative(entry.changed_at)}</span>
            </p>
            <ul className="mt-1.5 space-y-1">
              {fields.map(([key, change]) => (
                <li key={key} className="text-xs">
                  <span className="font-medium text-ink-600 dark:text-ink-300">{formatFieldName(key)}: </span>
                  <span className="text-rose-500 line-through">{formatValue(change.old)}</span>
                  {' → '}
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatValue(change.new)}</span>
                </li>
              ))}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}
