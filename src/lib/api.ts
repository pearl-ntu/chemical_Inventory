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
  AppNotification,
  Chemical,
  ChemicalHistoryEntry,
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
  LabLocation,
  MemberOffboardingSummary,
  OffboardingItem,
  OwnershipTransferInput,
  Profile,
  PiNote,
  Project,
  ProjectMember,
  ProjectMilestone,
  ProjectMilestoneInput,
  ProjectUpdate,
  ProjectUpdateInput,
  ProjectWorkspace,
  ResearchAsset,
  ResearchAssetChemicalLink,
  ResearchAssetInput,
  ResearchAssetLink,
  ResearchAssetLinkInput,
  ResearchAssetVersion,
  ResearchAssetVersionInput,
  FeedPost,
  FeedPostInput,
  FeedPostLike,
  IncidentReport,
  IncidentReportInput,
  Role,
  Sop,
  SopInput,
} from './types'
import { nextCode } from './utils'

export class ApiError extends Error {}

const DEVELOPER_EMAIL = 'abedisyedaliabbas@gmail.com'

function isDeveloperAccount(profile: Pick<Profile, 'email'>) {
  return profile.email.toLowerCase() === DEVELOPER_EMAIL
}

function protectDeveloperAccount(target: Profile, action: string) {
  if (isDeveloperAccount(target)) {
    throw new ApiError(`The PEARL developer account cannot be ${action}.`)
  }
}

const LOCAL_LAB_LOCATIONS_KEY = 'pearl.custom_lab_locations'

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

/** Shared @mention matching — same regex approach used for project comments,
 *  reused here for feed posts rather than duplicating the pattern. */
