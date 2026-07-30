import { Link } from 'react-router-dom'
import { PROJECT_HEALTH_DOT, type computeProjectHealth } from '../lib/projectHealth'
import { PROJECT_STATUS_LABEL, type Project } from '../lib/types'
import { cx, formatDate } from '../lib/utils'

const DAY_MS = 86_400_000

/**
 * Not a Gantt tool — just enough to see what's due when across the whole
 * lab in one glance. Every row shares the same date scale (today → the
 * furthest target date among them), so position is directly comparable
 * row to row even without a full timeline-chart library.
 */
export function ProjectTimeline({
  projects,
  health,
}: {
  projects: Project[]
  health: (project: Project) => ReturnType<typeof computeProjectHealth>
}) {
  const withDates = projects.filter((p) => p.target_date && p.status !== 'archived')
  const withoutDates = projects.filter((p) => !p.target_date && p.status !== 'archived')

  if (withDates.length === 0) {
    return <p className="text-sm text-ink-400">No projects have a target date set yet.</p>
  }

  const today = Date.now()
  const dates = withDates.map((p) => new Date(p.target_date as string).getTime())
  const maxDate = Math.max(today + 14 * DAY_MS, ...dates)
  const minDate = Math.min(today, ...dates)
  const span = Math.max(maxDate - minDate, DAY_MS)

  const sorted = [...withDates].sort((a, b) => (a.target_date ?? '').localeCompare(b.target_date ?? ''))
  const todayPct = ((today - minDate) / span) * 100

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between text-xs text-ink-400">
          <span>{formatDate(new Date(minDate).toISOString().slice(0, 10))}</span>
          <span>{formatDate(new Date(maxDate).toISOString().slice(0, 10))}</span>
        </div>
        <div className="space-y-3">
          {sorted.map((p) => {
            const target = new Date(p.target_date as string).getTime()
            const pct = Math.min(100, Math.max(0, ((target - minDate) / span) * 100))
            const daysToTarget = Math.round((target - today) / DAY_MS)
            const h = health(p)
            return (
              <Link key={p.id} to={`/pi-dashboard/projects/${p.id}`} className="block">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="truncate font-medium text-ink-800 dark:text-ink-100">{p.name}</span>
                  <span className="shrink-0 text-ink-400">
                    {PROJECT_STATUS_LABEL[p.status]} ·{' '}
                    {daysToTarget < 0 ? `${Math.abs(daysToTarget)}d overdue` : `in ${daysToTarget}d`}
                  </span>
                </div>
                <div className="relative h-2 rounded-full bg-ink-100 dark:bg-ink-800">
                  <div
                    className="absolute top-1/2 h-0.5 w-px bg-ink-300 dark:bg-ink-600"
                    style={{ left: `${todayPct}%` }}
                  />
                  <div
                    className={cx('absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-ink-900', PROJECT_HEALTH_DOT[h])}
                    style={{ left: `calc(${pct}% - 6px)` }}
                    title={formatDate(p.target_date)}
                  />
                </div>
              </Link>
            )
          })}
        </div>
        <p className="mt-3 text-[11px] text-ink-400">The thin vertical tick marks today.</p>
      </div>

      {withoutDates.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">No target date set</h3>
          <ul className="space-y-1 text-sm">
            {withoutDates.map((p) => (
              <li key={p.id}>
                <Link to={`/pi-dashboard/projects/${p.id}`} className="text-ink-600 hover:underline dark:text-ink-300">
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
