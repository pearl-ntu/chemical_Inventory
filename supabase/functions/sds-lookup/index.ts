/**
 * Best-effort SDS lookup by CAS number, using only PubChem's free public API
 * — no paid provider, no API key to configure. Never returns a value that
 * gets written to a record on its own: the client shows these as candidates
 * for a person to open and confirm, same as the delivery-photo OCR checklist
 * never auto-fills the form.
 *
 * PubChem doesn't host an official SDS PDF itself, but its "Safety and
 * Hazards" PUG View section aggregates GHS classification data sourced from
 * places (ECHA, Haz-Map, vendor submissions) that often link an actual SDS
 * document — this scrapes those out of the section rather than guessing a
 * vendor URL pattern that may not exist for a given catalogue entry.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

const hits = new Map<string, number[]>()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function rateLimited(userId: string) {
  const now = Date.now()
  const windowMs = 60_000
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= 12) {
    hits.set(userId, recent)
    return true
  }
  recent.push(now)
  hits.set(userId, recent)
  return false
}

function publishableKey(): string | null {
  const keys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
  if (keys) {
    try {
      const parsed = JSON.parse(keys)
      if (typeof parsed === 'string') return parsed
      if (Array.isArray(parsed)) return parsed.find((value) => typeof value === 'string') ?? null
      if (parsed && typeof parsed === 'object') {
        return Object.values(parsed).find((value) => typeof value === 'string') as string | undefined ?? null
      }
    } catch {
      return keys
    }
  }
  return Deno.env.get('SUPABASE_ANON_KEY')
}

function userIdFromJwt(jwt: string): string | null {
  try {
    const payload = jwt.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const jsonText = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
    const claims = JSON.parse(jsonText)
    return typeof claims.sub === 'string' ? claims.sub : null
  } catch {
    return null
  }
}

const CAS_RE = /^\d{2,7}-\d{2}-\d$/

interface Candidate {
  url: string
  label: string
}

/** A URL-shaped string worth surfacing as a candidate SDS/safety document. */
const DOC_URL_RE = /https?:\/\/[^\s"'<>]+/g
const SDS_HINT_RE = /msds|sds|safety[-_ ]?data|safety[-_ ]?sheet/i

async function pubchemCidForCas(cas: string): Promise<number | null> {
  const res = await fetch(
    `https://pubchem.ncbi.gov/rest/pug/compound/xref/RN/${encodeURIComponent(cas)}/cids/JSON`,
  )
  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  const cid = data?.IdentifierList?.CID?.[0]
  return typeof cid === 'number' ? cid : null
}

/** Pulls anything URL-shaped and SDS/safety-flavoured out of the raw PUG View
 *  JSON text for the "Safety and Hazards" section — simpler and more robust
 *  than walking PubChem's deeply nested, frequently-restructured schema. */
async function safetyDocCandidates(cid: number): Promise<Candidate[]> {
  const res = await fetch(
    `https://pubchem.ncbi.gov/rest/pug_view/data/compound/${cid}/JSON?heading=Safety+and+Hazards`,
  )
  if (!res.ok) return []
  const text = await res.text()
  const urls = new Set<string>()
  for (const match of text.matchAll(DOC_URL_RE)) {
    const url = match[0].replace(/[),.]+$/, '')
    if (SDS_HINT_RE.test(url)) urls.add(url)
  }
  return [...urls].slice(0, 5).map((url) => ({ url, label: new URL(url).hostname.replace(/^www\./, '') }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorization = req.headers.get('authorization')
  if (!authorization) return json({ error: 'Missing authorization header' }, 401)
  const jwt = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return json({ error: 'Missing user session token' }, 401)
  const userId = userIdFromJwt(jwt)
  if (!userId) return json({ error: 'Invalid session token format' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const apiKey = publishableKey()
  if (!url || !apiKey) return json({ error: 'Supabase environment is not configured' }, 500)

  const supabase = createClient(url, apiKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false },
  })

  if (rateLimited(userId)) return json({ error: 'Too many lookups. Try again in a minute.' }, 429)

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, approved')
    .eq('id', userId)
    .single()
  if (profileError || !profile?.approved) {
    return json({ error: 'Profile is not approved or session was rejected' }, 403)
  }

  let body: { cas?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const cas = (body.cas ?? '').trim()
  if (!CAS_RE.test(cas)) return json({ error: 'That does not look like a CAS number (e.g. 67-64-1).' }, 400)

  try {
    const cid = await pubchemCidForCas(cas)
    if (!cid) return json({ cid: null, pubchemUrl: null, candidates: [] as Candidate[] })

    const pubchemUrl = `https://pubchem.ncbi.gov/compound/${cid}#section=Safety-and-Hazards`
    const candidates = await safetyDocCandidates(cid)
    return json({ cid, pubchemUrl, candidates })
  } catch (err) {
    return json({ error: `Lookup failed: ${err instanceof Error ? err.message : 'unknown error'}` }, 502)
  }
})
