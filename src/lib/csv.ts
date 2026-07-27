import type { Chemical, ChemicalInput, Status } from './types'
import { todayISO } from './utils'

/** RFC-4180 parser: handles quoted fields, embedded commas, and "" escapes. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function esc(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const EXPORT_COLUMNS = [
  'code',
  'name',
  'cas',
  'formula',
  'mol_weight',
  'purity',
  'system',
  'supplier',
  'catalog_no',
  'location',
  'sub_location',
  'quantity',
  'size_value',
  'size_unit',
  'price',
  'currency',
  'hazards',
  'storage_class',
  'owner',
  'project',
  'registration_date',
  'opened_date',
  'expiry_date',
  'status',
  'date_emptied',
  'remarks',
  'registered_by',
] as const

const HEADER_LABEL: Record<string, string> = {
  code: 'Code',
  name: 'Chemical Name',
  cas: 'CAS No.',
  formula: 'Mol. Formula',
  mol_weight: 'Mol. Weight',
  purity: 'Purity',
  system: 'System',
  supplier: 'Supplier',
  catalog_no: 'Catalogue No.',
  location: 'Location',
  sub_location: 'Sub-location',
  quantity: 'Quantity',
  size_value: 'Size Value',
  size_unit: 'Size Unit',
  price: 'Purchase Price',
  currency: 'Currency',
  hazards: 'Hazards',
  storage_class: 'Storage Class',
  owner: 'User',
  project: 'Project',
  registration_date: 'Registration Date',
  opened_date: 'Date Opened',
  expiry_date: 'Expiry Date',
  status: 'Status',
  date_emptied: 'Date Emptied',
  remarks: 'Remarks',
  registered_by: 'Registered By',
}

export function toCSV(rows: Chemical[]): string {
  const head = EXPORT_COLUMNS.map((c) => esc(HEADER_LABEL[c] ?? c)).join(',')
  const body = rows.map((r) =>
    EXPORT_COLUMNS.map((c) => {
      const v = r[c as keyof Chemical]
      return esc(Array.isArray(v) ? v.join('; ') : v)
    }).join(','),
  )
  return [head, ...body].join('\n')
}

/** A blank sheet with the right headers, so people import valid data first try. */
export function templateCSV(): string {
  const head = EXPORT_COLUMNS.map((c) => esc(HEADER_LABEL[c] ?? c)).join(',')
  const example = [
    '',
    'Sodium borohydride',
    '16940-66-2',
    'NaBH4',
    '37.83',
    '98%',
    'Ariba System',
    'Sigma-Aldrich',
    '213462',
    'Cabinet 3',
    'Shelf 2',
    '1',
    '25',
    'g',
    '',
    'SGD',
    'Flammable; Corrosive',
    'Water-reactive',
    'Your Name',
    'Project X',
    todayISO(),
    '',
    '',
    'active',
    '',
    'Keep dry',
    'Your Name',
  ].map(esc)
  return [head, example.join(',')].join('\n')
}

/**
 * Maps a spreadsheet header to a field. Deliberately forgiving — it accepts the
 * headings from the lab's original Excel sheet as well as the app's own export,
 * so an import of either file just works.
 */
const HEADER_ALIASES: Record<string, keyof ChemicalInput> = {}
const ALIAS_SOURCE: Array<[keyof ChemicalInput, string[]]> = [
  ['code', ['code', 'id', 'barcode', 'label', 'pearl code']],
  ['name', ['name', 'chemical name', 'chemical', 'reagent', 'compound', 'product name']],
  ['cas', ['cas', 'cas no', 'cas no.', 'cas number', 'cas rn', 'casrn']],
  ['formula', ['formula', 'mol formula', 'mol. formula', 'molecular formula']],
  ['mol_weight', ['mw', 'mol weight', 'mol. weight', 'molecular weight', 'molar mass']],
  ['purity', ['purity', 'grade', 'assay']],
  ['system', ['system', 'source system', 'purchasing system']],
  ['supplier', ['supplier', 'vendor', 'manufacturer', 'brand']],
  ['catalog_no', ['catalog no', 'catalogue no', 'catalog no.', 'catalogue no.', 'cat no', 'cat. no.', 'product no']],
  ['location', ['location', 'storage', 'storage location', 'place', 'cabinet', 'fridge']],
  ['sub_location', ['sub-location', 'sub location', 'shelf', 'position', 'slot']],
  ['quantity', ['quantity', 'qty', 'containers', 'no. of bottles', 'bottles', 'count']],
  ['size_value', ['size value', 'size', 'amount', 'pack size', 'volume', 'mass']],
  ['size_unit', ['size unit', 'unit', 'units', 'uom']],
  ['price', ['price', 'purchase price', 'cost']],
  ['currency', ['currency', 'ccy']],
  ['hazards', ['hazards', 'hazard', 'ghs', 'ghs class', 'hazard class']],
  ['storage_class', ['storage class', 'storage category', 'class']],
  ['owner', ['user', 'owner', 'assigned to', 'responsible', 'holder']],
  ['project', ['project', 'grant', 'programme', 'program']],
  ['registration_date', ['registration date', 'date registered', 'date added', 'received', 'purchase date', 'date']],
  ['opened_date', ['date opened', 'opened', 'opened date']],
  ['expiry_date', ['expiry date', 'expiry', 'expires', 'expiration date', 'use by']],
  ['status', ['status', 'state']],
  ['date_emptied', ['date emptied', 'emptied', 'finished', 'date finished']],
  ['remarks', ['remarks', 'notes', 'comment', 'comments', 'note']],
  ['registered_by', ['registered by', 'added by', 'entered by', 'created by']],
]
for (const [field, aliases] of ALIAS_SOURCE) {
  for (const a of aliases) HEADER_ALIASES[a] = field
}

