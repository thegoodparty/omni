import {
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
import { underrepresentedGroups } from '@/priorities/util/priorityReadStatus.util'
import {
  poolSmallValues,
  type RakingCell,
  type RakingGap,
  type RakingTargets,
} from '@/priorities/util/raking.util'

// Tenure stays out until a statistician rules on holding person answers to
// a household target (see weightingTargets). Race steers only when
// raceNameable holds for the members.
const STEERED_DIMENSIONS = ['age', 'gender', 'tract', 'race'] as const
type SteeredDimension = (typeof STEERED_DIMENSIONS)[number]

export const MIN_STEER_WEIGHT = 0.5
export const MAX_STEER_WEIGHT = 2

// The status bar: the ±10 points a question's answers are sized for, or
// the 95% margin of a share near one half at this many members, whichever
// is wider, so a small panel is not called off on chance alone.
const MIN_BALANCE_BAR = 0.1
const Z_95 = 1.96

export const balanceBar = (members: number): number =>
  Math.max(MIN_BALANCE_BAR, Z_95 * Math.sqrt(0.25 / members))

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
): { gaps: PanelGap[]; pooled: Record<SteeredDimension, Set<string>> } => {
  const all = weightingTargets(mix.census)
  const withRace = raceNameable(mix.cells)
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

// The group trailing the census furthest, by the priority read's rule (at
// least MIN_UNDERREPRESENTED_GAP behind), or null.
const furthestBehind = (gaps: PanelGap[]): UnderrepresentedGroup | null => {
  const raking: RakingGap[] = gaps.map((gap) => ({
    dimension: gap.dimension,
    value: gap.value,
    share: gap.panelShare,
    unweightedShare: gap.panelShare,
    censusShare: gap.censusShare,
  }))
  // panelGaps holds race gaps only when race may be named.
  return underrepresentedGroups(raking, true)[0] ?? null
}

export const panelBalance = ({
  members,
  goal,
  gaps,
}: {
  members: number
  goal: number
  gaps: PanelGap[]
}): CivicPanelBalance => {
  if (members < PANEL_MIN_MEMBERS_FOR_BALANCE) {
    return { status: 'tooEarly', inviteMore: null }
  }
  const largestGap = gaps.reduce(
    (max, gap) => Math.max(max, Math.abs(gap.censusShare - gap.panelShare)),
    0,
  )
  if (largestGap > balanceBar(members)) {
    return { status: 'notYetRepresentative', inviteMore: furthestBehind(gaps) }
  }
  if (members < goal) {
    return { status: 'gettingClose', inviteMore: furthestBehind(gaps) }
  }
  return { status: 'representative', inviteMore: null }
}

// The tract a door step walks: of those the panel has barely reached (the
// unreachedTracts rule, on members), the one trailing its census share
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
  // Null: every resident weighs the same.
  weights: SampleWeights | null
  // The group the weights favor most, named on the step.
  leansToward: UnderrepresentedGroup | null
  doorTract: string | null
  // Calls draw landlines first unless the panel already holds at least the
  // district's share of people 65 and over.
  landlineFirst: boolean
}

const UNSTEERED: PanelSteering = {
  balance: null,
  weights: null,
  leansToward: null,
  doorTract: null,
  landlineFirst: true,
}

// How the next draws lean, and the one status the official sees. Below
// PANEL_MIN_MEMBERS_FOR_BALANCE members nothing leans: the gaps say more
// about chance than about who was invited.
export const panelSteering = ({
  members,
  goal,
  mix,
}: {
  members: number
  goal: number
  mix: PanelMix | null
}): PanelSteering => {
  if (members < PANEL_MIN_MEMBERS_FOR_BALANCE) {
    return { ...UNSTEERED, balance: { status: 'tooEarly', inviteMore: null } }
  }
  if (!mix) return UNSTEERED
  const { gaps, pooled } = panelGaps(mix)
  if (gaps.length === 0) return UNSTEERED
  const older = gaps.find(
    (gap) => gap.dimension === 'age' && gap.value === '65plus',
  )
  return {
    balance: panelBalance({ members, goal, gaps }),
    weights: steerWeights(gaps, pooled, mix.census),
    leansToward: furthestBehind(gaps),
    doorTract: doorTractFor(mix),
    landlineFirst: !older || older.panelShare < older.censusShare,
  }
}
