/**
 * DEMO-MODE storage.
 *
 * A tiny localStorage-backed stand-in for Supabase so the app is fully usable
 * with zero setup — useful for evaluating it, for a GitHub Pages preview, and
 * as an offline read-only reference on a phone at the bench.
 *
 * It is NOT a substitute for the real thing: data never leaves the browser, so
 * nothing is shared between people. The UI says so, loudly.
 */
import type {
  ActivityEntry,
  Chemical,
  ChemicalRequest,
  ChemicalRequestInput,
  Comment,
  CommentInput,
  Equipment,
  EquipmentBooking,
  EquipmentBookingInput,
  EquipmentInput,
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
import { SEED_ROWS } from './seedData'
import { nextCode, todayISO } from './utils'

const K = {
  chemicals: 'pearl.demo.chemicals',
  activity: 'pearl.demo.activity',
  users: 'pearl.demo.users',
  session: 'pearl.demo.session',
  researchAssets: 'pearl.demo.research_assets',
  researchAssetChemicals: 'pearl.demo.research_asset_chemicals',
  researchAssetVersions: 'pearl.demo.research_asset_versions',
  researchAssetLinks: 'pearl.demo.research_asset_links',
  chemicalRequests: 'pearl.demo.chemical_requests',
  comments: 'pearl.demo.comments',
  equipment: 'pearl.demo.equipment',
  equipmentBookings: 'pearl.demo.equipment_bookings',
} as const

interface DemoUser extends Profile {
  passwordHash: string
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota exceeded — demo mode degrades to read-only, which is acceptable */
  }
}

function uid(): string {
  return crypto.randomUUID()
}

function nextResearchAssetStableId(rows: ResearchAsset[]): string {
  const max = rows.reduce((highest, row) => {
    const n = Number(row.stable_id?.replace(/\D/g, '') || 0)
    return Number.isFinite(n) ? Math.max(highest, n) : highest
  }, 0)
  return `PEARL-RA-${String(max + 1).padStart(6, '0')}`
}

