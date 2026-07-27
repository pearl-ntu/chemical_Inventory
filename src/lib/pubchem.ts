/**
 * Optional enrichment from PubChem (public NIH service, CORS-enabled).
 *
 * Used to auto-fill molecular formula / weight when someone registers a new
 * container, and to show a structure drawing on the detail panel. Entirely
 * best-effort: every failure is swallowed and the app carries on offline.
 */
const BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'
const CACHE_KEY = 'pearl.pubchem.cache'
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30 // a molecule's formula does not change

export interface PubChemInfo {
  cid: number
  formula: string | null
  molecularWeight: number | null
  iupacName: string | null
  smiles: string | null
  imageUrl: string
  pageUrl: string
}

type CacheShape = Record<string, { at: number; value: PubChemInfo | null }>

function readCache(): CacheShape {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as CacheShape
  } catch {
    return {}
  }
}

function writeCache(cache: CacheShape) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* ignore quota errors */
  }
}

export function structureImageUrl(cid: number, size: 'small' | 'large' = 'large'): string {
  return `${BASE}/compound/cid/${cid}/PNG?image_size=${size}`
}

export function pubchemPageUrl(cid: number): string {
  return `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`
}

/**
 * Looks a compound up by CAS number first (unambiguous), then by name.
 * Returns null when PubChem has nothing, or when the network is unavailable.
 */
export async function lookup(cas: string | null, name: string | null): Promise<PubChemInfo | null> {
  const key = (cas?.trim() || name?.trim() || '').toLowerCase()
  if (!key) return null

  const cache = readCache()
  const hit = cache[key]
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  const candidates = [cas?.trim(), name?.trim()].filter(Boolean) as string[]
  let result: PubChemInfo | null = null

  for (const term of candidates) {
    try {
      const url =
        `${BASE}/compound/name/${encodeURIComponent(term)}` +
        `/property/MolecularFormula,MolecularWeight,IUPACName,CanonicalSMILES/JSON`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) continue

      const json = (await res.json()) as {
        PropertyTable?: {
          Properties?: Array<{
            CID: number
            MolecularFormula?: string
            MolecularWeight?: string | number
            IUPACName?: string
            CanonicalSMILES?: string
          }>
        }
      }

      const p = json.PropertyTable?.Properties?.[0]
      if (!p) continue

      const mw = p.MolecularWeight == null ? null : Number(p.MolecularWeight)
      result = {
        cid: p.CID,
        formula: p.MolecularFormula ?? null,
        molecularWeight: Number.isFinite(mw as number) ? (mw as number) : null,
        iupacName: p.IUPACName ?? null,
        smiles: p.CanonicalSMILES ?? null,
        imageUrl: structureImageUrl(p.CID),
        pageUrl: pubchemPageUrl(p.CID),
      }
      break
    } catch {
      // Offline, blocked, or rate-limited — fall through to the next candidate.
    }
  }

  cache[key] = { at: Date.now(), value: result }
  writeCache(cache)
  return result
}

/** Safety Data Sheet search, scoped to the supplier when we know it. */
export function sdsSearchUrl(name: string, cas: string | null, supplier: string | null): string {
  const terms = [name, cas, supplier, 'safety data sheet'].filter(Boolean).join(' ')
  return `https://www.google.com/search?q=${encodeURIComponent(terms)}`
}
