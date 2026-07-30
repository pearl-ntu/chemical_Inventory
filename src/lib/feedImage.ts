/**
 * Feed post images — same compress-before-upload approach as
 * deliveryPhoto.ts, kept small deliberately given the Storage free-tier
 * budget: nobody needs a full-resolution phone photo in a feed post.
 */
import { ApiError } from './api'
import { IS_CLOUD } from './config'
import { requireSupabase } from './supabase'

const BUCKET = 'feed-images'
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.75

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

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  return blob ?? file
}

/** Returns the storage object path to save as `feed_posts.image_url` — not
 *  directly viewable, the bucket is private, so resolveFeedImageUrl mints a
 *  signed URL when actually displaying it. */
export async function uploadFeedImage(file: File): Promise<string> {
  if (!IS_CLOUD) throw new ApiError('Images need the app connected to Supabase.')
  const compressed = await compressImage(file)
  const sb = requireSupabase()
  const { data: userData } = await sb.auth.getUser()
  const uid = userData.user?.id ?? 'anon'
  const path = `${uid}/${crypto.randomUUID()}.jpg`

  const { error } = await sb.storage.from(BUCKET).upload(path, compressed, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new ApiError(`Could not upload the image: ${error.message}`)
  return path
}

export async function resolveFeedImageUrl(path: string): Promise<string> {
  const sb = requireSupabase()
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error || !data) throw new ApiError(`Could not load the image: ${error?.message ?? 'unknown error'}`)
  return data.signedUrl
}
