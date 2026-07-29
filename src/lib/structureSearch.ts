import { Canonizer, Molecule, SSSearcher } from 'openchemlib'

type StructureMatchMode = 'exact' | 'substructure'

function moleculeFromMolfile(molfile: string | null | undefined): Molecule | null {
  if (!molfile) return null
  try {
    return Molecule.fromMolfile(molfile)
  } catch {
    return null
  }
}

export function structureIdCode(molfile: string | null | undefined): string | null {
  const molecule = moleculeFromMolfile(molfile)
  if (!molecule) return null
  try {
    return new Canonizer(molecule).getIDCode()
  } catch {
    return null
  }
}

export function structureMatches(
  queryMolfile: string | null | undefined,
  targetMolfile: string | null | undefined,
  mode: StructureMatchMode,
): boolean {
  const query = moleculeFromMolfile(queryMolfile)
  const target = moleculeFromMolfile(targetMolfile)
  if (!query || !target) return false

  if (mode === 'exact') {
    return structureIdCode(queryMolfile) === structureIdCode(targetMolfile)
  }

  try {
    query.setFragment(true)
    const searcher = new SSSearcher()
    searcher.setMol(query, target)
    return searcher.isFragmentInMolecule()
  } catch {
    return false
  }
}
