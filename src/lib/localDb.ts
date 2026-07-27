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
import type { ActivityEntry, Chemical, Profile, Role } from './types'
import { SEED_ROWS } from './seedData'
import { nextCode, todayISO } from './utils'

const K = {
  chemicals: 'pearl.demo.chemicals',
  activity: 'pearl.demo.activity',
  users: 'pearl.demo.users',
  session: 'pearl.demo.session',
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
    created_by: null,
    created_at: now,
    updated_at: now,
    // The starter sheet is the lab's existing, already-vetted inventory —
    // not a fresh submission — so it loads straight in as approved.
    review_status: 'approved',
    reviewed_by: null,
    reviewed_at: null,
    rejection_reason: null,
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
      lab_position: null,
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

  setRole(id: string, role: Role): Profile {
    return localDb.updateUser(id, { role })
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
