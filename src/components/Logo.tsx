import { cx } from '../lib/utils'

/**
 * The PEARL mark: a spectrum-gradient sphere with radiating rays, after the
 * group's own logo (a Photon Emission And Reactivity Lab — the rays are a
 * literal emission spectrum, not decoration). Drawn as SVG so it stays crisp
 * at any size and needs no image asset.
 */
export function Logo({ className }: { className?: string }) {
  const rays = 16
  const rayColors = [
    '#e34948', '#eb6834', '#eda100', '#f5c518',
    '#5fb84a', '#1baf7a', '#1ea3a4', '#2a78d6',
    '#3b73f0', '#4a3aa7', '#7a3aa7', '#c23a8e',
    '#e34948', '#eb6834', '#eda100', '#1baf7a',
  ]

  return (
    <svg viewBox="0 0 100 100" className={cx('h-8 w-8', className)} aria-hidden>
      <defs>
        <radialGradient id="pearl-sphere" cx="38%" cy="34%" r="72%">
          <stop offset="0%" stopColor="#fff6d6" />
          <stop offset="22%" stopColor="#ffd23f" />
          <stop offset="45%" stopColor="#ff8a3d" />
          <stop offset="65%" stopColor="#2fae7a" />
          <stop offset="85%" stopColor="#2a78d6" />
          <stop offset="100%" stopColor="#1c44ab" />
        </radialGradient>
      </defs>

      <g>
        {Array.from({ length: rays }).map((_, i) => {
          const angle = (i / rays) * 2 * Math.PI - Math.PI / 2
          const r1 = 30
          const r2 = 44
          const x1 = 50 + r1 * Math.cos(angle)
          const y1 = 50 + r1 * Math.sin(angle)
          const x2 = 50 + r2 * Math.cos(angle)
          const y2 = 50 + r2 * Math.sin(angle)
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={rayColors[i % rayColors.length]}
              strokeWidth="4.2"
              strokeLinecap="round"
            />
          )
        })}
      </g>

      <circle cx="50" cy="50" r="24" fill="url(#pearl-sphere)" />
      <circle cx="50" cy="50" r="24" fill="none" stroke="#0b1830" strokeOpacity="0.15" strokeWidth="1" />
      <ellipse cx="42" cy="40" rx="8" ry="5.5" fill="#ffffff" fillOpacity="0.55" transform="rotate(-25 42 40)" />
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
 * A plain typographic NTU badge — not a reproduction of the university's
 * crest, which is a protected mark this app has no license to redraw. Swap in
 * an official logo file (see README) if the group has one to hand.
 */
export function NtuBadge({ className }: { className?: string }) {
  return (
    <div className={cx('inline-flex items-center gap-1.5', className)}>
      <span className="flex h-5 w-5 items-center justify-center rounded-[3px] bg-[#f8291f] text-[9px] font-black italic text-white">
        N
      </span>
      <span className="text-[11px] font-bold leading-none tracking-wide text-ink-500 dark:text-ink-400">
        NTU SINGAPORE
      </span>
    </div>
  )
}
