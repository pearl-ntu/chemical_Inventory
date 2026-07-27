import { useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Beaker,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  MailCheck,
  User,
} from 'lucide-react'
import { Logo, NtuBadge } from '../components/Logo'
import { Field, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { auth } from '../lib/api'
import { ALLOWED_EMAIL_DOMAINS, LAB_SUBTITLE, MODE, emailDomainAllowed } from '../lib/config'
import { cx } from '../lib/utils'

type Tab = 'signin' | 'signup'
type Method = 'magic' | 'password'

export default function LoginPage() {
  const { signIn, signUp } = useAuth()
  const toast = useToast()

  const [tab, setTab] = useState<Tab>('signin')
  // Magic link is the default for the cloud build — nothing to remember, and
  // nobody has to invent a password just to check a shelf. Demo mode has no
  // mail server behind it, so it falls back to a password there.
  const [method, setMethod] = useState<Method>(MODE === 'cloud' ? 'magic' : 'password')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [linkSent, setLinkSent] = useState(false)

  function switchTab(t: Tab) {
    setTab(t)
    setError(null)
    setNotice(null)
    setLinkSent(false)
  }

  async function onSubmitMagicLink(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    if (!email.trim()) return setError('Enter your email address.')
    if (tab === 'signup') {
      if (!fullName.trim()) return setError('Please enter your name — it appears on every entry you add.')
      if (!emailDomainAllowed(email)) {
        return setError(
          `Sign-ups are limited to ${ALLOWED_EMAIL_DOMAINS.join(', ')} addresses. Ask an admin if you need an exception.`,
        )
      }
    }
    setBusy(true)
    try {
      await auth.sendMagicLink(email)
      setLinkSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function onSubmitPassword(e: FormEvent) {
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

  const showMagicLinkOption = MODE === 'cloud'

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      {/* ---------------------------------------------------------------- brand */}
      <div className="relative hidden overflow-hidden bg-[#0b1830] lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* The mark itself, oversized and bled off the corner — the one
            deliberate flourish, everything else on this panel stays quiet. */}
        <Logo className="pointer-events-none absolute -right-20 -top-32 h-[26rem] w-[26rem] opacity-90" />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 90% at 15% 100%, rgba(11,24,48,0) 0%, #0b1830 65%)',
          }}
        />

        <div className="relative flex items-center gap-3">
          <Logo className="h-9 w-9" />
          <div>
            <div className="text-lg font-extrabold tracking-tight text-white">PEARL</div>
            <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/50">
              Inventory
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-[2rem] font-bold leading-[1.15] tracking-tight text-white">
            Every reagent, every shelf, one source of truth.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            Search the whole store in a keystroke, see what is running low before an experiment
            stalls, and know exactly which fridge a bottle is sitting in — from the bench, on a
            phone, without opening a spreadsheet.
          </p>

          <dl className="mt-10 flex gap-8 border-t border-white/10 pt-6">
            {[
              ['235', 'containers'],
              ['16', 'locations'],
              ['40', 'suppliers'],
            ].map(([n, l]) => (
              <div key={l}>
                <dt className="text-xl font-bold text-white">{n}</dt>
                <dd className="mt-0.5 text-xs text-white/45">{l}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative flex items-center justify-between">
          <p className="text-xs leading-snug text-white/45">{LAB_SUBTITLE}</p>
          <NtuBadge className="opacity-80 [&_span:last-child]:text-white/60" />
        </div>
      </div>

      {/* ----------------------------------------------------------------- form */}
      <div className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between gap-3 lg:hidden">
            <div className="flex items-center gap-3">
              <Logo className="h-9 w-9" />
              <div>
                <div className="text-base font-extrabold tracking-tight text-ink-900 dark:text-ink-50">
                  PEARL <span className="font-medium text-pearl-600 dark:text-pearl-400">Inventory</span>
                </div>
                <div className="text-[10px] font-medium text-ink-400">
                  Photon Emission &amp; Reactivity Lab
                </div>
              </div>
            </div>
            <NtuBadge />
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
                onClick={() => switchTab(t)}
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

          {showMagicLinkOption && (
            <div className="mt-5 mb-4 grid grid-cols-2 gap-1 rounded-lg border border-ink-200 p-1 text-xs dark:border-ink-700">
              <button
                type="button"
                onClick={() => {
                  setMethod('magic')
                  setError(null)
                  setNotice(null)
                  setLinkSent(false)
                }}
                className={cx(
                  'flex items-center justify-center gap-1.5 rounded-md py-1.5 font-semibold transition-colors',
                  method === 'magic'
                    ? 'bg-pearl-600 text-white'
                    : 'text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-800',
                )}
              >
                <MailCheck className="h-3.5 w-3.5" /> Email link
              </button>
              <button
                type="button"
                onClick={() => {
                  setMethod('password')
                  setError(null)
                  setNotice(null)
                }}
                className={cx(
                  'flex items-center justify-center gap-1.5 rounded-md py-1.5 font-semibold transition-colors',
                  method === 'password'
                    ? 'bg-pearl-600 text-white'
                    : 'text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-800',
                )}
              >
                <KeyRound className="h-3.5 w-3.5" /> Password
              </button>
            </div>
          )}

          {/* ---------------------------------------------------- magic link */}
          {method === 'magic' && showMagicLinkOption ? (
            linkSent ? (
              <div className="rounded-xl border border-pearl-200 bg-pearl-50 p-4 text-sm dark:border-pearl-500/30 dark:bg-pearl-500/10">
                <div className="flex items-center gap-2 font-semibold text-pearl-900 dark:text-pearl-100">
                  <MailCheck className="h-4 w-4" /> Check your inbox
                </div>
                <p className="mt-1.5 leading-relaxed text-pearl-800 dark:text-pearl-100/80">
                  We sent a sign-in link to <strong>{email}</strong>. Open it on this device and
                  you're in — no password needed. The link expires after an hour.
                </p>
                <button
                  className="mt-3 text-xs font-semibold text-pearl-700 underline dark:text-pearl-300"
                  onClick={() => setLinkSent(false)}
                >
                  Use a different email
                </button>
              </div>
            ) : (
              <form onSubmit={onSubmitMagicLink} className="space-y-4">
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
                      : 'We’ll email you a one-click sign-in link.'
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
                      autoFocus
                    />
                  </div>
                </Field>

                {error && <ErrorBanner message={error} />}
                {notice && <NoticeBanner message={notice} />}

                <button type="submit" className="btn-primary w-full" disabled={busy}>
                  {busy ? <Spinner /> : <MailCheck className="h-4 w-4" />}
                  Send me a sign-in link
                </button>
              </form>
            )
          ) : (
            /* -------------------------------------------------- password --- */
            <form onSubmit={onSubmitPassword} className="space-y-4">
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

              {error && <ErrorBanner message={error} />}
              {notice && <NoticeBanner message={notice} />}

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
          )}

          {MODE === 'demo' && (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-500/25 dark:bg-amber-500/10">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
                <Beaker className="h-4 w-4" /> Demo mode
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-amber-800 dark:text-amber-200/80">
                No server is connected yet, so accounts and data live in this browser only, and
                email links need a real mail setup to work — that's why you're seeing a password
                form. Sign up with any email to explore the lab's real 235-container starter
                inventory — the first account created becomes the admin. See{' '}
                <code className="font-mono">SETUP.md</code> to switch on the shared database.
              </p>
            </div>
          )}

          <p className="mt-8 text-center text-xs leading-relaxed text-ink-400">
            Photon Emission &amp; Reactivity Lab · Prof. Xiaogang Liu
            <br />
            Nanyang Technological University, Singapore
          </p>
        </div>
      </div>
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="leading-snug">{message}</p>
    </div>
  )
}

function NoticeBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-pearl-200 bg-pearl-50 p-3 text-sm leading-snug text-pearl-900 dark:border-pearl-500/30 dark:bg-pearl-500/10 dark:text-pearl-100">
      {message}
    </div>
  )
}

