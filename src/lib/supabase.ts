import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { IS_CLOUD, SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

/**
 * `null` in demo mode. Every call site goes through `src/lib/api.ts`, which
 * picks the right backend, so nothing else in the app needs to null-check this.
 */
export const supabase: SupabaseClient | null = IS_CLOUD
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'pearl.auth',
      },
    })
  : null

/** Narrowing helper for the cloud-only code paths. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured (running in demo mode).')
  return supabase
}
