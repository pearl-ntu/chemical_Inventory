import { useEffect, useState } from 'react'
import { ShieldCheck, Users } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { EmptyState, LoadingScreen } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import type { Profile, Role } from '../lib/types'
import { formatDate } from '../lib/utils'

const ROLE_HELP: Record<Role, string> = {
  admin: 'Full control: additions go live immediately, plus approving/rejecting others’ submissions, deleting records, and changing what people can do.',
  member: 'Can add and edit containers, but a new registration waits in the Approvals queue for an admin to sign off before the group sees it.',
  viewer: 'Read-only. Useful for visitors, collaborators and undergraduates.',
}

export default function MembersPage() {
  const { profile, isAdmin } = useAuth()
  const toast = useToast()

  const [members, setMembers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    api
      .listProfiles()
      .then(setMembers)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not load members.'))
      .finally(() => setLoading(false))
  }, [toast])

  async function changeRole(id: string, role: Role) {
    setSaving(id)
    try {
      await api.setRole(id, role)
      setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, role } : m)))
      toast.success('Access level updated.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change that role.')
    } finally {
      setSaving(null)
    }
  }

  if (!isAdmin) {
    return (
      <EmptyState
        icon={<ShieldCheck className="h-6 w-6" />}
        title="Admins only"
        description="Ask an admin in the group if you need to manage member access."
      />
    )
  }

  if (loading) return <LoadingScreen label="Loading members…" />

  const adminCount = members.filter((m) => m.role === 'admin').length

  return (
    <>
      <PageHeader
        title="Members"
        description="Everyone with an account, and what they are allowed to do."
      />

      {members.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Users className="h-6 w-6" />} title="No accounts yet" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead className="border-b border-ink-200 bg-ink-50 dark:border-ink-800 dark:bg-ink-950/50">
                <tr>
                  <th className="th">Name</th>
                  <th className="th">Email</th>
                  <th className="th">Position</th>
                  <th className="th">Joined</th>
                  <th className="th">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {members.map((m) => {
                  // Never let the last admin demote themselves out of the account.
                  const isLastAdmin = m.role === 'admin' && adminCount === 1
                  return (
                    <tr key={m.id}>
                      <td className="td font-medium text-ink-900 dark:text-ink-50">
                        {m.full_name}
                        {m.id === profile?.id && (
                          <span className="ml-2 text-xs font-normal text-ink-400">you</span>
                        )}
                      </td>
                      <td className="td text-ink-500">{m.email}</td>
                      <td className="td text-ink-500">{m.lab_position ?? '—'}</td>
                      <td className="td whitespace-nowrap text-xs text-ink-400">
                        {formatDate(m.created_at.slice(0, 10))}
                      </td>
                      <td className="td">
                        <select
                          className="input py-1 text-xs"
                          value={m.role}
                          disabled={saving === m.id || isLastAdmin}
                          title={
                            isLastAdmin
                              ? 'This is the only admin — promote someone else first.'
                              : ROLE_HELP[m.role]
                          }
                          onChange={(e) => void changeRole(m.id, e.target.value as Role)}
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card mt-4 p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-500">
          What the levels mean
        </h2>
        <dl className="space-y-2.5 text-sm">
          {(Object.keys(ROLE_HELP) as Role[]).map((role) => (
            <div key={role} className="flex gap-3">
              <dt className="w-20 shrink-0 font-semibold capitalize text-ink-800 dark:text-ink-100">
                {role}
              </dt>
              <dd className="text-ink-500 dark:text-ink-400">{ROLE_HELP[role]}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-ink-400">
          These rules are enforced by the database itself, not just by the interface — a viewer
          cannot write to the inventory even with the browser console open.
        </p>
      </div>
    </>
  )
}
