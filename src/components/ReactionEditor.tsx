import { useRef, useState } from 'react'
import { Eraser } from 'lucide-react'
import { CanvasReactionEditor, type CanvasEditorOnChangeReaction } from 'react-ocl'
import { Molecule, Reaction } from 'openchemlib'
import { Modal } from './ui'

function productOnlyRxnfile(molfile: string | null | undefined): string | null {
  if (!molfile) return null
  try {
    const product = Molecule.fromMolfile(molfile)
    return Reaction.fromMolecules([product], 0).toRxnV3()
  } catch {
    return null
  }
}

/**
 * A synthesis scheme — reactants, reagents/conditions above the arrow,
 * products — attached to a registration alongside its free-text remarks.
 * Same editor engine as the single-structure one, just started in reaction
 * mode; OpenChemLib treats "one molecule" and "a reaction" as two modes of
 * the same canvas rather than two separate tools.
 */
export function ReactionEditorDialog({
  open,
  onClose,
  onConfirm,
  initialRxnfile,
  initialProductMolfile,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (rxnfile: string) => void
  initialRxnfile?: string | null
  initialProductMolfile?: string | null
}) {
  const seededRxnfile = initialRxnfile ?? productOnlyRxnfile(initialProductMolfile)
  const latestChange = useRef<CanvasEditorOnChangeReaction | null>(null)
  const [hasContent, setHasContent] = useState(Boolean(seededRxnfile))
  const [resetKey, setResetKey] = useState(0)

  function handleConfirm() {
    const change = latestChange.current
    if (!change) return onClose()
    onConfirm(change.getRxnV3())
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Draw the synthesis scheme"
      description={
        seededRxnfile && !initialRxnfile
          ? 'The compound structure is preloaded as the product. Add the reactants, reagents, solvent, temperature, and yield around it.'
          : 'Reactants on the left, products on the right. Reagents and conditions go above or below the arrow.'
      }
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
            Attach this scheme
          </button>
        </>
      }
    >
      <div className="h-[55vh] min-h-[380px] w-full overflow-hidden rounded-lg border border-ink-200 bg-white dark:border-ink-700">
        <CanvasReactionEditor
          key={resetKey}
          width="100%"
          height="100%"
          inputFormat={seededRxnfile ? 'molfile' : undefined}
          inputValue={resetKey === 0 ? (seededRxnfile ?? undefined) : undefined}
          onChange={(change) => {
            latestChange.current = change
            setHasContent(change.getRxnV3().trim().length > 0)
          }}
        />
      </div>
    </Modal>
  )
}
