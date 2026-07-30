import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { ArrowLeft, BarChart3, LayoutGrid, ShieldCheck, Users2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { cx } from '../lib/utils'
import { NotificationBell } from './NotificationBell'
import { ThemeToggle } from './Layout'

const CONSOLE_LINKS = [
  { to: '/pi-dashboard', label: 'Overview', icon: ShieldCheck, end: true },
  { to: '/pi-dashboard/projects', label: 'Projects', icon: LayoutGrid, end: false },
  { to: '/pi-dashboard/members', label: 'Members', icon: Users2, end: false },
  { to: '/pi-dashboard/analytics', label: 'Analytics', icon: BarChart3, end: false },
]

/**
 * A deliberately different room from the rest of the app — no experimental/
 * computational sidebar, no workspace switcher — but a single "Go to PEARL"
 * link back out, not a whole shortcut menu duplicating the main nav.
 */
export function PiConsoleLayout() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex h-full bg-ink-50 dark:bg-ink-950">
      <aside className="no-print hidden w-56 shrink-0 flex-col border-r border-white/10 bg-gradient-to-b from-ink-950 to-ink-900 lg:flex">
        <button
          onClick={() => navigate('/')}
          className="m-3 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Go to PEARL
        </button>

        <div className="flex items-center gap-2 border-y border-white/10 px-3 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">PI Console</h1>
            <p className="truncate text-[11px] text-ink-400">{profile?.full_name}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-3">
          {CONSOLE_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-amber-500/10 text-amber-300' : 'text-ink-300 hover:bg-white/5 hover:text-white',
                )
              }
            >
              <link.icon className="h-4 w-4 shrink-0" /> {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex flex-wrap items-center gap-3 border-b border-white/10 bg-gradient-to-r from-ink-950 via-ink-900 to-ink-950 px-4 py-2.5 sm:px-6">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-400 transition-colors hover:bg-white/5 hover:text-white lg:hidden"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Go to PEARL
          </button>
          <h1 className="text-sm font-bold tracking-tight text-white lg:hidden">PI Console</h1>
          <div className="flex-1" />
          <NotificationBell />
          <ThemeToggle />
        </header>

        <nav className="no-print flex gap-1 overflow-x-auto border-b border-white/10 bg-ink-950/60 px-4 sm:px-6 lg:hidden">
          {CONSOLE_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                cx(
                  'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-amber-400 text-white'
                    : 'border-transparent text-ink-400 hover:border-white/20 hover:text-white',
                )
              }
            >
              <link.icon className="h-4 w-4" /> {link.label}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 overflow-y-auto print:h-auto print:overflow-visible">
          <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
