import { cx } from '../lib/utils'

/**
 * A pearl: concentric rings with an off-centre highlight. Drawn rather than
 * imported so it stays crisp at any size and needs no asset pipeline.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx('h-8 w-8', className)} aria-hidden>
      <defs>
        <radialGradient id="pearl-body" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#d3f5f2" />
          <stop offset="45%" stopColor="#39bfbe" />
          <stop offset="100%" stopColor="#14686a" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="url(#pearl-body)" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="#06282b" strokeOpacity="0.18" strokeWidth="1" />
      <ellipse cx="11.5" cy="10.5" rx="4.6" ry="3.4" fill="#ffffff" fillOpacity="0.72" transform="rotate(-25 11.5 10.5)" />
      <circle cx="21" cy="22" r="2.2" fill="#ffffff" fillOpacity="0.28" />
    </svg>
  )
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Logo />
      {!compact && (
        <div className="leading-tight">
          <div className="text-[15px] font-extrabold tracking-tight text-ink-900 dark:text-ink-50">
            PEARL <span className="font-medium text-pearl-600 dark:text-pearl-400">Inventory</span>
          </div>
          <div className="text-[10.5px] font-medium uppercase tracking-wider text-ink-400">
            NTU Singapore
          </div>
        </div>
      )}
    </div>
  )
}
