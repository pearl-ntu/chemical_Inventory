import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Check, ChevronDown, Database, FlaskConical, Info, Mail, MoreVertical, RotateCw, ShieldCheck, ShieldOff, Trash2, UserCheck, UserPlus, Users, X } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { ConfirmDialog, EmptyState, Field, LoadingScreen, Modal, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api, auth } from '../lib/api'
import { MODE } from '../lib/config'
import type { Invite, MemberOffboardingSummary, OffboardingItem, OwnershipTransferInput, Profile, Role } from '../lib/types'
import { useCooldown } from '../lib/useCooldown'
import { formatRelative } from '../lib/utils'

const ROLE_HELP: Record<Role, string> = {
  admin: 'Full control: approving new accounts, deleting records, and changing what others can do.',
  member: 'Can add, edit and mark containers empty. The right level for most people, once approved.',
  viewer: 'Read-only. Useful for visitors, collaborators and undergraduates.',
}

const DEVELOPER_EMAIL = 'abedisyedaliabbas@gmail.com'

const AVATAR_CHOICES = [
  { key: 'pearl', label: 'Pearl' },
  { key: 'emerald', label: 'Emerald' },
  { key: 'violet', label: 'Violet' },
  { key: 'amber', label: 'Amber' },
  { key: 'rose', label: 'Rose' },
  { key: 'ink', label: 'Ink' },
]

function isDeveloperProfile(member: Profile) {
  return member.email.toLowerCase() === DEVELOPER_EMAIL
}

