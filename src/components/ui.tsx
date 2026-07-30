import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react'
import { cx } from '../lib/utils'

// ---------------------------------------------------------------------------
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-4 w-4 animate-spin', className)} aria-hidden />
}

export function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 text-ink-500">
      <Spinner className="h-6 w-6" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

/** A shaped placeholder block, for pages that pull from several queries at
 *  once (Analytics, PI Console) where a bare spinner leaves the eye with
 *  nothing to anchor on while everything loads together. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-ink-100 dark:bg-ink-800', className)} aria-hidden />
}

/** A skeleton shaped like this app's usual KPI-strip + table layout —
 *  matches what most multi-query dashboard pages actually render once
 *  loaded, so the loading state doesn't visually jump around. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-2 gap-px divide-y divide-ink-100 p-0 sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-ink-800">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-10" />
          </div>
        ))}
      </div>
      <div className="card space-y-2 p-4">
        <Skeleton className="mb-2 h-4 w-32" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && (
        <div className="rounded-full bg-ink-100 p-3 text-ink-400 dark:bg-ink-800 dark:text-ink-500">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-ink-800 dark:text-ink-100">{title}</h3>
      {description && (
        <p className="max-w-md text-sm text-ink-500 dark:text-ink-400">{description}</p>
      )}
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
/** Locks background scroll and restores focus — used by both Modal and Drawer. */
function useDismissable(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useDismissable(open, onClose)
  if (!open) return null

  const width = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
  }[size]

  // Rendered via a portal straight onto <body> — a `fixed` element nested
  // inside any ancestor with a filter/backdrop-blur/transform (the app's
  // header uses backdrop-blur) gets contained by that ancestor instead of
  // the viewport, which is exactly the "modal renders squashed into the
  // header" bug a plain in-tree `fixed` div runs into.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-pop animate-slide-up sm:rounded-2xl dark:bg-ink-900',
          width,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4 dark:border-ink-800">
          <div>
            <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">{title}</h2>
            {description && (
              <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">{description}</p>
            )}
          </div>
          <button onClick={onClose} className="btn-ghost -mr-2 -mt-1 p-2" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-ink-200 bg-ink-50 px-5 py-3 dark:border-ink-800 dark:bg-ink-950/50">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  useDismissable(open, onClose)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-pop animate-slide-in-right dark:bg-ink-900"
      >
        <header className="flex items-center justify-between gap-4 border-b border-ink-200 px-5 py-4 dark:border-ink-800">
          <h2 className="truncate text-base font-semibold text-ink-900 dark:text-ink-50">
            {title}
          </h2>
          <button onClick={onClose} className="btn-ghost -mr-2 p-2" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap items-center gap-2 border-t border-ink-200 bg-ink-50 px-5 py-3 dark:border-ink-800 dark:bg-ink-950/50">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------------------
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  destructive,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={destructive ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-ink-600 dark:text-ink-300">{message}</div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      if (sessionStorage.getItem('pearl.focus_search') === '1') {
        sessionStorage.removeItem('pearl.focus_search')
        window.setTimeout(() => ref.current?.focus(), 0)
      }
    } catch {
      /* focus still works through the direct shortcut path */
    }
  }, [])

  // "/" focuses search from anywhere, the way lab folk expect from GitHub/Slack.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      if ((e.key === '/' || e.code === 'Slash') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        ref.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input
        ref={ref}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input pl-9 pr-9"
        aria-label="Search inventory"
        data-search-shortcut="true"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  counts,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  counts?: Record<string, number>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const shown = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((s) => s !== value) : [...selected, value])
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'btn-secondary w-full justify-between whitespace-nowrap sm:w-auto',
          selected.length > 0 && 'border-pearl-400 text-pearl-800 dark:text-pearl-300',
        )}
        aria-expanded={open}
      >
        <span>
          {label}
          {selected.length > 0 && (
            <span className="ml-1.5 rounded bg-pearl-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
              {selected.length}
            </span>
          )}
        </span>
        <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1.5 max-h-80 w-64 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop animate-slide-up dark:border-ink-700 dark:bg-ink-900">
          {options.length > 8 && (
            <div className="border-b border-ink-100 p-2 dark:border-ink-800">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Filter ${label.toLowerCase()}…`}
                className="input py-1.5 text-xs"
              />
            </div>
          )}
          <div className="max-h-60 overflow-y-auto p-1">
            {shown.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-ink-400">No matches</p>
            )}
            {shown.map((o) => {
              const on = selected.includes(o)
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggle(o)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-800"
                >
                  <span
                    className={cx(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      on
                        ? 'border-pearl-600 bg-pearl-600 text-white'
                        : 'border-ink-300 dark:border-ink-600',
                    )}
                  >
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-700 dark:text-ink-200">{o}</span>
                  {counts?.[o] != null && (
                    <span className="text-xs tabular-nums text-ink-400">{counts[o]}</span>
                  )}
                </button>
              )
            })}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-ink-100 p-1 dark:border-ink-800">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-800"
              >
                Clear {label.toLowerCase()}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string
  hint?: string
  error?: string | null
  required?: boolean
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-rose-600 dark:text-rose-400">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-400">{hint}</span>
      ) : null}
    </label>
  )
}
