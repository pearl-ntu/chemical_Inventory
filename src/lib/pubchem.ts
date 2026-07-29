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
  name: string | null
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

export function structureImageUrlForTerm(term: string, size: 'small' | 'large' = 'large'): string {
  return `${BASE}/compound/name/${encodeURIComponent(term)}/PNG?image_size=${size}`
}

export function pubchemPageUrl(cid: number): string {
  return `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`
}

async function fetchSdf(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { Accept: 'chemical/x-mdl-sdfile,text/plain,*/*' },
  })
  if (!res.ok) return null
  const text = await res.text()
  return text.includes('$$$$') || text.trim().length > 100 ? text : null
}

export async function fetch3dSdf(cid: number): Promise<string | null> {
  try {
    const direct = await fetchSdf(`${BASE}/compound/cid/${cid}/record/SDF?record_type=3d`)
    if (direct) return direct
    const conformers = await fetch(`${BASE}/compound/cid/${cid}/conformers/TXT`)
    if (!conformers.ok) return null
    const conformerId = (await conformers.text()).split(/\s+/).find(Boolean)
    return conformerId ? fetchSdf(`${BASE}/conformers/${encodeURIComponent(conformerId)}/SDF`) : null
  } catch {
    return null
  }
}

export async function fetch2dSdf(cid: number): Promise<string | null> {
  try {
    return fetchSdf(`${BASE}/compound/cid/${cid}/record/SDF`)
  } catch {
    return null
  }
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
      const info = await fetchProperties(`compound/name/${encodeURIComponent(term)}`)
      if (info) {
        result = info
        break
      }
    } catch {
      // Offline, blocked, or rate-limited — fall through to the next candidate.
    }
  }

  cache[key] = { at: Date.now(), value: result }
  writeCache(cache)
  return result
}

interface PubChemProperties {
  CID: number
  Title?: string
  MolecularFormula?: string
  MolecularWeight?: string | number
  IUPACName?: string
  // PubChem renamed this response key from CanonicalSMILES a while back —
  // the old name still works as a *request* parameter (silently ignored) but
  // the response always comes back under this key now. Reading the old name
  // here would just silently return null forever, which is exactly what this
  // code did until it was caught.
  ConnectivitySMILES?: string
}

async function fetchProperties(pathPrefix: string): Promise<PubChemInfo | null> {
  const url = `${BASE}/${pathPrefix}/property/Title,MolecularFormula,MolecularWeight,IUPACName,ConnectivitySMILES/JSON`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null

  const json = (await res.json()) as {
    PropertyTable?: { Properties?: PubChemProperties[] }
  }
  const p = json.PropertyTable?.Properties?.[0]
  if (!p) return null

  const mw = p.MolecularWeight == null ? null : Number(p.MolecularWeight)
  return {
    cid: p.CID,
    name: p.Title ?? p.IUPACName ?? null,
    formula: p.MolecularFormula ?? null,
    molecularWeight: Number.isFinite(mw as number) ? (mw as number) : null,
    iupacName: p.IUPACName ?? null,
    smiles: p.ConnectivitySMILES ?? null,
    imageUrl: structureImageUrl(p.CID),
    pageUrl: pubchemPageUrl(p.CID),
  }
}

/**
 * Converts a PubChem SMILES hit into the same V3000 Molfile shape the built-in
 * drawing editor stores. Kept behind a dynamic import so browsing the inventory
 * still avoids loading the chemistry editor bundle until enrichment needs it.
 */
export async function molfileFromSmiles(smiles: string): Promise<string | null> {
  const trimmed = smiles.trim()
  if (!trimmed) return null

  try {
    const mod = await import('openchemlib')
    const shimmed = mod as unknown as {
      Molecule?: typeof mod.Molecule
      default?: { Molecule: typeof mod.Molecule }
    }
    const Molecule = shimmed.Molecule ?? shimmed.default?.Molecule
    return Molecule?.fromSmiles(trimmed).toMolfileV3() ?? null
  } catch {
    return null
  }
}

/**
 * Looks a compound up by an exact SMILES match — used to check "is what I
 * just drew actually a known, purchasable compound" before ordering it as
 * custom synthesis. This is an exact-structure match (after PubChem's own
 * canonicalisation), not a fuzzy/similarity search: a different tautomer or
 * stereoisomer won't match, which is the right default — a near-miss here
 * would be actively misleading ("PubChem has this" when it doesn't, quite).
 */
export async function lookupBySmiles(smiles: string): Promise<PubChemInfo | null> {
  const trimmed = smiles.trim()
  if (!trimmed) return null

  const key = `smiles:${trimmed}`
  const cache = readCache()
  const hit = cache[key]
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  let result: PubChemInfo | null = null
  try {
    result = await fetchProperties(`compound/smiles/${encodeURIComponent(trimmed)}`)
  } catch {
    // Offline, blocked, or rate-limited — caller sees "no match", not an error.
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

export const SUPPLIER_SEARCHES = [
  { label: 'Sigma', terms: 'Sigma-Aldrich Merck' },
  { label: 'TCI', terms: 'TCI Chemicals' },
  { label: 'Fisher', terms: 'Fisher Scientific' },
  { label: 'Macklin', terms: 'Macklin chemical' },
  { label: 'Aladdin', terms: 'Aladdin chemical' },
] as const

export function supplierSearchUrl(
  supplierTerms: string,
  name: string,
  cas: string | null,
): string {
  const terms = [supplierTerms, cas, name, 'catalog price SDS'].filter(Boolean).join(' ')
  return `https://www.google.com/search?q=${encodeURIComponent(terms)}`
}

export function synthesisSearchUrl(name: string, cas: string | null): string {
  const terms = [name, cas, 'synthesis preparation reaction conditions yield'].filter(Boolean).join(' ')
  return `https://www.google.com/search?q=${encodeURIComponent(terms)}`
}

export function scholarSynthesisSearchUrl(name: string, cas: string | null): string {
  const terms = [name, cas, 'synthesis'].filter(Boolean).join(' ')
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(terms)}`
}

export function patentSynthesisSearchUrl(name: string, cas: string | null): string {
  const terms = [name, cas, 'synthesis preparation'].filter(Boolean).join(' ')
  return `https://patents.google.com/?q=${encodeURIComponent(terms)}`
}
