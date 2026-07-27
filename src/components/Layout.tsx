import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  BarChart3,
  ChevronDown,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Moon,
  QrCode,
  Settings,
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
  { to: '/analytics', label: 'Analytics', icon: BarChart3, end: false },
  { to: '/activity', label: 'Activity', icon: Activity, end: false },
  { to: '/labels', label: 'QR labels', icon: QrCode, end: false },
]

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

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { isAdmin } = useAuth()
  const links = [...NAV, ...(isAdmin ? [{ to: '/members', label: 'Members', icon: Users, end: false }] : [])]

  return (
    <>
      <div className="px-3 py-4">
        <Wordmark />
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
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
  const location = useLocation()

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="no-print hidden w-60 shrink-0 flex-col border-r border-ink-200 bg-white lg:flex dark:border-ink-800 dark:bg-ink-900">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-64 flex-col bg-white shadow-pop animate-slide-in-right dark:bg-ink-900">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-ink-200 bg-white/85 px-3 py-2.5 backdrop-blur sm:px-5 dark:border-ink-800 dark:bg-ink-900/85">
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
