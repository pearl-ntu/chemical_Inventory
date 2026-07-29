/**
 * The single data layer for the whole app.
 *
 * Every page talks to `api.*` and never to Supabase or localStorage directly,
 * so the cloud and demo backends stay interchangeable and the UI has exactly
 * one place to look for a bug.
 */
import { IS_CLOUD } from './config'
import { localDb } from './localDb'
import { SEED_ROWS } from './seedData'
import { supabase, requireSupabase } from './supabase'
import type {
  ActivityAction,
  ActivityEntry,
  Chemical,
  ChemicalInput,
  Invite,
  Profile,
  Role,
} from './types'
import { nextCode } from './utils'

export class ApiError extends Error {}

function fail(context: string, error: { message: string } | null): never {
  throw new ApiError(`${context}: ${error?.message ?? 'unknown error'}`)
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
      location: r.location,
      sub_location: null,
      formula: null,
      mol_weight: null,
      structure_molfile: null,
      reaction_rxnfile: null,
      delivery_photo_path: null,
      purity: null,
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
