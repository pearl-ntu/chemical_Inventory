import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Beaker, CornerDownLeft, Search, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { COMPUTATIONAL_NAV, NAV } from '../lib/nav'
import type { Chemical } from '../lib/types'
import { cx, formatSize } from '../lib/utils'

type Entry =
  | { kind: 'page'; key: string; label: string; hint: string; to: string; icon: typeof Search }
  | { kind: 'chemical'; key: string; label: string; hint: string; chemical: Chemical }

const BASE_PAGES: Array<{ to: string; label: string; hint: string; icon: typeof Search }> = [
  ...NAV.map((n) => ({ to: n.to, label: n.label, hint: 'Experimental', icon: n.icon })),
  ...COMPUTATIONAL_NAV.map((n) => ({ to: n.to, label: n.label, hint: 'Computational', icon: n.icon })),
]

function matches(chemical: Chemical, needle: string): boolean {
  return [chemical.name, chemical.code, chemical.cas, chemical.supplier, chemical.location]
    .filter(Boolean)
    .some((field) => field!.toLowerCase().includes(needle))
}

/**
 * A single ⌘K launchpad for the whole app — jump straight to a page or a
 * specific bottle by name/code/CAS without hunting through the sidebar
 * first. Opened globally (see AppShell), so it works from any screen.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { chemicals } = useInventory()
  const { isPi } = useAuth()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const PAGES = useMemo(
    () =>
      isPi
        ? [...BASE_PAGES, { to: '/pi-dashboard', label: 'PI Dashboard', hint: 'Oversight', icon: ShieldCheck }]
        : BASE_PAGES,
    [isPi],
  )

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      // Let the panel mount before focusing — same trick the rest of the app uses for dialogs.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const entries = useMemo<Entry[]>(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) {
      return PAGES.map((p) => ({ kind: 'page', key: p.to, label: p.label, hint: p.hint, to: p.to, icon: p.icon }))
    }

    const pageHits: Entry[] = PAGES.filter((p) => p.label.toLowerCase().includes(needle)).map((p) => ({
      kind: 'page',
      key: p.to,
      label: p.label,
      hint: p.hint,
      to: p.to,
      icon: p.icon,
    }))

    const chemicalHits: Entry[] = chemicals
      .filter((c) => matches(c, needle))
      .slice(0, 8)
      .map((c) => ({
        kind: 'chemical',
        key: c.id,
        label: c.name,
        hint: `${c.code} · ${[c.location, formatSize(c)].filter(Boolean).join(' · ')}`,
        chemical: c,
      }))

    return [...pageHits.slice(0, 4), ...chemicalHits]
  }, [query, chemicals, PAGES])

  useEffect(() => {
    setActiveIndex(0)
  }, [entries.length])

  function select(entry: Entry) {
    if (entry.kind === 'page') navigate(entry.to)
    else navigate(`/inventory?code=${encodeURIComponent(entry.chemical.code)}`)
    onClose()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, entries.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const entry = entries[activeIndex]
      if (entry) select(entry)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-pop animate-slide-up dark:border-ink-700 dark:bg-ink-900"
      >
        <div className="flex items-center gap-2.5 border-b border-ink-200 px-4 py-3 dark:border-ink-800">
          <Search className="h-4 w-4 shrink-0 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page, or search by name, code, CAS, supplier…"
            className="w-full bg-transparent text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none dark:text-ink-100"
          />
          <kbd className="hidden shrink-0 rounded border border-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-ink-400 sm:block dark:border-ink-700">
            Esc
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-1.5">
          {entries.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-ink-400">No matches for "{query}".</p>
          ) : (
            entries.map((entry, i) => {
              const Icon = entry.kind === 'page' ? entry.icon : Beaker
              return (
                <button
                  key={`${entry.kind}-${entry.key}`}
                  type="button"
                  onClick={() => select(entry)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                    i === activeIndex ? 'bg-pearl-50 dark:bg-pearl-500/10' : 'hover:bg-ink-50 dark:hover:bg-ink-800',
                  )}
                >
                  <span
                    className={cx(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                      i === activeIndex
                        ? 'bg-pearl-100 text-pearl-700 dark:bg-pearl-500/20 dark:text-pearl-300'
                        : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-800 dark:text-ink-100">
                      {entry.label}
                    </span>
                    <span className="block truncate text-xs text-ink-400">{entry.hint}</span>
                  </span>
                  {i === activeIndex && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-pearl-500" />}
                </button>
              )
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-ink-200 bg-ink-50 px-4 py-2 text-[11px] text-ink-400 dark:border-ink-800 dark:bg-ink-950/50">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-ink-200 px-1 font-mono dark:border-ink-700">↑↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" /> open
          </span>
        </div>
      </div>
    </div>
  )
}
