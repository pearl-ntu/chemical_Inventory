export type Status = 'active' | 'low' | 'empty' | 'disposed'

/**
 * The approval workflow, separate from the physical stock `status` above.
 * Set by the server, never trusted from the client: see the triggers in
 * supabase/schema.sql.
 */
export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
}

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
  review_status: ReviewStatus
  reviewed_by: string | null
  reviewed_at: string | null
  rejection_reason: string | null
}

/** The subset a user actually types in the form. */
export type ChemicalInput = Omit<
  Chemical,
  'id' | 'created_at' | 'updated_at' | 'created_by' | 'code' | 'review_status' | 'reviewed_by' | 'reviewed_at' | 'rejection_reason'
> & { code?: string }

export type Role = 'admin' | 'member' | 'viewer'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  lab_position: string | null
  created_at: string
}

export type ActivityAction =
  | 'created'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'updated'
  | 'deleted'
  | 'marked_empty'
  | 'restocked'
  | 'imported'
  | 'signed_up'

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
