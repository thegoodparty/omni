import type { Prisma } from '@/generated/prisma'
import type { RespondentCell } from '@/peopleDb/databricks/districtCensusSql.util'
import type { TargetedDimension } from '@/contacts/utils/civicPanelAllocation.util'
import {
  POOLED_VALUE,
  weightingTargets,
  type WeightingCensus,
} from './censusWeighting.util'
import type { MrpAnswerCell, MrpFrameCell } from './mrp.util'

// A priority's round 2 text: the model's frame and answers, and how its
// send is marked. When it is drawn is the Serve SMS schedule rule's
// (roundTwoDrawCutoff). See docs/features/civic-panel-mrp.md.

// Tenure stays out, as it does from the census steering.
export const roundTwoDimensions = (withRace: boolean): TargetedDimension[] => [
  'age',
  'gender',
  'tract',
  ...(withRace ? (['race'] as const) : []),
]

// The district's cells from its census shares, one dimension at a time.
// The census publishes no joint counts, so each cell's share is the product
// of its values' shares: the model reweights to the district's mix on each
// dimension, not to how the dimensions overlap.
export const roundTwoFrame = (
  census: WeightingCensus,
  dimensions: readonly TargetedDimension[],
): MrpFrameCell[] => {
  const targets = weightingTargets(census)
  return dimensions.reduce<MrpFrameCell[]>(
    (cells, dimension) => {
      const shares = targets[dimension]
      if (!shares) return cells
      return cells.flatMap((cell) =>
        Object.entries(shares).map(([value, share]) => ({
          count: cell.count * share,
          values: { ...cell.values, [dimension]: value },
        })),
      )
    },
    [{ count: 1, values: {} }],
  )
}

export interface CodedCells {
  yes: RespondentCell[]
  no: RespondentCell[]
  mixed: RespondentCell[]
}

const YES_SHARE: Record<keyof CodedCells, number> = {
  yes: 1,
  no: 0,
  mixed: 0.5,
}

const valueOf = (
  cell: RespondentCell,
  dimension: TargetedDimension,
): string | null => (dimension === 'age' ? cell.ageBand : cell[dimension])

// Who answered, counted into the frame's cells. A value the frame does not
// hold sits out its dimension, except a race the census folded into
// 'other', which counts there.
export const roundTwoAnswers = (
  coded: CodedCells,
  frame: MrpFrameCell[],
  dimensions: readonly TargetedDimension[],
): MrpAnswerCell[] => {
  const known = new Map<string, Set<string>>()
  for (const cell of frame) {
    for (const [dimension, value] of Object.entries(cell.values)) {
      known.set(dimension, (known.get(dimension) ?? new Set()).add(value))
    }
  }
  const place = (dimension: TargetedDimension, value: string | null) => {
    const values = known.get(dimension)
    if (value === null || !values) return null
    if (values.has(value)) return value
    return dimension === 'race' && values.has(POOLED_VALUE)
      ? POOLED_VALUE
      : null
  }
  const answers = new Map<string, MrpAnswerCell>()
  for (const code of ['yes', 'no', 'mixed'] as const) {
    for (const cell of coded[code]) {
      const values = Object.fromEntries(
        dimensions
          .filter((d) => known.has(d))
          .map((d) => [d, place(d, valueOf(cell, d))]),
      )
      const key = JSON.stringify(values)
      const answer = answers.get(key) ?? { yes: 0, answers: 0, values }
      answer.yes += cell.count * YES_SHARE[code]
      answer.answers += cell.count
      answers.set(key, answer)
    }
  }
  return [...answers.values()]
}

// How a round 2 send is marked: its list carries a sample size and nothing
// drawn yet. Nothing else saves a list that way, since every other sample is
// drawn when it is saved, and such a list resolves to nobody, so a send that
// reached delivery early would text no one.
export const UNDRAWN_SAMPLE_WHERE = {
  sampleSize: { not: null },
  sampledAt: null,
} satisfies Prisma.VoterFileFilterWhereInput

export const isUndrawnSample = (
  list: { sampleSize: number | null; sampledAt: Date | null } | null,
): boolean => list?.sampleSize != null && !list.sampledAt

// The steered draw and the unsteered one, as one list of at most `size`.
// The unsteered draw already leaves out who the steered one took; this
// holds the list to the paid size even if a draw ran over.
export const unionDraws = (
  steered: string[],
  unsteered: string[],
  size: number,
): string[] => [...new Set([...steered, ...unsteered])].slice(0, size)
