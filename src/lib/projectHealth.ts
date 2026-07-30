import type { Project, ProjectHealth } from './types'

const STALE_DAYS = 7
const RED_DAYS = 14
const SOON_DAYS = 7

/**
 * Computed on every read, never stored — a project's health is a function
 * of "how stale is the log" and "how close/overdue is the target date",
 * both of which change on their own as time passes. Caching this would just
 * mean building a job to keep the cache honest.
 *
 * `daysSinceUpdate` is Infinity when there's no update at all yet.
 */
export function computeProjectHealth(project: Pick<Project, 'status' | 'target_date'>, daysSinceUpdate: number): ProjectHealth {
  const targetDate = project.target_date ? new Date(project.target_date) : null
  const daysToTarget = targetDate ? Math.floor((targetDate.getTime() - Date.now()) / 86_400_000) : null

  const overdue = daysToTarget !== null && daysToTarget < 0
  const dueSoon = daysToTarget !== null && daysToTarget >= 0 && daysToTarget <= SOON_DAYS

  if (project.status === 'active' && (daysSinceUpdate >= RED_DAYS || overdue)) return 'red'
  if (daysSinceUpdate >= STALE_DAYS || dueSoon) return 'amber'
  return 'green'
}

export const PROJECT_HEALTH_DOT: Record<ProjectHealth, string> = {
  red: 'bg-rose-500',
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
}

export const PROJECT_HEALTH_LABEL: Record<ProjectHealth, string> = {
  red: 'Needs attention',
  amber: 'Getting stale',
  green: 'Healthy',
}
