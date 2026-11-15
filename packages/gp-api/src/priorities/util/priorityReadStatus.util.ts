import type { UnderrepresentedGroup } from '@goodparty_org/contracts'

// A group trailing the census by less than this is not worth naming.
export const MIN_UNDERREPRESENTED_GAP = 0.05

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
