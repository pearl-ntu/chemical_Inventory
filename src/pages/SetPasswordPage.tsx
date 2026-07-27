import { useState } from 'react'
import { Eye, EyeOff, KeyRound, LogOut } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Field, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { auth } from '../lib/api'
import { LAB_SUBTITLE } from '../lib/config'

/**
 * Shown once, right after a magic-link/invite sign-in, to an account that's
 * never set a password (`profile.has_password === false`). The link that got
 * them here works, but it's also the *only* way back in until this runs once
 * — a slow or spam-filtered email, and they're locked out with no fallback.
 * Setting a password doesn't disable the email link either; it's additive.
 */
export default function SetPasswordPage() {
  const { profile, signOut, refresh } = useAuth()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (!profile) return
    if (newPassword.length < 8) return setError('Needs at least 8 characters.')
    if (newPassword !== confirmPassword) return setError('The two passwords don’t match.')

    setSaving(true)
    try {
      await auth.changePassword(profile.email, null, newPassword)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set your password.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <div className="mx-auto mb-6 flex justify-center">
          <Logo className="h-14 w-14" />
        </div>

        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-pearl-50 text-pearl-600 dark:bg-pearl-500/10 dark:text-pearl-400">
          <KeyRound className="h-6 w-6" />
        </div>

        <h1 className="text-center text-lg font-bold text-ink-900 dark:text-ink-50">
          Set a password
        </h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-ink-500 dark:text-ink-400">
          You signed in with an email link — one more step and you won't need a fresh one every
          time. This is for <strong className="text-ink-700 dark:text-ink-200">{profile?.email}</strong>.
        </p>

        <div className="mt-6 space-y-3">
          <Field label="New password" hint="At least 8 characters.">
            <input
              className="input"
              type={showPasswords ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />
          </Field>
          <Field label="Confirm password">
            <input
              className="input"
              type={showPasswords ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </Field>

          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}

          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-700 dark:hover:text-ink-300"
            onClick={() => setShowPasswords((s) => !s)}
          >
            {showPasswords ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showPasswords ? 'Hide' : 'Show'} passwords
          </button>

          <div className="flex flex-col gap-2 pt-1">
            <button className="btn-primary" onClick={() => void submit()} disabled={saving}>
              {saving ? <Spinner /> : <KeyRound className="h-4 w-4" />} Set password and continue
            </button>
            <button className="btn-secondary" onClick={() => void signOut()}>
              <LogOut className="h-4 w-4" /> Sign out instead
            </button>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-ink-400">{LAB_SUBTITLE}</p>
      </div>
    </div>
  )
}
