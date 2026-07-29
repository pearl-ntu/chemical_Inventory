import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  BarChart3,
  ChevronDown,
  ClipboardList,
  Database,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Minus,
  Moon,
  Plus,
  QrCode,
  Settings,
  Server,
  Sun,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { MODE, LAB_SUBTITLE } from '../lib/config'
import { cx } from '../lib/utils'
import { NtuBadge, Wordmark } from './Logo'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inventory', label: 'Inventory', icon: FlaskConical, end: false },
  { to: '/locations', label: 'Locations', icon: MapPin, end: false },
  { to: '/operations', label: 'Operations', icon: ClipboardList, end: false },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, end: false },
  { to: '/activity', label: 'Activity', icon: Activity, end: false },
  { to: '/labels', label: 'QR labels', icon: QrCode, end: false },
]

const COMPUTATIONAL_NAV = [
  { to: '/computational', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/research-assets', label: 'Research Assets', icon: Database, end: false },
  { to: '/computational/hpc-sync', label: 'Linux/HPC Sync', icon: Server, end: false },
  { to: '/computational/analytics', label: 'Analytics', icon: BarChart3, end: false },
  { to: '/computational/activity', label: 'Activity', icon: Activity, end: false },
]

type WorkspaceMode = 'experimental' | 'computational'
type SidebarWidth = 'compact' | 'comfortable' | 'wide'

const WORKSPACE_STORAGE_KEY = 'pearl.workspace_mode'
const SIDEBAR_WIDTH_STORAGE_KEY = 'pearl.sidebar_width'
const SHARED_WORKSPACE_PATHS = new Set(['/analytics', '/activity'])
const SIDEBAR_WIDTHS: Record<SidebarWidth, string> = {
  compact: 'w-60',
  comfortable: 'w-72',
  wide: 'w-80',
}

function storedWorkspaceMode(): WorkspaceMode {
  try {
    return localStorage.getItem(WORKSPACE_STORAGE_KEY) === 'computational'
      ? 'computational'
      : 'experimental'
  } catch {
    return 'experimental'
  }
}

function workspaceFromPath(pathname: string): WorkspaceMode {
  if (SHARED_WORKSPACE_PATHS.has(pathname)) return storedWorkspaceMode()
  return pathname.startsWith('/research-assets') || pathname.startsWith('/computational')
    ? 'computational'
    : 'experimental'
}

function storedSidebarWidth(): SidebarWidth {
  try {
    const value = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    return value === 'compact' || value === 'wide' ? value : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

function WorkspaceSwitch({
  compact = false,
  shortLabels = false,
  onSwitch,
}: {
  compact?: boolean
  shortLabels?: boolean
  onSwitch?: () => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const mode = workspaceFromPath(location.pathname)

  function setMode(next: WorkspaceMode) {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, next)
    } catch {
      /* route still changes */
    }
    navigate(next === 'experimental' ? '/' : '/computational')
    onSwitch?.()
  }

  return (
    <div
      className={cx(
        'rounded-lg border border-ink-200 bg-ink-50 p-1 dark:border-ink-800 dark:bg-ink-950',
        compact ? 'flex w-full' : 'grid grid-cols-2',
      )}
      aria-label="Inventory workspace"
    >
      {[
        { value: 'experimental' as const, label: shortLabels ? 'Exp' : 'Experimental', icon: FlaskConical },
        { value: 'computational' as const, label: shortLabels ? 'Comp' : 'Computational', icon: Database },
      ].map(({ value, label, icon: Icon }) => {
        const on = mode === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cx(
              'flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors',
              on
                ? 'bg-white text-pearl-800 shadow-sm ring-1 ring-ink-200 dark:bg-ink-800 dark:text-pearl-200 dark:ring-ink-700'
                : 'text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-100',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('pearl.theme', dark ? 'dark' : 'light')
    } catch {
      /* private browsing — the toggle still works for this session */
    }
  }, [dark])
  return { dark, toggle: () => setDark((d) => !d) }
}

function ThemeToggle() {
  const { dark, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      className="btn-ghost p-2"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
}

function SidebarWidthControl({
  value,
  onChange,
}: {
  value: SidebarWidth
  onChange: (value: SidebarWidth) => void
}) {
  const widths: SidebarWidth[] = ['compact', 'comfortable', 'wide']
  const index = widths.indexOf(value)

  function setWidth(next: SidebarWidth) {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, next)
    } catch {
      /* preference still changes for this view */
    }
    onChange(next)
  }

  return (
    <div className="hidden items-center gap-1 rounded-lg border border-ink-200 bg-white p-1 lg:flex dark:border-ink-800 dark:bg-ink-900">
      <button
        type="button"
        className="btn-ghost p-1.5"
        onClick={() => setWidth(widths[Math.max(0, index - 1)])}
        disabled={index === 0}
        title="Narrower sidebar"
        aria-label="Narrower sidebar"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="w-16 text-center text-[11px] font-medium capitalize text-ink-500">
        {value}
      </span>
      <button
        type="button"
        className="btn-ghost p-1.5"
        onClick={() => setWidth(widths[Math.min(widths.length - 1, index + 1)])}
        disabled={index === widths.length - 1}
        title="Wider sidebar"
        aria-label="Wider sidebar"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function UserMenu() {
  const { profile, isAdmin, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!profile) return null

  const initials = profile.full_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-ink-100 dark:hover:bg-ink-800"
        aria-expanded={open}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pearl-600 text-xs font-bold text-white">
          {initials || '?'}
        </span>
        <span className="hidden text-sm font-medium text-ink-700 sm:block dark:text-ink-200">
          {profile.full_name.split(' ')[0]}
        </span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-ink-400 sm:block" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1.5 w-60 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop animate-slide-up dark:border-ink-700 dark:bg-ink-900">
          <div className="border-b border-ink-100 px-3 py-2.5 dark:border-ink-800">
            <p className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">
              {profile.full_name}
            </p>
            <p className="truncate text-xs text-ink-500">{profile.email}</p>
            <span className="badge mt-1.5 bg-pearl-50 text-pearl-700 ring-pearl-600/20 dark:bg-pearl-500/10 dark:text-pearl-300 dark:ring-pearl-400/20">
              {profile.role}
            </span>
          </div>
          <div className="p-1">
            <button
              className="nav-link w-full"
              onClick={() => {
                setOpen(false)
                navigate('/settings')
              }}
            >
              <Settings className="h-4 w-4" /> Settings
            </button>
            {isAdmin && (
              <button
                className="nav-link w-full"
                onClick={() => {
                  setOpen(false)
                  navigate('/members')
                }}
              >
                <Users className="h-4 w-4" /> Members
              </button>
            )}
            <button
              className="nav-link w-full text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10"
              onClick={() => void signOut()}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SidebarContent({
  onNavigate,
  showWorkspaceSwitch = false,
}: {
  onNavigate?: () => void
  showWorkspaceSwitch?: boolean
}) {
  const { isAdmin } = useAuth()
  const location = useLocation()
  const mode = workspaceFromPath(location.pathname)
  const links = mode === 'computational' ? COMPUTATIONAL_NAV : NAV

  return (
    <>
      <div className="space-y-3 px-3 py-4">
        <Wordmark />
        {showWorkspaceSwitch && <WorkspaceSwitch onSwitch={onNavigate} />}
      </div>
      <nav className="flex-1 space-y-1 px-3">
        <p className="px-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-400">
          {mode === 'computational' ? 'Computational' : 'Experimental'}
        </p>
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) => cx('nav-link', isActive && 'nav-link-active')}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-1 border-t border-ink-200 px-3 py-3 dark:border-ink-800">
        {isAdmin && (
          <NavLink
            to="/members"
            onClick={onNavigate}
            className={({ isActive }) => cx('nav-link', isActive && 'nav-link-active')}
          >
            <Users className="h-4 w-4" /> Members
          </NavLink>
        )}
        <NavLink
          to="/settings"
          onClick={onNavigate}
          className={({ isActive }) => cx('nav-link', isActive && 'nav-link-active')}
        >
          <Settings className="h-4 w-4" /> Settings
        </NavLink>
        <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
          <p className="text-[10.5px] leading-snug text-ink-400">{LAB_SUBTITLE}</p>
          <NtuBadge className="shrink-0 [&_span:last-child]:hidden" />
        </div>
      </div>
    </>
  )
}

export function DemoBanner() {
  const [dismissed, setDismissed] = useState(false)
  if (MODE !== 'demo' || dismissed) return null
  return (
    <div className="no-print flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
      <span className="mt-0.5 font-semibold">Demo mode</span>
      <p className="flex-1 leading-snug">
        Everything you do is saved in this browser only — nothing is shared with the rest of the
        group. Connect a Supabase project (see <code className="font-mono text-xs">SETUP.md</code>)
        to switch on real accounts and one shared database.
      </p>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="p-0.5">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function AppShell({ children }: { children?: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState<SidebarWidth>(() => storedSidebarWidth())
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key !== '/' && e.code !== 'Slash') return

      e.preventDefault()
      const search = document.querySelector<HTMLInputElement>('[data-search-shortcut="true"]')
      if (search) {
        search.focus()
        return
      }

      try {
        sessionStorage.setItem('pearl.focus_search', '1')
      } catch {
        /* ignore private browsing/session storage failures */
      }
      navigate('/inventory')
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside
        className={cx(
          'app-chrome no-print hidden shrink-0 flex-col border-r border-ink-200 transition-[width] lg:flex dark:border-ink-800',
          SIDEBAR_WIDTHS[sidebarWidth],
        )}
      >
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="app-chrome relative flex h-full w-72 max-w-[88vw] flex-col shadow-pop animate-slide-in-right">
            <SidebarContent onNavigate={() => setMobileOpen(false)} showWorkspaceSwitch />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-chrome no-print sticky top-0 z-30 flex items-center gap-2 border-b border-ink-200 px-3 py-2.5 backdrop-blur sm:px-5 dark:border-ink-800">
          <button
            className="btn-ghost p-2 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="lg:hidden">
            <Wordmark compact />
          </div>
          <div className="hidden w-[28rem] max-w-[42vw] lg:block">
            <WorkspaceSwitch compact />
          </div>
          <SidebarWidthControl value={sidebarWidth} onChange={setSidebarWidth} />
          <div className="flex-1" />
          <span className="hidden rounded-md border border-ink-200 px-2 py-1 text-[11px] text-ink-400 md:block dark:border-ink-700">
            Press <kbd className="font-mono font-semibold">/</kbd> to search
          </span>
          <ThemeToggle />
          <UserMenu />
        </header>

        <DemoBanner />

        <main className="min-w-0 flex-1 overflow-y-auto">
          {/* Keyed by route so every navigation re-triggers the entrance
              animation — the app otherwise cuts between pages instantly. */}
          <div key={location.pathname} className="mx-auto w-full max-w-[1400px] p-4 sm:p-6 animate-slide-up">
            {children ?? <Outlet />}
          </div>
        </main>
      </div>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-ink-900 sm:text-2xl dark:text-ink-50">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
