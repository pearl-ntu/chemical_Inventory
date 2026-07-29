import { useState } from 'react'
import {
  Cloud,
  Database,
  Download,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Palette,
  RotateCcw,
  Save,
} from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { ConfirmDialog, Field, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import { auth } from '../lib/api'
import {
  APPEARANCE_THEMES,
  getStoredAppearanceTheme,
  saveAppearanceTheme,
  type AppearanceTheme,
} from '../lib/appearance'
import { LAB_NAME, LAB_SUBTITLE, MODE, SUPABASE_URL } from '../lib/config'
import { toCSV } from '../lib/csv'
import { localDb } from '../lib/localDb'
import { download, todayISO } from '../lib/utils'

export default function SettingsPage() {
  const { profile, refresh } = useAuth()
  const { chemicals, reload } = useInventory()
  const toast = useToast()

  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [position, setPosition] = useState(profile?.lab_position ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [appearanceTheme, setAppearanceTheme] = useState<AppearanceTheme>(() => getStoredAppearanceTheme())

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  async function changePassword() {
    setPasswordError(null)
    if (!profile) return
    // Demo mode is password-only, so there's always one to verify. In cloud
    // mode someone who only ever used a magic link has none yet — leaving
    // this blank sets their first password instead of changing one.
    if (!currentPassword && MODE !== 'cloud') return setPasswordError('Enter your current password.')
    if (newPassword.length < 8) return setPasswordError('New password needs at least 8 characters.')
    if (newPassword !== confirmPassword) return setPasswordError('The two new passwords don’t match.')

    setChangingPassword(true)
    try {
      await auth.changePassword(profile.email, currentPassword || null, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Password changed.')
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Could not change your password.')
    } finally {
      setChangingPassword(false)
    }
  }

  async function saveProfile() {
    if (!profile) return
    setSaving(true)
    try {
      await auth.updateProfile(profile.id, {
        full_name: fullName.trim() || profile.full_name,
        lab_position: position.trim() || null,
      })
      await refresh()
      toast.success('Profile saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save your profile.')
    } finally {
      setSaving(false)
    }
  }

  function chooseAppearanceTheme(theme: AppearanceTheme) {
    setAppearanceTheme(theme)
    saveAppearanceTheme(theme)
    toast.success('Theme updated.')
  }

  return (
    <>
      <PageHeader title="Settings" description="Your account, and how this copy of the app is set up." />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* profile ------------------------------------------------------- */}
        <section className="card p-5">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-500">
            Your profile
          </h2>
          <div className="space-y-3">
            <Field label="Full name" hint="Shown on every entry you register or edit.">
              <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <Field label="Position in the group">
              <input
                className="input"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="PhD student · Research Fellow · PI"
              />
            </Field>
            <Field label="Email">
              <input className="input" value={profile?.email ?? ''} disabled />
            </Field>
            <Field label="Access level">
              <input className="input capitalize" value={profile?.role ?? ''} disabled />
            </Field>
            <button className="btn-primary" onClick={() => void saveProfile()} disabled={saving}>
              {saving ? <Spinner /> : <Save className="h-4 w-4" />} Save profile
            </button>
          </div>
        </section>

        {/* password -------------------------------------------------------- */}
        <section className="card p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-500">
            <KeyRound className="h-4 w-4" /> Password
          </h2>
          <div className="space-y-3">
            <Field
              label="Current password"
              hint={
                MODE === 'cloud'
                  ? 'Leave blank if you only ever signed in with an email link.'
                  : undefined
              }
            >
              <input
                className="input"
                type={showPasswords ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field label="New password" hint="At least 8 characters.">
              <input
                className="input"
                type={showPasswords ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirm new password">
              <input
                className="input"
                type={showPasswords ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>

            {passwordError && (
              <p className="text-xs text-rose-600 dark:text-rose-400">{passwordError}</p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="btn-primary"
                onClick={() => void changePassword()}
                disabled={changingPassword}
              >
                {changingPassword ? <Spinner /> : <KeyRound className="h-4 w-4" />} Change password
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-700 dark:hover:text-ink-300"
                onClick={() => setShowPasswords((s) => !s)}
              >
                {showPasswords ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPasswords ? 'Hide' : 'Show'} passwords
              </button>
            </div>
          </div>
        </section>

        {/* appearance ----------------------------------------------------- */}
        <section className="card p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-500">
            <Palette className="h-4 w-4" /> Appearance
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {APPEARANCE_THEMES.map((theme) => {
              const selected = theme.id === appearanceTheme
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => chooseAppearanceTheme(theme.id)}
                  className={[
                    'rounded-lg border p-3 text-left transition-colors',
                    selected
                      ? 'border-pearl-500 bg-pearl-50 ring-1 ring-pearl-500 dark:bg-pearl-500/10'
                      : 'border-ink-200 hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-800',
                  ].join(' ')}
                >
                  <div className="mb-2 flex items-center gap-1.5">
                    {theme.swatches.map((color) => (
                      <span
                        key={color}
                        className="h-4 w-4 rounded-full border border-white shadow-sm ring-1 ring-ink-200 dark:ring-ink-700"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{theme.name}</p>
                  <p className="mt-0.5 text-xs leading-snug text-ink-500 dark:text-ink-400">
                    {theme.description}
                  </p>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-ink-400">
            This only changes your browser view; it does not affect other lab members.
          </p>
        </section>

        {/* deployment ---------------------------------------------------- */}
        <section className="card p-5">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-500">
            This installation
          </h2>

          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3 rounded-lg border border-ink-200 p-3 dark:border-ink-800">
              {MODE === 'cloud' ? (
                <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              ) : (
                <HardDrive className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              )}
              <div>
                <p className="font-semibold text-ink-900 dark:text-ink-50">
                  {MODE === 'cloud' ? 'Shared cloud database' : 'Demo mode — this browser only'}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                  {MODE === 'cloud' ? (
                    <>
                      Connected to <code className="font-mono">{new URL(SUPABASE_URL).host}</code>.
                      Accounts, permissions and the inventory are shared across the whole group in
                      real time.
                    </>
                  ) : (
                    <>
                      Nothing is shared. To switch the group on to one live database, create a free
                      Supabase project, run <code className="font-mono">supabase/schema.sql</code>,
                      and put the two keys in a <code className="font-mono">.env</code> file.{' '}
                      <code className="font-mono">SETUP.md</code> walks through it in about ten
                      minutes.
                    </>
                  )}
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-ink-50 p-3 dark:bg-ink-950">
                <dt className="text-ink-500">Group</dt>
                <dd className="mt-0.5 font-semibold text-ink-800 dark:text-ink-100">{LAB_NAME}</dd>
              </div>
              <div className="rounded-lg bg-ink-50 p-3 dark:bg-ink-950">
                <dt className="text-ink-500">Containers</dt>
                <dd className="mt-0.5 font-semibold text-ink-800 dark:text-ink-100">
                  {chemicals.length}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-ink-400">{LAB_SUBTITLE}</p>
          </div>
        </section>

        {/* data ---------------------------------------------------------- */}
        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-ink-500">Your data</h2>
          <p className="mb-4 text-xs text-ink-500 dark:text-ink-400">
            The inventory is yours. Export it whenever you like — a plain CSV that opens in Excel and
            can be re-imported into this or any other system.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              onClick={() => {
                download(
                  `pearl-inventory-full-${todayISO()}.csv`,
                  toCSV(chemicals),
                  'text/csv;charset=utf-8',
                )
                toast.success(`Exported all ${chemicals.length} records.`)
              }}
            >
              <Download className="h-4 w-4" /> Export everything as CSV
            </button>

            <button className="btn-secondary" onClick={() => void reload()}>
              <RotateCcw className="h-4 w-4" /> Refresh from the database
            </button>

            {MODE === 'demo' && (
              <button className="btn-secondary text-rose-600" onClick={() => setConfirmReset(true)}>
                <Database className="h-4 w-4" /> Reset demo data
              </button>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset the demo inventory?"
        destructive
        confirmLabel="Reset to the starter data"
        message="Every change you have made in this browser is discarded and the original 235 containers are restored. Accounts on this device are left alone."
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          localDb.resetChemicals()
          await reload()
          setConfirmReset(false)
          toast.success('Demo data reset.')
        }}
      />
    </>
  )
}
