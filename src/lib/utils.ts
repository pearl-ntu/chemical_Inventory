import type { Chemical, Status } from './types'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return '—'
  const date = new Date(d + (d.length === 10 ? 'T00:00:00' : ''))
  if (Number.isNaN(date.getTime())) return d
  return date.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const secs = Math.round((Date.now() - then) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return formatDate(iso.slice(0, 10))
}

export function formatSize(c: Pick<Chemical, 'size_value' | 'size_unit' | 'quantity'>): string {
  const size = c.size_value == null ? '?' : trimNumber(c.size_value)
  const unit = c.size_unit || ''
  const each = `${size} ${unit}`.trim()
  return c.quantity > 1 ? `${c.quantity} × ${each}` : each
}

export function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)))
}

const UNIT_BASE: Record<string, { family: 'mass' | 'volume'; factor: number }> = {
  mg: { family: 'mass', factor: 0.001 },
  g: { family: 'mass', factor: 1 },
  kg: { family: 'mass', factor: 1000 },
  'µL': { family: 'volume', factor: 0.001 },
  mL: { family: 'volume', factor: 1 },
  L: { family: 'volume', factor: 1000 },
}

/**
 * Total amount held, converted to a common base (grams or millilitres) so
 * containers can be ranked against each other. Returns null for units that
 * cannot be compared — mixing "500 mL" and "500 g" in one ranking would be
 * meaningless, so callers keep the two families apart.
 */
export function normalisedAmount(
  c: Chemical,
): { family: 'mass' | 'volume'; base: number } | null {
  if (c.size_value == null) return null
  const unit = UNIT_BASE[c.size_unit]
  if (!unit) return null
  return { family: unit.family, base: c.size_value * (c.quantity || 1) * unit.factor }
}

const CAS_RE = /^\d{2,7}-\d{2}-\d$/

/** CAS numbers carry a check digit; catching typos here saves a lot of grief. */
export function validateCAS(cas: string): { ok: boolean; reason?: string } {
  const v = cas.trim()
  if (!v) return { ok: true }
  if (!CAS_RE.test(v)) return { ok: false, reason: 'Expected the form 123-45-6' }
  const digits = v.replace(/-/g, '')
  const body = digits.slice(0, -1)
  const check = Number(digits.slice(-1))
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[body.length - 1 - i]) * (i + 1)
  }
  return sum % 10 === check ? { ok: true } : { ok: false, reason: 'Check digit does not match' }
}

export function statusTone(status: Status): string {
  switch (status) {
    case 'active':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20'
    case 'low':
      return 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20'
    case 'empty':
      return 'bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-500/10 dark:text-ink-300 dark:ring-ink-400/20'
    case 'disposed':
      return 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20'
  }
}

/** Fuzzy-ish scoring so "dcm" finds "Dichloromethane" and CAS fragments match. */
export function matchesQuery(c: Chemical, q: string): boolean {
  if (!q) return true
  const needles = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = [
    c.name,
    c.cas,
    c.code,
    c.supplier,
    c.location,
    c.sub_location,
    c.owner,
    c.project,
    c.formula,
    c.catalog_no,
    c.remarks,
    c.system,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return needles.every((n) => hay.includes(n))
}

export function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v && v.trim())))).sort(
    (a, b) => a.localeCompare(b, 'en', { numeric: true }),
  )
}

/** Groups locations into "Fridge", "Cabinet", "Flammables store", "Other". */
export function locationGroup(location: string | null): string {
  const l = (location ?? '').toLowerCase()
  if (l.startsWith('fridge') || l.startsWith('freezer')) return 'Cold storage'
  if (l.startsWith('cabinet')) return 'Cabinets'
  if (l.startsWith('fs')) return 'Flammables store'
  if (!l) return 'Unassigned'
  return 'Other'
}

export function download(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob(['﻿' + content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function nextCode(existing: string[]): string {
  let max = 0
  for (const code of existing) {
    const m = /^PEARL-(\d+)$/.exec(code ?? '')
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `PEARL-${String(max + 1).padStart(4, '0')}`
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout>
  return (...args: A) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}
