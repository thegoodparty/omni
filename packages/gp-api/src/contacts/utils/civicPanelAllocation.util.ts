import {
  answersNeeded,
  DEFAULT_TEXT_REPLY_RATE,
  MAJOR_GROUP_SHARE,
  MAX_LIST_SAMPLE_SIZE,
  MIN_VOICES_PER_GROUP,
} from '@goodparty_org/contracts'
import type { DistrictCell } from '@/peopleDb/databricks/districtCensusSql.util'
import type { SampleWeights } from '@/peopleDb/schemas/people.schema'
import {
  POOLED_VALUE,
  raceNameable,
} from '@/priorities/util/censusWeighting.util'
import type {
  FrameCell,
  GroupCount,
} from '@/priorities/util/priorityGroupRead.util'
import type { RakingTargets } from '@/priorities/util/raking.util'
import { asksFor } from './civicPanelInvite.util'

// A priority's two rounds of outreach: how big round 1's text is, and who
// round 2's scheduled text leans toward, from the priority's read of round
// 1's answers. See docs/features/civic-panel-rounds.md.

// A group is heard at MIN_VOICES_PER_GROUP answers. Groups under
// MAJOR_GROUP_SHARE are still counted, but chasing each would spend a batch
// on a few dozen residents. Both live in contracts, beside answersNeeded,
// which sizes from them.
export { MAJOR_GROUP_SHARE, MIN_VOICES_PER_GROUP }
// Drawn without leaning, so drift among the residents the lean never
// reaches still shows up.
export const UNSTEERED_BATCH_SHARE = 0.15
export const MAX_TARGET_WEIGHT = 4

export type TargetedDimension = 'age' | 'gender' | 'tract' | 'race'

export interface BatchTarget {
  dimension: TargetedDimension
  value: string
}

export const isTargeted = (
  group: GroupCount,
  dimensions: readonly TargetedDimension[],
): group is GroupCount & { dimension: TargetedDimension } =>
  dimensions.some((d) => d === group.dimension) &&
  group.share >= MAJOR_GROUP_SHARE &&
  group.value !== POOLED_VALUE

// The share of the district's smallest major group, the one answersNeeded
// sizes for. Null when the frame has no major group. Shares are of the whole
// district, as the model's are: someone whose value is unknown answers for
// no group on that dimension, so dividing by the known alone would inflate
// a group and size for fewer answers than it needs.
export const smallestMajorShare = (
  frame: FrameCell[],
  dimensions: readonly TargetedDimension[],
): number | null => {
  const total = frame.reduce((sum, cell) => sum + cell.count, 0)
  if (total === 0) return null
  const shares = dimensions.flatMap((dimension) => {
    const counts = new Map<string, number>()
    for (const cell of frame) {
      const value = cell.values[dimension]
      if (value === undefined) continue
      counts.set(value, (counts.get(value) ?? 0) + cell.count)
    }
    return [...counts].flatMap(([value, count]) =>
      value !== POOLED_VALUE && count / total >= MAJOR_GROUP_SHARE
        ? [count / total]
        : [],
    )
  })
  return shares.length === 0 ? null : Math.min(...shares)
}

// The answers a good read of the district needs: what round 1 is sized to
// and the floor the read holds a priority to, from the one frame both read,
// so the target an official is given and the read can never disagree. Race
// counts as a dimension when the frame's people can name it.
export const frameAnswersNeeded = (frame: FrameCell[]): number => {
  const dimensions: TargetedDimension[] = raceNameable(
    frame.map((cell) => ({
      count: cell.count,
      race: cell.values.race ?? null,
    })),
  )
    ? ['age', 'gender', 'tract', 'race']
    : ['age', 'gender', 'tract']
  return answersNeeded(smallestMajorShare(frame, dimensions))
}

// The major groups short of their voices, largest first.
export const batchTargets = (
  groups: GroupCount[],
  dimensions: readonly TargetedDimension[],
): BatchTarget[] =>
  groups
    .filter((g) => isTargeted(g, dimensions))
    .filter((g) => g.answers < MIN_VOICES_PER_GROUP)
    .sort((a, b) => b.share - a.share)
    .map((g) => ({ dimension: g.dimension, value: g.value }))

// Draw factors for drawListSample. A major group short of its voices leans
// fully; every other major group counts 1, as a value with no factor does.
export const batchWeights = (
  groups: GroupCount[],
  dimensions: readonly TargetedDimension[],
): SampleWeights => {
  const factors = (dimension: TargetedDimension): Record<string, number> =>
    Object.fromEntries(
      groups
        .filter((g) => g.dimension === dimension && isTargeted(g, dimensions))
        .map((g) => [
          g.value,
          g.answers < MIN_VOICES_PER_GROUP ? MAX_TARGET_WEIGHT : 1,
        ]),
    )
  return {
    age: factors('age'),
    gender: factors('gender'),
    tract: factors('tract'),
    race: factors('race'),
    minWeight: 1,
    maxWeight: MAX_TARGET_WEIGHT,
  }
}

export const splitBatch = (
  size: number,
): { steered: number; unsteered: number } => {
  const unsteered = Math.round(size * UNSTEERED_BATCH_SHARE)
  return { steered: size - unsteered, unsteered }
}

// A placeholder for the share of residents who answer a text, until a
// measured rate replaces it.
export const TEXT_ANSWER_RATE = DEFAULT_TEXT_REPLY_RATE

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

// Round 1's text: enough that every major group is expected to bring
// MIN_VOICES_PER_GROUP answers, capped by who it can reach (`pool`, anyone
// with a cell phone). A group no cell phone reaches cannot be helped by the
// text, so it does not size it.
export const sizeRoundOne = ({
  districtShares,
  dimensions,
  pool,
}: {
  districtShares: RakingTargets
  dimensions: readonly TargetedDimension[]
  pool: DistrictCell[]
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
    perText: shareOf(pool, group.dimension, group.value) * TEXT_ANSWER_RATE,
  }))
  const needed = Math.max(
    0,
    ...reach
      .filter((g) => g.perText > 0)
      .map((g) => asksFor(MIN_VOICES_PER_GROUP, g.perText)),
  )
  const texts = Math.min(needed, sizeOf(pool), MAX_LIST_SAMPLE_SIZE)
  return {
    texts,
    groups: reach.map(({ dimension, value, share, perText }) => ({
      dimension,
      value,
      share,
      expectedAnswers: Math.round(texts * perText * 10) / 10,
    })),
  }
}
