import { lazy } from 'react'

/**
 * OpenChemLib ships its own element/ring-template data as a ~1MB (gzip
 * ~460KB) resource file — real chemistry data, not bloat, but no reason to
 * make someone who's just browsing the inventory table download it. Both
 * pull from the same dynamic import, so Vite emits one shared chunk that's
 * fetched once, the first time either is actually rendered.
 */
export const LazyStructureEditorDialog = lazy(() =>
  import('./StructureEditor').then((m) => ({ default: m.StructureEditorDialog })),
)

export const LazyMolfileSvgRenderer = lazy(() =>
  import('react-ocl').then((m) => ({ default: m.MolfileSvgRenderer })),
)
