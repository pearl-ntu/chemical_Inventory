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
  batch_no: string | null
  location: string | null
  sub_location: string | null
  formula: string | null
  mol_weight: number | null
  /** MDL Molfile (V3000) from the built-in 2D structure editor — null if never drawn. */
  structure_molfile: string | null
  /** Cached PubChem CID, resolved from CAS/name — lets structure search use
   *  PubChem's own substructure index for rows that never got a hand-drawn
   *  structure_molfile. Null until enrichment runs. */
  pubchem_cid: number | null
  /** An optional drawn synthesis scheme (RXN format) — null if never drawn. */
  reaction_rxnfile: string | null
  /** Path into the delivery-photos storage bucket (cloud) or a data URL
   *  (demo mode) — a photo of the delivery order/invoice, for reference. */
  delivery_photo_path: string | null
  sds_url: string | null
  coa_url: string | null
  invoice_url: string | null
  purity: string | null
  concentration: string | null
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
  disposal_date: string | null
  disposal_reason: string | null
  disposal_waste_class: string | null
  reorder_url: string | null
  reorder_priority: 'none' | 'watch' | 'soon' | 'urgent'
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
  /**
   * Whether this account has ever set a password — false for someone who's
   * only ever clicked a magic-link/invite email. Gates the one-time
   * "set a password" prompt shown right after that first sign-in, so a slow
   * or misdirected email isn't the only way back in from then on.
   */
  has_password: boolean
  lab_position: string | null
  avatar_key?: string | null
  /** Grants the PI-only oversight dashboard and pings, on top of whatever
   *  `role` already allows — see supabase/upgrade_pi_oversight.sql. */
  is_pi?: boolean
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

export type ProjectWorkspace = 'experimental' | 'computational' | 'both'

export const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
}

export interface Project {
  id: string
  name: string
  workspace: ProjectWorkspace
  description: string | null
  status: ProjectStatus
  target_date: string | null
  budget_amount: number | null
  created_by: string | null
  created_at: string
  archived: boolean
}

export type ProjectHealth = 'red' | 'amber' | 'green'

export const MILESTONE_STATUSES = ['todo', 'in_progress', 'done'] as const
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number]

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
}

export interface ProjectMilestone {
  id: string
  project_id: string
  title: string
  status: MilestoneStatus
  assignee_member_id: string | null
  due_date: string | null
  created_at: string
}

export type ProjectMilestoneInput = Pick<ProjectMilestone, 'project_id' | 'title' | 'assignee_member_id' | 'due_date'>

export type FeedLinkedResourceType = 'chemical' | 'research_asset' | 'project'

export interface FeedPost {
  id: string
  author_id: string | null
  author_name: string | null
  body: string
  image_url: string | null
  linked_resource_type: FeedLinkedResourceType | null
  linked_resource_id: string | null
  cross_post_to_teams: boolean
  created_at: string
}

export type FeedPostInput = Pick<
  FeedPost,
  'body' | 'image_url' | 'linked_resource_type' | 'linked_resource_id' | 'cross_post_to_teams'
>

export interface FeedPostLike {
  post_id: string
  member_id: string
  created_at: string
}

export const INCIDENT_SEVERITIES = ['near_miss', 'minor', 'major'] as const
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number]

export const INCIDENT_SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  near_miss: 'Near miss',
  minor: 'Minor',
  major: 'Major',
}

export type IncidentResourceType = 'chemical' | 'equipment' | 'other'

export interface IncidentReport {
  id: string
  reported_by: string | null
  reported_by_name: string | null
  resource_type: IncidentResourceType | null
  resource_id: string | null
  severity: IncidentSeverity
  description: string
  occurred_at: string
  actions_taken: string | null
  created_at: string
}

export type IncidentReportInput = Pick<
  IncidentReport,
  'resource_type' | 'resource_id' | 'severity' | 'description' | 'occurred_at' | 'actions_taken'
>

