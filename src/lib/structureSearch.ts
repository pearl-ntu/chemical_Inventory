import type { Canonizer as CanonizerType, Molecule as MoleculeType, SSSearcher as SSSearcherType } from 'openchemlib'

type StructureMatchMode = 'exact' | 'substructure'

/** openchemlib ships its own ~1MB element/ring-template data file — no
 * reason to make every visitor download it just to open the inventory
 * table. Loaded once, on first actual use of structure search, and cached
 * here rather than re-imported per call. */
let ochlPromise: Promise<typeof import('openchemlib')> | null = null
function loadOchl() {
  if (!ochlPromise) ochlPromise = import('openchemlib')
  return ochlPromise
}

async function moleculeFromMolfile(molfile: string | null | undefined): Promise<MoleculeType | null> {
  if (!molfile) return null
  try {
    const { Molecule } = await loadOchl()
    return Molecule.fromMolfile(molfile)
  } catch {
    return null
  }
}

export async function structureIdCode(molfile: string | null | undefined): Promise<string | null> {
  const molecule = await moleculeFromMolfile(molfile)
  if (!molecule) return null
  try {
    const { Canonizer } = await loadOchl()
    return new (Canonizer as typeof CanonizerType)(molecule).getIDCode()
  } catch {
    return null
  }
}

export async function structureMatches(
  queryMolfile: string | null | undefined,
  targetMolfile: string | null | undefined,
  mode: StructureMatchMode,
): Promise<boolean> {
  const query = await moleculeFromMolfile(queryMolfile)
  const target = await moleculeFromMolfile(targetMolfile)
  if (!query || !target) return false

  if (mode === 'exact') {
    return (await structureIdCode(queryMolfile)) === (await structureIdCode(targetMolfile))
  }

  try {
    const { SSSearcher } = await loadOchl()
    query.setFragment(true)
    const searcher = new (SSSearcher as typeof SSSearcherType)()
    searcher.setMol(query, target)
    return searcher.isFragmentInMolecule()
  } catch {
    return false
  }
}
