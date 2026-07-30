import { useState } from 'react'
import { Clock, LogOut, RefreshCw, Save, UserRound } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { auth } from '../lib/api'
import { LAB_SUBTITLE } from '../lib/config'

/**
 * Shown to a signed-in account that hasn't been approved yet. Sign-up is open
 * to any email address, so this — not the sign-up form — is the actual gate:
 * the account exists, but Row Level Security means it can't read a single row
 * of the inventory until an admin flips it on from the Members page.
 */
export default function PendingApprovalPage() {
  const { profile, signOut, refresh } = useAuth()
  const [checking, setChecking] = useState(false)
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const emailName = profile?.email.split('@')[0]?.toLowerCase() ?? ''
  const needsName =
    !profile?.full_name.trim() || profile.full_name.trim().toLowerCase() === emailName

  async function checkAgain() {
    setChecking(true)
    try {
      await refresh()
    } finally {
      setChecking(false)
    }
  }

  async function saveName() {
    const name = fullName.trim()
    if (!profile) return
    if (name.length < 2) {
      setNameError('Enter the name your lab admin will recognise.')
      return
    }

    setSavingName(true)
    setNameError(null)
    try {
      await auth.updateProfile(profile.id, { full_name: name })
      await refresh()
    } catch (error) {
      setNameError(error instanceof Error ? error.message : 'Could not save your name.')
    } finally {
      setSavingName(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center px-5">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 flex justify-center">
          <Logo className="h-14 w-14" />
        </div>

        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
          <Clock className="h-6 w-6" />
        </div>

        <h1 className="text-lg font-bold text-ink-900 dark:text-ink-50">Waiting for approval</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500 dark:text-ink-400">
          Your account (<strong className="text-ink-700 dark:text-ink-200">{profile?.email}</strong>)
          is signed in, but an admin hasn't let it into the inventory yet. This is normal — it
          happens for every new account. You&apos;ll see the shelf the moment you&apos;re approved.
        </p>

        {needsName && (
          <div className="mt-5 rounded-xl border border-ink-200 bg-white p-4 text-left dark:border-ink-800 dark:bg-ink-900">
            <label
              className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-ink-800 dark:text-ink-100"
              htmlFor="pending-full-name"
            >
              <UserRound className="h-4 w-4" /> Tell the admin who you are
            </label>
            <p className="mb-3 text-xs text-ink-500 dark:text-ink-400">
              This name will appear with your approval request and inventory activity.
            </p>
            <div className="flex gap-2">
              <input
                id="pending-full-name"
                className="input min-w-0"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Your full name"
                autoComplete="name"
                onKeyDown={(event) => event.key === 'Enter' && void saveName()}
              />
              <button
                type="button"
                className="btn-secondary shrink-0"
                onClick={() => void saveName()}
                disabled={savingName}
              >
                {savingName ? <Spinner /> : <Save className="h-4 w-4" />} Save
              </button>
            </div>
            {nameError && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{nameError}</p>}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <button className="btn-primary" onClick={() => void checkAgain()} disabled={checking}>
            {checking ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Check again
          </button>
          <button className="btn-secondary" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>

        <p className="mt-8 text-xs text-ink-400">{LAB_SUBTITLE}</p>
      </div>
    </div>
  )
}
