/**
 * The single data layer for the whole app.
 *
 * Every page talks to `api.*` and never to Supabase or localStorage directly,
 * so the cloud and demo backends stay interchangeable and the UI has exactly
 * one place to look for a bug.
 */
import { IS_CLOUD, SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { localDb } from './localDb'
import { SEED_ROWS } from './seedData'
import { supabase, requireSupabase } from './supabase'
import type {
  ActivityAction,
  ActivityEntry,
  Chemical,
  ChemicalInput,
  ChemicalRequest,
  ChemicalRequestInput,
  Comment,
  CommentInput,
  Equipment,
  EquipmentBooking,
  EquipmentBookingInput,
  EquipmentInput,
  Invite,
  MemberOffboardingSummary,
  OffboardingItem,
  OwnershipTransferInput,
  Profile,
  ResearchAsset,
  ResearchAssetChemicalLink,
  ResearchAssetInput,
  ResearchAssetLink,
  ResearchAssetLinkInput,
  ResearchAssetVersion,
  ResearchAssetVersionInput,
  Role,
} from './types'
import { nextCode } from './utils'

export class ApiError extends Error {}

export interface AskPearlReply {
  answer: string
  sources?: Array<{ table: string; count: number }>
}

function fail(context: string, error: { message: string } | null): never {
  throw new ApiError(`${context}: ${error?.message ?? 'unknown error'}`)
}

function missingTable(error: { message?: string; code?: string } | null): boolean {
  return (
    error?.code === 'PGRST205' ||
    error?.code === '42P01' ||
    /Could not find the table|relation .* does not exist/i.test(error?.message ?? '')
  )
}

function nextStableId(rows: Array<{ stable_id: string | null }>): string {
  const max = rows.reduce((highest, row) => {
    const n = Number(row.stable_id?.replace(/\D/g, '') || 0)
    return Number.isFinite(n) ? Math.max(highest, n) : highest
  }, 0)
  return `PEARL-RA-${String(max + 1).padStart(6, '0')}`
}

function memberAliases(member: Profile): string[] {
  return [member.id, member.full_name, member.email]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value))
}

function itemForChemical(row: Chemical): OffboardingItem {
  return {
    resource_type: 'chemical',
    resource_id: row.id,
    title: row.name,
    subtitle: row.code,
    project: row.project,
    location: [row.location, row.sub_location].filter(Boolean).join(' / ') || null,
    status: row.status,
    stable_id: null,
    owner: row.owner,
    created_by: row.created_by,
    size_label: [row.quantity ? `${row.quantity}x` : null, row.size_value ? `${row.size_value} ${row.size_unit}` : null]
      .filter(Boolean)
      .join(' ') || null,
    storage_link: null,
  }
}

function itemForResearchAsset(row: ResearchAsset): OffboardingItem {
  return {
    resource_type: 'research_asset',
    resource_id: row.id,
    title: row.title,
    subtitle: [row.stable_id, row.type, row.software].filter(Boolean).join(' - ') || null,
    project: row.project,
    location: row.external_path,
    status: row.status,
    stable_id: row.stable_id,
    owner: row.owner,
    created_by: row.created_by,
    size_label: row.size_label,
    storage_link: row.storage_link ?? row.output_link ?? row.repo_link,
  }
}

