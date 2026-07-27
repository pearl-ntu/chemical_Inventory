/**
 * Hand-rolled SVG charts.
 *
 * No charting library: the dashboard needs three shapes, and 200 lines of SVG
 * keeps the bundle small and the theming honest. Colours come from the
 * `--viz-*` tokens in index.css (see the note there about the status palette).
 *
 * Rules applied throughout: one measure per axis, single-hue magnitude bars,
 * a legend whenever more than one series is on screen, values printed next to
 * every status mark so colour never carries meaning on its own, and recessive
 * grid lines.
 */
import { useId, useState } from 'react'
import { cx } from '../lib/utils'

export interface Datum {
  label: string
  value: number
  /** Optional override, used by the status charts. */
  color?: string
  onClick?: () => void
}

// ---------------------------------------------------------------------------
// Horizontal bar list — "which shelf holds the most?"
// ---------------------------------------------------------------------------
export function BarList({
  data,
  max,
  unit = '',
  emptyLabel = 'No data yet',
}: {
  data: Datum[]
  max?: number
  unit?: string
  emptyLabel?: string
}) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value))

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-400">{emptyLabel}</p>
  }

  return (
    <ul className="viz-root flex flex-col gap-2.5">
      {data.map((d) => {
        const pct = (d.value / top) * 100
        const Row = d.onClick ? 'button' : 'div'
        return (
          <li key={d.label}>
            <Row
              {...(d.onClick ? { onClick: d.onClick, type: 'button' as const } : {})}
              className={cx(
                'group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-left',
                d.onClick && 'cursor-pointer',
              )}
              title={`${d.label}: ${d.value}${unit ? ' ' + unit : ''}`}
            >
              <div className="min-w-0">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm text-ink-700 group-hover:text-ink-900 dark:text-ink-300 dark:group-hover:text-ink-100">
                    {d.label}
                  </span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full"
                  style={{ background: 'var(--viz-grid)' }}
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-500 ease-out"
                    style={{
                      width: `${Math.max(pct, 2)}%`,
                      background: d.color ?? 'var(--viz-series)',
                    }}
                  />
                </div>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-800 dark:text-ink-100">
                {d.value}
                {unit && <span className="ml-0.5 text-xs font-normal text-ink-400">{unit}</span>}
              </span>
            </Row>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Donut — composition of the shelf by status
// ---------------------------------------------------------------------------
export function Donut({
  data,
  centerValue,
  centerLabel,
  size = 168,
}: {
  data: Datum[]
  centerValue: string | number
  centerLabel: string
  size?: number
}) {
  const [hover, setHover] = useState<string | null>(null)
  const total = data.reduce((s, d) => s + d.value, 0)
  const stroke = 22
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  // A 2px surface-coloured gap between segments keeps neighbouring slices legible.
  const gap = total > 0 ? (2 / circumference) * 100 : 0

  let offset = 0

  return (
    // Deliberately always stacked, never side-by-side: this lives in a grid
    // column whose width depends on the grid, not the viewport — a `sm:`
    // breakpoint switching to a row doesn't know the column may still only be
    // ~230px wide well past that breakpoint, which is exactly what pushed the
    // legend text out past the card edge.
    <div className="viz-root flex flex-col items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={centerLabel}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--viz-grid)"
            strokeWidth={stroke}
          />
          {total > 0 &&
            data
              .filter((d) => d.value > 0)
              .map((d) => {
                const pct = (d.value / total) * 100
                const dash = Math.max(pct - gap, 0.5)
                const el = (
                  <circle
                    key={d.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={d.color ?? 'var(--viz-series)'}
                    strokeWidth={hover === d.label ? stroke + 4 : stroke}
                    strokeDasharray={`${(dash / 100) * circumference} ${circumference}`}
                    strokeDashoffset={-((offset / 100) * circumference)}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    className="cursor-default transition-[stroke-width] duration-150"
                    onMouseEnter={() => setHover(d.label)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>{`${d.label}: ${d.value} (${pct.toFixed(0)}%)`}</title>
                  </circle>
                )
                offset += pct
                return el
              })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-ink-900 dark:text-ink-50">{centerValue}</span>
          <span className="text-xs text-ink-500 dark:text-ink-400">{centerLabel}</span>
        </div>
      </div>

      {/* Legend doubles as the value table — required relief for the amber slice,
          which sits below 3:1 against a white surface. */}
      <ul className="w-full min-w-0 flex-1 space-y-1.5">
        {data.map((d) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0
          return (
            <li
              key={d.label}
              className={cx(
                'flex items-center gap-2.5 rounded-md px-2 py-1 transition-colors',
                hover === d.label && 'bg-ink-50 dark:bg-ink-800',
              )}
              onMouseEnter={() => setHover(d.label)}
              onMouseLeave={() => setHover(null)}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: d.color ?? 'var(--viz-series)' }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-sm text-ink-600 dark:text-ink-300">
                {d.label}
              </span>
              <span className="text-sm font-semibold tabular-nums text-ink-800 dark:text-ink-100">
                {d.value}
              </span>
              <span className="w-10 text-right text-xs tabular-nums text-ink-400">
                {pct.toFixed(0)}%
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Timeline — one series, registrations over time, with a crosshair tooltip
// ---------------------------------------------------------------------------
export function Timeline({
  points,
  height = 160,
  valueLabel = 'registered',
}: {
  points: Array<{ label: string; value: number }>
  height?: number
  valueLabel?: string
}) {
  const gradientId = useId()
  const [active, setActive] = useState<number | null>(null)

  if (points.length < 2) {
    return (
      <p className="py-10 text-center text-sm text-ink-400">
        Not enough history yet — the trend appears once there are entries from two or more months.
      </p>
    )
  }

  const W = 640
  const H = height
  const padX = 8
  const padTop = 14
  const padBottom = 26
  const maxV = Math.max(1, ...points.map((p) => p.value))
  const stepX = (W - padX * 2) / (points.length - 1)
  const y = (v: number) => padTop + (1 - v / maxV) * (H - padTop - padBottom)
  const x = (i: number) => padX + i * stepX

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ')
  const area = `${line} L${x(points.length - 1)},${H - padBottom} L${x(0)},${H - padBottom} Z`

  return (
    <div className="viz-root relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Containers ${valueLabel} over time`}
        onMouseLeave={() => setActive(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const rel = ((e.clientX - rect.left) / rect.width) * W
          const idx = Math.round((rel - padX) / stepX)
          setActive(Math.min(points.length - 1, Math.max(0, idx)))
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--viz-series)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--viz-series)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <line
          x1={padX}
          x2={W - padX}
          y1={H - padBottom}
          y2={H - padBottom}
          stroke="var(--viz-axis)"
          strokeWidth="1"
        />
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--viz-series)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {active != null && (
          <line
            x1={x(active)}
            x2={x(active)}
            y1={padTop - 6}
            y2={H - padBottom}
            stroke="var(--viz-axis)"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {points.map((p, i) => (
          <circle
            key={p.label}
            cx={x(i)}
            cy={y(p.value)}
            r={active === i ? 5 : 3.5}
            fill="var(--viz-series)"
            stroke="var(--viz-surface)"
            strokeWidth="2"
            className="transition-[r] duration-150"
          />
        ))}
      </svg>

      <div className="mt-1 flex justify-between px-2 text-[11px] text-ink-400">
        <span>{points[0].label}</span>
        <span>{points[points.length - 1].label}</span>
      </div>

      {active != null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs shadow-pop dark:border-ink-700 dark:bg-ink-900"
          style={{ left: `${(x(active) / W) * 100}%` }}
        >
          <div className="font-semibold text-ink-800 dark:text-ink-100">{points[active].label}</div>
          <div className="tabular-nums text-ink-500 dark:text-ink-400">
            {points[active].value} {valueLabel}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = 'default',
  onClick,
}: {
  label: string
  value: string | number
  sub?: string
  icon?: React.ReactNode
  tone?: 'default' | 'good' | 'warning' | 'critical'
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  const toneRing = {
    default: 'text-pearl-700 bg-pearl-50 dark:bg-pearl-500/10 dark:text-pearl-300',
    good: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-300',
    warning: 'text-amber-700 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300',
    critical: 'text-rose-700 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-300',
  }[tone]

  return (
    <Tag
      {...(onClick ? { onClick, type: 'button' as const } : {})}
      className={cx(
        'card flex items-center gap-4 p-4 text-left',
        onClick && 'transition hover:shadow-pop hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]',
      )}
    >
      {icon && <div className={cx('rounded-lg p-2.5', toneRing)}>{icon}</div>}
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
          {label}
        </p>
        <p className="mt-0.5 text-2xl font-bold leading-tight text-ink-900 dark:text-ink-50">
          {value}
        </p>
        {sub && <p className="truncate text-xs text-ink-400">{sub}</p>}
      </div>
    </Tag>
  )
}
