import {
  AlertTriangle,
  Biohazard,
  Bomb,
  Cylinder,
  Droplets,
  Fish,
  Flame,
  Skull,
  Zap,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../lib/utils'

/** Icon + tone per GHS class. Icon and label always travel together, so the
 *  colour is never the only thing carrying the warning. */
const HAZARD_STYLE: Record<string, { icon: ReactNode; tone: string }> = {
  Flammable: { icon: <Flame className="h-3 w-3" />, tone: 'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-400/25' },
  Oxidising: { icon: <Zap className="h-3 w-3" />, tone: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25' },
  Explosive: { icon: <Bomb className="h-3 w-3" />, tone: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/25' },
  Corrosive: { icon: <Droplets className="h-3 w-3" />, tone: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20 dark:bg-fuchsia-500/10 dark:text-fuchsia-300 dark:ring-fuchsia-400/25' },
  'Acute toxic': { icon: <Skull className="h-3 w-3" />, tone: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/25' },
  'Health hazard': { icon: <Biohazard className="h-3 w-3" />, tone: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/25' },
  Irritant: { icon: <AlertTriangle className="h-3 w-3" />, tone: 'bg-yellow-50 text-yellow-800 ring-yellow-600/20 dark:bg-yellow-500/10 dark:text-yellow-300 dark:ring-yellow-400/25' },
  Environmental: { icon: <Fish className="h-3 w-3" />, tone: 'bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-400/25' },
  'Compressed gas': { icon: <Cylinder className="h-3 w-3" />, tone: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/25' },
}

export function HazardBadge({ hazard }: { hazard: string }) {
  const style = HAZARD_STYLE[hazard] ?? {
    icon: <AlertTriangle className="h-3 w-3" />,
    tone: 'bg-ink-100 text-ink-700 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300 dark:ring-ink-600',
  }
  return (
    <span className={cx('badge', style.tone)}>
      {style.icon}
      {hazard}
    </span>
  )
}

export function HazardBadges({ hazards, max }: { hazards: string[]; max?: number }) {
  if (!hazards || hazards.length === 0) return null
  const shown = max ? hazards.slice(0, max) : hazards
  const rest = hazards.length - shown.length
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((h) => (
        <HazardBadge key={h} hazard={h} />
      ))}
      {rest > 0 && (
        <span className="badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-400 dark:ring-ink-700">
          +{rest}
        </span>
      )}
    </span>
  )
}
