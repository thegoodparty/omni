import {
  answersNeeded,
  type PriorityReadStatus,
  type PriorityResultsGroup,
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
  // The district's answers needed (frameAnswersNeeded of the model's frame):
  // fewer answers than this never read as representative, however the
  // groups split them, since one answer counts once on every dimension.
  answersNeeded: number
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

// Answers within their group's share of the floor count toward a balanced
// read; past it, a group's extra answers count for nothing more. Only the
// major groups the read decides on hold seats, shared out by their part of
// the district on each dimension, so a small group or the pooled rest never
// holds a seat empty. One answer counts on every dimension, so the
// dimension furthest behind sets it. The floor is never under the answers
// its smallest major group needs, so every group at its share has every
// major group heard, and a good read fills every seat.
const representativeOf = (
  majors: readonly MrpGroupEstimate[],
  dimensions: TargetedDimension[],
  answers: number,
  floor: number,
  good: boolean,
): { representativeAnswers: number; representativeNeeded: number } => {
  const needed = Math.max(
    1,
    floor,
    answersNeeded(Math.min(...majors.map((group) => group.share))),
  )
  if (good)
    return { representativeAnswers: needed, representativeNeeded: needed }
  const counted = Math.min(
    ...dimensions.flatMap((dimension) => {
      const on = majors.filter((group) => group.dimension === dimension)
      const known = on.reduce((sum, group) => sum + group.share, 0)
      if (known <= 0) return []
      return on.reduce(
        (sum, group) =>
          sum + Math.min(group.answers, (group.share / known) * needed),
        0,
      )
    }),
  )
  return {
    // Rounded to six places first so float noise never drops a whole answer.
    representativeAnswers: Math.min(
      answers,
      needed,
      Math.floor(Number(counted.toFixed(6))),
    ),
    representativeNeeded: needed,
  }
}

// The one place a "good read" is decided, so every surface that reads it
// changes together. A good read is a representative one: the district's
// answersNeeded heard in all, every group holding MAJOR_GROUP_SHARE of the
// district on a steered dimension has its voices, and the model is sure
// enough of each. `answers` is the people heard; the groups count coded
// answers. When the district could not be
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
      groupsNext: 0,
      representativeAnswers: Math.min(answers, needed),
      representativeNeeded: needed,
      good,
      status: good ? 'enoughAnswers' : 'tooEarly',
      underrepresented: [],
      unheard: [],
    }
  }
  const status = ((): ReadRepresentativeness => {
    if (majors.some((group) => group.answers === 0)) return 'tooEarly'
    if (
      answers < (read?.answersNeeded ?? 0) ||
      majors.some((group) => group.answers < MIN_VOICES_PER_GROUP)
    ) {
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
  // A named group nobody in has answered: for neighborhoods, any one of the
  // tracts it stands for.
  const silent = new Set(
    majors
      .filter((group) => group.answers === 0)
      .map((group) => `${group.dimension}:${group.value}`),
  )
  const underrepresented: UnderrepresentedGroup[] = []
  const unheard: UnderrepresentedGroup[] = []
  for (const target of batchTargets(groups, dimensions)) {
    const key = `${target.dimension}:${target.value}`
    if (!holdingBack.has(key)) continue
    const group = underrepresentedGroupOf(
      target.dimension,
      target.value,
      read?.raceNameable ?? false,
    )
    if (!group) continue
    const named = underrepresented.includes(group)
    if (!named && underrepresented.length === MAX_UNDERREPRESENTED) continue
    if (!named) underrepresented.push(group)
    if (silent.has(key) && !unheard.includes(group)) unheard.push(group)
  }
  return {
    answers,
    needed: Math.max(
      1,
      read?.answersNeeded ?? 0,
      answers + answersMissing(majors, dimensions),
    ),
    groupsHeard: majors.filter((group) => group.answers >= MIN_VOICES_PER_GROUP)
      .length,
    groupsTotal: majors.length,
    // Every tract stands for one named group, so naming it puts each tract
    // still short in the count.
    groupsNext: majors.filter((group) => {
      if (group.answers >= MIN_VOICES_PER_GROUP) return false
      const named = underrepresentedGroupOf(
        group.dimension,
        group.value,
        read?.raceNameable ?? false,
      )
      return named !== null && underrepresented.includes(named)
    }).length,
    ...representativeOf(
      majors,
      dimensions,
      answers,
      read?.answersNeeded ?? 0,
      status === 'representative',
    ),
    good: status === 'representative',
    status,
    underrepresented,
    unheard,
  }
}

// Each major group the read counts, other than neighborhoods: its share of
// the district against its share of the coded answers on that dimension,
// for the results page's petals. Answers with no known value on a
// dimension sit out of it.
export const answerGroups = (read: MrpRead | null): PriorityResultsGroup[] => {
  const groups = read?.result.groups ?? []
  const dimensions = dimensionsOf(read?.raceNameable ?? false).filter(
    (dimension) => dimension !== 'tract',
  )
  const answersOn = (dimension: string): number =>
    groups
      .filter((group) => group.dimension === dimension)
      .reduce((sum, group) => sum + group.answers, 0)
  return groups.flatMap((group) => {
    if (!isTargeted(group, dimensions)) return []
    const named = underrepresentedGroupOf(
      group.dimension,
      group.value,
      read?.raceNameable ?? false,
    )
    if (!named) return []
    const total = answersOn(group.dimension)
    return [
      {
        group: named,
        districtShare: group.share,
        answerShare: total > 0 ? group.answers / total : 0,
      },
    ]
  })
}