export async function hashPassword(pw: string): Promise<string> {
  const bytes = new TextEncoder().encode('pearl:' + pw)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function seedChemicals(): Chemical[] {
  const now = new Date().toISOString()
  return SEED_ROWS.map((r) => ({
    id: uid(),
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
    created_by: null,
    created_at: now,
    updated_at: now,
  }))
}

export const localDb = {
  chemicals(): Chemical[] {
    const existing = read<Chemical[] | null>(K.chemicals, null)
    if (existing) return existing
    const seeded = seedChemicals()
    write(K.chemicals, seeded)
    return seeded
  },

  saveChemicals(rows: Chemical[]) {
    write(K.chemicals, rows)
  },

  insertChemical(input: Omit<Chemical, 'id' | 'created_at' | 'updated_at' | 'code'> & { code?: string }): Chemical {
    const rows = localDb.chemicals()
    const now = new Date().toISOString()
    const row: Chemical = {
      ...input,
      id: uid(),
      code: input.code || nextCode(rows.map((r) => r.code)),
      created_at: now,
      updated_at: now,
    }
    localDb.saveChemicals([row, ...rows])
    return row
  },

  updateChemical(id: string, patch: Partial<Chemical>): Chemical {
    const rows = localDb.chemicals()
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) throw new Error('Chemical not found')
    const updated = { ...rows[idx], ...patch, updated_at: new Date().toISOString() }
    rows[idx] = updated
    localDb.saveChemicals(rows)
    return updated
  },

  deleteChemical(id: string) {
    localDb.saveChemicals(localDb.chemicals().filter((r) => r.id !== id))
  },

  resetChemicals(): Chemical[] {
    const seeded = seedChemicals()
    write(K.chemicals, seeded)
    return seeded
  },

  activity(): ActivityEntry[] {
    return read<ActivityEntry[]>(K.activity, [])
  },

  logActivity(entry: Omit<ActivityEntry, 'id' | 'created_at'>) {
    const rows = localDb.activity()
    rows.unshift({ ...entry, id: uid(), created_at: new Date().toISOString() })
    write(K.activity, rows.slice(0, 500))
  },

  users(): DemoUser[] {
    return read<DemoUser[]>(K.users, [])
  },

  saveUsers(users: DemoUser[]) {
    write(K.users, users)
  },

  async createUser(email: string, password: string, fullName: string): Promise<Profile> {
    const users = localDb.users()
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('An account with that email already exists on this device.')
    }
    const user: DemoUser = {
      id: uid(),
      email,
      full_name: fullName || email.split('@')[0],
      // First account on the device is the admin, mirroring the SQL trigger.
      role: users.length === 0 ? 'admin' : 'member',
      // Demo mode has no real security boundary — it's one browser's own
      // storage — so there's no benefit to the account-approval gate here,
      // only friction. Every demo account is approved immediately.
      approved: true,
      // Demo mode is password-only (no magic link), so there's always one.
      has_password: true,
      lab_position: null,
      avatar_key: null,
      created_at: todayISO(),
      passwordHash: await hashPassword(password),
    }
    users.push(user)
    localDb.saveUsers(users)
    return stripHash(user)
  },

  async verifyUser(email: string, password: string): Promise<Profile> {
    const user = localDb
      .users()
      .find((u) => u.email.toLowerCase() === email.trim().toLowerCase())
    if (!user) throw new Error('No account found for that email on this device.')
    if (user.passwordHash !== (await hashPassword(password))) {
      throw new Error('Incorrect password.')
    }
    return stripHash(user)
  },

  updateUser(id: string, patch: Partial<Profile>): Profile {
    const users = localDb.users()
    const idx = users.findIndex((u) => u.id === id)
    if (idx === -1) throw new Error('User not found')
    users[idx] = { ...users[idx], ...patch }
    localDb.saveUsers(users)
    return stripHash(users[idx])
  },

  async setPassword(id: string, newPassword: string): Promise<void> {
    const users = localDb.users()
    const idx = users.findIndex((u) => u.id === id)
    if (idx === -1) throw new Error('User not found')
    users[idx] = { ...users[idx], passwordHash: await hashPassword(newPassword), has_password: true }
    localDb.saveUsers(users)
  },

  setRole(id: string, role: Role): Profile {
    return localDb.updateUser(id, { role })
  },

  researchAssets(): ResearchAsset[] {
    return read<ResearchAsset[]>(K.researchAssets, []).map((row) => ({
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

  saveResearchAssets(rows: ResearchAsset[]) {
    write(K.researchAssets, rows)
  },

  insertResearchAsset(input: ResearchAssetInput, actor: Profile): ResearchAsset {
    const rows = localDb.researchAssets()
    const now = new Date().toISOString()
    const row: ResearchAsset = {
      ...input,
      id: uid(),
      stable_id: nextResearchAssetStableId(rows),
      created_by: actor.id,
      created_by_name: actor.full_name,
      created_at: now,
      updated_at: now,
    }
    localDb.saveResearchAssets([row, ...rows])
    return row
  },

  updateResearchAsset(id: string, patch: Partial<ResearchAsset>): ResearchAsset {
    const rows = localDb.researchAssets()
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) throw new Error('Research asset not found')
    const updated = { ...rows[idx], ...patch, updated_at: new Date().toISOString() }
    rows[idx] = updated
    localDb.saveResearchAssets(rows)
    return updated
  },

  deleteResearchAsset(id: string) {
    localDb.saveResearchAssets(localDb.researchAssets().filter((r) => r.id !== id))
    localDb.saveResearchAssetChemicalLinks(
      localDb.researchAssetChemicalLinks().filter((r) => r.research_asset_id !== id),
    )
    localDb.saveResearchAssetVersions(
      localDb.researchAssetVersions().filter((r) => r.research_asset_id !== id),
    )
    localDb.saveResearchAssetLinks(
      localDb.researchAssetLinks().filter((r) => r.source_asset_id !== id && r.target_asset_id !== id),
    )
  },

  researchAssetChemicalLinks(): ResearchAssetChemicalLink[] {
    return read<ResearchAssetChemicalLink[]>(K.researchAssetChemicals, [])
  },

  saveResearchAssetChemicalLinks(rows: ResearchAssetChemicalLink[]) {
    write(K.researchAssetChemicals, rows)
  },

  setResearchAssetChemicals(assetId: string, chemicalIds: string[]) {
    const chemicals = localDb.chemicals()
    const nextLinks = chemicalIds.map((chemicalId) => ({
      research_asset_id: assetId,
      chemical_id: chemicalId,
      chemical_name: chemicals.find((c) => c.id === chemicalId)?.name ?? null,
    }))
    const others = localDb
      .researchAssetChemicalLinks()
      .filter((row) => row.research_asset_id !== assetId)
    localDb.saveResearchAssetChemicalLinks([...others, ...nextLinks])
  },

  researchAssetVersions(): ResearchAssetVersion[] {
    return read<ResearchAssetVersion[]>(K.researchAssetVersions, [])
  },

  saveResearchAssetVersions(rows: ResearchAssetVersion[]) {
    write(K.researchAssetVersions, rows)
  },

  insertResearchAssetVersion(input: ResearchAssetVersionInput, actor: Profile): ResearchAssetVersion {
    const row: ResearchAssetVersion = {
      ...input,
      id: uid(),
      created_at: new Date().toISOString(),
      created_by: actor.id,
      created_by_name: actor.full_name,
    }
    localDb.saveResearchAssetVersions([row, ...localDb.researchAssetVersions()])
    return row
  },

  deleteResearchAssetVersion(id: string) {
    localDb.saveResearchAssetVersions(localDb.researchAssetVersions().filter((row) => row.id !== id))
  },

  researchAssetLinks(): ResearchAssetLink[] {
    return read<ResearchAssetLink[]>(K.researchAssetLinks, [])
  },

  saveResearchAssetLinks(rows: ResearchAssetLink[]) {
    write(K.researchAssetLinks, rows)
  },

  insertResearchAssetLink(input: ResearchAssetLinkInput, actor: Profile): ResearchAssetLink {
    const row: ResearchAssetLink = {
      ...input,
      id: uid(),
      created_at: new Date().toISOString(),
      created_by: actor.id,
      created_by_name: actor.full_name,
    }
    localDb.saveResearchAssetLinks([row, ...localDb.researchAssetLinks()])
    return row
  },

  deleteResearchAssetLink(id: string) {
    localDb.saveResearchAssetLinks(localDb.researchAssetLinks().filter((row) => row.id !== id))
  },

  chemicalRequests(): ChemicalRequest[] {
    return read<ChemicalRequest[]>(K.chemicalRequests, [])
  },

  saveChemicalRequests(rows: ChemicalRequest[]) {
    write(K.chemicalRequests, rows)
  },

  insertChemicalRequest(input: ChemicalRequestInput, actor: Profile): ChemicalRequest {
    const row: ChemicalRequest = {
      ...input,
      id: uid(),
      requested_by: actor.id,
      requested_by_name: actor.full_name,
      status: 'pending',
      requested_at: new Date().toISOString(),
      decided_by: null,
      decided_by_name: null,
      decided_at: null,
      received_container_id: null,
    }
    localDb.saveChemicalRequests([row, ...localDb.chemicalRequests()])
    return row
  },

  updateChemicalRequest(id: string, patch: Partial<ChemicalRequest>): ChemicalRequest {
    const rows = localDb.chemicalRequests()
    const idx = rows.findIndex((row) => row.id === id)
    if (idx === -1) throw new Error('Chemical request not found')
    const updated = { ...rows[idx], ...patch }
    rows[idx] = updated
    localDb.saveChemicalRequests(rows)
    return updated
  },

  comments(resourceType?: string, resourceId?: string): Comment[] {
    const rows = read<Comment[]>(K.comments, [])
    return resourceType && resourceId
      ? rows.filter((row) => row.resource_type === resourceType && row.resource_id === resourceId)
      : rows
  },

  insertComment(input: CommentInput, actor: Profile): Comment {
    const row: Comment = {
      ...input,
      id: uid(),
      author_id: actor.id,
      author_name: actor.full_name,
      created_at: new Date().toISOString(),
      edited_at: null,
    }
    write(K.comments, [row, ...read<Comment[]>(K.comments, [])])
    return row
  },

  deleteComment(id: string) {
    write(K.comments, read<Comment[]>(K.comments, []).filter((row) => row.id !== id))
  },

  equipment(): Equipment[] {
    return read<Equipment[]>(K.equipment, [])
  },

  insertEquipment(input: EquipmentInput): Equipment {
    const row: Equipment = { ...input, id: uid(), created_at: new Date().toISOString() }
    write(K.equipment, [row, ...localDb.equipment()])
    return row
  },

  equipmentBookings(): EquipmentBooking[] {
    return read<EquipmentBooking[]>(K.equipmentBookings, [])
  },

  insertEquipmentBooking(input: EquipmentBookingInput, actor: Profile): EquipmentBooking {
    const equipment = localDb.equipment().find((row) => row.id === input.equipment_id)
    const overlaps = localDb.equipmentBookings().some(
      (row) =>
        row.equipment_id === input.equipment_id &&
        new Date(input.start_time) < new Date(row.end_time) &&
        new Date(input.end_time) > new Date(row.start_time),
    )
    if (overlaps) throw new Error('This equipment is already booked for that time.')
    const row: EquipmentBooking = {
      ...input,
      id: uid(),
      equipment_name: equipment?.name ?? null,
      booked_by: actor.id,
      booked_by_name: actor.full_name,
      related_research_asset_title: null,
      created_at: new Date().toISOString(),
    }
    write(K.equipmentBookings, [row, ...localDb.equipmentBookings()])
    return row
  },

  session(): Profile | null {
    const id = read<string | null>(K.session, null)
    if (!id) return null
    const user = localDb.users().find((u) => u.id === id)
    return user ? stripHash(user) : null
  },

  setSession(id: string | null) {
    if (id) write(K.session, id)
    else localStorage.removeItem(K.session)
  },
}

function stripHash(u: DemoUser): Profile {
  const { passwordHash: _ignored, ...profile } = u
  return profile
}
