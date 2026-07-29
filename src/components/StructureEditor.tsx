import { useRef, useState } from 'react'
import { CheckCircle2, Eraser, ExternalLink, HelpCircle, Search } from 'lucide-react'
import { CanvasMoleculeEditor, type CanvasEditorOnChangeMolecule } from 'react-ocl'
import { Molecule } from 'openchemlib'
import * as pubchem from '../lib/pubchem'
import { Modal, Spinner } from './ui'
import { Molecule3DViewer } from './Molecule3DViewer'

export interface DrawnStructure {
  molfile: string
  smiles: string
  /** From OpenChemLib's own formula calculator — no network round-trip needed. */
  formula: string
  molWeight: number
}

type PubChemSearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'found'; info: pubchem.PubChemInfo }
  | { status: 'not-found' }

function moleculeFromMolfile(molfile: string | null | undefined): Molecule | null {
  if (!molfile) return null
  try {
    return Molecule.fromMolfile(molfile)
  } catch {
    return null
  }
}

/**
 * A real 2D structure editor, not a toy — atoms, bond orders, ring templates,
 * charges, stereo bonds, the lot. Backed by OpenChemLib's canvas editor
 * (BSD-3-Clause, pure JS, no WASM), not a from-scratch drawing tool: getting
 * bond/valence chemistry right is a solved problem, not worth re-solving.
 */
export function StructureEditorDialog({
  open,
  onClose,
  onConfirm,
  initialMolfile,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (structure: DrawnStructure) => void
  /** Pass an existing molfile to edit it further; omit to start from a blank canvas. */
  initialMolfile?: string | null
}) {
  // The editor calls onChange on every edit with a snapshot of getters — we
  // just hold the latest one and pull values out of it when the user
  // confirms, rather than re-deriving state on every keystroke/drag.
  const latestChange = useRef<CanvasEditorOnChangeMolecule | null>(null)
  const [hasContent, setHasContent] = useState(Boolean(initialMolfile))
  const [resetKey, setResetKey] = useState(0)
  const [search, setSearch] = useState<PubChemSearchState>({ status: 'idle' })
  const [sdf3d, setSdf3d] = useState<string | null>(null)
  const [sdf2d, setSdf2d] = useState<string | null>(null)

  function handleConfirm() {
    const change = latestChange.current
    const molecule = change?.getMolecule() ?? moleculeFromMolfile(initialMolfile)
    if (!molecule) return onClose()
    const formulaInfo = molecule.getMolecularFormula()
    onConfirm({
      molfile: change?.getMolfileV3() ?? molecule.toMolfileV3(),
      smiles: change?.getSmiles() ?? molecule.toSmiles(),
      formula: formulaInfo.formula,
      molWeight: Math.round(formulaInfo.relativeWeight * 100) / 100,
    })
  }

  async function searchPubChem() {
    const smiles = latestChange.current?.getSmiles() ?? moleculeFromMolfile(initialMolfile)?.toSmiles()
    if (!smiles) return
    setSearch({ status: 'searching' })
    try {
      const info = await pubchem.lookupBySmiles(smiles)
      setSearch(info ? { status: 'found', info } : { status: 'not-found' })
      setSdf3d(info?.cid ? await pubchem.fetch3dSdf(info.cid) : null)
      setSdf2d(info?.cid ? await pubchem.fetch2dSdf(info.cid) : null)
    } catch {
      setSearch({ status: 'not-found' })
      setSdf3d(null)
      setSdf2d(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Draw the structure"
      description="Full toolbar: atom types, bond orders, ring templates, charges, stereo bonds. Double-click an atom to change its element."
      size="xl"
      footer={
        <>
          <button
            type="button"
            className="btn-ghost mr-auto"
            onClick={() => {
              latestChange.current = null
              setHasContent(false)
              setSearch({ status: 'idle' })
              setSdf3d(null)
              setSdf2d(null)
              setResetKey((k) => k + 1)
            }}
          >
            <Eraser className="h-4 w-4" /> Clear
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void searchPubChem()}
            disabled={!hasContent || search.status === 'searching'}
            title="Check whether this exact structure is a known compound on PubChem"
          >
            {search.status === 'searching' ? <Spinner /> : <Search className="h-4 w-4" />}
            Search PubChem
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleConfirm} disabled={!hasContent}>
            Use this structure
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="h-[55vh] min-h-[380px] w-full overflow-hidden rounded-lg border border-ink-200 bg-white dark:border-ink-700">
          <CanvasMoleculeEditor
            key={resetKey}
            width="100%"
            height="100%"
            inputFormat={initialMolfile ? 'molfile' : undefined}
            inputValue={resetKey === 0 ? (initialMolfile ?? undefined) : undefined}
            onChange={(change) => {
              latestChange.current = change
              setHasContent(change.getMolfileV3().trim().length > 0)
              // A new edit invalidates whatever the last search found.
              setSearch({ status: 'idle' })
              setSdf3d(null)
              setSdf2d(null)
            }}
          />
        </div>

        {search.status === 'found' && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-emerald-900 dark:text-emerald-100">
                Known compound — PubChem CID {search.info.cid}
              </p>
              <p className="mt-0.5 text-emerald-800/80 dark:text-emerald-200/70">
                {search.info.iupacName ?? 'No IUPAC name on file'} · {search.info.formula ?? '—'}
                {search.info.molecularWeight != null && ` · ${search.info.molecularWeight.toFixed(2)} g/mol`}
              </p>
              <p className="mt-1 text-xs text-emerald-700/70 dark:text-emerald-300/60">
                Worth checking if it's available to simply order, before registering this as a
                custom-synthesis product.
              </p>
            </div>
            <a
              href={search.info.pageUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-secondary shrink-0 py-1.5 text-xs"
            >
              View <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {search.status === 'found' && (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded-lg border border-ink-200 bg-white p-3 dark:border-ink-700">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">2D drawing</p>
              <p className="text-sm text-ink-600 dark:text-ink-300">
                The drawing above is the structure PEARL will save. The 3D panel is a PubChem preview for the exact match.
              </p>
            </div>
            <div className="rounded-lg border border-ink-200 bg-white p-3 dark:border-ink-700">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">3D PubChem preview</p>
              <Molecule3DViewer sdf={sdf3d ?? sdf2d} coordinates={sdf3d ? '3d' : '2d'} />
            </div>
          </div>
        )}

        {search.status === 'not-found' && (
          <div className="flex items-start gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3 dark:border-ink-700 dark:bg-ink-800/50">
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
            <p className="text-sm text-ink-600 dark:text-ink-300">
              No exact match on PubChem — this looks like it'd need custom synthesis, or PubChem
              simply doesn't have it catalogued. (This checks for an exact structure match, not a
              similar one, so a different tautomer or stereoisomer won't match either.)
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
