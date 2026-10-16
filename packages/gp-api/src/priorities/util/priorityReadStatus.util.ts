import {
  answersNeeded,
  type PriorityReadStatus,
  type ReadRepresentativeness,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'
import type { RakingGap } from './raking.util'

// Below this many answers, a gap says more about chance than about who
// outreach reached, so there is no status to give yet.
export const MIN_ANSWERS_FOR_REPRESENTATIVENESS = 30

// A district small enough to need fewer answers than that is read at its
// own figure, or it could never have a good read.
export const minAnswersForStatus = (population: number | null): number =>
  Math.min(MIN_ANSWERS_FOR_REPRESENTATIVENESS, answersNeeded(population))
// Within this share either way of the census on every weighted group, the
// same ±10 points answersNeeded is sized for.
export const MAX_REPRESENTATIVE_GAP = 0.1
// A group trailing the census by less than this is not worth naming.
export const MIN_UNDERREPRESENTED_GAP = 0.05
const MAX_UNDERREPRESENTED = 2

// What weighting the answers to the census found. Null when the district's
// census could not be read.
export interface ReadWeighting {
  // Kish effective sample size: answers, discounted for how far the
  // weights had to move them.
  effectiveSampleSize: number
  largestGap: number
  gaps: RakingGap[]
}

const groupOf = (gap: RakingGap): UnderrepresentedGroup | null => {
  if (gap.dimension === 'tract') return 'unreachedAreas'
  const key = `${gap.dimension}:${gap.value}`
  const groups: Record<string, UnderrepresentedGroup> = {
    'age:18to64': 'age18to64',
    'age:65plus': 'age65plus',
    'tenure:owner': 'owners',
    'tenure:renter': 'renters',
    'gender:male': 'men',
    'gender:female': 'women',
  }
  return groups[key] ?? null
}

// Measured on who actually answered, before weighting: that is who the
// official needs to hear more from.
export const underrepresentedGroups = (
  gaps: RakingGap[],
): UnderrepresentedGroup[] => {
  const behind = new Map<UnderrepresentedGroup, number>()
  for (const gap of gaps) {
    const group = groupOf(gap)
    const trail = gap.censusShare - gap.unweightedShare
    if (!group || trail < MIN_UNDERREPRESENTED_GAP) continue
    behind.set(group, Math.max(behind.get(group) ?? 0, trail))
  }
  return [...behind]
    .sort(([, a], [, b]) => b - a)
    .slice(0, MAX_UNDERREPRESENTED)
    .map(([group]) => group)
}

// The one place a "good read" is decided, so every surface that reads it
// changes together. A good read is a representative one: enough answers,
// once weighted to the district's census mix, and every weighted group
// within MAX_REPRESENTATIVE_GAP of the census.
export const priorityReadStatus = (input: {
  answers: number
  population: number | null
  weighting: ReadWeighting | null
}): PriorityReadStatus => {
  const needed = answersNeeded(input.population)
  const { answers, weighting } = input
  const tooEarly = answers < minAnswersForStatus(input.population)
  const underrepresented =
    weighting && !tooEarly ? underrepresentedGroups(weighting.gaps) : []
  const status = ((): ReadRepresentativeness => {
    if (tooEarly) return 'tooEarly'
    // Without the census there is nothing to weigh against, so the read
    // falls back to the count alone.
    if (!weighting) return answers >= needed ? 'representative' : 'gettingClose'
    if (weighting.largestGap > MAX_REPRESENTATIVE_GAP) {
      return 'notYetRepresentative'
    }
    return weighting.effectiveSampleSize >= needed
      ? 'representative'
      : 'gettingClose'
  })()
  return {
    answers,
    needed,
    good: status === 'representative',
    status,
    underrepresented,
  }
}
