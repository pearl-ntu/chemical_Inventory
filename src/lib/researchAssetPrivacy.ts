import type { Profile, ResearchAsset } from './types'

export function isOwnResearchAsset(asset: ResearchAsset, profile: Profile | null | undefined) {
  if (!profile) return false
  const aliases = [profile.id, profile.email, profile.full_name]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value))
  const ownerAliases = [asset.created_by, asset.owner, asset.created_by_name]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value))
  return ownerAliases.some((value) => aliases.includes(value))
}

export function privateResearchAssets(rows: ResearchAsset[], profile: Profile | null | undefined) {
  return rows.filter((row) => isOwnResearchAsset(row, profile))
}
