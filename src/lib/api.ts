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
  Profile,
  Role,
} from './types'
import { nextCode } from './utils'

export class ApiError extends Error {}

function fail(context: string, error: { message: string } | null): never {
  throw new ApiError(`${context}: ${error?.message ?? 'unknown error'}`)
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
    if (!data) {
      return {
        id: user.id,
        email: user.email ?? '',
        full_name: (user.user_metadata?.full_name as string) ?? user.email?.split('@')[0] ?? '',
        role: 'member',
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

  async setRole(id: string, role: Role): Promise<void> {
    if (!IS_CLOUD) {
      localDb.setRole(id, role)
      return
    }
    const { error } = await requireSupabase().from('profiles').update({ role }).eq('id', id)
    if (error) fail('Could not change that role', error)
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