export interface Sop {
  id: string
  title: string
  body: string
  related_chemical_ids: string[]
  related_equipment_id: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

export type SopInput = Pick<Sop, 'title' | 'body' | 'related_chemical_ids' | 'related_equipment_id'>

export interface ChemicalHistoryEntry {
  id: string
  chemical_id: string
  changed_by: string | null
  changed_by_name: string | null
  changed_at: string
  diff: Record<string, { old: unknown; new: unknown }>
}

export interface PiNote {
  id: string
  member_id: string
  author_id: string | null
  author_name: string | null
  body: string
  created_at: string
}

export const PROJECT_UPDATE_STATUSES = ['on_track', 'blocked', 'done', 'paused'] as const
export type ProjectUpdateStatus = (typeof PROJECT_UPDATE_STATUSES)[number]

export const PROJECT_UPDATE_STATUS_LABEL: Record<ProjectUpdateStatus, string> = {
  on_track: 'On track',
  blocked: 'Blocked',
  done: 'Done',
  paused: 'Paused',
}

export interface ProjectUpdate {
  id: string
  project_id: string
  author_id: string | null
  author_name: string | null
  status: ProjectUpdateStatus
  summary: string
  created_at: string
}

export type ProjectUpdateInput = Pick<ProjectUpdate, 'project_id' | 'status' | 'summary'>

export interface ProjectMember {
  project_id: string
  profile_id: string
  assigned_by: string | null
  assigned_at: string
}

export interface AppNotification {
  id: string
  recipient_id: string
  actor_id: string | null
  actor_name: string | null
  project_id: string | null
  message: string
  created_at: string
  read_at: string | null
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
  | 'moved'
  | 'disposed'
  | 'handover'

export const ASSET_TYPES = ['dataset', 'model', 'simulation', 'code', 'notebook', 'compute', 'sample', 'publication', 'other'] as const
export type ResearchAssetType = (typeof ASSET_TYPES)[number]

export const ASSET_STATUSES = ['active', 'running', 'complete', 'failed', 'archived'] as const
export type ResearchAssetStatus = (typeof ASSET_STATUSES)[number]

export const ASSET_VISIBILITIES = ['private'] as const
export type ResearchAssetVisibility = (typeof ASSET_VISIBILITIES)[number]

export interface ResearchAsset {
  id: string
  stable_id: string | null
  type: ResearchAssetType
  title: string
  description: string | null
  project: string | null
  owner: string | null
  related_chemical_id: string | null
  related_chemical_name: string | null
  source: string | null
  source_external_id: string | null
  external_path: string | null
  storage_link: string | null
  size_bytes: number | null
  size_label: string | null
  format: string | null
  license: string | null
  checksum: string | null
  version: string | null
  tags: string[]
  method: string | null
  software: string | null
  input_link: string | null
  output_link: string | null
  repo_link: string | null
  environment: string | null
  metrics: string | null
  access_notes: string | null
  status: ResearchAssetStatus
  visibility: ResearchAssetVisibility
  notes: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
  last_verified_at: string | null
}

export type ResearchAssetInput = Omit<
  ResearchAsset,
  'id' | 'stable_id' | 'created_at' | 'updated_at' | 'created_by' | 'created_by_name'
>

export interface ResearchAssetChemicalLink {
  research_asset_id: string
  chemical_id: string
  chemical_name?: string | null
}

export interface ResearchAssetVersion {
  id: string
  research_asset_id: string
  version_number: string
  checksum: string | null
  size_bytes: number | null
  size_label: string | null
  external_path: string | null
  created_at: string
  notes: string | null
  created_by: string | null
  created_by_name: string | null
}

export type ResearchAssetVersionInput = Omit<
  ResearchAssetVersion,
  'id' | 'created_at' | 'created_by' | 'created_by_name'
>

export const ASSET_LINK_RELATIONSHIPS = ['derived_from', 'input_to', 'related_to'] as const
export type ResearchAssetRelationship = (typeof ASSET_LINK_RELATIONSHIPS)[number]

export interface ResearchAssetLink {
  id: string
  source_asset_id: string
  target_asset_id: string
  relationship: ResearchAssetRelationship
  created_at: string
  created_by: string | null
  created_by_name: string | null
  notes: string | null
}

export type ResearchAssetLinkInput = Omit<
  ResearchAssetLink,
  'id' | 'created_at' | 'created_by' | 'created_by_name'
>

export const CHEMICAL_REQUEST_STATUSES = ['pending', 'approved', 'declined', 'received'] as const
export type ChemicalRequestStatus = (typeof CHEMICAL_REQUEST_STATUSES)[number]

export interface ChemicalRequest {
  id: string
  requested_by: string | null
  requested_by_name: string | null
  chemical_name_or_cas: string
  quantity: string | null
  supplier: string | null
  justification_project: string | null
  status: ChemicalRequestStatus
  requested_at: string
  decided_by: string | null
  decided_by_name: string | null
  decided_at: string | null
  received_container_id: string | null
  notes: string | null
}

export type ChemicalRequestInput = Pick<
  ChemicalRequest,
  'chemical_name_or_cas' | 'quantity' | 'supplier' | 'justification_project' | 'notes'
>

export type OwnershipResourceType = 'chemical' | 'research_asset'

export interface OwnershipTransfer {
  id: string
  resource_type: OwnershipResourceType
  resource_id: string
  from_member: string | null
  from_member_name: string | null
  to_member: string | null
  to_member_name: string | null
  transferred_by: string | null
  transferred_by_name: string | null
  transferred_at: string
}

export interface OffboardingItem {
  resource_type: OwnershipResourceType
  resource_id: string
  title: string
  subtitle: string | null
  project: string | null
  location: string | null
  status: string | null
  stable_id: string | null
  owner: string | null
  created_by: string | null
  size_label: string | null
  storage_link: string | null
}

export interface MemberOffboardingSummary {
  member: Pick<Profile, 'id' | 'full_name' | 'email'>
  chemicals: OffboardingItem[]
  research_assets: OffboardingItem[]
  projects: Array<{ name: string; count: number; size_bytes: number | null }>
}

export interface OwnershipTransferInput {
  resource_type: OwnershipResourceType
  resource_id: string
  to_member_id: string
}

export type CommentResourceType = 'chemical' | 'research_asset' | 'equipment_booking' | 'project' | 'feed_post'

export interface Comment {
  id: string
  resource_type: CommentResourceType
  resource_id: string
  author_id: string | null
  author_name: string | null
  body: string
  created_at: string
  edited_at: string | null
}

export type CommentInput = Pick<Comment, 'resource_type' | 'resource_id' | 'body'>

export interface Equipment {
  id: string
  name: string
  location: string | null
  notes: string | null
  created_at: string
}

export type EquipmentInput = Pick<Equipment, 'name' | 'location' | 'notes'>

export interface LabLocation {
  id: string
  name: string
  kind: 'location' | 'sub_location'
  capacity: number | null
  notes: string | null
  last_inspected_at: string | null
  inspected_by: string | null
  created_by: string | null
  created_at: string
}

export interface EquipmentBooking {
  id: string
  equipment_id: string
  equipment_name?: string | null
  booked_by: string | null
  booked_by_name: string | null
  start_time: string
  end_time: string
  purpose: string
  related_research_asset_id: string | null
  related_research_asset_title?: string | null
  created_at: string
}

export type EquipmentBookingInput = Pick<
  EquipmentBooking,
  'equipment_id' | 'start_time' | 'end_time' | 'purpose' | 'related_research_asset_id'
>

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