export default function MembersPage() {
  const { profile, isAdmin, isPi } = useAuth()
  const toast = useToast()

  const [members, setMembers] = useState<Profile[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<
    | { kind: 'revoke'; member: Profile }
    | { kind: 'remove'; member: Profile }
    | null
  >(null)
  const [offboarding, setOffboarding] = useState<{
    member: Profile
    summary: MemberOffboardingSummary | null
    destinations: Record<string, string>
  } | null>(null)
  const [offboardingBusy, setOffboardingBusy] = useState(false)
  const [roleMenuFor, setRoleMenuFor] = useState<string | null>(null)
  const [actionMenuFor, setActionMenuFor] = useState<string | null>(null)
  const [avatarMenuFor, setAvatarMenuFor] = useState<string | null>(null)
  const [positionEditFor, setPositionEditFor] = useState<string | null>(null)
  const [positionDraft, setPositionDraft] = useState('')
  const [showRoleHelp, setShowRoleHelp] = useState(false)

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

  useEffect(() => {
    const refreshOnFocus = () => {
      void load().catch(() => {
        // The visible Refresh button provides a clear retry path if this
        // background refresh happens while the connection is unavailable.
      })
    }
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshMembers() {
    setRefreshing(true)
    try {
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not refresh members.')
    } finally {
      setRefreshing(false)
    }
  }

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
        `Invite sent to ${inviteEmail}. They can click the email link, or paste the code on the PEARL sign-in page.`,
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
      toast.success(`Invite re-sent to ${inv.email}. They can use the link or the email code.`)
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
      toast.success(`Sign-in email sent to ${target.email}. They can use the link or the email code.`)
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
    if (isDeveloperProfile(target)) {
      toast.error('The PEARL developer account cannot be demoted or role-changed.')
      return
    }
    if (target.is_pi && !profile.is_pi) {
      toast.error('Only the PI can change the PI account’s access level.')
      return
    }
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

  async function togglePi(target: Profile) {
    if (!profile) return
    if (isDeveloperProfile(target)) {
      toast.error('The PEARL developer account is protected from PI controls.')
      return
    }
    const next = !target.is_pi
    setSaving(target.id)
    try {
      await api.setPiFlag(target, next, profile)
      setMembers((prev) => prev.map((m) => (m.id === target.id ? { ...m, is_pi: next } : m)))
      toast.success(next ? `${target.full_name} is now PI.` : `${target.full_name} is no longer PI.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the PI flag.')
    } finally {
      setSaving(null)
    }
  }

  async function updateMemberProfile(target: Profile, patch: Partial<Profile>) {
    if (!profile) return
    setSaving(target.id)
    try {
      const updated = await auth.updateProfile(target.id, patch)
      setMembers((prev) => prev.map((member) => (member.id === target.id ? { ...member, ...updated } : member)))
      toast.success('Member profile updated.')
    } catch (err) {
      if (
        'avatar_key' in patch &&
        err instanceof Error &&
        err.message.toLowerCase().includes('avatar_key')
      ) {
        const avatarKey = patch.avatar_key ?? null
        if (avatarKey) localStorage.setItem(localAvatarStorageKey(target.id), avatarKey)
        setMembers((prev) => prev.map((member) => (member.id === target.id ? { ...member, avatar_key: avatarKey } : member)))
        toast.success('Avatar saved in this browser. Run the avatar SQL upgrade to save it for everyone.')
        return
      }
      toast.error(err instanceof Error ? err.message : 'Could not update this member.')
    } finally {
      setSaving(null)
    }
  }

  function startPositionEdit(member: Profile) {
    setActionMenuFor(null)
    setAvatarMenuFor(null)
    setRoleMenuFor(null)
    setPositionEditFor(member.id)
    setPositionDraft(member.lab_position ?? '')
  }

  async function savePosition(member: Profile) {
    const next = positionDraft.trim() || null
    setPositionEditFor(null)
    await updateMemberProfile(member, { lab_position: next })
  }

  async function chooseAvatar(member: Profile, avatarKey: string) {
    setAvatarMenuFor(null)
    await updateMemberProfile(member, { avatar_key: avatarKey })
  }

  async function revoke(target: Profile) {
    if (!profile) return
    if (isDeveloperProfile(target)) {
      toast.error('The PEARL developer account cannot be revoked.')
      return
    }
    if (target.is_pi && !profile.is_pi) {
      toast.error('Only the PI can revoke the PI account’s access.')
      return
    }
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
    if (isDeveloperProfile(target)) {
      toast.error('The PEARL developer account cannot be removed.')
      return
    }
    if (target.is_pi && !profile.is_pi) {
      toast.error('Only the PI can remove the PI account.')
      return
    }
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

  async function openOffboarding(target: Profile) {
    if (isDeveloperProfile(target)) {
      toast.error('The PEARL developer account cannot be offboarded.')
      return
    }
    if (target.is_pi && !profile?.is_pi) {
      toast.error('Only the PI can start handover for the PI account.')
      return
    }
    setOffboarding({ member: target, summary: null, destinations: {} })
    setOffboardingBusy(true)
    try {
      const summary = await api.getMemberOffboardingSummary(target)
      setOffboarding({ member: target, summary, destinations: {} })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load handover details.')
      setOffboarding(null)
    } finally {
      setOffboardingBusy(false)
    }
  }

  function handoverItems(summary: MemberOffboardingSummary | null): OffboardingItem[] {
    return summary ? [...summary.chemicals, ...summary.research_assets] : []
  }

  function setDestination(resourceId: string, memberId: string) {
    setOffboarding((current) =>
      current
        ? { ...current, destinations: { ...current.destinations, [resourceId]: memberId } }
        : current,
    )
  }

  function applyBulkDestination(memberId: string) {
    setOffboarding((current) => {
      if (!current?.summary) return current
      return {
        ...current,
        destinations: Object.fromEntries(
          handoverItems(current.summary).map((item) => [item.resource_id, memberId]),
        ),
      }
    })
  }

  async function transferOffboardingItems(revokeAfter = false) {
    if (!profile || !offboarding?.summary) return
    const transfers: OwnershipTransferInput[] = handoverItems(offboarding.summary)
      .map((item) => ({
        resource_type: item.resource_type,
        resource_id: item.resource_id,
        to_member_id: offboarding.destinations[item.resource_id],
      }))
      .filter((transfer) => transfer.to_member_id)
    if (transfers.length !== handoverItems(offboarding.summary).length) {
      toast.error('Choose a new owner for every chemical and computational asset first.')
      return
    }

    setOffboardingBusy(true)
    try {
      const summary = await api.transferMemberOwnership(offboarding.member, transfers, profile)
      setOffboarding((current) => current && { ...current, summary, destinations: {} })
      toast.success(`Transferred ${transfers.length} item${transfers.length === 1 ? '' : 's'}.`)
      if (revokeAfter) {
        await revoke(offboarding.member)
        setOffboarding(null)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not complete handover.')
    } finally {
      setOffboardingBusy(false)
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

  const offboardingItems = handoverItems(offboarding?.summary ?? null)
  const handoverDestinations = approvedMembers.filter((m) => m.id !== offboarding?.member.id)
  const assignedCount = offboardingItems.filter((item) => offboarding?.destinations[item.resource_id]).length

  return (
    <>
      <PageHeader
        title="Members"
        description="Everyone with an account, and what they are allowed to do. Sign-up is open to any email — nobody sees the inventory until you approve them here."
        actions={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void refreshMembers()}
            disabled={refreshing}
          >
            {refreshing ? <Spinner /> : <RotateCw className="h-4 w-4" />} Refresh
          </button>
        }
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
            ? 'Sends a PEARL sign-in email. The recipient can click the link, or copy the short code from the email into the PEARL sign-in page. The invite is recorded below the moment you send it, so it cannot quietly disappear.'
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
                      : 'Send code/link'}
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-3 dark:border-ink-800 dark:bg-ink-950/40">
            <div>
              <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50">Approved members</h2>
              <p className="text-xs text-ink-500">Manage sign-in access, roles, and member handover.</p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {(Object.keys(ROLE_HELP) as Role[]).map((role) => (
                <span key={role} className={roleBadgeClass(role)}>
                  {approvedMembers.filter((member) => member.role === role).length} {role}
                </span>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <div className="grid grid-cols-[minmax(260px,1fr)_220px_132px_48px] items-center gap-3 border-b border-ink-200 bg-ink-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:bg-ink-950/50 dark:text-ink-400">
                <span>Member</span>
                <span>Position</span>
                <span className="flex items-center gap-1.5">
                  Access
                  <button
                    type="button"
                    className="rounded p-0.5 text-ink-400 hover:bg-ink-200 hover:text-ink-700 dark:hover:bg-ink-800 dark:hover:text-ink-200"
                    onClick={() => setShowRoleHelp((value) => !value)}
                    title="What the access levels mean"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </span>
                <span className="text-right">Actions</span>
              </div>
              {showRoleHelp && (
                <div className="grid gap-2 border-b border-ink-200 bg-white px-4 py-3 text-sm dark:border-ink-800 dark:bg-ink-950/30 md:grid-cols-3">
                  {(Object.keys(ROLE_HELP) as Role[]).map((role) => (
                    <div key={role} className="rounded-lg border border-ink-200 px-3 py-2 dark:border-ink-800">
                      <p className="mb-1 flex items-center justify-between gap-2 font-semibold capitalize text-ink-800 dark:text-ink-100">
                        <span>{role}</span>
                        <span className={roleBadgeClass(role)}>{role}</span>
                      </p>
                      <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">{ROLE_HELP[role]}</p>
                    </div>
                  ))}
                </div>
              )}
            {approvedMembers.map((m) => {
              // Never let the last admin demote themselves out of the account.
              const isLastAdmin = m.role === 'admin' && adminCount === 1
              const piProtected = Boolean(m.is_pi && !isPi)
              const isDeveloper = isDeveloperProfile(m)
              const accessLocked = isLastAdmin || piProtected || isDeveloper
              const avatarKey = m.avatar_key ?? localAvatarKey(m.id)
              return (
                <div key={m.id} className="relative grid grid-cols-[minmax(260px,1fr)_220px_132px_48px] items-center gap-3 border-b border-ink-100 px-4 py-2.5 last:border-b-0 hover:bg-ink-50/70 dark:border-ink-800 dark:hover:bg-ink-900/45">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        className={`${avatarClass(avatarKey)} flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ring-1 ring-inset transition hover:scale-105`}
                        title="Choose avatar"
                        onClick={() => {
                          setActionMenuFor(null)
                          setRoleMenuFor(null)
                          setAvatarMenuFor(avatarMenuFor === m.id ? null : m.id)
                        }}
                      >
                        {initialsFor(m.full_name || m.email)}
                      </button>
                      {avatarMenuFor === m.id && (
                        <div className="absolute left-0 top-11 z-40 w-48 rounded-lg border border-ink-200 bg-white p-2 shadow-lg dark:border-ink-800 dark:bg-ink-950">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Avatar color</p>
                          <div className="grid grid-cols-3 gap-2">
                            {AVATAR_CHOICES.map((choice) => (
                              <button
                                key={choice.key}
                                type="button"
                                className="flex flex-col items-center gap-1 rounded-lg p-1.5 text-[10px] text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-800"
                                onClick={() => void chooseAvatar(m, choice.key)}
                              >
                                <span className={`${avatarClass(choice.key)} flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ring-1 ring-inset`}>
                                  {initialsFor(m.full_name || m.email)}
                                </span>
                                {choice.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50" title={m.full_name}>
                        {m.full_name}
                        {m.id === profile?.id && <span className="ml-2 text-xs font-normal text-ink-400">you</span>}
                        {isDeveloper && (
                          <span className="ml-2 rounded-full bg-pearl-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pearl-700 ring-1 ring-pearl-600/20 dark:bg-pearl-500/10 dark:text-pearl-300 dark:ring-pearl-400/20">
                            Developer
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-ink-500" title={m.email}>
                        {m.email}
                        {isDeveloper && <span className="ml-1 text-pearl-600 dark:text-pearl-300">- bug reports</span>}
                      </p>
                    </div>
                  </div>
                  <div className="min-w-0">
                    {positionEditFor === m.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          className="input h-8 min-w-0 text-sm"
                          value={positionDraft}
                          placeholder="Research Fellow"
                          autoFocus
                          onChange={(event) => setPositionDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void savePosition(m)
                            if (event.key === 'Escape') setPositionEditFor(null)
                          }}
                        />
                        <button
                          type="button"
                          className="btn-primary h-8 px-2 text-xs"
                          disabled={saving === m.id}
                          onClick={() => void savePosition(m)}
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="block max-w-full truncate rounded-md px-1 py-1 text-left text-sm text-ink-500 hover:bg-ink-100 hover:text-ink-900 dark:hover:bg-ink-800 dark:hover:text-ink-100"
                        title={m.lab_position ? `${m.lab_position} - click to edit` : 'Click to add position'}
                        onClick={() => startPositionEdit(m)}
                      >
                        {m.lab_position ?? '—'}
                      </button>
                    )}
                  </div>
                  <div className="relative flex items-center gap-1.5">
                    {m.is_pi && (
                      <span
                        className="badge shrink-0 bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300"
                        title="Has the PI oversight dashboard, on top of their role"
                      >
                        PI
                      </span>
                    )}
                    <button
                      type="button"
                      className={`${roleBadgeClass(m.role)} h-7 w-full justify-between px-2.5 capitalize ${accessLocked ? 'cursor-not-allowed opacity-60' : 'hover:ring-pearl-500/40'}`}
                      disabled={saving === m.id || accessLocked}
                      title={
                        piProtected
                          ? 'Only the PI can change the PI account’s access.'
                          : isDeveloper
                            ? 'The PEARL developer account cannot be changed by admins or PI users.'
                          : isLastAdmin
                            ? 'This is the only admin — promote someone else first.'
                            : ROLE_HELP[m.role]
                      }
                      onClick={() => {
                        setActionMenuFor(null)
                        setAvatarMenuFor(null)
                        setRoleMenuFor(roleMenuFor === m.id ? null : m.id)
                      }}
                    >
                      <span>{m.role}</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    {roleMenuFor === m.id && (
                      <div className="absolute left-0 top-8 z-30 w-36 rounded-lg border border-ink-200 bg-white p-1 shadow-lg dark:border-ink-800 dark:bg-ink-950">
                        {(['admin', 'member', 'viewer'] as Role[]).map((role) => (
                          <button
                            key={role}
                            type="button"
                            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm capitalize text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800"
                            onClick={() => {
                              setRoleMenuFor(null)
                              if (role !== m.role) void changeRole(m, role)
                            }}
                          >
                            {role}
                            {role === m.role && <Check className="h-3.5 w-3.5 text-pearl-600" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative flex justify-end">
                    <button
                      type="button"
                      className="btn-ghost h-8 w-8 px-0"
                      onClick={() => {
                        setRoleMenuFor(null)
                        setAvatarMenuFor(null)
                        setActionMenuFor(actionMenuFor === m.id ? null : m.id)
                      }}
                      title="Member actions"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    {actionMenuFor === m.id && (
                      <div className="absolute right-0 top-9 z-30 w-44 rounded-lg border border-ink-200 bg-white p-1 shadow-lg dark:border-ink-800 dark:bg-ink-950">
                        <MenuAction
                          icon={<UserCheck className="h-3.5 w-3.5" />}
                          label="Edit position"
                          disabled={saving === m.id}
                          onClick={() => startPositionEdit(m)}
                        />
                        <MenuAction
                          icon={<Users className="h-3.5 w-3.5" />}
                          label="Choose avatar"
                          disabled={saving === m.id}
                          onClick={() => {
                            setActionMenuFor(null)
                            setRoleMenuFor(null)
                            setAvatarMenuFor(m.id)
                          }}
                        />
                        <MenuAction
                          icon={<Mail className="h-3.5 w-3.5" />}
                          label={resendCooldown.secondsLeft(m.id) > 0 ? `Email in ${resendCooldown.secondsLeft(m.id)}s` : 'Email code/link'}
                          disabled={saving === m.id || resendCooldown.secondsLeft(m.id) > 0}
                          onClick={() => { setActionMenuFor(null); void sendMemberLink(m) }}
                        />
                        <MenuAction
                          icon={<ShieldOff className="h-3.5 w-3.5" />}
                          label="Revoke access"
                          disabled={saving === m.id || accessLocked}
                          onClick={() => { setActionMenuFor(null); setConfirm({ kind: 'revoke', member: m }) }}
                        />
                        {isPi && (
                          <MenuAction
                            icon={<ShieldCheck className="h-3.5 w-3.5" />}
                            label={m.is_pi ? 'Remove PI access' : 'Make PI'}
                            disabled={saving === m.id || isDeveloper}
                            onClick={() => { setActionMenuFor(null); void togglePi(m) }}
                          />
                        )}
                        <MenuAction
                          icon={<UserCheck className="h-3.5 w-3.5" />}
                          label="Offboard"
                          disabled={saving === m.id || accessLocked || m.id === profile?.id}
                          onClick={() => { setActionMenuFor(null); void openOffboarding(m) }}
                        />
                        <MenuAction
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                          label="Remove"
                          danger
                          disabled={saving === m.id || accessLocked || m.id === profile?.id}
                          onClick={() => { setActionMenuFor(null); setConfirm({ kind: 'remove', member: m }) }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        </div>
      )}

      <section className="mt-4 rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-950/40">
        <div className="mb-3 flex items-center gap-2">
          <Info className="h-4 w-4 text-pearl-600" />
          <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Access levels</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {(Object.keys(ROLE_HELP) as Role[]).map((role) => (
            <div key={role} className="rounded-lg border border-ink-100 bg-ink-50/70 p-3 dark:border-ink-800 dark:bg-ink-900/40">
              <span className={roleBadgeClass(role)}>{role}</span>
              <p className="mt-2 text-xs leading-relaxed text-ink-500 dark:text-ink-400">{ROLE_HELP[role]}</p>
            </div>
          ))}
        </div>
      </section>

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

      <Modal
        open={Boolean(offboarding)}
        onClose={() => {
          if (!offboardingBusy) setOffboarding(null)
        }}
        title="Member sign-off and handover"
        description={
          offboarding
            ? `Review ${offboarding.member.full_name}'s chemicals, computational projects, and data pointers before access is revoked.`
            : undefined
        }
        size="xl"
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={offboardingBusy} onClick={() => setOffboarding(null)}>
              Close
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={offboardingBusy || offboardingItems.length === 0 || assignedCount !== offboardingItems.length}
              onClick={() => void transferOffboardingItems(false)}
            >
              {offboardingBusy ? <Spinner /> : <ArrowRight className="h-4 w-4" />} Transfer only
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={offboardingBusy || offboardingItems.length === 0 || assignedCount !== offboardingItems.length}
              onClick={() => void transferOffboardingItems(true)}
            >
              {offboardingBusy ? <Spinner /> : <ShieldOff className="h-4 w-4" />} Transfer and revoke
            </button>
          </>
        }
      >
        {offboardingBusy && !offboarding?.summary ? (
          <LoadingScreen label="Loading handover inventory..." />
        ) : offboarding?.summary ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ['Chemicals', offboarding.summary.chemicals.length],
                ['Computational assets', offboarding.summary.research_assets.length],
                ['Projects', offboarding.summary.projects.length],
                ['Assigned', `${assignedCount}/${offboardingItems.length}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
                  <p className="mt-1 text-2xl font-bold text-ink-900 dark:text-ink-50">{value}</p>
                </div>
              ))}
            </div>

            <section className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">Bulk reassign</h3>
                  <p className="text-xs text-ink-500 dark:text-ink-400">
                    Choose one new owner for everything, then adjust individual rows if needed.
                  </p>
                </div>
                <select
                  className="input w-full sm:w-64"
                  value=""
                  onChange={(e) => applyBulkDestination(e.target.value)}
                  disabled={offboardingBusy || handoverDestinations.length === 0}
                >
                  <option value="">Reassign everything to...</option>
                  {handoverDestinations.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            {offboarding.summary.projects.length > 0 && (
              <section className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
                <h3 className="mb-2 text-sm font-semibold text-ink-900 dark:text-ink-100">
                  Projects and data map
                </h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {offboarding.summary.projects.map((project) => (
                    <div key={project.name} className="rounded-lg bg-ink-50 px-3 py-2 dark:bg-ink-950">
                      <p className="truncate text-sm font-semibold text-ink-800 dark:text-ink-100">{project.name}</p>
                      <p className="text-xs text-ink-500">{project.count} linked item{project.count === 1 ? '' : 's'}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <HandoverSection
              title="Experimental chemicals"
              icon={<FlaskConical className="h-4 w-4" />}
              items={offboarding.summary.chemicals}
              destinations={handoverDestinations}
              selected={offboarding.destinations}
              onSelect={setDestination}
            />
            <HandoverSection
              title="Computational assets and datasets"
              icon={<Database className="h-4 w-4" />}
              items={offboarding.summary.research_assets}
              destinations={handoverDestinations}
              selected={offboarding.destinations}
              onSelect={setDestination}
            />
          </div>
        ) : null}
      </Modal>
    </>
  )
}

function HandoverSection({
  title,
  icon,
  items,
  destinations,
  selected,
  onSelect,
}: {
  title: string
  icon: ReactNode
  items: OffboardingItem[]
  destinations: Profile[]
  selected: Record<string, string>
  onSelect: (resourceId: string, memberId: string) => void
}) {
  return (
    <section className="rounded-lg border border-ink-200 dark:border-ink-800">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-3 py-2 dark:border-ink-800 dark:bg-ink-950">
        {icon}
        <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-100">{title}</h3>
        <span className="ml-auto text-xs text-ink-400">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-4 text-sm text-ink-500">No items found for this member.</p>
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {items.map((item) => (
            <li key={`${item.resource_type}:${item.resource_id}`} className="grid gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium text-ink-900 dark:text-ink-50">{item.title}</p>
                  {item.stable_id && (
                    <span className="rounded-full bg-ink-100 px-2 py-0.5 font-mono text-[10px] text-ink-500 dark:bg-ink-800">
                      {item.stable_id}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-500">
                  {[item.subtitle, item.project, item.location, item.status, item.size_label].filter(Boolean).join(' - ') || 'No extra metadata'}
                </p>
                {item.storage_link && <p className="mt-0.5 truncate text-xs text-ink-400">{item.storage_link}</p>}
              </div>
              <select
                className="input"
                value={selected[item.resource_id] ?? ''}
                onChange={(e) => onSelect(item.resource_id, e.target.value)}
              >
                <option value="">New owner...</option>
                {destinations.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function MenuAction({
  icon,
  label,
  disabled,
  danger = false,
  onClick,
}: {
  icon: ReactNode
  label: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm disabled:pointer-events-none disabled:opacity-45 ${
        danger
          ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10'
          : 'text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800'
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}

function initialsFor(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

function localAvatarStorageKey(memberId: string) {
  return `pearl.memberAvatar.${memberId}`
}

function localAvatarKey(memberId: string) {
  return localStorage.getItem(localAvatarStorageKey(memberId))
}

function avatarClass(key?: string | null) {
  if (key === 'emerald') return 'bg-emerald-100 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-400/20'
  if (key === 'violet') return 'bg-violet-100 text-violet-700 ring-violet-600/20 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-400/20'
  if (key === 'amber') return 'bg-amber-100 text-amber-700 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-400/20'
  if (key === 'rose') return 'bg-rose-100 text-rose-700 ring-rose-600/20 dark:bg-rose-500/15 dark:text-rose-200 dark:ring-rose-400/20'
  if (key === 'ink') return 'bg-ink-200 text-ink-700 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-100 dark:ring-ink-600/40'
  return 'bg-pearl-100 text-pearl-700 ring-pearl-600/20 dark:bg-pearl-500/15 dark:text-pearl-200 dark:ring-pearl-400/20'
}

function roleBadgeClass(role: Role) {
  if (role === 'admin') return 'badge bg-pearl-50 text-pearl-700 ring-pearl-600/20 dark:bg-pearl-500/10 dark:text-pearl-200 dark:ring-pearl-400/20'
  if (role === 'member') return 'badge bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-400/20'
  return 'badge bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-200 dark:ring-ink-600/40'
}
