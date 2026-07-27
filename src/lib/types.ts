export type Status = 'active' | 'low' | 'empty' | 'disposed'

export const STATUSES: Status[] = ['active', 'low', 'empty', 'disposed']

export const STATUS_LABEL: Record<Status, string> = {
  active: 'In stock',
  low: 'Running low',
  empty: 'Empty',
  disposed: 'Disposed',
}

/** GHS pictogram hazard classes, used for the safety badges and storage advice. */
export const HAZARDS = [
  'Flammable',
  'Oxidising',
  'Explosive',
  'Corrosive',
  'Acute toxic',
  'Health hazard',
  'Irritant',
  'Environmental',
  'Compressed gas',
] as const

export type Hazard = (typeof HAZARDS)[number]

export const SIZE_UNITS = ['g', 'mg', 'kg', 'mL', 'L', 'µL', 'mol', 'mmol', 'units'] as const

export interface Chemical {
  id: string
  /** Short human-readable label, also encoded in the QR sticker. e.g. PEARL-0042 */
  code: string
  name: string
  cas: string | null
  system: string | null
  supplier: string | null
  catalog_no: string | null
  location: string | null
  sub_location: string | null
  formula: string | null
  mol_weight: number | null
  /** MDL Molfile (V3000) from the built-in 2D structure editor — null if never drawn. */
  structure_molfile: string | null
  /** An optional drawn synthesis scheme (RXN format) — null if never drawn. */
  reaction_rxnfile: string | null
  purity: string | null
  quantity: number
  size_value: number | null
  size_unit: string
  price: number | null
  currency: string
  owner: string | null
  project: string | null
  registration_date: string | null
  opened_date: string | null
  expiry_date: string | null
  status: Status
  date_emptied: string | null
  hazards: string[]
  storage_class: string | null
  remarks: string | null
  registered_by: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** The subset a user actually types in the form. */
export type ChemicalInput = Omit<
  Chemical,
  'id' | 'created_at' | 'updated_at' | 'created_by' | 'code'
> & { code?: string }

export type Role = 'admin' | 'member' | 'viewer'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  /**
   * Whether an admin has let this account in at all. New sign-ups start
   * `false` and can't see the inventory — not just "can't edit it" — until
   * someone approves them. Distinct from `role`, which only governs what an
   * already-approved account can do.
   */
  approved: boolean
  lab_position: string | null
  created_at: string
}

/**
 * A record that an invite email was sent — exists independently of whether
 * the recipient has opened it yet, so "who did we invite, and when" survives
 * even before they show up as an actual account.
 */
export interface Invite {
  id: string
  email: string
  full_name: string | null
  invited_by: string | null
  invited_by_name: string | null
  created_at: string
}

export type ActivityAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'marked_empty'
  | 'restocked'
  | 'imported'
  | 'signed_up'
  | 'invited'
  | 'role_changed'

export interface ActivityEntry {
  id: string
  chemical_id: string | null
  chemical_name: string | null
  action: ActivityAction
  details: string | null
  user_id: string | null
  user_name: string | null
  created_at: string
}

export interface Filters {
  q: string
  location: string[]
  supplier: string[]
  status: Status[]
  system: string[]
  owner: string[]
  hazard: string[]
}

export const EMPTY_FILTERS: Filters = {
  q: '',
  location: [],
  supplier: [],
  status: [],
  system: [],
  owner: [],
  hazard: [],
}

export type SortKey =
  | 'name'
  | 'cas'
  | 'location'
  | 'supplier'
  | 'registration_date'
  | 'status'
  | 'size_value'
  | 'code'

export interface Sort {
  key: SortKey
  dir: 'asc' | 'desc'
}
