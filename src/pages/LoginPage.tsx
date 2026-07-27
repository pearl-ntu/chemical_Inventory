import { useState, type FormEvent } from 'react'
import { AlertTriangle, ArrowRight, Beaker, Eye, EyeOff, Lock, Mail, User } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Field, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { auth } from '../lib/api'
import { ALLOWED_EMAIL_DOMAINS, LAB_SUBTITLE, MODE, emailDomainAllowed } from '../lib/config'
import { cx } from '../lib/utils'

type Tab = 'signin' | 'signup'

export default function LoginPage() {
  const { signIn, signUp } = useAuth()
  const toast = useToast()

  const [tab, setTab] = useState<Tab>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    if (tab === 'signup') {
      if (!fullName.trim()) return setError('Please enter your name — it appears on every entry you add.')
      if (password.length < 8) return setError('Use at least 8 characters for your password.')
      if (!emailDomainAllowed(email)) {
        return setError(
          `Sign-ups are limited to ${ALLOWED_EMAIL_DOMAINS.join(', ')} addresses. Ask an admin if you need an exception.`,
        )
      }
    }

    setBusy(true)
    try {
      if (tab === 'signin') {
        await signIn(email, password)
      } else {
        const { needsConfirmation } = await signUp(email, password, fullName)
        if (needsConfirmation) {
          setNotice(
            `Almost there — we sent a confirmation link to ${email}. Click it, then come back and sign in.`,
          )
          setTab('signin')
        } else {
          toast.success(`Welcome to the group inventory, ${fullName.split(' ')[0]}.`)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function onForgotPassword() {
    if (!email.trim()) return setError('Enter your email address first, then click "Forgot password".')
    try {
      await auth.sendPasswordReset(email)
      setNotice(`If an account exists for ${email}, a reset link is on its way.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset email.')
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      {/* ---------------------------------------------------------------- brand */}
      <div className="relative hidden overflow-hidden bg-pearl-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <MolecularBackdrop />

        <div className="relative">
          <div className="flex items-center gap-3">
            <Logo className="h-10 w-10" />
            <div>
              <div className="text-lg font-extrabold tracking-tight text-white">
                PEARL <span className="font-medium text-pearl-300">Inventory</span>
              </div>
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-pearl-400/80">
                Nanyang Technological University
              </div>
            </div>
          </div>
        </div>

        <div className="relative max-w-lg">
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-white xl:text-4xl">
            Every reagent, every shelf,
            <br />
            <span className="text-pearl-300">one source of truth.</span>
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-pearl-100/70">
            Search the whole store in a keystroke, see what is running low before an experiment
            stalls, and know exactly which fridge a bottle is sitting in — from the bench, on a
            phone, without opening a spreadsheet.
          </p>

          <dl className="mt-9 grid grid-cols-3 gap-6 border-t border-white/10 pt-6">
            {[
              ['235', 'containers tracked'],
              ['16', 'storage locations'],
              ['40', 'suppliers'],
            ].map(([n, l]) => (
              <div key={l}>
                <dt className="text-2xl font-bold text-white">{n}</dt>
                <dd className="mt-0.5 text-xs leading-snug text-pearl-300/70">{l}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative text-xs text-pearl-400/60">{LAB_SUBTITLE}</p>
      </div>

      {/* ----------------------------------------------------------------- form */}
      <div className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo className="h-9 w-9" />
            <div>
              <div className="text-base font-extrabold tracking-tight text-ink-900 dark:text-ink-50">
                PEARL <span className="font-medium text-pearl-600 dark:text-pearl-400">Inventory</span>
              </div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-ink-400">
                NTU Singapore
              </div>
            </div>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">
            {tab === 'signin' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="mt-1.5 text-sm text-ink-500 dark:text-ink-400">
            {tab === 'signin'
              ? 'Sign in to see the group’s live chemical inventory.'
              : 'Anyone in the group can make an account. Your name is stamped on what you add.'}
          </p>

          <div className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-ink-100 p-1 dark:bg-ink-800">
            {(['signin', 'signup'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t)
                  setError(null)
                  setNotice(null)
                }}
                className={cx(
                  'rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
                  tab === t
                    ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-900 dark:text-ink-50'
                    : 'text-ink-500 hover:text-ink-700 dark:hover:text-ink-300',
                )}
              >
                {t === 'signin' ? 'Sign in' : 'Sign up'}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            {tab === 'signup' && (
              <Field label="Full name" required hint="Shown next to entries you register.">
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                  <input
                    className="input pl-9"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Dr. Takuya Tanaka"
                    autoComplete="name"
                  />
                </div>
              </Field>
            )}

            <Field
              label="Email"
              required
              hint={
                tab === 'signup' && ALLOWED_EMAIL_DOMAINS.length > 0
                  ? `Use your ${ALLOWED_EMAIL_DOMAINS[0]} address.`
                  : undefined
              }
            >
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  className="input pl-9"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@e.ntu.edu.sg"
                  autoComplete="email"
                />
              </div>
            </Field>

            <Field
              label="Password"
              required
              hint={tab === 'signup' ? 'At least 8 characters.' : undefined}
            >
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  className="input pl-9 pr-10"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="leading-snug">{error}</p>
              </div>
            )}
            {notice && (
              <div className="rounded-lg border border-pearl-200 bg-pearl-50 p-3 text-sm leading-snug text-pearl-900 dark:border-pearl-500/30 dark:bg-pearl-500/10 dark:text-pearl-100">
                {notice}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? <Spinner /> : null}
              {tab === 'signin' ? 'Sign in' : 'Create account'}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </button>

            {tab === 'signin' && MODE === 'cloud' && (
              <button
                type="button"
                onClick={() => void onForgotPassword()}
                className="w-full text-center text-xs font-medium text-ink-500 hover:text-pearl-700 dark:hover:text-pearl-400"
              >
                Forgot your password?
              </button>
            )}
          </form>

          {MODE === 'demo' && (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-500/25 dark:bg-amber-500/10">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
                <Beaker className="h-4 w-4" /> Demo mode
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-amber-800 dark:text-amber-200/80">
                No server is connected yet, so accounts and data live in this browser only. Sign up
                with any email to explore the lab’s real 235-container starter inventory — the first
                account created becomes the admin. See{' '}
                <code className="font-mono">SETUP.md</code> to switch on the shared database.
              </p>
            </div>
          )}

          <p className="mt-8 text-center text-xs leading-relaxed text-ink-400">
            Built for the PEARL Group · Prof. Xiaogang Liu Lab
            <br />
            Nanyang Technological University, Singapore
          </p>
        </div>
      </div>
    </div>
  )
}

/** Decorative hex-lattice + orbiting rings. Purely presentational. */
function MolecularBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <svg className="absolute inset-0 h-full w-full opacity-[0.16]" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="hex" width="56" height="97" patternUnits="userSpaceOnUse" patternTransform="scale(1.1)">
            <path
              d="M28 0 L56 16 L56 48 L28 64 L0 48 L0 16 Z"
              fill="none"
              stroke="#73d9d6"
              strokeWidth="1"
            />
            <path
              d="M28 64 L56 80 L56 97 M28 64 L0 80 L0 97"
              fill="none"
              stroke="#73d9d6"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hex)" />
      </svg>

      <div className="absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-pearl-500/20 blur-3xl" />
      <div className="absolute -bottom-40 -left-24 h-[26rem] w-[26rem] rounded-full bg-pearl-400/10 blur-3xl" />

      <svg className="absolute right-8 top-1/3 h-64 w-64 opacity-30" viewBox="0 0 200 200">
        <g fill="none" stroke="#abeae7" strokeWidth="1.2">
          <ellipse cx="100" cy="100" rx="80" ry="30" />
          <ellipse cx="100" cy="100" rx="80" ry="30" transform="rotate(60 100 100)" />
          <ellipse cx="100" cy="100" rx="80" ry="30" transform="rotate(120 100 100)" />
        </g>
        <circle cx="100" cy="100" r="7" fill="#39bfbe" />
        <circle cx="180" cy="100" r="4" fill="#abeae7" />
        <circle cx="60" cy="31" r="4" fill="#abeae7" />
        <circle cx="60" cy="169" r="4" fill="#abeae7" />
      </svg>
    </div>
  )
}
