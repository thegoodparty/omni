import {
  answersNeeded,
  type PriorityReadStatus,
  type ReadRepresentativeness,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'
import {
  batchTargets,
  isTargeted,
  MIN_VOICES_PER_GROUP,
  type TargetedDimension,
} from '@/contacts/utils/civicPanelAllocation.util'
import type { MrpGroupEstimate, MrpResult } from './mrp.util'
import { underrepresentedGroupOf } from './priorityReadStatus.util'

// A major group whose 90% range is wider than this leaves the read getting
// close: the model cannot yet say within 10 points either way what that
// group thinks.
export const MAX_REPRESENTATIVE_RANGE = 0.2
const MAX_UNDERREPRESENTED = 2

// The model of a priority's coded answers, poststratified to the district.
export interface MrpRead {
  result: MrpResult
  // Whether a race group may be named (raceNameable). Race still shapes the
  // model either way; it only stops counting as a major group.
  raceNameable: boolean
}

const dimensionsOf = (raceNameable: boolean): TargetedDimension[] =>
  raceNameable ? ['age', 'gender', 'tract', 'race'] : ['age', 'gender', 'tract']

const isHoldingBack = (group: MrpGroupEstimate): boolean =>
  group.answers < MIN_VOICES_PER_GROUP ||
  group.high - group.low > MAX_REPRESENTATIVE_RANGE

// The tracts the model has too few voices from, or is too unsure of: the
// parts of the district the status asks to hear from.
export const holdingBackTracts = (read: MrpRead | null): string[] =>
  (read?.result.groups ?? [])
    .filter(
      (group) =>
        group.dimension === 'tract' &&
        isHoldingBack(group) &&
        isTargeted(group, ['tract']),
    )
    .map((group) => group.value)

// The fewest further answers that could give every major group its voices:
// an answer counts once on every dimension, so the dimension furthest short
// sets it.
const answersMissing = (
  majors: ReadonlyArray<{ dimension: string; answers: number }>,
  dimensions: TargetedDimension[],
): number =>
  Math.max(
    0,
    ...dimensions.map((dimension) =>
      majors
        .filter((group) => group.dimension === dimension)
        .reduce(
          (sum, group) =>
            sum + Math.max(0, Math.ceil(MIN_VOICES_PER_GROUP - group.answers)),
          0,
        ),
    ),
  )

// The one place a "good read" is decided, so every surface that reads it
// changes together. A good read is a representative one: every group
// holding MAJOR_GROUP_SHARE of the district on a steered dimension has its
// voices, and the model is sure enough of each. `answers` is the people
// heard; the groups count coded answers. When the district could not be
// read, enough answers alone (answersNeeded of the smallest major group a
// district can have) are a good read, under its own status.
export const mrpReadStatus = (input: {
  answers: number
  read: MrpRead | null
}): PriorityReadStatus => {
  const { answers, read } = input
  const dimensions = dimensionsOf(read?.raceNameable ?? false)
  const groups = read?.result.groups ?? []
  const majors = groups.filter((group) => isTargeted(group, dimensions))
  if (majors.length === 0) {
    const needed = answersNeeded()
    const good = answers >= needed
    return {
      answers,
      needed,
      groupsHeard: 0,
      groupsTotal: 0,
      good,
      status: good ? 'enoughAnswers' : 'tooEarly',
      underrepresented: [],
    }
  }
  const status = ((): ReadRepresentativeness => {
    if (majors.some((group) => group.answers === 0)) return 'tooEarly'
    if (majors.some((group) => group.answers < MIN_VOICES_PER_GROUP)) {
      return 'notYetRepresentative'
    }
    return majors.some(
      (group) => group.high - group.low > MAX_REPRESENTATIVE_RANGE,
    )
      ? 'gettingClose'
      : 'representative'
  })()
  // Named in the order round 2 would lean toward them, but only the groups
  // holding the read back: short of voices, or still too unsure.
  const holdingBack = new Set(
    majors
      .filter(isHoldingBack)
      .map((group) => `${group.dimension}:${group.value}`),
  )
  const underrepresented: UnderrepresentedGroup[] = []
  for (const target of batchTargets(groups, dimensions)) {
    if (!holdingBack.has(`${target.dimension}:${target.value}`)) continue
    const group = underrepresentedGroupOf(
      target.dimension,
      target.value,
      read?.raceNameable ?? false,
    )
    if (group && !underrepresented.includes(group)) underrepresented.push(group)
    if (underrepresented.length === MAX_UNDERREPRESENTED) break
  }
  return {
    answers,
    needed: Math.max(1, answers + answersMissing(majors, dimensions)),
    groupsHeard: majors.filter((group) => group.answers >= MIN_VOICES_PER_GROUP)
      .length,
    groupsTotal: majors.length,
    good: status === 'representative',
    status,
    underrepresented,
  }
}
