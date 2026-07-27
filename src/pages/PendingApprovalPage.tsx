import { useState } from 'react'
import { Clock, LogOut, RefreshCw } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
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

  async function checkAgain() {
    setChecking(true)
    try {
      await refresh()
    } finally {
      setChecking(false)
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
          happens for every new sign-up. Nothing to do but wait; you'll see the shelf the moment
          you're approved.
        </p>

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
