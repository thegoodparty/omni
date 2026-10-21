import { PriorityAnswerCode } from '@/generated/prisma'
import type { Person } from '@goodparty_org/contracts'
import {
  MAJOR_GROUP_SHARE,
  type TargetedDimension,
} from '@/contacts/utils/civicPanelAllocation.util'
import { ADULT_AGE_BANDS } from '@/peopleDb/databricks/districtCensusSql.util'
import { POOLED_VALUE } from '@/priorities/util/censusWeighting.util'
import type { MrpFrameCell } from '@/priorities/util/mrp.util'

// Who answers the seeded priority ask, chosen so its read lands where the
// seed's flags say: every major group the read counts gets its voices first,
// then everyone else in the order they were asked.

// Above the read's three, so a group's range is narrow enough too.
export const SEED_VOICES_PER_GROUP = 5

const DIMENSIONS: TargetedDimension[] = ['age', 'gender', 'tract', 'race']

export interface SeedGroup {
  dimension: TargetedDimension
  value: string
}

export type SeedValues = Partial<Record<TargetedDimension, string | null>>

// The read's major groups: every value holding MAJOR_GROUP_SHARE of the
// district's frame, the census-weighted one the model poststratifies to.
// Race is included whether or not it ends up nameable; answering for it
// costs nothing when it is not.
export const readGroups = (frame: MrpFrameCell[]): SeedGroup[] => {
  const total = frame.reduce((sum, cell) => sum + cell.count, 0)
  if (total === 0) return []
  return DIMENSIONS.flatMap((dimension) => {
    const counts = new Map<string, number>()
    for (const cell of frame) {
      const value = cell.values[dimension]
      if (value === undefined) continue
      counts.set(value, (counts.get(value) ?? 0) + cell.count)
    }
    return [...counts].flatMap(([value, count]) =>
      value !== POOLED_VALUE && count / total >= MAJOR_GROUP_SHARE
        ? [{ dimension, value }]
        : [],
    )
  })
}

const RACE_OF: Record<NonNullable<Person['ethnicityGroup']>, string> = {
  European: 'white',
  'African American': 'black',
  Hispanic: 'hispanic',
  Asian: 'asian',
  Other: 'other',
}

const ageBandOf = (age: number | null): string | null => {
  if (age === null) return null
  const band = [...ADULT_AGE_BANDS].reverse().find((b) => age >= b.minAge)
  return band?.key ?? null
}

// A resident in the model's cells, folded as the warehouse folds them. The
// tract is only known for residents drawn from one.
export const seedValuesOf = (
  person: Pick<Person, 'age' | 'gender' | 'ethnicityGroup'>,
  tract: string | null,
): SeedValues => ({
  age: ageBandOf(person.age),
  gender:
    person.gender === 'Male'
      ? 'male'
      : person.gender === 'Female'
        ? 'female'
        : null,
  tract,
  race: person.ethnicityGroup ? RACE_OF[person.ethnicityGroup] : null,
})

const keyOf = (dimension: string, value: string) => `${dimension}:${value}`

// The first `size` answerers. While a major group is short of its voices,
// the next pick is whoever closes the most of the shortfall, so the groups
// furthest short fill first and a small `size` spreads across all of them
// rather than finishing one. Then everyone else, in the order given.
export const allocateAnswers = <T extends { values: SeedValues }>(
  respondents: T[],
  groups: SeedGroup[],
  size: number,
  minPerGroup = SEED_VOICES_PER_GROUP,
): T[] => {
  const target = Math.min(size, respondents.length)
  const counts = new Map(
    groups.map((group) => [keyOf(group.dimension, group.value), 0]),
  )
  const keysOf = (respondent: T): string[] =>
    DIMENSIONS.flatMap((dimension) => {
      const value = respondent.values[dimension]
      if (value === null || value === undefined) return []
      const key = keyOf(dimension, value)
      return counts.has(key) ? [key] : []
    })
  const gain = (respondent: T): number =>
    keysOf(respondent).reduce(
      (sum, key) => sum + Math.max(0, minPerGroup - counts.get(key)!),
      0,
    )
  const left = [...respondents]
  const chosen: T[] = []
  while (chosen.length < target) {
    let best = -1
    let bestGain = 0
    for (const [index, respondent] of left.entries()) {
      const next = gain(respondent)
      if (next > bestGain) {
        best = index
        bestGain = next
      }
    }
    if (best === -1) break
    const [pick] = left.splice(best, 1)
    for (const key of keysOf(pick!)) counts.set(key, counts.get(key)! + 1)
    chosen.push(pick!)
  }
  return [...chosen, ...left.slice(0, target - chosen.length)]
}

// Nine in ten yes: near-unanimous answers are what narrow the model's ranges
// enough for every group to read as heard.
const LEAN_CODES = [
  ...Array.from({ length: 9 }, () => PriorityAnswerCode.yes),
  PriorityAnswerCode.mixed,
]
const EVEN_CODES = [PriorityAnswerCode.yes, PriorityAnswerCode.no]

// Codes cycle within each age band and sex, not down the whole list, so no
// group's answers line up with the cycle and all come out one way.
export const answerCodes = (
  respondents: Array<{ values: SeedValues }>,
  split: 'lean' | 'even' | undefined,
): PriorityAnswerCode[] => {
  const codes = split === 'even' ? EVEN_CODES : LEAN_CODES
  const seen = new Map<string, number>()
  return respondents.map(({ values }) => {
    const cell = `${values.age ?? '-'}:${values.gender ?? '-'}`
    const index = seen.get(cell) ?? 0
    seen.set(cell, index + 1)
    return codes[index % codes.length]!
  })
}
