import type { UnderrepresentedGroup } from '@goodparty_org/contracts'
import type { RakingGap } from './raking.util'

// A group trailing the census by less than this is not worth naming.
export const MIN_UNDERREPRESENTED_GAP = 0.05
const MAX_UNDERREPRESENTED = 2

// The name a group goes by wherever it is named, or null for one that is
// never named.
export const underrepresentedGroupOf = (
  dimension: string,
  value: string,
  nameRace: boolean,
): UnderrepresentedGroup | null => {
  if (dimension === 'tract') return 'unreachedAreas'
  if (dimension === 'race' && !nameRace) return null
  const key = `${dimension}:${value}`
  const groups: Record<string, UnderrepresentedGroup> = {
    'age:18to24': 'age18to24',
    'age:25to34': 'age25to34',
    'age:35to44': 'age35to44',
    'age:45to54': 'age45to54',
    'age:55to64': 'age55to64',
    'age:65plus': 'age65plus',
    'tenure:owner': 'owners',
    'tenure:renter': 'renters',
    'gender:male': 'men',
    'gender:female': 'women',
    // 'other' is a mix of groups no one would recognize as one, so it
    // weights but is never named.
    'race:white': 'white',
    'race:black': 'black',
    'race:hispanic': 'hispanic',
    'race:asian': 'asian',
  }
  return groups[key] ?? null
}

// Measured on who actually answered, before weighting: that is who the
// official needs to hear more from.
export const underrepresentedGroups = (
  gaps: RakingGap[],
  nameRace: boolean,
): UnderrepresentedGroup[] => {
  const behind = new Map<UnderrepresentedGroup, number>()
  for (const gap of gaps) {
    const group = underrepresentedGroupOf(gap.dimension, gap.value, nameRace)
    const trail = gap.censusShare - gap.unweightedShare
    if (!group || trail < MIN_UNDERREPRESENTED_GAP) continue
    behind.set(group, Math.max(behind.get(group) ?? 0, trail))
  }
  return [...behind]
    .sort(([, a], [, b]) => b - a)
    .slice(0, MAX_UNDERREPRESENTED)
    .map(([group]) => group)
}