function matchMentionedMembers(rows: Array<{ id: string; full_name: string }>, body: string, excludeId: string): string[] {
  const ids: string[] = []
  for (const row of rows) {
    if (row.id === excludeId) continue
    if (row.full_name && new RegExp(`@${row.full_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(body)) {
      ids.push(row.id)
    }
  }
  return ids
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

function localLabLocations(): LabLocation[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_LAB_LOCATIONS_KEY) ?? '[]') as LabLocation[]
  } catch {
    return []
  }
}

function saveLocalLabLocations(rows: LabLocation[]) {
  localStorage.setItem(LOCAL_LAB_LOCATIONS_KEY, JSON.stringify(rows))
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

async function invokeEdgeFunction(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sb = requireSupabase()
  await sb.auth.refreshSession().catch(() => null)
  const { data: userData, error: userError } = await sb.auth.getUser()
  if (userError || !userData.user) throw new ApiError('This action needs a fresh sign-in session.')
  const { data: sessionData } = await sb.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new ApiError('This action needs a signed-in session.')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(data?.error ?? data?.message ?? `Action failed with HTTP ${res.status}.`)
  return data as Record<string, unknown>
}

function invokeAskPearl(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return invokeEdgeFunction('ask-pearl', body)
}

export interface SdsLookupResult {
  cid: number | null
  pubchemUrl: string | null
  candidates: { url: string; label: string }[]
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
    const profile = await auth.currentProfile()
    if (!profile) throw new ApiError('Signed in, but no profile could be loaded.')

    if (profile.has_password) {
      if (!currentPassword) throw new ApiError('Enter your current password.')
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
    if (user) {
      const { error: profileError } = await sb
        .from('profiles')
        .update({ has_password: true })
        .eq('id', user.id)
      if (profileError) fail('Password changed, but could not update the account profile', profileError)
    }
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

  async lookupSds(cas: string): Promise<SdsLookupResult> {
    if (!IS_CLOUD) throw new ApiError('SDS lookup needs the app connected to Supabase.')
    const res = await invokeEdgeFunction('sds-lookup', { cas })
    return res as unknown as SdsLookupResult
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

  async listLabLocations(): Promise<LabLocation[]> {
    if (!IS_CLOUD) return localLabLocations()
    const { data, error } = await requireSupabase()
      .from('lab_locations')
      .select('*')
      .order('kind', { ascending: true })
      .order('name', { ascending: true })
    if (missingTable(error)) return []
    if (error) fail('Could not load custom lab locations', error)
    return (data ?? []) as LabLocation[]
  },

  async addLabLocation(name: string, kind: LabLocation['kind'], actor: Profile): Promise<LabLocation> {
    const clean = name.trim().replace(/\s+/g, ' ')
    if (!clean) throw new ApiError('Enter a location name first.')

    if (!IS_CLOUD) {
      const existing = localLabLocations()
      const duplicate = existing.find((row) => row.kind === kind && row.name.toLowerCase() === clean.toLowerCase())
      if (duplicate) return duplicate
      const row: LabLocation = {
        id: crypto.randomUUID(),
        name: clean,
        kind,
        capacity: null,
        notes: null,
        last_inspected_at: null,
        inspected_by: null,
        created_by: actor.id,
        created_at: new Date().toISOString(),
      }
      saveLocalLabLocations([...existing, row])
      return row
    }

    const { data, error } = await requireSupabase()
      .from('lab_locations')
      .insert({ name: clean, kind, created_by: actor.id })
      .select()
      .single()
    if (missingTable(error)) {
      throw new ApiError('Run supabase/upgrade_lab_locations.sql first, then add custom lab locations.')
    }
    if (error?.code === '23505') {
      const { data: rows } = await requireSupabase()
        .from('lab_locations')
        .select('*')
        .eq('kind', kind)
      const duplicate = ((rows ?? []) as LabLocation[]).find((row) => row.name.toLowerCase() === clean.toLowerCase())
      if (duplicate) return duplicate
    }
    if (error) fail('Could not add this lab location', error)
    return data as LabLocation
  },

  async deleteLabLocation(row: LabLocation): Promise<void> {
    if (!IS_CLOUD) {
      saveLocalLabLocations(localLabLocations().filter((item) => item.id !== row.id))
      return
    }
    const { error } = await requireSupabase().from('lab_locations').delete().eq('id', row.id)
    if (missingTable(error)) return
    if (error) fail('Could not remove this lab location', error)
  },

  async updateLabLocation(row: LabLocation, patch: Partial<LabLocation>): Promise<LabLocation> {
    if (!IS_CLOUD) {
      const updated = { ...row, ...patch }
      saveLocalLabLocations(localLabLocations().map((item) => (item.id === row.id ? updated : item)))
      return updated
    }
    const { data, error } = await requireSupabase()
      .from('lab_locations')
      .update(patch)
      .eq('id', row.id)
      .select()
      .single()
    if (missingTable(error)) throw new ApiError('Run supabase/upgrade_lab_locations.sql first.')
    if (error) fail('Could not update this lab location', error)
    return data as LabLocation
  },

  async listChemicals(): Promise<Chemical[]> {
    if (!IS_CLOUD) return localDb.chemicals()
    const sb = requireSupabase()
    // PostgREST caps a plain select at 1000 rows — paginate explicitly so a
    // library past that size doesn't silently show a truncated inventory.
    const PAGE_SIZE = 1000
    const { count, error: countError } = await sb
      .from('chemicals')
      .select('*', { count: 'exact', head: true })
    if (countError) fail('Could not load the inventory', countError)
    const pageStarts: number[] = []
    for (let from = 0; from < (count ?? 0); from += PAGE_SIZE) pageStarts.push(from)
    if (pageStarts.length === 0) return []
    const pages = await Promise.all(
      pageStarts.map(async (from) => {
        const { data, error } = await sb
          .from('chemicals')
          .select('*')
          .order('name', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1)
        if (error) fail('Could not load the inventory', error)
        return (data ?? []) as Chemical[]
      }),
    )
    return pages.flat()
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
      const { data: nextCodeValue, error: nextCodeError } = await sb.rpc('next_chemical_code')
      if (nextCodeError) fail('Could not allocate a code', nextCodeError)
      code = nextCodeValue as string
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
    const action: ActivityAction =
      patch.status === 'disposed'
        ? 'disposed'
        : 'location' in patch || 'sub_location' in patch
          ? 'moved'
          : 'updated'
    if (!IS_CLOUD) {
      const row = localDb.updateChemical(id, patch)
      logLocal(row, action, note ?? `Updated ${row.name}`, actor)
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
    await api.log(row, action, note ?? `Updated ${row.name}`, actor)
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
    const { count } = await sb.from('chemicals').select('*', { count: 'exact', head: true })
    const CODE_PAGE_SIZE = 1000
    const codeStarts: number[] = []
    for (let from = 0; from < (count ?? 0); from += CODE_PAGE_SIZE) codeStarts.push(from)
    const codePages = await Promise.all(
      codeStarts.map(async (from) => {
        const { data } = await sb.from('chemicals').select('code').range(from, from + CODE_PAGE_SIZE - 1)
        return ((data ?? []) as Array<{ code: string }>).map((c) => c.code)
      }),
    )
    const taken = codePages.flat()

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
      pubchem_cid: null,
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
    protectDeveloperAccount(target, 'demoted or role-changed')
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

  /** Grants or revokes the PI oversight dashboard — layered on top of
   *  `role` rather than replacing it, so a PI keeps whatever admin/member
   *  access they already had. */
  async setPiFlag(target: Profile, isPi: boolean, actor: Profile): Promise<void> {
    protectDeveloperAccount(target, 'changed by PI controls')
    if (!IS_CLOUD) throw new ApiError('The PI flag needs the app connected to Supabase.')
    const details = `${target.full_name} ${isPi ? 'made' : 'removed as'} PI`
    const { error } = await requireSupabase().from('profiles').update({ is_pi: isPi }).eq('id', target.id)
    if (error) fail('Could not update the PI flag', error)
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
    protectDeveloperAccount(target, 'revoked')
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
    protectDeveloperAccount(target, 'removed')
    const details = `${target.full_name}'s account removed`
    if (!IS_CLOUD) {
      localDb.saveUsers(localDb.users().filter((u) => u.id !== target.id))
      logLocal(null, 'role_changed', details, actor)
      return
    }
    await invokeEdgeFunction('member-offboarding', {
      action: 'delete_member',
      target_member_id: target.id,
    })
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
    const { data: nextStableIdValue, error: nextStableIdError } = await requireSupabase().rpc('next_research_asset_stable_id')
    if (nextStableIdError) fail('Could not allocate a stable ID', nextStableIdError)
    const { data, error } = await requireSupabase()
      .from('research_assets')
      .insert({
        ...input,
        stable_id: nextStableIdValue as string,
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
    let payload
    if (stableId) {
      payload = { ...input, stable_id: stableId, created_by: actor.id, created_by_name: actor.full_name }
    } else {
      const { data: nextStableIdValue, error: nextStableIdError } = await sb.rpc('next_research_asset_stable_id')
      if (nextStableIdError) fail('Could not allocate a stable ID', nextStableIdError)
      payload = {
        ...input,
        stable_id: nextStableIdValue as string,
        created_by: actor.id,
        created_by_name: actor.full_name,
      }
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
    const sb = requireSupabase()
    const { data, error } = await sb
      .from('comments')
      .insert({ ...input, author_id: actor.id, author_name: actor.full_name })
      .select()
      .single()
    if (missingTable(error)) return localDb.insertComment(input, actor)
    if (error) fail('Could not add comment', error)

    // A reply on a project thread pings every PI (minus whoever just wrote
    // it) — the whole point of a shared thread is that the PI doesn't have
    // to keep re-checking it manually for a reply. Plus anyone @mentioned
    // by full name gets their own ping too, deduped against the PI list.
    if (input.resource_type === 'project') {
      const { data: approved } = await sb.from('profiles').select('id, full_name, is_pi').eq('approved', true)
      const rows = (approved ?? []) as Array<{ id: string; full_name: string; is_pi: boolean }>

      const recipients = new Map<string, string>() // id -> reason
      for (const row of rows) {
        if (row.id === actor.id) continue
        if (row.is_pi) recipients.set(row.id, 'reply')
        else if (row.full_name && new RegExp(`@${row.full_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(input.body)) {
          recipients.set(row.id, 'mention')
        }
      }

      if (recipients.size > 0) {
        await sb.from('notifications').insert(
          [...recipients.entries()].map(([recipient_id, reason]) => ({
            recipient_id,
            actor_id: actor.id,
            actor_name: actor.full_name,
            project_id: input.resource_id,
            message: reason === 'mention' ? `mentioned you: ${input.body.slice(0, 140)}` : `replied: ${input.body.slice(0, 140)}`,
          })),
        )
      }
    }

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

  // -------------------------------------------------------------------------
  // Projects, weekly updates, and PI oversight — cloud-only; a demo-mode
  // session simply sees nothing here rather than a fake local log, since
  // there's no group of people to report progress to in a solo trial.
  // -------------------------------------------------------------------------

  async listProjects(): Promise<Project[]> {
    if (!IS_CLOUD) return []
    const { data, error } = await requireSupabase()
      .from('projects')
      .select('*')
      .eq('archived', false)
      .order('name')
    if (missingTable(error)) return []
    if (error) fail('Could not load projects', error)
    return (data ?? []) as Project[]
  },

  /** Finds a project by name (case-insensitive) or creates it — so posting
   *  an update never requires a separate "create project" step first. */
  async findOrCreateProject(name: string, workspace: ProjectWorkspace, actor: Profile): Promise<Project> {
    if (!IS_CLOUD) throw new ApiError('Projects need the app connected to Supabase.')
    const trimmed = name.trim()
    if (!trimmed) throw new ApiError('Project name is required.')
    const sb = requireSupabase()

    const existing = await sb.from('projects').select('*').ilike('name', trimmed).maybeSingle()
    if (existing.data) return existing.data as Project

    const { data, error } = await sb
      .from('projects')
      .insert({ name: trimmed, workspace, created_by: actor.id })
      .select()
      .single()
    if (error?.code === '23505') {
      // Someone else created the same name a moment ago — fetch instead of failing.
      const retry = await sb.from('projects').select('*').ilike('name', trimmed).single()
      if (!retry.error) return retry.data as Project
    }
    if (error) fail('Could not create project', error)
    return data as Project
  },

  async listProjectUpdates(projectId: string): Promise<ProjectUpdate[]> {
    if (!IS_CLOUD) return []
    const { data, error } = await requireSupabase()
      .from('project_updates')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (missingTable(error)) return []
    if (error) fail('Could not load project updates', error)
    return (data ?? []) as ProjectUpdate[]
  },

  /** Every update across every project, newest first — the PI dashboard's
   *  main feed, capped so one chatty project can't drown out the rest. */
  async listRecentProjectUpdates(limit = 200): Promise<ProjectUpdate[]> {
    if (!IS_CLOUD) return []
    const { data, error } = await requireSupabase()
      .from('project_updates')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (missingTable(error)) return []
    if (error) fail('Could not load project updates', error)
    return (data ?? []) as ProjectUpdate[]
  },

  async addProjectUpdate(input: ProjectUpdateInput, actor: Profile): Promise<ProjectUpdate> {
    if (!IS_CLOUD) throw new ApiError('Project updates need the app connected to Supabase.')
    const { data, error } = await requireSupabase()
      .from('project_updates')
      .insert({ ...input, author_id: actor.id, author_name: actor.full_name })
      .select()
      .single()
    if (error) fail('Could not post that update', error)
    return data as ProjectUpdate
  },

  async listNotifications(): Promise<AppNotification[]> {
    if (!IS_CLOUD) return []
    const { data, error } = await requireSupabase()
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    if (missingTable(error)) return []
    if (error) fail('Could not load notifications', error)
    return (data ?? []) as AppNotification[]
  },

  async markNotificationRead(id: string): Promise<void> {
    if (!IS_CLOUD) return
    const { error } = await requireSupabase()
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .is('read_at', null)
    if (error && !missingTable(error)) fail('Could not update that notification', error)
  },

  /** Pings one recipient about a project — used by the PI dashboard's
   *  comment box. Posts a project comment and a notification together so
   *  the recipient sees both the message and an unread badge. */
  async pingAboutProject(
    projectId: string,
    recipientId: string,
    message: string,
    actor: Profile,
  ): Promise<void> {
    if (!IS_CLOUD) throw new ApiError('Pings need the app connected to Supabase.')
    const sb = requireSupabase()
    const { error: commentError } = await sb
      .from('comments')
      .insert({ resource_type: 'project', resource_id: projectId, author_id: actor.id, author_name: actor.full_name, body: message })
    if (commentError) fail('Could not post that comment', commentError)

    const { error: notifyError } = await sb.from('notifications').insert({
      recipient_id: recipientId,
      actor_id: actor.id,
      actor_name: actor.full_name,
      project_id: projectId,
      message,
    })
    if (notifyError && !missingTable(notifyError)) fail('Comment posted, but the ping failed', notifyError)
  },

  /** Explicit creation, distinct from `findOrCreateProject` — used from the
   *  PI console where "add a project" is a deliberate action, not a
   *  side-effect of someone posting their first update. */
  async createProject(name: string, workspace: ProjectWorkspace, actor: Profile): Promise<Project> {
    return api.findOrCreateProject(name, workspace, actor)
  },

  async archiveProject(project: Project): Promise<void> {
    if (!IS_CLOUD) throw new ApiError('Projects need the app connected to Supabase.')
    const { error } = await requireSupabase().from('projects').update({ archived: true }).eq('id', project.id)
    if (error) fail('Could not archive that project', error)
  },

  async unarchiveProject(project: Project): Promise<Project> {
    if (!IS_CLOUD) throw new ApiError('Projects need the app connected to Supabase.')
    const { data, error } = await requireSupabase()
      .from('projects')
      .update({ archived: false })
      .eq('id', project.id)
      .select()
      .single()
    if (error) fail('Could not restore that project', error)
    return data as Project
  },

  async listArchivedProjects(): Promise<Project[]> {
    if (!IS_CLOUD) return []
    const { data, error } = await requireSupabase()
      .from('projects')
      .select('*')
      .eq('archived', true)
      .order('name')
    if (missingTable(error)) return []
    if (error) fail('Could not load archived projects', error)
    return (data ?? []) as Project[]
  },

  async updateProjectDescription(project: Project, description: string): Promise<Project> {
    return api.updateProject(project, { description })
  },

  async updateProject(
    project: Project,
    patch: Partial<Pick<Project, 'description' | 'status' | 'target_date' | 'budget_amount' | 'workspace'>>,
  ): Promise<Project> {
    if (!IS_CLOUD) throw new ApiError('Projects need the app connected to Supabase.')
    const { data, error } = await requireSupabase()
      .from('projects')
      .update(patch)
      .eq('id', project.id)
      .select()
      .single()
    if (error) fail('Could not save that project', error)
    return data as Project
  },

  async getProject(id: string): Promise<Project | null> {
    if (!IS_CLOUD) return null
    const { data, error } = await requireSupabase().from('projects').select('*').eq('id', id).maybeSingle()
    if (error) fail('Could not load that project', error)
    return (data as Project | null) ?? null
  },

  async listMilestones(projectId: string): Promise<ProjectMilestone[]> {
    if (!IS_CLOUD) return []
    const { data, error } = await requireSupabase()
      .from('project_milestones')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at')
    if (missingTable(error)) return []
    if (error) fail('Could not load milestones', error)
    return (data ?? []) as ProjectMilestone[]
  },

  async createMilestone(input: ProjectMilestoneInput): Promise<ProjectMilestone> {
    if (!IS_CLOUD) throw new ApiError('Milestones need the app connected to Supabase.')
    const { data, error } = await requireSupabase().from('project_milestones').insert(input).select().single()
    if (error) fail('Could not add that milestone', error)
    return data as ProjectMilestone
  },

  async updateMilestone(
    milestone: ProjectMilestone,
    patch: Partial<Pick<ProjectMilestone, 'status' | 'title' | 'assignee_member_id' | 'due_date'>>,
  ): Promise<ProjectMilestone> {
    if (!IS_CLOUD) throw new ApiError('Milestones need the app connected to Supabase.')
    const { data, error } = await requireSupabase()
      .from('project_milestones')
      .update(patch)
      .eq('id', milestone.id)
      .select()
      .single()
    if (error) fail('Could not update that milestone', error)
    return data as ProjectMilestone
  },

  async deleteMilestone(milestone: ProjectMilestone): Promise<void> {
    if (!IS_CLOUD) throw new ApiError('Milestones need the app connected to Supabase.')
    const { error } = await requireSupabase().from('project_milestones').delete().eq('id', milestone.id)
    if (error) fail('Could not delete that milestone', error)
  },

  async listFeedPosts(): Promise<FeedPost[]> {
    if (!IS_CLOUD) return []
    const { data, error } = await requireSupabase().from('feed_posts').select('*').order('created_at', { ascending: false })
    if (missingTable(error)) return []
    if (error) fail('Could not load the feed', error)
    return (data ?? []) as FeedPost[]
  },

  async createFeedPost(input: FeedPostInput, actor: Profile): Promise<FeedPost> {
    if (!IS_CLOUD) throw new ApiError('The feed needs the app connected to Supabase.')
    const sb = requireSupabase()
    const { data, error } = await sb
      .from('feed_posts')
      .insert({ ...input, author_id: actor.id, author_name: actor.full_name })
      .select()
      .single()
    if (error) fail('Could not post that', error)

    const { data: approved } = await sb.from('profiles').select('id, full_name').eq('approved', true)
    const mentioned = matchMentionedMembers((approved ?? []) as Array<{ id: string; full_name: string }>, input.body, actor.id)
    if (mentioned.length > 0) {
      await sb.from('notifications').insert(
        mentioned.map((recipient_id) => ({
          recipient_id,
          actor_id: actor.id,
          actor_name: actor.full_name,
          message: `mentioned you in the feed: ${input.body.slice(0, 140)}`,
        })),
      )
    }

    return data as FeedPost
  },

  async deleteFeedPost(post: FeedPost): Promise<void> {
    if (!IS_CLOUD) throw new ApiError('The feed needs the app connected to Supabase.')
    const { error } = await requireSupabase().from('feed_posts').delete().eq('id', post.id)
    if (error) fail('Could not delete that post', error)
  },

  async listFeedPostLikes(): Promise<FeedPostLike[]> {
    if (!IS_CLOUD) return []
    const { data, error } = await requireSupabase().from('feed_post_likes').select('*')
    if (missingTable(error)) return []
    if (error) fail('Could not load likes', error)
    return (data ?? []) as FeedPostLike[]
  },

  async likeFeedPost(postId: string, actor: Profile): Promise<void> {
    if (!IS_CLOUD) throw new ApiError('The feed needs the app connected to Supabase.')
    const { error } = await requireSupabase().from('feed_post_likes').insert({ post_id: postId, member_id: actor.id })
    if (error && error.code !== '23505') fail('Could not like that post', error)
  },

  async unlikeFeedPost(postId: string, actor: Profile): Promise<void> {
    if (!IS_CLOUD) throw new ApiError('The feed needs the app connected to Supabase.')
    const { error } = await requireSupabase()
      .from('feed_post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('member_id', actor.id)
    if (error) fail('Could not unlike that post', error)
  },

  async listIncidentReports(): Promise<IncidentReport[]> {
    if (!IS_CLOUD) return []
    const { data, error } = await requireSupabase()
      .from('incident_reports')
      .select('*')
      .order('created_at', { ascending: false })
    if (missingTable(error)) return []
    if (error) fail('Could not load incident reports', error)
    return (data ?? []) as IncidentReport[]
  },

  async createIncidentReport(input: IncidentReportInput, actor: Profile): Promise<IncidentReport> {
    if (!IS_CLOUD) throw new ApiError('Incident reports need the app connected to Supabase.')
    const { data, error } = await requireSupabase()
      .from('incident_reports')
      .insert({ ...input, reported_by: actor.id, reported_by_name: actor.full_name })
      .select()
      .single()
    if (error) fail('Could not file that report', error)
    return data as IncidentReport
  },

  async listSops(): Promise<Sop[]> {
    if (!IS_CLOUD) return []
    const { data, error } = await requireSupabase().from('sops').select('*').order('title')
    if (missingTable(error)) return []
    if (error) fail('Could not load SOPs', error)
    return (data ?? []) as Sop[]
  },

  async createSop(input: SopInput, actor: Profile): Promise<Sop> {
    if (!IS_CLOUD) throw new ApiError('SOPs need the app connected to Supabase.')
    const { data, error } = await requireSupabase()
      .from('sops')
      .insert({ ...input, created_by: actor.id, created_by_name: actor.full_name })
      .select()
      .single()
    if (error) fail('Could not create that SOP', error)
    return data as Sop
  },

  async updateSop(sop: Sop, patch: SopInput): Promise<Sop> {
    if (!IS_CLOUD) throw new ApiError('SOPs need the app connected to Supabase.')
    const { data, error } = await requireSupabase()
      .from('sops')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', sop.id)
      .select()
      .single()
    if (error) fail('Could not save that SOP', error)
    return data as Sop
  },

  async deleteSop(sop: Sop): Promise<void> {
    if (!IS_CLOUD) throw new ApiError('SOPs need the app connected to Supabase.')
    const { error } = await requireSupabase().from('sops').delete().eq('id', sop.id)
    if (error) fail('Could not delete that SOP', error)
  },

  /** Populated entirely by a database trigger — never written to from here. */
  async listChemicalHistory(chemicalId: string): Promise<ChemicalHistoryEntry[]> {
    if (!IS_CLOUD) return []
    const { data, error } = await requireSupabase()
      .from('chemical_history')
      .select('*')
      .eq('chemical_id', chemicalId)
      .order('changed_at', { ascending: false })
    if (missingTable(error)) return []
    if (error) fail('Could not load history', error)
    return (data ?? []) as ChemicalHistoryEntry[]
  },

  /** Admin-only supervision notes about a member — RLS already keeps these
   *  from the member they're about; missingTable() failures fall back to an
   *  empty list rather than surfacing an error toast for a not-yet-migrated
   *  install. */
  async listPiNotes(memberId: string): Promise<PiNote[]> {
    if (!IS_CLOUD) return []
    const { data, error } = await requireSupabase()
      .from('pi_notes')
      .select('*')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
    if (missingTable(error)) return []
    if (error) fail('Could not load notes', error)
    return (data ?? []) as PiNote[]
  },

  async addPiNote(memberId: string, body: string, actor: Profile): Promise<PiNote> {
    if (!IS_CLOUD) throw new ApiError('Notes need the app connected to Supabase.')
    const { data, error } = await requireSupabase()
      .from('pi_notes')
      .insert({ member_id: memberId, author_id: actor.id, author_name: actor.full_name, body })
      .select()
      .single()
    if (error) fail('Could not save that note', error)
    return data as PiNote
  },

  async deletePiNote(note: PiNote): Promise<void> {
    if (!IS_CLOUD) throw new ApiError('Notes need the app connected to Supabase.')
    const { error } = await requireSupabase().from('pi_notes').delete().eq('id', note.id)
    if (error) fail('Could not delete that note', error)
  },

  async listAllProjectMembers(): Promise<ProjectMember[]> {
    if (!IS_CLOUD) return []
    const { data, error } = await requireSupabase().from('project_members').select('*')
    if (missingTable(error)) return []
    if (error) fail('Could not load project assignments', error)
    return (data ?? []) as ProjectMember[]
  },

  async assignMember(projectId: string, profileId: string, actor: Profile): Promise<ProjectMember> {
    if (!IS_CLOUD) throw new ApiError('Assignments need the app connected to Supabase.')
    const { data, error } = await requireSupabase()
      .from('project_members')
      .upsert({ project_id: projectId, profile_id: profileId, assigned_by: actor.id }, { onConflict: 'project_id,profile_id' })
      .select()
      .single()
    if (error) fail('Could not assign that member', error)
    return data as ProjectMember
  },

  async unassignMember(projectId: string, profileId: string): Promise<void> {
    if (!IS_CLOUD) throw new ApiError('Assignments need the app connected to Supabase.')
    const { error } = await requireSupabase()
      .from('project_members')
      .delete()
      .eq('project_id', projectId)
      .eq('profile_id', profileId)
    if (error) fail('Could not remove that assignment', error)
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
