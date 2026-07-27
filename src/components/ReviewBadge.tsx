import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import type { ReviewStatus } from '../lib/types'
import { REVIEW_STATUS_LABEL } from '../lib/types'
import { cx } from '../lib/utils'

const TONE: Record<ReviewStatus, string> = {
  approved:
    'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
  pending:
    'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  rejected:
    'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20',
}

const ICON: Record<ReviewStatus, typeof Clock> = {
  approved: CheckCircle2,
  pending: Clock,
  rejected: XCircle,
}

/**
 * Distinct from the stock `StatusBadge` (in stock / low / empty) — this one
 * is about the *submission*, not the physical shelf. Approved items don't
 * normally show this at all; it's only rendered where the distinction
 * matters (the approvals queue, a submitter's own pending items).
 */
export function ReviewBadge({ status, className }: { status: ReviewStatus; className?: string }) {
  const Icon = ICON[status]
  return (
    <span className={cx('badge', TONE[status], className)}>
      <Icon className="h-3 w-3" />
      {REVIEW_STATUS_LABEL[status]}
    </span>
  )
}
