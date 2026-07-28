/**
 * A photo of the delivery order/invoice, attached to a chemical registration
 * for reference — and an optional, always-user-confirmed reading of its
 * fields. Nothing here ever writes to the registration form on its own;
 * every caller gets back plain data and decides what to do with it.
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

/** Exactly the fields the extraction tool is allowed to return — see the
 *  matching tool schema in supabase/functions/extract-invoice. */
export interface ExtractedFields {
  name?: string
  cas?: string
  supplier?: string
  catalog_no?: string
  quantity?: number
  size_value?: number
  size_unit?: string
  purity?: string
  price?: number
  currency?: string
  system?: string
}

/**
 * Sends the photo to the extract-invoice Edge Function and returns whatever
 * fields it could read — nothing here touches the registration form. The
 * caller shows these as a checklist for the person to confirm first.
 */
export async function extractInvoiceFields(file: File): Promise<ExtractedFields> {
  if (!IS_CLOUD) {
    throw new ApiError('Reading a photo needs the shared cloud database. In demo mode, fill the fields in by hand.')
  }
  const sb = requireSupabase()
  const compressed = await compressImage(file)
  const dataUrl = await blobToDataUrl(compressed)
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)

  const { data, error } = await sb.functions.invoke('extract-invoice', {
    body: { image: base64, mediaType: 'image/jpeg' },
  })
  if (error) throw new ApiError(`Could not read the photo: ${await describeFunctionsError(error)}`)
  if (data?.error) throw new ApiError(data.error)
  return (data?.fields ?? {}) as ExtractedFields
}

/**
 * supabase-js's own `error.message` for a failed function call is always the
 * same generic "Edge Function returned a non-2xx status code" — it never
 * surfaces what the function actually said. The real reason is in
 * `error.context`, the raw Response, whose body is the `{ error: "..." }`
 * this function's own error handler wrote.
 */
async function describeFunctionsError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context
  if (context instanceof Response) {
    try {
      const body = await context.clone().json()
      if (typeof body?.error === 'string') return body.error
    } catch {
      // Body wasn't JSON (e.g. a gateway error page) — fall through.
    }
  }
  return error instanceof Error ? error.message : 'Unknown error.'
}

/** Narrowing helper so callers don't need to null-check `supabase` again. */
export function deliveryPhotosAvailable(): boolean {
  return IS_CLOUD && supabase !== null
}