function normaliseHeader(h: string): keyof ChemicalInput | null {
  const key = h
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[_\s]+/g, ' ')
    .replace(/[^a-z0-9. ]/g, '')
    .trim()
  return HEADER_ALIASES[key] ?? HEADER_ALIASES[key.replace(/\.$/, '')] ?? null
}

export interface ImportResult {
  rows: ChemicalInput[]
  /** Headers we could not map, so the user can see what was ignored. */
  ignoredColumns: string[]
  errors: Array<{ line: number; message: string }>
}

function toNumber(v: string): number | null {
  const cleaned = v.replace(/[^\d.\-]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function toDate(v: string): string | null {
  const t = v.trim()
  if (!t) return null
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(t)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  // Day-first, which is what a Singapore-locale Excel export produces.
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(t)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  const parsed = new Date(t)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

const VALID_STATUS: Status[] = ['active', 'low', 'empty', 'disposed']

export function rowsToChemicals(table: string[][]): ImportResult {
  const errors: ImportResult['errors'] = []
  const rows: ChemicalInput[] = []
  if (table.length < 2) {
    return { rows, ignoredColumns: [], errors: [{ line: 0, message: 'The file has no data rows.' }] }
  }

  const header = table[0]
  const mapping = header.map(normaliseHeader)
  const ignoredColumns = header.filter((h, i) => h.trim() && mapping[i] === null)

  if (!mapping.includes('name')) {
    return {
      rows,
      ignoredColumns,
      errors: [
        {
          line: 1,
          message:
            'No "Chemical Name" column found. Download the template to see the expected headings.',
        },
      ],
    }
  }

  for (let r = 1; r < table.length; r++) {
    const cells = table[r]
    const raw: Record<string, string> = {}
    mapping.forEach((field, i) => {
      if (field) raw[field] = (cells[i] ?? '').trim()
    })

    if (!raw.name) {
      errors.push({ line: r + 1, message: 'Skipped — no chemical name.' })
      continue
    }

    const status = raw.status?.toLowerCase().trim() as Status
    rows.push({
      code: raw.code || undefined,
      name: raw.name,
      cas: raw.cas || null,
      system: raw.system || null,
      supplier: raw.supplier || null,
      catalog_no: raw.catalog_no || null,
      location: raw.location || null,
      sub_location: raw.sub_location || null,
      formula: raw.formula || null,
      mol_weight: raw.mol_weight ? toNumber(raw.mol_weight) : null,
      purity: raw.purity || null,
      quantity: raw.quantity ? (toNumber(raw.quantity) ?? 1) : 1,
      size_value: raw.size_value ? toNumber(raw.size_value) : null,
      size_unit: raw.size_unit || 'g',
      price: raw.price ? toNumber(raw.price) : null,
      currency: raw.currency || 'SGD',
      owner: raw.owner || null,
      project: raw.project || null,
      registration_date: raw.registration_date ? toDate(raw.registration_date) : todayISO(),
      opened_date: raw.opened_date ? toDate(raw.opened_date) : null,
      expiry_date: raw.expiry_date ? toDate(raw.expiry_date) : null,
      status: VALID_STATUS.includes(status) ? status : 'active',
      date_emptied: raw.date_emptied ? toDate(raw.date_emptied) : null,
      hazards: raw.hazards
        ? raw.hazards
            .split(/[;,|]/)
            .map((h) => h.trim())
            .filter(Boolean)
        : [],
      storage_class: raw.storage_class || null,
      remarks: raw.remarks || null,
      registered_by: raw.registered_by || null,
    })
  }

  return { rows, ignoredColumns, errors }
}