function projectRollup(items: OffboardingItem[]): MemberOffboardingSummary['projects'] {
  const map = new Map<string, { name: string; count: number; size_bytes: number | null }>()
  for (const item of items) {
    const name = item.project?.trim() || 'Unassigned project'
    const current = map.get(name) ?? { name, count: 0, size_bytes: null }
    current.count += 1
    map.set(name, current)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

async function invokeAskPearl(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sb = requireSupabase()
  await sb.auth.refreshSession().catch(() => null)
  const { data: userData, error: userError } = await sb.auth.getUser()
  if (userError || !userData.user) throw new ApiError('This AI action needs a fresh sign-in session.')
  const { data: sessionData } = await sb.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new ApiError('This AI action needs a signed-in session.')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ask-pearl`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(data?.error ?? data?.message ?? `AI action failed with HTTP ${res.status}.`)
  return data as Record<string, unknown>
}

/**
 * Where Supabase should send the browser back to after a magic link or an
 * OAuth round trip. Deliberately the bare origin + path, no hash — the app
 * uses HashRouter for its own routes, and Supabase appends its own token
 * fragment (or `?code=`) to whatever URL we hand it here. Landing on a clean
 * URL keeps those from fighting over `location.hash`; the session is picked
 * up by `detectSessionInUrl` before the router ever looks at it, and this
 * exact URL must also be added to the Supabase project's redirect allow-list
 * (see SETUP.md).
 */
function redirectUrl(): string {
  return window.location.origin + window.location.pathname
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const auth = {
  async currentProfile(): Promise<Profile | null> {
    if (!IS_CLOUD) return localDb.session()

    const sb = requireSupabase()
    const { data: sessionData } = await sb.auth.getSession()
    const user = sessionData.session?.user
    if (!user) return null

    const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle()
    if (error) fail('Could not load your profile', error)

    // The sign-up trigger normally creates this row; if a project was set up
    // without it, fall back to a sensible profile rather than dead-ending.
    // Safest possible defaults here — unapproved, read-only — since this
    // path means something's actually wrong (the trigger didn't fire), not
    // a normal state to grant access under.
    if (!data) {
      return {
        id: user.id,
        email: user.email ?? '',
        full_name: (user.user_metadata?.full_name as string) ?? user.email?.split('@')[0] ?? '',
        role: 'viewer',
        approved: false,
        has_password: false,
        lab_position: null,
        avatar_key: null,
        created_at: user.created_at ?? new Date().toISOString(),
      }
    }
    return data as Profile
  },

  /** Fires whenever the user signs in or out in this tab or another one. */
  onChange(cb: () => void): () => void {
    if (!IS_CLOUD) {
      const handler = (e: StorageEvent) => {
        if (e.key === 'pearl.demo.session') cb()
      }
      window.addEventListener('storage', handler)
      return () => window.removeEventListener('storage', handler)
    }
    const { data } = requireSupabase().auth.onAuthStateChange(() => cb())
    return () => data.subscription.unsubscribe()
  },

  async signIn(email: string, password: string): Promise<Profile> {
    if (!IS_CLOUD) {
      const profile = await localDb.verifyUser(email, password)
      localDb.setSession(profile.id)
      return profile
    }
    const { error } = await requireSupabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) throw new ApiError(error.message)
    const profile = await auth.currentProfile()
    if (!profile) throw new ApiError('Signed in, but no profile could be loaded.')
    return profile
  },

  /**
   * Returns `needsConfirmation: true` when the Supabase project has email
   * confirmation switched on, so the UI can say "check your inbox" instead of
   * pretending the user is signed in.
   */
  async signUp(
    email: string,
    password: string,
    fullName: string,
  ): Promise<{ profile: Profile | null; needsConfirmation: boolean }> {
    if (!IS_CLOUD) {
      const profile = await localDb.createUser(email.trim(), password, fullName.trim())
      localDb.setSession(profile.id)
      localDb.logActivity({
        chemical_id: null,
        chemical_name: null,
        action: 'signed_up',
        details: `${profile.full_name} joined`,
        user_id: profile.id,
        user_name: profile.full_name,
      })
      return { profile, needsConfirmation: false }
    }

    const { data, error } = await requireSupabase().auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    })
    if (error) throw new ApiError(error.message)
    if (!data.session) return { profile: null, needsConfirmation: true }
    return { profile: await auth.currentProfile(), needsConfirmation: false }
  },

  /**
   * Passwordless sign-in: Supabase emails a one-time link that both creates the
   * account (first time) and signs the person in. Nothing to remember, nothing
   * to reset — usually the right default for a lab.
   */
  async sendMagicLink(email: string): Promise<void> {
    if (!IS_CLOUD) {
      throw new ApiError(
        'Magic links need the shared database. In demo mode, sign up with a password instead.',
      )
    }
    const { error } = await requireSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectUrl(), shouldCreateUser: true },
    })
    if (error) throw new ApiError(error.message)
  },

  /**
   * The same email as the magic link also carries a 6-digit code — the
   * fallback for when the link itself doesn't work. That happens more than
   * it should: some institutional email gateways pre-fetch every link in an
   * inbound message to scan it for phishing, which silently burns a
   * single-use magic link before the person ever clicks it. Nothing types a
   * code in on your behalf, so this path can't be pre-consumed the same way.
   */
  async verifyEmailCode(email: string, code: string): Promise<void> {
    if (!IS_CLOUD) {
      throw new ApiError(
        'Email codes need the shared database. In demo mode, sign up with a password instead.',
      )
    }
    const { error } = await requireSupabase().auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    })
    if (error) throw new ApiError(error.message)
  },

  /**
   * An admin inviting someone by email — same mechanism as the sign-up
   * page's magic link, just triggered from the Members page instead of
   * waiting for the person to find the app themselves. There's no way to
   * create their account for them without the service_role key, which must
   * never touch the frontend, so this is the email-and-they-click-it flow
   * either way: the account (and its "waiting for approval" state) only
   * really exists once they open the link.
   */
  async inviteMember(email: string, fullName: string): Promise<void> {
    if (!IS_CLOUD) {
      throw new ApiError(
        'Invites aren’t needed in demo mode — anyone can sign up directly from the login page.',
      )
    }
    const { error } = await requireSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: redirectUrl(),
        shouldCreateUser: true,
        data: fullName.trim() ? { full_name: fullName.trim() } : undefined,
      },
    })
    if (error) throw new ApiError(error.message)
  },

  async signOut(): Promise<void> {
    if (!IS_CLOUD) {
      localDb.setSession(null)
      return
    }
    await requireSupabase().auth.signOut()
  },

  async sendPasswordReset(email: string): Promise<void> {
    if (!IS_CLOUD) {
      throw new ApiError('Password reset needs the cloud backend. In demo mode, use Settings.')
    }
    const { error } = await requireSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + window.location.pathname,
    })
    if (error) throw new ApiError(error.message)
  },

  /**
   * Requires the current password before setting a new one — Supabase's
   * `updateUser` alone would happily change it for anyone with an open
   * session, which is exactly the case (a shared or unlocked computer) this
   * check exists for. `currentPassword` is optional only because someone who
   * signed up via magic link has never set one — there's nothing to verify,
   * so this call sets their first password instead of changing one.
   */
  async changePassword(
    email: string,
    currentPassword: string | null,
    newPassword: string,
  ): Promise<void> {
    if (!IS_CLOUD) {
      const existing = localDb.users().find((u) => u.email.toLowerCase() === email.trim().toLowerCase())
      // Everyday demo accounts are password-only, so there's always one to
      // check. The exception is an account carried over from before this
      // field existed (has_password missing/false) — same "nothing to
      // verify yet" case as a real magic-link account.
      if (existing?.has_password) {
        if (!currentPassword) throw new ApiError('Enter your current password.')
        await localDb.verifyUser(email, currentPassword)
      }
      if (!existing) throw new ApiError('No account found for that email on this device.')
      await localDb.setPassword(existing.id, newPassword)
      return
    }
    const sb = requireSupabase()
    if (currentPassword) {
      const { error: verifyError } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password: currentPassword,
      })
      if (verifyError) throw new ApiError('Current password is incorrect.')
    }

    const { error } = await sb.auth.updateUser({ password: newPassword })
    if (error) throw new ApiError(error.message)

    // The trigger only sets this at account creation — flip it here too, or
    // someone who just set their first password would still see the "set a
    // password" prompt on their next sign-in.
    const user = (await sb.auth.getUser()).data.user
    if (user) await sb.from('profiles').update({ has_password: true }).eq('id', user.id)
  },

  async updateProfile(id: string, patch: Partial<Profile>): Promise<Profile> {
    if (!IS_CLOUD) return localDb.updateUser(id, patch)
    const { data, error } = await requireSupabase()
      .from('profiles')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (error) fail('Could not save your profile', error)
    return data as Profile
  },
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export const api = {
  async askPearl(question: string, workspace?: 'experimental' | 'computational'): Promise<AskPearlReply> {
    if (!IS_CLOUD) {
      return {
        answer:
          'Ask PEARL is available when the app is connected to Supabase and a server-side model provider secret is configured.',
        sources: [],
      }
    }
    return (await invokeAskPearl({ question, workspace })) as unknown as AskPearlReply
  },

  async draftMethods(project: string): Promise<string> {
    if (!IS_CLOUD) {
      const chemicals = localDb.chemicals().filter((row) => row.project === project)
      const assets = localDb.researchAssets().filter((row) => row.project === project)
      return `Materials and methods draft for ${project}: ${chemicals.length} chemicals and ${assets.length} research assets are linked in PEARL. Review supplier, grade, instrument, and computational parameters before use in a manuscript.`
    }
    const res = await invokeAskPearl({ action: 'draft_methods', project })
    return String(res?.draft ?? '')
  },

  async listChemicals(): Promise<Chemical[]> {
    if (!IS_CLOUD) return localDb.chemicals()
    const { data, error } = await requireSupabase()
      .from('chemicals')
      .select('*')
      .order('name', { ascending: true })
    if (error) fail('Could not load the inventory', error)
    return (data ?? []) as Chemical[]
  },

  async createChemical(input: ChemicalInput, actor: Profile): Promise<Chemical> {
    const payload = {
      ...input,
      registered_by: input.registered_by || actor.full_name,
      created_by: actor.id,
    }

    if (!IS_CLOUD) {
      const row = localDb.insertChemical(payload as Parameters<typeof localDb.insertChemical>[0])
      logLocal(row, 'created', `Registered ${row.name}`, actor)
      return row
    }

    const sb = requireSupabase()
    let code = input.code
    if (!code) {
      const { data: codes } = await sb.from('chemicals').select('code')
      code = nextCode(((codes ?? []) as Array<{ code: string }>).map((c) => c.code))
    }

    const { data, error } = await sb
      .from('chemicals')
      .insert({ ...payload, code })
      .select()
      .single()
    if (error) fail('Could not add the chemical', error)

    const row = data as Chemical
    await api.log(row, 'created', `Registered ${row.name}`, actor)
    return row
  },

  async updateChemical(
    id: string,
    patch: Partial<Chemical>,
    actor: Profile,
    note?: string,
  ): Promise<Chemical> {
    if (!IS_CLOUD) {
      const row = localDb.updateChemical(id, patch)
      logLocal(row, 'updated', note ?? `Updated ${row.name}`, actor)
      return row
    }
    const { data, error } = await requireSupabase()
      .from('chemicals')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (error) fail('Could not save the changes', error)
    const row = data as Chemical
    await api.log(row, 'updated', note ?? `Updated ${row.name}`, actor)
    return row
  },

  async deleteChemical(row: Chemical, actor: Profile): Promise<void> {
    if (!IS_CLOUD) {
      localDb.deleteChemical(row.id)
      logLocal(null, 'deleted', `Deleted ${row.name} (${row.code})`, actor)
      return
    }
    const { error } = await requireSupabase().from('chemicals').delete().eq('id', row.id)
    if (error) fail('Could not delete the record', error)
    await api.log(null, 'deleted', `Deleted ${row.name} (${row.code})`, actor)
  },

  /** Bulk insert used by the CSV importer. Returns how many rows landed. */
  async importChemicals(rows: ChemicalInput[], actor: Profile): Promise<number> {
    if (rows.length === 0) return 0

    if (!IS_CLOUD) {
      const existing = localDb.chemicals().map((r) => r.code)
      rows.forEach((r, i) => {
        localDb.insertChemical({
          ...r,
          code: r.code || nextCode([...existing, ...Array.from({ length: i }, (_, k) => `PEARL-${k}`)]),
          registered_by: r.registered_by || actor.full_name,
          created_by: actor.id,
        } as Parameters<typeof localDb.insertChemical>[0])
        existing.push(r.code ?? '')
      })
      logLocal(null, 'imported', `Imported ${rows.length} containers`, actor)
      return rows.length
    }

    const sb = requireSupabase()
    const { data: codes } = await sb.from('chemicals').select('code')
    const taken = ((codes ?? []) as Array<{ code: string }>).map((c) => c.code)

    const payload = rows.map((r) => {
      const code = r.code || nextCode(taken)
      taken.push(code)
      return { ...r, code, registered_by: r.registered_by || actor.full_name, created_by: actor.id }
    })

    const { error } = await sb.from('chemicals').insert(payload)
    if (error) fail('Import failed', error)
    await api.log(null, 'imported', `Imported ${rows.length} containers`, actor)
    return rows.length
  },

  /** One-click load of the lab's original spreadsheet into an empty database. */
  async loadStarterData(actor: Profile): Promise<number> {
    const existing = await api.listChemicals()
    const taken = new Set(existing.map((c) => c.code))
    const fresh = SEED_ROWS.filter((r) => !taken.has(r.code))
    if (fresh.length === 0) return 0

    const rows: ChemicalInput[] = fresh.map((r) => ({
      code: r.code,
      name: r.name,
      cas: r.cas,
      system: r.system,
      supplier: r.supplier,
      catalog_no: null,
      batch_no: null,
      location: r.location,
      sub_location: null,
      formula: null,
      mol_weight: null,
      structure_molfile: null,
      reaction_rxnfile: null,
      delivery_photo_path: null,
      sds_url: null,
      coa_url: null,
      invoice_url: null,
      purity: null,
      concentration: null,
      quantity: r.quantity,
      size_value: r.size_value,
      size_unit: r.size_unit,
      price: null,
      currency: 'SGD',
      owner: r.owner,
      project: r.project,
      registration_date: r.registration_date,
      opened_date: null,
      expiry_date: null,
      status: (r.status as Chemical['status']) ?? 'active',
      date_emptied: r.date_emptied,
      disposal_date: null,
      disposal_reason: null,
      disposal_waste_class: null,
      reorder_url: null,
      reorder_priority: 'none',
      hazards: [],
      storage_class: null,
      remarks: r.remarks,
      registered_by: r.registered_by,
    }))

    return api.importChemicals(rows, actor)
  },

  async listActivity(limit = 100): Promise<ActivityEntry[]> {
    if (!IS_CLOUD) return localDb.activity().slice(0, limit)
    const { data, error } = await requireSupabase()
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) fail('Could not load the activity log', error)
    return (data ?? []) as ActivityEntry[]
  },

  async log(
    chemical: Chemical | null,
    action: ActivityAction,
    details: string,
    actor: Profile,
  ): Promise<void> {
    if (!IS_CLOUD) {
      logLocal(chemical, action, details, actor)
      return
    }
    // Logging must never break the operation that triggered it.
    await requireSupabase()
      .from('activity_log')
      .insert({
        chemical_id: chemical?.id ?? null,
        chemical_name: chemical?.name ?? null,
        action,
        details,
        user_id: actor.id,
        user_name: actor.full_name,
      })
      .then(({ error }) => {
        if (error) console.warn('activity log write failed:', error.message)
      })
  },

  async listProfiles(): Promise<Profile[]> {
    if (!IS_CLOUD) return localDb.users().map(({ passwordHash: _p, ...rest }) => rest)
    const { data, error } = await requireSupabase()
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) fail('Could not load the member list', error)
    return (data ?? []) as Profile[]
  },

  /** Every invite ever sent — the Members page filters out the ones who've
   *  since actually joined (i.e. now have a matching profile). */
  async listInvites(): Promise<Invite[]> {
    if (!IS_CLOUD) return []
    const { data, error } = await requireSupabase()
      .from('invites')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) fail('Could not load invites', error)
    return (data ?? []) as Invite[]
  },

  /** Sends the sign-in email and records that it happened, in one step —
   *  the record is what stops an invite from feeling like it vanished. */
  async sendInvite(email: string, fullName: string, actor: Profile): Promise<Invite> {
    await auth.inviteMember(email, fullName)
    const { data, error } = await requireSupabase()
      .from('invites')
      .insert({
        email: email.trim(),
        full_name: fullName.trim() || null,
        invited_by: actor.id,
        invited_by_name: actor.full_name,
      })
      .select()
      .single()
    if (error) fail('Invite email sent, but could not save the record of it', error)
    await api.log(null, 'invited', `Invited ${fullName.trim() || email.trim()} (${email.trim()})`, actor)
    return data as Invite
  },

  async cancelInvite(id: string): Promise<void> {
    const { error } = await requireSupabase().from('invites').delete().eq('id', id)
    if (error) fail('Could not remove that invite', error)
  },

  async setRole(target: Profile, role: Role, actor: Profile): Promise<void> {
    const details = `${target.full_name}'s access set to ${role}`
    if (!IS_CLOUD) {
      localDb.setRole(target.id, role)
      logLocal(null, 'role_changed', details, actor)
      return
    }
    const { error } = await requireSupabase().from('profiles').update({ role }).eq('id', target.id)
    if (error) fail('Could not change that role', error)
    await api.log(null, 'role_changed', details, actor)
  },

  /**
   * Lets someone in: flips `approved` and, unless they're already something
   * else, sets them up as a working `member` in the same step — matching
   * what "approve this person" actually means to an admin, rather than
   * requiring two separate clicks (approve, then remember to also promote).
   */
  async approveAccount(target: Profile, actor: Profile): Promise<void> {
    const role = target.role === 'viewer' ? 'member' : target.role
    const details = `${target.full_name} approved as ${role}`
    if (!IS_CLOUD) {
      localDb.updateUser(target.id, { approved: true, role })
      logLocal(null, 'role_changed', details, actor)
      return
    }
    const { error } = await requireSupabase()
      .from('profiles')
      .update({ approved: true, role })
      .eq('id', target.id)
    if (error) fail('Could not approve that account', error)
    await api.log(null, 'role_changed', details, actor)
  },

  async revokeAccount(target: Profile, actor: Profile): Promise<void> {
    const details = `${target.full_name}'s inventory access revoked`
    if (!IS_CLOUD) {
      localDb.updateUser(target.id, { approved: false, role: 'viewer' })
      logLocal(null, 'role_changed', details, actor)
      return
    }
    const { error } = await requireSupabase()
      .from('profiles')
      .update({ approved: false, role: 'viewer' })
      .eq('id', target.id)
    if (error) fail('Could not revoke that account', error)
    await api.log(null, 'role_changed', details, actor)
  },

  async removeMemberAccess(target: Profile, actor: Profile): Promise<void> {
    const details = `${target.full_name}'s member profile removed`
    if (!IS_CLOUD) {
      localDb.saveUsers(localDb.users().filter((u) => u.id !== target.id))
      logLocal(null, 'role_changed', details, actor)
      return
    }
    const { error } = await requireSupabase().from('profiles').delete().eq('id', target.id)
    if (error) fail('Could not remove that member profile', error)
    await api.log(null, 'role_changed', details, actor)
  },

  async getMemberOffboardingSummary(target: Profile): Promise<MemberOffboardingSummary> {
    if (!IS_CLOUD) {
      const aliases = memberAliases(target)
      const chemicals = localDb
        .chemicals()
        .filter((row) => aliases.includes((row.owner ?? '').trim().toLowerCase()))
        .map(itemForChemical)
      const research_assets = localDb
        .researchAssets()
        .filter((row) => row.created_by === target.id || aliases.includes((row.owner ?? '').trim().toLowerCase()))
        .map(itemForResearchAsset)
      return {
        member: { id: target.id, full_name: target.full_name, email: target.email },
        chemicals,
        research_assets,
        projects: projectRollup([...chemicals, ...research_assets]),
      }
    }

    const sb = requireSupabase()
    await sb.auth.refreshSession().catch(() => null)
    const { data: sessionData } = await sb.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) throw new ApiError('Member handover needs a signed-in admin session.')
    const res = await fetch(`${SUPABASE_URL}/functions/v1/member-offboarding`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'summary', target_member_id: target.id }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new ApiError(data?.error ?? `Could not load handover summary (${res.status}).`)
    return data as MemberOffboardingSummary
  },

  async transferMemberOwnership(
    target: Profile,
    transfers: OwnershipTransferInput[],
    actor: Profile,
  ): Promise<MemberOffboardingSummary> {
    if (transfers.length === 0) return api.getMemberOffboardingSummary(target)
    if (!IS_CLOUD) {
      const users = localDb.users()
      for (const transfer of transfers) {
        const to = users.find((user) => user.id === transfer.to_member_id)
        if (!to) throw new ApiError('Transfer destination not found.')
        if (transfer.resource_type === 'chemical') {
          localDb.updateChemical(transfer.resource_id, { owner: to.full_name })
        } else {
          localDb.updateResearchAsset(transfer.resource_id, {
            owner: to.full_name,
            created_by: to.id,
            created_by_name: to.full_name,
          })
        }
        logLocal(null, 'handover', `Transferred ${transfer.resource_type} to ${to.full_name}`, actor)
      }
      return api.getMemberOffboardingSummary(target)
    }

    const sb = requireSupabase()
    await sb.auth.refreshSession().catch(() => null)
    const { data: sessionData } = await sb.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) throw new ApiError('Member handover needs a signed-in admin session.')
    const res = await fetch(`${SUPABASE_URL}/functions/v1/member-offboarding`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'transfer',
        target_member_id: target.id,
        transfers,
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new ApiError(data?.error ?? `Could not transfer ownership (${res.status}).`)
    await api.log(null, 'handover', `Transferred ${transfers.length} item${transfers.length === 1 ? '' : 's'} from ${target.full_name}`, actor)
    return data as MemberOffboardingSummary
  },

  async listResearchAssets(): Promise<ResearchAsset[]> {
    if (!IS_CLOUD) return localDb.researchAssets()
    const { data, error } = await requireSupabase()
      .from('research_assets')
      .select('*')
      .order('updated_at', { ascending: false })
    if (missingTable(error)) return localDb.researchAssets()
    if (error) fail('Could not load research assets', error)
    return ((data ?? []) as ResearchAsset[]).map((row) => ({
      ...row,
      description: row.description ?? null,
      source_external_id: row.source_external_id ?? null,
      external_path: row.external_path ?? null,
      size_bytes: row.size_bytes ?? null,
      tags: row.tags ?? [],
      visibility: row.visibility ?? 'private',
      stable_id: row.stable_id ?? null,
    }))
  },

  async listResearchAssetChemicalLinks(): Promise<ResearchAssetChemicalLink[]> {
    if (!IS_CLOUD) return localDb.researchAssetChemicalLinks()
    const { data, error } = await requireSupabase()
      .from('research_asset_chemicals')
      .select('research_asset_id, chemical_id, chemicals(name)')
    if (missingTable(error)) return localDb.researchAssetChemicalLinks()
    if (error) fail('Could not load computational links', error)
    return ((data ?? []) as Array<{
      research_asset_id: string
      chemical_id: string
      chemicals?: { name?: string | null } | null
    }>).map((row) => ({
      research_asset_id: row.research_asset_id,
      chemical_id: row.chemical_id,
      chemical_name: row.chemicals?.name ?? null,
    }))
  },

  async listResearchAssetsForChemical(chemicalId: string): Promise<ResearchAsset[]> {
    const [assets, links] = await Promise.all([
      api.listResearchAssets(),
      api.listResearchAssetChemicalLinks(),
    ])
    const linkedIds = new Set(
      links.filter((row) => row.chemical_id === chemicalId).map((row) => row.research_asset_id),
    )
    return assets.filter((asset) => asset.related_chemical_id === chemicalId || linkedIds.has(asset.id))
  },

  async setResearchAssetChemicals(assetId: string, chemicalIds: string[]): Promise<void> {
    if (!IS_CLOUD) {
      localDb.setResearchAssetChemicals(assetId, chemicalIds)
      return
    }

    const sb = requireSupabase()
    const { error: deleteError } = await sb
      .from('research_asset_chemicals')
      .delete()
      .eq('research_asset_id', assetId)
    if (missingTable(deleteError)) {
      localDb.setResearchAssetChemicals(assetId, chemicalIds)
      return
    }
    if (deleteError) fail('Could not update computational links', deleteError)
    if (chemicalIds.length === 0) return
    const { error } = await sb.from('research_asset_chemicals').insert(
      chemicalIds.map((chemical_id) => ({
        research_asset_id: assetId,
        chemical_id,
      })),
    )
    if (error) fail('Could not save computational links', error)
  },

  async createResearchAsset(input: ResearchAssetInput, actor: Profile): Promise<ResearchAsset> {
    if (!IS_CLOUD) {
      const row = localDb.insertResearchAsset(input, actor)
      logLocal(null, 'created', `Added research asset ${row.title}`, actor)
      return row
    }
    const { data: ids } = await requireSupabase().from('research_assets').select('stable_id')
    const { data, error } = await requireSupabase()
      .from('research_assets')
      .insert({
        ...input,
        stable_id: nextStableId((ids ?? []) as Array<{ stable_id: string | null }>),
        created_by: actor.id,
        created_by_name: actor.full_name,
      })
      .select()
      .single()
    if (missingTable(error)) {
      const row = localDb.insertResearchAsset(input, actor)
      logLocal(null, 'created', `Added local research asset ${row.title}`, actor)
      return row
    }
    if (error) fail('Could not add research asset', error)
    await api.log(null, 'created', `Added research asset ${input.title}`, actor)
    return { ...(data as ResearchAsset), visibility: (data as ResearchAsset).visibility ?? 'private' }
  },

  async upsertResearchAsset(input: ResearchAssetInput, actor: Profile): Promise<ResearchAsset> {
    if (!input.source || !input.source_external_id) return api.createResearchAsset(input, actor)
    if (!IS_CLOUD) {
      const existing = localDb
        .researchAssets()
        .find((row) => row.created_by === actor.id && row.source === input.source && row.source_external_id === input.source_external_id)
      const row = existing
        ? localDb.updateResearchAsset(existing.id, input)
        : localDb.insertResearchAsset(input, actor)
      logLocal(null, existing ? 'updated' : 'created', `${existing ? 'Updated' : 'Added'} research asset ${row.title}`, actor)
      return row
    }
    const sb = requireSupabase()
    const { data: existingRows } = await sb
      .from('research_assets')
      .select('id, stable_id')
      .eq('created_by', actor.id)
      .eq('source', input.source)
      .eq('source_external_id', input.source_external_id)
      .limit(1)
    const stableId = (existingRows?.[0] as { stable_id?: string | null } | undefined)?.stable_id
    const payload = stableId
      ? { ...input, stable_id: stableId, created_by: actor.id, created_by_name: actor.full_name }
      : {
          ...input,
          stable_id: nextStableId(await sb.from('research_assets').select('stable_id').then(({ data }) => (data ?? []) as Array<{ stable_id: string | null }>)),
          created_by: actor.id,
          created_by_name: actor.full_name,
        }
    const { data, error } = await requireSupabase()
      .from('research_assets')
      .upsert(payload, { onConflict: 'created_by,source,source_external_id' })
      .select()
      .single()
    if (missingTable(error)) {
      const row = localDb.insertResearchAsset(input, actor)
      logLocal(null, 'created', `Added local research asset ${row.title}`, actor)
      return row
    }
    if (error) fail('Could not save research asset', error)
    const row = { ...(data as ResearchAsset), visibility: (data as ResearchAsset).visibility ?? 'private' }
    await api.log(null, 'updated', `Synced research asset ${row.title}`, actor)
    return row
  },

  async updateResearchAsset(
    id: string,
    patch: Partial<ResearchAsset>,
    actor: Profile,
  ): Promise<ResearchAsset> {
    if (!IS_CLOUD) {
      const row = localDb.updateResearchAsset(id, patch)
      logLocal(null, 'updated', `Updated research asset ${row.title}`, actor)
      return row
    }
    const { data, error } = await requireSupabase()
      .from('research_assets')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (missingTable(error)) {
      const row = localDb.updateResearchAsset(id, patch)
      logLocal(null, 'updated', `Updated local research asset ${row.title}`, actor)
      return row
    }
    if (error) fail('Could not update research asset', error)
    const row = { ...(data as ResearchAsset), visibility: (data as ResearchAsset).visibility ?? 'private' }
    await api.log(null, 'updated', `Updated research asset ${row.title}`, actor)
    return row
  },

  async deleteResearchAsset(row: ResearchAsset, actor: Profile): Promise<void> {
    if (!IS_CLOUD) {
      localDb.deleteResearchAsset(row.id)
      logLocal(null, 'deleted', `Deleted research asset ${row.title}`, actor)
      return
    }
    const { error } = await requireSupabase().from('research_assets').delete().eq('id', row.id)
    if (missingTable(error)) {
      localDb.deleteResearchAsset(row.id)
      logLocal(null, 'deleted', `Deleted local research asset ${row.title}`, actor)
      return
    }
    if (error) fail('Could not delete research asset', error)
    await api.log(null, 'deleted', `Deleted research asset ${row.title}`, actor)
  },

  async listResearchAssetVersions(assetId?: string): Promise<ResearchAssetVersion[]> {
    if (!IS_CLOUD) {
      const rows = localDb.researchAssetVersions()
      return assetId ? rows.filter((row) => row.research_asset_id === assetId) : rows
    }
    let query = requireSupabase()
      .from('research_asset_versions')
      .select('*')
      .order('created_at', { ascending: false })
    if (assetId) query = query.eq('research_asset_id', assetId)
    const { data, error } = await query
    if (missingTable(error)) return []
    if (error) fail('Could not load research asset versions', error)
    return (data ?? []) as ResearchAssetVersion[]
  },

  async createResearchAssetVersion(input: ResearchAssetVersionInput, actor: Profile): Promise<ResearchAssetVersion> {
    if (!IS_CLOUD) {
      const row = localDb.insertResearchAssetVersion(input, actor)
      logLocal(null, 'updated', `Added version ${row.version_number} to research asset`, actor)
      return row
    }
    const { data, error } = await requireSupabase()
      .from('research_asset_versions')
      .insert({ ...input, created_by: actor.id, created_by_name: actor.full_name })
      .select()
      .single()
    if (missingTable(error)) {
      const row = localDb.insertResearchAssetVersion(input, actor)
      logLocal(null, 'updated', `Added local research asset version ${row.version_number}`, actor)
      return row
    }
    if (error) fail('Could not add research asset version', error)
    await api.log(null, 'updated', `Added research asset version ${input.version_number}`, actor)
    return data as ResearchAssetVersion
  },

  async deleteResearchAssetVersion(row: ResearchAssetVersion, actor: Profile): Promise<void> {
    if (!IS_CLOUD) {
      localDb.deleteResearchAssetVersion(row.id)
      logLocal(null, 'deleted', `Deleted research asset version ${row.version_number}`, actor)
      return
    }
    const { error } = await requireSupabase().from('research_asset_versions').delete().eq('id', row.id)
    if (missingTable(error)) {
      localDb.deleteResearchAssetVersion(row.id)
      return
    }
    if (error) fail('Could not delete research asset version', error)
    await api.log(null, 'deleted', `Deleted research asset version ${row.version_number}`, actor)
  },

  async listResearchAssetLinks(): Promise<ResearchAssetLink[]> {
    if (!IS_CLOUD) return localDb.researchAssetLinks()
    const { data, error } = await requireSupabase()
      .from('research_asset_links')
      .select('*')
      .order('created_at', { ascending: false })
    if (missingTable(error)) return []
    if (error) fail('Could not load research asset lineage', error)
    return (data ?? []) as ResearchAssetLink[]
  },

  async createResearchAssetLink(input: ResearchAssetLinkInput, actor: Profile): Promise<ResearchAssetLink> {
    if (!IS_CLOUD) {
      const row = localDb.insertResearchAssetLink(input, actor)
      logLocal(null, 'updated', `Linked research assets`, actor)
      return row
    }
    const { data, error } = await requireSupabase()
      .from('research_asset_links')
      .insert({ ...input, created_by: actor.id, created_by_name: actor.full_name })
      .select()
      .single()
    if (missingTable(error)) {
      const row = localDb.insertResearchAssetLink(input, actor)
      logLocal(null, 'updated', 'Linked local research assets', actor)
      return row
    }
    if (error) fail('Could not link research assets', error)
    await api.log(null, 'updated', 'Linked research assets', actor)
    return data as ResearchAssetLink
  },

  async deleteResearchAssetLink(row: ResearchAssetLink, actor: Profile): Promise<void> {
    if (!IS_CLOUD) {
      localDb.deleteResearchAssetLink(row.id)
      logLocal(null, 'deleted', 'Deleted research asset link', actor)
      return
    }
    const { error } = await requireSupabase().from('research_asset_links').delete().eq('id', row.id)
    if (missingTable(error)) {
      localDb.deleteResearchAssetLink(row.id)
      return
    }
    if (error) fail('Could not delete research asset link', error)
    await api.log(null, 'deleted', 'Deleted research asset link', actor)
  },

  async listChemicalRequests(): Promise<ChemicalRequest[]> {
    if (!IS_CLOUD) return localDb.chemicalRequests()
    const { data, error } = await requireSupabase()
      .from('chemical_requests')
      .select('*')
      .order('requested_at', { ascending: false })
    if (missingTable(error)) return []
    if (error) fail('Could not load chemical requests', error)
    return (data ?? []) as ChemicalRequest[]
  },

  async createChemicalRequest(input: ChemicalRequestInput, actor: Profile): Promise<ChemicalRequest> {
    if (!IS_CLOUD) {
      const row = localDb.insertChemicalRequest(input, actor)
      logLocal(null, 'created', `Requested ${row.chemical_name_or_cas}`, actor)
      return row
    }
    const { data, error } = await requireSupabase()
      .from('chemical_requests')
      .insert({ ...input, requested_by: actor.id, requested_by_name: actor.full_name })
      .select()
      .single()
    if (missingTable(error)) {
      const row = localDb.insertChemicalRequest(input, actor)
      logLocal(null, 'created', `Requested ${row.chemical_name_or_cas}`, actor)
      return row
    }
    if (error) fail('Could not submit chemical request', error)
    await api.log(null, 'created', `Requested ${input.chemical_name_or_cas}`, actor)
    return data as ChemicalRequest
  },

  async updateChemicalRequest(id: string, patch: Partial<ChemicalRequest>, actor: Profile): Promise<ChemicalRequest> {
    const payload = patch.status && patch.status !== 'pending'
      ? { ...patch, decided_by: actor.id, decided_by_name: actor.full_name, decided_at: new Date().toISOString() }
      : patch
    if (!IS_CLOUD) {
      const row = localDb.updateChemicalRequest(id, payload)
      logLocal(null, 'updated', `Updated request ${row.chemical_name_or_cas}`, actor)
      return row
    }
    const { data, error } = await requireSupabase()
      .from('chemical_requests')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
    if (missingTable(error)) {
      const row = localDb.updateChemicalRequest(id, payload)
      logLocal(null, 'updated', `Updated request ${row.chemical_name_or_cas}`, actor)
      return row
    }
    if (error) fail('Could not update chemical request', error)
    await api.log(null, 'updated', `Updated chemical request ${(data as ChemicalRequest).chemical_name_or_cas}`, actor)
    return data as ChemicalRequest
  },

  async listComments(resourceType: Comment['resource_type'], resourceId: string): Promise<Comment[]> {
    if (!IS_CLOUD) return localDb.comments(resourceType, resourceId)
    const { data, error } = await requireSupabase()
      .from('comments')
      .select('*')
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .order('created_at', { ascending: true })
    if (missingTable(error)) return []
    if (error) fail('Could not load comments', error)
    return (data ?? []) as Comment[]
  },

  async createComment(input: CommentInput, actor: Profile): Promise<Comment> {
    if (!IS_CLOUD) return localDb.insertComment(input, actor)
    const { data, error } = await requireSupabase()
      .from('comments')
      .insert({ ...input, author_id: actor.id, author_name: actor.full_name })
      .select()
      .single()
    if (missingTable(error)) return localDb.insertComment(input, actor)
    if (error) fail('Could not add comment', error)
    return data as Comment
  },

  async deleteComment(row: Comment, actor: Profile): Promise<void> {
    if (!IS_CLOUD) {
      localDb.deleteComment(row.id)
      return
    }
    const { error } = await requireSupabase().from('comments').delete().eq('id', row.id)
    if (missingTable(error)) {
      localDb.deleteComment(row.id)
      return
    }
    if (error) fail('Could not delete comment', error)
    await api.log(null, 'updated', `Deleted comment on ${row.resource_type}`, actor)
  },

  async listEquipment(): Promise<Equipment[]> {
    if (!IS_CLOUD) return localDb.equipment()
    const { data, error } = await requireSupabase().from('equipment').select('*').order('name')
    if (missingTable(error)) return localDb.equipment()
    if (error) fail('Could not load equipment', error)
    return (data ?? []) as Equipment[]
  },

  async createEquipment(input: EquipmentInput): Promise<Equipment> {
    if (!IS_CLOUD) return localDb.insertEquipment(input)
    const { data, error } = await requireSupabase().from('equipment').insert(input).select().single()
    if (missingTable(error)) return localDb.insertEquipment(input)
    if (error) fail('Could not add equipment', error)
    return data as Equipment
  },

  async listEquipmentBookings(): Promise<EquipmentBooking[]> {
    if (!IS_CLOUD) return localDb.equipmentBookings()
    const { data, error } = await requireSupabase()
      .from('equipment_bookings')
      .select('*, equipment(name), research_assets(title)')
      .order('start_time', { ascending: true })
    if (missingTable(error)) return localDb.equipmentBookings()
    if (error) fail('Could not load equipment bookings', error)
    return ((data ?? []) as Array<EquipmentBooking & { equipment?: { name?: string }, research_assets?: { title?: string } }>).map((row) => ({
      ...row,
      equipment_name: row.equipment?.name ?? null,
      related_research_asset_title: row.research_assets?.title ?? null,
    }))
  },

  async createEquipmentBooking(input: EquipmentBookingInput, actor: Profile): Promise<EquipmentBooking> {
    if (!IS_CLOUD) return localDb.insertEquipmentBooking(input, actor)
    const { data, error } = await requireSupabase()
      .from('equipment_bookings')
      .insert({ ...input, booked_by: actor.id, booked_by_name: actor.full_name })
      .select()
      .single()
    if (missingTable(error)) return localDb.insertEquipmentBooking(input, actor)
    if (error) fail('Could not book equipment', error)
    return data as EquipmentBooking
  },

  /** Live updates so two people at two benches see the same shelf. */
  subscribe(onChange: () => void): () => void {
    if (!IS_CLOUD || !supabase) return () => {}
    const sb = supabase
    const channel = sb
      .channel('pearl-inventory')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chemicals' }, onChange)
      .subscribe()
    return () => {
      void sb.removeChannel(channel)
    }
  },
}

function logLocal(
  chemical: Chemical | null,
  action: ActivityAction,
  details: string,
  actor: Profile,
) {
  localDb.logActivity({
    chemical_id: chemical?.id ?? null,
    chemical_name: chemical?.name ?? null,
    action,
    details,
    user_id: actor.id,
    user_name: actor.full_name,
  })
}
