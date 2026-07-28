/**
 * A photo of the delivery order/invoice, attached to a chemical registration
 * for reference — and an optional, always-user-confirmed reading of its
 * fields. Nothing here ever writes to the registration form on its own;
 * every caller gets back plain data and decides what to do with it.
 *
 * Reading the fields runs entirely on-device (Tesseract.js OCR + pattern
 * matching) rather than calling a paid AI vision API — free, works offline,
 * and works in demo mode too, at the cost of only reliably catching
 * structured patterns (a CAS number, a price, a pack size) rather than
 * free-text fields like the chemical name, which OCR has no way to tell
 * apart from the supplier's letterhead or address block.
 */
import { ApiError } from './api'
import { IS_CLOUD } from './config'
import { requireSupabase, supabase } from './supabase'

const BUCKET = 'delivery-photos'
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.75

/** Downscales a phone photo before it ever leaves the device — a fresh
 *  12MP shot is massive overkill for reading text off it, and bloats both
 *  the storage bucket and (in demo mode) localStorage. */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  )
  return blob ?? file
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Uploads a delivery photo and returns what `chemicals.delivery_photo_path`
 * should be set to — a storage object path in cloud mode, or the image
 * itself as a data URL in demo mode (there's no real bucket to put it in).
 */
export async function uploadDeliveryPhoto(file: File): Promise<string> {
  const compressed = await compressImage(file)

  if (!IS_CLOUD) return blobToDataUrl(compressed)

  const sb = requireSupabase()
  const { data: userData } = await sb.auth.getUser()
  const uid = userData.user?.id ?? 'anon'
  const path = `${uid}/${crypto.randomUUID()}.jpg`

  const { error } = await sb.storage.from(BUCKET).upload(path, compressed, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (error) throw new ApiError(`Could not upload the photo: ${error.message}`)
  return path
}

/** A stored path isn't directly viewable — the bucket is private, so a
 *  temporary signed URL is minted each time the photo is actually shown.
 *  A demo-mode data URL is already viewable as-is. */
export async function resolveDeliveryPhotoUrl(path: string): Promise<string> {
  if (path.startsWith('data:')) return path
  const sb = requireSupabase()
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error || !data) throw new ApiError(`Could not load the photo: ${error?.message ?? 'unknown error'}`)
  return data.signedUrl
}

/** Only the fields on-device OCR can plausibly find — a distinctive enough
 *  pattern to pick out of a wall of raw recognized text with confidence. A
 *  free-text field like `name` or `supplier` has no such pattern, so it's
 *  deliberately not attempted rather than guessed and often wrong. */
export interface ExtractedFields {
  cas?: string
  quantity?: number
  size_value?: number
  size_unit?: string
  price?: number
  currency?: string
}

const SIZE_UNITS = ['kg', 'mg', 'g', 'mL', 'µL', 'L', 'mmol', 'mol', 'units'] as const
const CURRENCY_SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', S$: 'SGD' }

/**
 * Runs OCR on the photo and pattern-matches a handful of structured fields
 * out of the raw text — nothing here touches the registration form. The
 * caller shows these as a checklist for the person to confirm first.
 */
export async function extractInvoiceFields(file: File): Promise<ExtractedFields> {
  const { createWorker } = await import('tesseract.js')
  const compressed = await compressImage(file)

  const worker = await createWorker('eng')
  let text: string
  try {
    const result = await worker.recognize(compressed)
    text = result.data.text
  } finally {
    await worker.terminate()
  }

  const fields: ExtractedFields = {}

  // CAS registry numbers have a distinctive, near-unambiguous shape —
  // 2-7 digits, a hyphen, 2 digits, a hyphen, 1 check digit.
  const cas = text.match(/\b\d{2,7}-\d{2}-\d\b/)
  if (cas) fields.cas = cas[0]

  // A pack size: a number immediately followed by a known unit.
  const size = text.match(new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s?(${SIZE_UNITS.join('|')})\\b`, 'i'))
  if (size) {
    fields.size_value = Number(size[1])
    fields.size_unit = SIZE_UNITS.find((u) => u.toLowerCase() === size[2].toLowerCase())
  }

  // A price: a currency symbol/code immediately before or after an amount.
  const price = text.match(/(SGD|USD|S\$|US\$|[$€£])\s?([\d,]+\.\d{2})\b/i)
  if (price) {
    fields.price = Number(price[2].replace(/,/g, ''))
    const symbol = price[1].toUpperCase()
    fields.currency = symbol.length === 3 ? symbol : (CURRENCY_SYMBOLS[price[1]] ?? undefined)
  }

  // A quantity, only when explicitly labelled — otherwise any stray number
  // (a phone number, an invoice number) would get mistaken for one.
  const qty = text.match(/\b(?:qty|quantity)[:\s]*(\d+)\b/i)
  if (qty) fields.quantity = Number(qty[1])

  return fields
}

/** Narrowing helper so callers don't need to null-check `supabase` again. */
export function deliveryPhotosAvailable(): boolean {
  return IS_CLOUD && supabase !== null
}
