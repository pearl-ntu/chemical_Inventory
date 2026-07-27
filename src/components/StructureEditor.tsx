import { useRef, useState } from 'react'
import { Eraser } from 'lucide-react'
import { CanvasMoleculeEditor, type CanvasEditorOnChangeMolecule } from 'react-ocl'
import { Modal } from './ui'

export interface DrawnStructure {
  molfile: string
  smiles: string
  /** From OpenChemLib's own formula calculator — no network round-trip needed. */
  formula: string
  molWeight: number
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

  function handleConfirm() {
    const change = latestChange.current
    if (!change) return onClose()
    const molecule = change.getMolecule()
    const formulaInfo = molecule.getMolecularFormula()
    onConfirm({
      molfile: change.getMolfileV3(),
      smiles: change.getSmiles(),
      formula: formulaInfo.formula,
      molWeight: Math.round(formulaInfo.relativeWeight * 100) / 100,
    })
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
              setResetKey((k) => k + 1)
            }}
          >
            <Eraser className="h-4 w-4" /> Clear
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
      <div className="h-[60vh] min-h-[420px] w-full overflow-hidden rounded-lg border border-ink-200 bg-white dark:border-ink-700">
        <CanvasMoleculeEditor
          key={resetKey}
          width="100%"
          height="100%"
          inputFormat={initialMolfile ? 'molfile' : undefined}
          inputValue={resetKey === 0 ? (initialMolfile ?? undefined) : undefined}
          onChange={(change) => {
            latestChange.current = change
            setHasContent(change.getMolfileV3().trim().length > 0)
          }}
        />
      </div>
    </Modal>
  )
}
