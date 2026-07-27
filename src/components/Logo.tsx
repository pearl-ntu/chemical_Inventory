import pearlIcon from '../assets/pearl-icon.png'
import ntuShield from '../assets/ntu-shield.png'
import { cx } from '../lib/utils'

/**
 * The group's actual PEARL mark — a spectrum-gradient sphere with radiating
 * rays (Photon Emission And Reactivity Lab: the rays are a literal emission
 * spectrum, not decoration) — cropped from the source artwork to just the
 * icon, no wordmark, so it reads cleanly at nav-bar sizes.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'inline-block shrink-0 overflow-hidden rounded-[28%] bg-[#0b1830]',
        className ?? 'h-8 w-8',
      )}
    >
      <img src={pearlIcon} alt="" className="h-full w-full object-cover" draggable={false} />
    </span>
  )
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Logo />
      {!compact && (
        <div className="leading-tight">
          <div className="text-[15px] font-extrabold tracking-tight text-ink-900 dark:text-ink-50">
            PEARL
          </div>
          <div className="text-[10px] font-medium leading-tight text-ink-400">
            Photon Emission &amp; Reactivity Lab
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The university crest, cropped from the file the group provided — this is
 * NTU's own logo, used here only to credit the university as the lab's home
 * institution, not to imply the app is an official NTU product.
 */
export function NtuBadge({ className }: { className?: string }) {
  return (
    <div className={cx('inline-flex items-center gap-1.5', className)}>
      <img src={ntuShield} alt="Nanyang Technological University" className="h-5 w-auto" draggable={false} />
      <span className="text-[11px] font-bold leading-none tracking-wide text-ink-500 dark:text-ink-400">
        NTU SINGAPORE
      </span>
    </div>
  )
}
