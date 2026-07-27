import { useState } from 'react'
import { Cloud, Database, Download, HardDrive, RotateCcw, Save } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { ConfirmDialog, Field, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { useToast } from '../context/ToastContext'
import { auth } from '../lib/api'
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
