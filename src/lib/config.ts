const env = import.meta.env

export const SUPABASE_URL = (env.VITE_SUPABASE_URL ?? '').trim()
export const SUPABASE_ANON_KEY = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()

/**
 * The app runs in one of two modes:
 *
 *   cloud — a Supabase project is configured. Real accounts, one shared
 *           database, row-level security. This is what the lab should use.
 *
 *   demo  — nothing is configured. Everything lives in this browser's local
 *           storage, pre-loaded with the lab's real starter inventory. Useful
 *           for trying the app out, for offline reference, and for the GitHub
 *           Pages preview before anyone sets up a server.
 */
export const IS_CLOUD = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
export const MODE: 'cloud' | 'demo' = IS_CLOUD ? 'cloud' : 'demo'

export const LAB_NAME = (env.VITE_LAB_NAME ?? 'PEARL Group').trim()
export const LAB_SUBTITLE = (
  env.VITE_LAB_SUBTITLE ?? 'Prof. Xiaogang Liu Lab · NTU Singapore'
).trim()

/** Optional sign-up allow-list, e.g. "ntu.edu.sg,e.ntu.edu.sg". Empty = anyone. */
export const ALLOWED_EMAIL_DOMAINS = (env.VITE_ALLOWED_EMAIL_DOMAINS ?? '')
  .split(',')
  .map((d: string) => d.trim().toLowerCase())
  .filter(Boolean)

export function emailDomainAllowed(email: string): boolean {
  if (ALLOWED_EMAIL_DOMAINS.length === 0) return true
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return ALLOWED_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))
}
