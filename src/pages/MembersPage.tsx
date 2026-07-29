import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Mail, RotateCw, ShieldCheck, ShieldOff, Trash2, UserPlus, Users, X } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { ConfirmDialog, EmptyState, Field, LoadingScreen, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api, auth } from '../lib/api'
import { MODE } from '../lib/config'
import type { Invite, Profile, Role } from '../lib/types'
import { useCooldown } from '../lib/useCooldown'
import { formatDate, formatRelative } from '../lib/utils'

const ROLE_HELP: Record<Role, string> = {
  admin: 'Full control: approving new accounts, deleting records, and changing what others can do.',
  member: 'Can add, edit and mark containers empty. The right level for most people, once approved.',
  viewer: 'Read-only. Useful for visitors, collaborators and undergraduates.',
}

export default function MembersPage() {
  const { profile, isAdmin } = useAuth()
  const toast = useToast()

  const [members, setMembers] = useState<Profile[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<
    | { kind: 'revoke'; member: Profile }
    | { kind: 'remove'; member: Profile }
    | null
  >(null)

  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)

  // Resending the same invite too soon in a row is exactly what triggers a
  // receiving mail server to throttle the sender — a burst reads as spammy
  // even though it's the same one email each time. A visible cooldown stops
  // that click-it-again reflex instead of just quietly failing later.
  const resendCooldown = useCooldown()

  function load() {
    return Promise.all([api.listProfiles(), api.listInvites()]).then(([m, i]) => {
      setMembers(m)
      setInvites(i)
    })
  }

  useEffect(() => {
    load()
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not load members.'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pending = useMemo(
    () => members.filter((m) => !m.approved).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [members],
  )
  const approvedMembers = useMemo(() => members.filter((m) => m.approved), [members])
  const adminCount = approvedMembers.filter((m) => m.role === 'admin').length

  // An invite "resolves" the moment its email shows up as a real account —
  // pending or approved, it doesn't matter, it's no longer just an email
  // that vanished into the void.
  const outstandingInvites = useMemo(
    () =>
      invites.filter(
        (inv) => !members.some((m) => m.email.toLowerCase() === inv.email.toLowerCase()),
      ),
    [invites, members],
  )

  async function sendInvite(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    if (!inviteEmail.trim()) return toast.error('Enter an email address to invite.')
    if (members.some((m) => m.email.toLowerCase() === inviteEmail.trim().toLowerCase())) {
      return toast.error('That email already has an account — approve it below instead.')
    }
    if (outstandingInvites.some((inv) => inv.email.toLowerCase() === inviteEmail.trim().toLowerCase())) {
      return toast.error('Already invited — use Resend below instead of inviting again.')
    }

    setInviting(true)
    try {
      const invite = await api.sendInvite(inviteEmail, inviteName, profile)
      setInvites((prev) => [invite, ...prev])
      toast.success(
        `Invite sent to ${inviteEmail}. If they don't see it, check spam — see Settings for why that happens.`,
      )
      setInviteName('')
      setInviteEmail('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send that invite.')
    } finally {
      setInviting(false)
    }
  }

  async function resend(inv: Invite) {
    setSaving(inv.id)
    try {
      await auth.inviteMember(inv.email, inv.full_name ?? '')
      toast.success(`Invite re-sent to ${inv.email}.`)
      resendCooldown.start(inv.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not resend that invite.')
    } finally {
      setSaving(null)
    }
  }

  async function sendMemberLink(target: Profile) {
    setSaving(target.id)
    try {
      await auth.inviteMember(target.email, target.full_name)
      toast.success(`Sign-in email sent to ${target.email}.`)
      resendCooldown.start(target.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send that email.')
    } finally {
      setSaving(null)
    }
  }

  async function cancel(inv: Invite) {
    setSaving(inv.id)
    try {
      await api.cancelInvite(inv.id)
      setInvites((prev) => prev.filter((i) => i.id !== inv.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove that invite.')
    } finally {
      setSaving(null)
    }
  }

  async function approve(target: Profile) {
    if (!profile) return
    setSaving(target.id)
    try {
      await api.approveAccount(target, profile)
      setMembers((prev) =>
        prev.map((m) => (m.id === target.id ? { ...m, approved: true, role: target.role === 'viewer' ? 'member' : target.role } : m)),
      )
      toast.success(`${target.full_name} can now sign in.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not approve that account.')
    } finally {
      setSaving(null)
    }
  }

  async function changeRole(target: Profile, role: Role) {
    if (!profile) return
    setSaving(target.id)
    try {
      await api.setRole(target, role, profile)
      setMembers((prev) => prev.map((m) => (m.id === target.id ? { ...m, role } : m)))
      toast.success('Access level updated.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change that role.')
    } finally {
      setSaving(null)
    }
  }

  async function revoke(target: Profile) {
    if (!profile) return
    setSaving(target.id)
    try {
      await api.revokeAccount(target, profile)
      setMembers((prev) =>
        prev.map((m) => (m.id === target.id ? { ...m, approved: false, role: 'viewer' } : m)),
      )
      toast.success(`${target.full_name} can no longer see the inventory.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revoke that account.')
    } finally {
      setSaving(null)
      setConfirm(null)
    }
  }

  async function removeAccess(target: Profile) {
    if (!profile) return
    setSaving(target.id)
    try {
      await api.removeMemberAccess(target, profile)
      setMembers((prev) => prev.filter((m) => m.id !== target.id))
      toast.success(`${target.full_name} removed from the member list.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove that member.')
    } finally {
      setSaving(null)
      setConfirm(null)
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

  return (
    <>
      <PageHeader
        title="Members"
        description="Everyone with an account, and what they are allowed to do. Sign-up is open to any email — nobody sees the inventory until you approve them here."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[
          ['Approved', approvedMembers.length],
          ['Waiting', pending.length],
          ['Invited', outstandingInvites.length],
          ['Admins', adminCount],
        ].map(([label, value]) => (
          <div key={label} className="card px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
            <p className="mt-1 text-2xl font-bold text-ink-900 dark:text-ink-50">{value}</p>
          </div>
        ))}
      </div>

      {/* invite ---------------------------------------------------------------- */}
      <section className="card mb-4 p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-800 dark:text-ink-100">
          <Mail className="h-4 w-4 text-pearl-600" /> Invite someone
        </h2>
        <p className="mb-3 text-xs text-ink-500 dark:text-ink-400">
          {MODE === 'cloud'
            ? 'Sends a one-click sign-in link. They still have to open it to actually create the account — there\'s no way around that without a password to hand them — but it saves them finding the app themselves. It\'s recorded below the moment you send it, so it can\'t quietly disappear.'
            : 'Demo mode has no email to send — anyone can just sign up directly from the login page instead.'}
        </p>
        <form onSubmit={(e) => void sendInvite(e)} className="flex flex-wrap items-end gap-2">
          <div className="w-full sm:w-48">
            <Field label="Name">
              <input
                className="input"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Dr. Takuya Tanaka"
                disabled={MODE !== 'cloud'}
              />
            </Field>
          </div>
          <div className="w-full flex-1 sm:w-auto">
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="them@e.ntu.edu.sg"
                disabled={MODE !== 'cloud'}
              />
            </Field>
          </div>
          <button className="btn-primary" disabled={inviting || MODE !== 'cloud'}>
            {inviting ? <Spinner /> : <UserPlus className="h-4 w-4" />} Send invite
          </button>
        </form>
      </section>

      {/* invited, not yet joined ------------------------------------------------ */}
      {outstandingInvites.length > 0 && (
        <section className="card mb-4">
          <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5 dark:border-ink-800 dark:bg-ink-950/50">
            <Mail className="h-4 w-4 text-ink-500" />
            <h2 className="text-sm font-semibold text-ink-700 dark:text-ink-200">
              Invited, not yet joined ({outstandingInvites.length})
            </h2>
          </div>
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {outstandingInvites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink-900 dark:text-ink-50">
                    {inv.full_name || inv.email}
                  </p>
                  <p className="text-xs text-ink-500">
                    {inv.email} · invited by {inv.invited_by_name ?? 'an admin'} ·{' '}
                    {formatRelative(inv.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    className="btn-secondary py-1.5"
                    disabled={saving === inv.id || resendCooldown.secondsLeft(inv.id) > 0}
                    onClick={() => void resend(inv)}
                    title={
                      resendCooldown.secondsLeft(inv.id) > 0
                        ? 'Sending it again this soon is what makes a mail server start throttling it'
                        : 'Send the sign-in email again'
                    }
                  >
                    {saving === inv.id ? <Spinner /> : <RotateCw className="h-3.5 w-3.5" />}
                    {resendCooldown.secondsLeft(inv.id) > 0
                      ? `Resend in ${resendCooldown.secondsLeft(inv.id)}s`
                      : 'Resend'}
                  </button>
                  <button
                    className="btn-ghost py-1.5 text-ink-500"
                    disabled={saving === inv.id}
                    onClick={() => void cancel(inv)}
                    title="Remove this invite"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* pending approval ---------------------------------------------------- */}
      {pending.length > 0 && (
        <section className="card mb-4 border-amber-200 dark:border-amber-500/30">
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-500/25 dark:bg-amber-500/10">
            <UserPlus className="h-4 w-4 text-amber-700 dark:text-amber-400" />
            <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Waiting for approval ({pending.length})
            </h2>
          </div>
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {pending.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink-900 dark:text-ink-50">{m.full_name}</p>
                  <p className="text-xs text-ink-500">
                    {m.email} · signed up {formatRelative(m.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    className="btn-secondary py-1.5"
                    disabled={saving === m.id || resendCooldown.secondsLeft(m.id) > 0}
                    onClick={() => void sendMemberLink(m)}
                  >
                    {saving === m.id ? <Spinner /> : <Mail className="h-4 w-4" />}
                    {resendCooldown.secondsLeft(m.id) > 0
                      ? `Email in ${resendCooldown.secondsLeft(m.id)}s`
                      : 'Send email'}
                  </button>
                  <button
                    className="btn-primary py-1.5"
                    disabled={saving === m.id}
                    onClick={() => void approve(m)}
                  >
                    {saving === m.id ? <Spinner /> : <Check className="h-4 w-4" />} Approve
                  </button>
                  <button
                    className="btn-ghost py-1.5 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                    disabled={saving === m.id}
                    onClick={() => setConfirm({ kind: 'remove', member: m })}
                  >
                    <Trash2 className="h-4 w-4" /> Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* approved members ----------------------------------------------------- */}
      {approvedMembers.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Users className="h-6 w-6" />} title="No approved accounts yet" />
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
                  <th className="th">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {approvedMembers.map((m) => {
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
                          onChange={(e) => void changeRole(m, e.target.value as Role)}
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            className="btn-secondary py-1.5 text-xs"
                            disabled={saving === m.id || resendCooldown.secondsLeft(m.id) > 0}
                            onClick={() => void sendMemberLink(m)}
                            title="Send a fresh magic sign-in email"
                          >
                            {saving === m.id ? <Spinner /> : <Mail className="h-3.5 w-3.5" />}
                            {resendCooldown.secondsLeft(m.id) > 0
                              ? `${resendCooldown.secondsLeft(m.id)}s`
                              : 'Email'}
                          </button>
                          <button
                            className="btn-secondary py-1.5 text-xs"
                            disabled={saving === m.id || isLastAdmin}
                            onClick={() => setConfirm({ kind: 'revoke', member: m })}
                            title={
                              isLastAdmin
                                ? 'This is the only admin — promote someone else first.'
                                : 'Move them back to waiting for approval'
                            }
                          >
                            <ShieldOff className="h-3.5 w-3.5" /> Revoke
                          </button>
                          <button
                            className="btn-ghost py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                            disabled={saving === m.id || isLastAdmin || m.id === profile?.id}
                            onClick={() => setConfirm({ kind: 'remove', member: m })}
                            title={
                              m.id === profile?.id
                                ? 'You cannot remove yourself.'
                                : isLastAdmin
                                  ? 'This is the only admin — promote someone else first.'
                                  : 'Remove this profile from the member list'
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Remove
                          </button>
                        </div>
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
          These rules are enforced by the database itself, not just by the interface — an
          unapproved account cannot read a single row of the inventory even with the browser
          console open, and a viewer cannot write to it. A role can only be set once someone
          actually has an account — that's what separates "invited" from "waiting for approval"
          above.
        </p>
      </div>

      <ConfirmDialog
        open={confirm?.kind === 'revoke'}
        title="Revoke inventory access?"
        confirmLabel="Revoke access"
        busy={confirm ? saving === confirm.member.id : false}
        message={
          confirm?.kind === 'revoke' ? (
            <>
              <p>
                <strong>{confirm.member.full_name}</strong> will be moved back to waiting for
                approval and will no longer be able to see the inventory.
              </p>
              <p className="mt-2">You can approve them again later.</p>
            </>
          ) : null
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'revoke') void revoke(confirm.member)
        }}
      />

      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        title="Remove this member profile?"
        destructive
        confirmLabel="Remove access"
        busy={confirm ? saving === confirm.member.id : false}
        message={
          confirm?.kind === 'remove' ? (
            <>
              <p>
                <strong>{confirm.member.full_name}</strong> will be removed from the member list and
                will lose inventory access.
              </p>
              <p className="mt-2">
                This removes the app profile, not the underlying Supabase Auth user. If they sign in
                again, they will land outside the inventory until an admin approves them.
              </p>
            </>
          ) : null
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'remove') void removeAccess(confirm.member)
        }}
      />
    </>
  )
}
