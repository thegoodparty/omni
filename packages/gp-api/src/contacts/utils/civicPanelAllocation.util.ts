import {
  DEFAULT_TEXT_REPLY_RATE,
  MAX_LIST_SAMPLE_SIZE,
  PANEL_CALL_ASSUMED_JOIN_RATE,
  PANEL_DOOR_ASSUMED_JOIN_RATE,
  type CivicPanelBuildChannel,
} from '@goodparty_org/contracts'
import type { DistrictCell } from '@/peopleDb/databricks/districtCensusSql.util'
import type { SampleWeights } from '@/peopleDb/schemas/people.schema'
import { POOLED_VALUE } from '@/priorities/util/censusWeighting.util'
import type { MrpGroupEstimate } from '@/priorities/util/mrp.util'
import type { RakingTargets } from '@/priorities/util/raking.util'
import { asksFor, sizePanelWave } from './civicPanelBuild.util'

// A priority's two rounds of outreach: how big round 1's doors, calls and
// text are, and who round 2's scheduled text leans toward, from the model's
// read of round 1's answers. See docs/features/civic-panel-mrp.md.

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

// Placeholders for the share of residents who answer, until measured rates
// replace them.
export const DOOR_ANSWER_RATE = PANEL_DOOR_ASSUMED_JOIN_RATE
export const CALL_ANSWER_RATE = PANEL_CALL_ASSUMED_JOIN_RATE
export const TEXT_ANSWER_RATE = DEFAULT_TEXT_REPLY_RATE

// Who each channel can reach, counted by group: anyone at the door, any
// phone for calls, a cell phone for the text.
export interface RoundOnePools {
  door: DistrictCell[]
  phone: DistrictCell[]
  text: DistrictCell[]
}

export interface RoundOneGroup {
  dimension: TargetedDimension
  value: string
  // Of the district.
  share: number
  expectedAnswers: number
}

export interface RoundOneSize {
  doors: number
  calls: number
  texts: number
  // Every major group, with the answers round 1 is expected to bring.
  groups: RoundOneGroup[]
}

const valueOf = (
  cell: DistrictCell,
  dimension: TargetedDimension,
): string | null => (dimension === 'age' ? cell.ageBand : cell[dimension])

const sizeOf = (cells: DistrictCell[]): number =>
  cells.reduce((sum, cell) => sum + cell.count, 0)

// The chance a resident drawn at random from the pool is in the group.
// Residents with no known value count in the pool but in no group.
const shareOf = (
  cells: DistrictCell[],
  dimension: TargetedDimension,
  value: string,
): number => {
  const pool = sizeOf(cells)
  return pool === 0
    ? 0
    : sizeOf(cells.filter((cell) => valueOf(cell, dimension) === value)) / pool
}

const stepsOf = (
  steps: ReturnType<typeof sizePanelWave>,
  channel: CivicPanelBuildChannel,
): number =>
  steps
    .filter((step) => step.channel === channel)
    .reduce((sum, step) => sum + step.targetSize, 0)

// Round 1: doors and calls spend the official's hours as the panel plan
// splits them, and the text covers whatever major groups those leave short
// of MIN_VOICES_PER_GROUP expected answers, capped by who it can reach. A
// group no cell phone reaches cannot be helped by the text, so it does not
// size it.
export const sizeRoundOne = ({
  hoursPerWeek,
  districtShares,
  dimensions,
  pools,
}: {
  hoursPerWeek: number
  districtShares: RakingTargets
  dimensions: readonly TargetedDimension[]
  pools: RoundOnePools
}): RoundOneSize => {
  const majors = dimensions.flatMap((dimension) =>
    Object.entries(districtShares[dimension] ?? {}).flatMap(([value, share]) =>
      share >= MAJOR_GROUP_SHARE && value !== POOLED_VALUE
        ? [{ dimension, value, share }]
        : [],
    ),
  )
  // No member gap caps round 1, so the hours alone size doors and calls.
  const wave = sizePanelWave({
    gap: Number.POSITIVE_INFINITY,
    hoursPerWeek,
    pools: { text: 0, phone: sizeOf(pools.phone), door: sizeOf(pools.door) },
  })
  const doors = stepsOf(wave, 'door_knocking')
  const calls = stepsOf(wave, 'phone_banking')
  const reach = majors.map((group) => ({
    ...group,
    fromHours:
      doors *
        shareOf(pools.door, group.dimension, group.value) *
        DOOR_ANSWER_RATE +
      calls *
        shareOf(pools.phone, group.dimension, group.value) *
        CALL_ANSWER_RATE,
    perText:
      shareOf(pools.text, group.dimension, group.value) * TEXT_ANSWER_RATE,
  }))
  const needed = Math.max(
    0,
    ...reach
      .filter((g) => g.fromHours < MIN_VOICES_PER_GROUP && g.perText > 0)
      .map((g) => asksFor(MIN_VOICES_PER_GROUP - g.fromHours, g.perText)),
  )
  const texts = Math.min(needed, sizeOf(pools.text), MAX_LIST_SAMPLE_SIZE)
  return {
    doors,
    calls,
    texts,
    groups: reach.map(({ dimension, value, share, fromHours, perText }) => ({
      dimension,
      value,
      share,
      expectedAnswers: Math.round((fromHours + texts * perText) * 10) / 10,
    })),
  }
}
