import { lazy } from 'react'

/**
 * OpenChemLib ships its own element/ring-template data as a ~1MB (gzip
 * ~460KB) resource file — real chemistry data, not bloat, but no reason to
 * make someone who's just browsing the inventory table download it. All of
 * these pull from the same underlying dynamic import, so Vite emits one
 * shared chunk that's fetched once, the first time any of them is actually
 * rendered — not on every page load.
 */
export const LazyStructureEditorDialog = lazy(() =>
  import('./StructureEditor').then((m) => ({ default: m.StructureEditorDialog })),
)

export const LazyReactionEditorDialog = lazy(() =>
  import('./ReactionEditor').then((m) => ({ default: m.ReactionEditorDialog })),
)

export const LazyMolfileSvgRenderer = lazy(() =>
  import('react-ocl').then((m) => ({ default: m.MolfileSvgRenderer })),
)

/** A read-only reaction depiction — same canvas editor, just non-interactive. */
export const LazyReactionViewer = lazy(() =>
  import('react-ocl').then((m) => ({
    default: function ReactionViewer({ rxnfile }: { rxnfile: string }) {
      return (
        <m.CanvasReactionEditor
          readOnly
          inputFormat="molfile"
          inputValue={rxnfile}
          width="100%"
          height="100%"
        />
      )
    },
  })),
)
