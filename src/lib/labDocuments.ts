/**
 * SDS / CoA / invoice files attached to a chemical registration. The
 * `chemicals.sds_url` / `coa_url` / `invoice_url` columns have always held a
 * plain external link (a manufacturer's SDS page, say); this adds the option
 * to upload the actual file instead, without a schema change, by storing a
 * `storage:<path>` reference in the same column. `resolveDocUrl` tells the
 * two apart and mints a signed URL only for the ones that need it — an
 * external link is already directly viewable.
 */
import { ApiError } from './api'
import { IS_CLOUD } from './config'
import { requireSupabase, supabase } from './supabase'

const BUCKET = 'lab-documents'
const STORAGE_PREFIX = 'storage:'
const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15MB — generous for a scanned PDF, not for a video
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

export type LabDocumentKind = 'sds' | 'coa' | 'invoice'

function extensionFor(file: File): string {
  const fromName = file.name.split('.').pop()
  if (fromName && fromName.length <= 5) return fromName.toLowerCase()
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  return 'jpg'
}

function blobToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Uploads an SDS/CoA/invoice file and returns what the corresponding
 * `sds_url` / `coa_url` / `invoice_url` column should be set to. Rejects
 * up front on an unexpected file type or an unreasonably large file —
 * validated here rather than trusting the browser's file picker, since
 * this value ends up world-signable (a signed URL) for approved lab members.
 */
export async function uploadLabDocument(file: File, kind: LabDocumentKind): Promise<string> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new ApiError('Please upload a PDF or image (JPEG, PNG, WEBP).')
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ApiError('That file is larger than 15MB — please upload a smaller copy.')
  }

  if (!IS_CLOUD) return blobToDataUrl(file)

  const sb = requireSupabase()
  const { data: userData } = await sb.auth.getUser()
  const uid = userData.user?.id ?? 'anon'
  const path = `${uid}/${kind}/${crypto.randomUUID()}.${extensionFor(file)}`

  const { error } = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new ApiError(`Could not upload the file: ${error.message}`)
  return `${STORAGE_PREFIX}${path}`
}

/** Whether a stored value is one of our own uploads rather than an external link. */
export function isStorageRef(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(STORAGE_PREFIX))
}

/**
 * Resolves a stored `sds_url`/`coa_url`/`invoice_url` value into something
 * directly openable: an external link and a demo-mode data URL are already
 * viewable as-is; one of our own uploads needs a temporary signed URL minted
 * since the bucket is private.
 */
export async function resolveDocUrl(value: string | null | undefined): Promise<string | null> {
  if (!value) return null
  if (!isStorageRef(value)) return value

  const path = value.slice(STORAGE_PREFIX.length)
  const sb = requireSupabase()
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error || !data) throw new ApiError(`Could not open the file: ${error?.message ?? 'unknown error'}`)
  return data.signedUrl
}

/** Narrowing helper so callers don't need to null-check `supabase` again. */
export function labDocumentsAvailable(): boolean {
  return IS_CLOUD && supabase !== null
}
