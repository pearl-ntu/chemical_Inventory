import type { ResearchAsset } from './types'

export interface PublicationGroup {
  project: string
  total: number
  byStatus: Partial<Record<ResearchAsset['status'], number>>
}

/**
 * Grouped by project, counted by the research_assets `status` field —
 * there's no dedicated "submitted vs published" stage in the schema, so
 * this reports the real status values (active/running/complete/failed/
 * archived) rather than inventing a submission pipeline the data doesn't
 * actually track.
 */
export function rollupPublications(assets: ResearchAsset[]): PublicationGroup[] {
  const publications = assets.filter((a) => a.type === 'publication')
  const byProject = new Map<string, ResearchAsset[]>()
  for (const p of publications) {
    const key = p.project?.trim() || 'No project tag'
    byProject.set(key, [...(byProject.get(key) ?? []), p])
  }
  return [...byProject.entries()]
    .map(([project, rows]) => {
      const byStatus: Partial<Record<ResearchAsset['status'], number>> = {}
      for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
      return { project, total: rows.length, byStatus }
    })
    .sort((a, b) => b.total - a.total)
}
