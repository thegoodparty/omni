import {
  DEFAULT_TEXT_REPLY_RATE,
  MAJOR_GROUP_SHARE,
  MAX_LIST_SAMPLE_SIZE,
  MIN_VOICES_PER_GROUP,
  PANEL_CALL_ASSUMED_JOIN_RATE,
  PANEL_DOOR_ASSUMED_JOIN_RATE,
  type CivicPanelBuildChannel,
} from '@goodparty_org/contracts'
import type { DistrictCell } from '@/peopleDb/databricks/districtCensusSql.util'
import type { SampleWeights } from '@/peopleDb/schemas/people.schema'
import { POOLED_VALUE } from '@/priorities/util/censusWeighting.util'
import type { MrpFrameCell, MrpGroupEstimate } from '@/priorities/util/mrp.util'
import type { RakingTargets } from '@/priorities/util/raking.util'
import { asksFor, sizePanelWave } from './civicPanelBuild.util'

// A priority's two rounds of outreach: how big round 1's doors, calls and
// text are, and who round 2's scheduled text leans toward, from the model's
// read of round 1's answers. See docs/features/civic-panel-mrp.md.

// Below MIN_VOICES_PER_GROUP answers a group's estimate is mostly the
// model's guess. Groups under MAJOR_GROUP_SHARE are still modeled, but
// chasing each would spend a batch on a few dozen residents. Both live in
// contracts, beside answersNeeded, which sizes from them.
export { MAJOR_GROUP_SHARE, MIN_VOICES_PER_GROUP }
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

// The share of the district's smallest major group, the one answersNeeded
// sizes for. Null when the frame has no major group.
export const smallestMajorShare = (
  frame: MrpFrameCell[],
  dimensions: readonly TargetedDimension[],
): number | null => {
  const shares = dimensions.flatMap((dimension) => {
    const counts = new Map<string, number>()
    for (const cell of frame) {
      const value = cell.values[dimension]
      if (value === undefined) continue
      counts.set(value, (counts.get(value) ?? 0) + cell.count)
    }
    const known = [...counts.values()].reduce((sum, n) => sum + n, 0)
    return known === 0
      ? []
      : [...counts].flatMap(([value, count]) =>
          value !== POOLED_VALUE && count / known >= MAJOR_GROUP_SHARE
            ? [count / known]
            : [],
        )
  })
  return shares.length === 0 ? null : Math.min(...shares)
}

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

// Who each part of round 1 can reach, counted by group: the residents of
// the walkable area the doors were picked in, anyone with a phone for
// calls, and anyone with a cell phone for the text.
export interface RoundOnePools {
  doorArea: DistrictCell[]
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
  texts: number
  // Every major group, with the answers round 1 is expected to bring.
  groups: RoundOneGroup[]
}

const valueOf = (
  cell: DistrictCell,
  dimension: TargetedDimension,
): string | null => (dimension === 'age' ? cell.ageBand : cell[dimension])

export const sizeOf = (cells: DistrictCell[]): number =>
  cells.reduce((sum, cell) => sum + cell.count, 0)

// The chance a resident drawn from the pool is in the group. Residents with
// no known value count in the pool but in no group.
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

// Round 1's doors and calls: the official's hours as the panel plan splits
// them. No member gap caps round 1, so the hours alone size both.
export const roundOneHours = ({
  hoursPerWeek,
  doorPool,
  phonePool,
}: {
  hoursPerWeek: number
  doorPool: number
  phonePool: number
}): { doors: number; calls: number } => {
  const wave = sizePanelWave({
    gap: Number.POSITIVE_INFINITY,
    hoursPerWeek,
    pools: { text: 0, phone: phonePool, door: doorPool },
  })
  return {
    doors: stepsOf(wave, 'door_knocking'),
    calls: stepsOf(wave, 'phone_banking'),
  }
}

// Round 1's text: it covers whatever major groups the doors and calls leave
// short of MIN_VOICES_PER_GROUP expected answers, capped by who it can
// reach. Every door is in one walkable area, so the doors reach a group only
// as far as it lives there. A group no cell phone reaches cannot be helped
// by the text, so it does not size it.
export const sizeRoundOne = ({
  doors,
  calls,
  districtShares,
  dimensions,
  pools,
}: {
  doors: number
  calls: number
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
  const reach = majors.map((group) => ({
    ...group,
    fromHours:
      doors *
        shareOf(pools.doorArea, group.dimension, group.value) *
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
    texts,
    groups: reach.map(({ dimension, value, share, fromHours, perText }) => ({
      dimension,
      value,
      share,
      expectedAnswers: Math.round((fromHours + texts * perText) * 10) / 10,
    })),
  }
}
