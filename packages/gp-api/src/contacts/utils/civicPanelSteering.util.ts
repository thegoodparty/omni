import {
  MAJOR_GROUP_SHARE,
  PANEL_MEMBERS_PER_GROUP,
  PANEL_MIN_MEMBERS_FOR_BALANCE,
  type CivicPanelBalance,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'
import type { RespondentCell } from '@/peopleDb/databricks/districtCensusSql.util'
import type { SampleWeights } from '@/peopleDb/schemas/people.schema'
import {
  MIN_ANSWERS_PER_WEIGHTING_GROUP,
  placeCells,
  POOLED_VALUE,
  raceNameable,
  toRakingCells,
  tractShortfalls,
  weightingTargets,
  type WeightingCensus,
} from '@/priorities/util/censusWeighting.util'
import { underrepresentedGroupOf } from '@/priorities/util/priorityReadStatus.util'
import {
  poolSmallValues,
  type RakingCell,
  type RakingTargets,
} from '@/priorities/util/raking.util'

// Tenure stays out until a statistician rules on holding person answers to
// a household target (see weightingTargets). Race steers only when
// raceNameable holds for the members.
const STEERED_DIMENSIONS = ['age', 'gender', 'tract', 'race'] as const
type SteeredDimension = (typeof STEERED_DIMENSIONS)[number]

export const MIN_STEER_WEIGHT = 0.5
export const MAX_STEER_WEIGHT = 2

export interface PanelMix {
  // Members counted by age band, gender, tenure, tract and race.
  cells: RespondentCell[]
  census: WeightingCensus
}

export interface PanelGap {
  dimension: SteeredDimension
  value: string
  censusShare: number
  panelShare: number
}

const clampWeight = (value: number): number =>
  Math.min(MAX_STEER_WEIGHT, Math.max(MIN_STEER_WEIGHT, value))

// Census share against the members' unweighted share, per value. Members
// with an unknown value sit out that dimension's base. Values fewer than
// MIN_ANSWERS_PER_WEIGHTING_GROUP members hold pool into one, as weighting
// pools them; `pooled` names the values that went into it. Race sits out
// entirely unless raceNameable holds.
export const panelGaps = (
  mix: PanelMix,
  raceCells: RespondentCell[] = mix.cells,
): { gaps: PanelGap[]; pooled: Record<SteeredDimension, Set<string>> } => {
  const all = weightingTargets(mix.census)
  const withRace = raceNameable(raceCells)
  let targets: RakingTargets = {}
  for (const dimension of STEERED_DIMENSIONS) {
    const shares = all[dimension]
    if (shares && (dimension !== 'race' || withRace)) {
      targets[dimension] = shares
    }
  }
  let cells: RakingCell[] = placeCells(toRakingCells(mix.cells), targets)
  const pooled: Record<SteeredDimension, Set<string>> = {
    age: new Set(),
    gender: new Set(),
    tract: new Set(),
    race: new Set(),
  }
  for (const dimension of STEERED_DIMENSIONS) {
    const before = Object.keys(targets[dimension] ?? {})
    const result = poolSmallValues(
      cells,
      targets,
      dimension,
      MIN_ANSWERS_PER_WEIGHTING_GROUP,
      POOLED_VALUE,
    )
    cells = result.cells
    targets = result.targets
    const after = targets[dimension] ?? {}
    for (const value of before) {
      if (after[value] === undefined) pooled[dimension].add(value)
    }
  }
  const gaps = STEERED_DIMENSIONS.flatMap((dimension) => {
    const counts = new Map<string, number>()
    let known = 0
    for (const cell of cells) {
      const value = cell.values[dimension]
      if (value == null) continue
      counts.set(value, (counts.get(value) ?? 0) + cell.count)
      known += cell.count
    }
    if (known === 0) return []
    return Object.entries(targets[dimension] ?? {}).map(
      ([value, censusShare]) => ({
        dimension,
        value,
        censusShare,
        panelShare: (counts.get(value) ?? 0) / known,
      }),
    )
  })
  return { gaps, pooled }
}

// Each value's draw factor, clamp(census / panel, 0.5, 2), and 2 for a
// value the panel holds nobody from. A pooled value takes its pool's. A
// race of 'other' itself is never leaned toward, so it draws at 1.
export const steerWeights = (
  gaps: PanelGap[],
  pooled: Record<SteeredDimension, Set<string>>,
  census: WeightingCensus,
): SampleWeights => {
  const factorOf = new Map(
    gaps.map((gap) => [
      `${gap.dimension}:${gap.value}`,
      gap.panelShare === 0
        ? MAX_STEER_WEIGHT
        : clampWeight(gap.censusShare / gap.panelShare),
    ]),
  )
  const all = weightingTargets(census)
  const factors = (dimension: SteeredDimension): Record<string, number> =>
    Object.fromEntries(
      Object.keys(all[dimension] ?? {}).flatMap((value) => {
        if (dimension === 'race' && value === POOLED_VALUE) return []
        const key = pooled[dimension].has(value) ? POOLED_VALUE : value
        const factor = factorOf.get(`${dimension}:${key}`)
        return factor === undefined ? [] : [[value, factor]]
      }),
    )
  return {
    age: factors('age'),
    gender: factors('gender'),
    tract: factors('tract'),
    race: factors('race'),
    minWeight: MIN_STEER_WEIGHT,
    maxWeight: MAX_STEER_WEIGHT,
  }
}

export interface PanelCoverage {
  groupsCovered: number
  groupsTotal: number
  // The groups short of members, the largest first.
  missing: UnderrepresentedGroup[]
  // The fewest more members that would cover every group: a member sits in
  // one value of each dimension, so the dimension needing the most.
  membersShort: number
}

// Major groups of the district (MAJOR_GROUP_SHARE or more, by age band,
// gender, tract, and race when it may be named) and how many have the
// members it takes to expect three answers to a question.
export const panelCoverage = (
  mix: PanelMix,
  raceCells: RespondentCell[] = mix.cells,
): PanelCoverage => {
  const targets = weightingTargets(mix.census)
  const withRace = raceNameable(raceCells)
  const membersIn = (dimension: SteeredDimension, value: string): number =>
    mix.cells.reduce(
      (sum, cell) =>
        sum +
        (cell[dimension === 'age' ? 'ageBand' : dimension] === value
          ? cell.count
          : 0),
      0,
    )
  const groups = STEERED_DIMENSIONS.flatMap((dimension) => {
    if (dimension === 'race' && !withRace) return []
    return Object.entries(targets[dimension] ?? {})
      .filter(
        ([value, share]) =>
          value !== POOLED_VALUE && share >= MAJOR_GROUP_SHARE,
      )
      .map(([value, share]) => ({
        dimension,
        value,
        share,
        covered: membersIn(dimension, value) >= PANEL_MEMBERS_PER_GROUP,
      }))
  })
  const missing: UnderrepresentedGroup[] = []
  for (const group of groups
    .filter((candidate) => !candidate.covered)
    .sort((a, b) => b.share - a.share)) {
    const name = underrepresentedGroupOf(group.dimension, group.value, true)
    if (name && !missing.includes(name)) missing.push(name)
  }
  const shortBy = (dimension: SteeredDimension): number =>
    groups
      .filter((group) => group.dimension === dimension)
      .reduce(
        (sum, group) =>
          sum +
          Math.max(
            0,
            PANEL_MEMBERS_PER_GROUP - membersIn(dimension, group.value),
          ),
        0,
      )
  return {
    groupsCovered: groups.filter((group) => group.covered).length,
    groupsTotal: groups.length,
    missing,
    membersShort: Math.max(0, ...STEERED_DIMENSIONS.map(shortBy)),
  }
}

// Too few members to tell below PANEL_MIN_MEMBERS_FOR_BALANCE, then whether
// every major group has its members. Given `fresh` (the coverage of the
// panel's active members, once it is past its goal) the groups short of
// active members are counted and the group to invite is the largest of them.
export const panelBalance = ({
  members,
  coverage,
  fresh = null,
}: {
  members: number
  coverage: PanelCoverage
  fresh?: PanelCoverage | null
}): CivicPanelBalance => {
  if (members < PANEL_MIN_MEMBERS_FOR_BALANCE) {
    return { status: 'tooFewMembers', inviteMore: null }
  }
  const freshness = fresh
    ? { groupsNeedingFresh: fresh.groupsTotal - fresh.groupsCovered }
    : {}
  if (coverage.groupsCovered < coverage.groupsTotal) {
    return {
      status: 'missingGroups',
      inviteMore: (fresh ?? coverage).missing[0] ?? null,
      ...freshness,
    }
  }
  return {
    status: 'everyGroup',
    inviteMore: fresh?.missing[0] ?? null,
    ...freshness,
  }
}

// The tract a door step walks: of those the panel has barely reached (the
// tractShortfalls rule, on members), the one trailing its census share
// most. Ties go to the lower GEOID.
export const doorTractFor = (mix: PanelMix): string | null => {
  const [first] = tractShortfalls(mix.cells, mix.census.tractAdults).sort(
    (a, b) =>
      b.censusShare - b.share - (a.censusShare - a.share) ||
      a.tract.localeCompare(b.tract),
  )
  return first?.tract ?? null
}

export interface PanelSteering {
  // Null when the census could not be compared with the panel.
  balance: CivicPanelBalance | null
  coverage: PanelCoverage | null
  // The coverage of the active members, past the goal. Null before it.
  fresh: PanelCoverage | null
  // Null: every resident weighs the same.
  weights: SampleWeights | null
  // The largest group short of members, the one the balance's inviteMore
  // names, so a step and the status line never name different groups.
  leansToward: UnderrepresentedGroup | null
  doorTract: string | null
  // Calls draw landlines first unless the panel already holds at least the
  // district's share of people 65 and over.
  landlineFirst: boolean
}

const UNSTEERED: PanelSteering = {
  balance: null,
  coverage: null,
  fresh: null,
  weights: null,
  leansToward: null,
  doorTract: null,
  landlineFirst: true,
}

// How the next draws lean, and the one status the official sees. Below
// PANEL_MIN_MEMBERS_FOR_BALANCE members nothing leans: the gaps say more
// about chance than about who was invited. Past the goal `activeMix` (the
// members who answered lately) stands in for the members when judging who
// is short, so draws lean toward the groups gone quiet.
export const panelSteering = ({
  members,
  mix,
  activeMix = null,
}: {
  members: number
  mix: PanelMix | null
  activeMix?: PanelMix | null
}): PanelSteering => {
  const coverage = mix ? panelCoverage(mix) : null
  if (members < PANEL_MIN_MEMBERS_FOR_BALANCE) {
    return {
      ...UNSTEERED,
      coverage,
      balance: { status: 'tooFewMembers', inviteMore: null },
    }
  }
  if (!mix || !coverage) return UNSTEERED
  const fresh = activeMix ? panelCoverage(activeMix, mix.cells) : null
  const steerMix = activeMix ?? mix
  const { gaps, pooled } = panelGaps(steerMix, mix.cells)
  const balance = panelBalance({ members, coverage, fresh })
  if (gaps.length === 0) {
    return fresh
      ? { ...UNSTEERED, coverage, fresh, balance }
      : { ...UNSTEERED, coverage }
  }
  const older = gaps.find(
    (gap) => gap.dimension === 'age' && gap.value === '65plus',
  )
  return {
    balance,
    coverage,
    fresh,
    weights: steerWeights(gaps, pooled, steerMix.census),
    leansToward: (fresh ?? coverage).missing[0] ?? null,
    doorTract: doorTractFor(steerMix),
    landlineFirst: !older || older.panelShare < older.censusShare,
  }
}
