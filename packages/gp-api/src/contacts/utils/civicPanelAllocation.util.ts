import type { SampleWeights } from '@/peopleDb/schemas/people.schema'
import { POOLED_VALUE } from '@/priorities/util/censusWeighting.util'
import type { MrpGroupEstimate } from '@/priorities/util/mrp.util'

// Round 2 of a priority's outreach: who its scheduled text leans toward,
// from the model's read of round 1's answers. See
// docs/features/civic-panel-mrp.md.

// Below this many answers a group's estimate is mostly the model's guess.
export const MIN_VOICES_PER_GROUP = 3
// Smaller groups are still modeled, but chasing each would spend a batch on
// a few dozen residents.
export const MAJOR_GROUP_SHARE = 0.03
// Drawn without leaning, so drift among the residents the lean never
// reaches still shows up.
export const UNSTEERED_BATCH_SHARE = 0.15
export const MIN_TARGET_WEIGHT = 0.5
export const MAX_TARGET_WEIGHT = 4

export type TargetedDimension = 'age' | 'gender' | 'tract' | 'race'

export type TargetReason = 'tooFewVoices' | 'leastSure'

export interface BatchTarget {
  dimension: TargetedDimension
  value: string
  reason: TargetReason
  // Share of the district times the width of the group's range.
  score: number
}

export const isTargeted = (
  group: MrpGroupEstimate,
  dimensions: readonly TargetedDimension[],
): group is MrpGroupEstimate & { dimension: TargetedDimension } =>
  dimensions.some((d) => d === group.dimension) &&
  group.share >= MAJOR_GROUP_SHARE &&
  group.value !== POOLED_VALUE

const scoreOf = (group: MrpGroupEstimate): number =>
  group.share * (group.high - group.low)

// Groups short of their voices first, largest first; then the rest by how
// much of the district's doubt they hold. A wide range on a small group
// moves the district less than a modest one on a large group.
export const batchTargets = (
  groups: MrpGroupEstimate[],
  dimensions: readonly TargetedDimension[],
): BatchTarget[] => {
  const targeted = groups.filter((g) => isTargeted(g, dimensions))
  const short = targeted
    .filter((g) => g.answers < MIN_VOICES_PER_GROUP)
    .sort((a, b) => b.share - a.share)
  const rest = targeted
    .filter((g) => g.answers >= MIN_VOICES_PER_GROUP)
    .sort((a, b) => scoreOf(b) - scoreOf(a))
  return [
    ...short.map((g) => ({
      dimension: g.dimension,
      value: g.value,
      reason: 'tooFewVoices' as const,
      score: scoreOf(g),
    })),
    ...rest.map((g) => ({
      dimension: g.dimension,
      value: g.value,
      reason: 'leastSure' as const,
      score: scoreOf(g),
    })),
  ]
}

const clamp = (value: number): number =>
  Math.min(MAX_TARGET_WEIGHT, Math.max(MIN_TARGET_WEIGHT, value))

// Draw factors for drawListSample. An even draw already reaches a group in
// proportion to its share, so leaning by range width over the dimension's
// average makes a group's expected texts follow its score. A group short
// of its voices leans fully; a value with no factor counts 1.
export const batchWeights = (
  groups: MrpGroupEstimate[],
  dimensions: readonly TargetedDimension[],
): SampleWeights => {
  const factors = (dimension: TargetedDimension): Record<string, number> => {
    const targeted = groups.filter(
      (g) => g.dimension === dimension && isTargeted(g, dimensions),
    )
    const mass = targeted.reduce((sum, g) => sum + g.share, 0)
    const average =
      targeted.reduce((sum, g) => sum + g.share * (g.high - g.low), 0) / mass
    return Object.fromEntries(
      targeted.map((g) => [
        g.value,
        g.answers < MIN_VOICES_PER_GROUP || average <= 0
          ? MAX_TARGET_WEIGHT
          : clamp((g.high - g.low) / average),
      ]),
    )
  }
  return {
    age: factors('age'),
    gender: factors('gender'),
    tract: factors('tract'),
    race: factors('race'),
    minWeight: MIN_TARGET_WEIGHT,
    maxWeight: MAX_TARGET_WEIGHT,
  }
}

export const splitBatch = (
  size: number,
): { steered: number; unsteered: number } => {
  const unsteered = Math.round(size * UNSTEERED_BATCH_SHARE)
  return { steered: size - unsteered, unsteered }
}
