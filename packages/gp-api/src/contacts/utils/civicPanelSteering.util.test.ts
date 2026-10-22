import { describe, expect, it } from 'vitest'
import {
  ACS_COUNT_KEYS,
  type AcsCountKey,
  type AcsCounts,
  type RespondentCell,
} from '@/peopleDb/databricks/districtCensusSql.util'
import {
  doorTractFor,
  panelBalance,
  panelComposition,
  panelCoverage,
  panelGaps,
  panelSteering,
  precinctPlaces,
  tractNumber,
  type PanelMix,
} from './civicPanelSteering.util'

const acs = (overrides: Partial<Record<AcsCountKey, number>>): AcsCounts =>
  Object.fromEntries(
    ACS_COUNT_KEYS.map((key) => [key, overrides[key] ?? 0]),
  ) as AcsCounts

// 1,000 adults: 16% in each age band under 65 and 20% at 65 and over, in
// three tracts of 50%, 40% and 10%. Tenure is in the census but never
// steered.
const DISTRICT = acs({
  populationMale18To24: 80,
  populationFemale18To24: 80,
  populationMale25To34: 80,
  populationFemale25To34: 80,
  populationMale35To44: 80,
  populationFemale35To44: 80,
  populationMale45To54: 80,
  populationFemale45To54: 80,
  populationMale55To64: 80,
  populationFemale55To64: 80,
  populationMale65Plus: 100,
  populationFemale65Plus: 100,
  households: 400,
  ownerOccupiedHouseholds: 240,
})
const A = '53017950100'
const B = '53017950200'
const C = '53017950300'
const TRACTS = new Map([
  [A, 500],
  [B, 400],
  [C, 100],
])

const cell = (
  overrides: Partial<RespondentCell> & { count: number },
): RespondentCell => ({
  ageBand: '35to44',
  gender: null,
  tenure: 'owner',
  tract: A,
  race: null,
  ...overrides,
})

// Everyone, all ages: 50% white, 30% Black, 15% Hispanic, 5% other.
const RACE_DISTRICT = {
  ...DISTRICT,
  populationWhiteNh: 625,
  populationBlackNh: 375,
  populationHispanic: 187.5,
  populationOtherNh: 62.5,
}
const raceMixOf = (cells: RespondentCell[]): PanelMix => ({
  cells,
  census: { district: RACE_DISTRICT, tractAdults: TRACTS },
})

const mixOf = (cells: RespondentCell[]): PanelMix => ({
  cells,
  census: { district: DISTRICT, tractAdults: TRACTS },
})

describe('panelComposition', () => {
  it('reads every tract with its members and each major group beside the district', () => {
    const composition = panelComposition(
      mixOf([
        cell({ count: 6, gender: 'female' }),
        cell({ count: 4, ageBand: '65plus', tract: B, gender: 'male' }),
      ]),
    )

    expect(composition.placeKind).toBe('tract')
    expect(composition.places).toEqual([
      { key: A, name: '9501', districtShare: 0.5, members: 6 },
      { key: B, name: '9502', districtShare: 0.4, members: 4 },
      { key: C, name: '9503', districtShare: 0.1, members: 0 },
    ])
    expect(composition.groups.map((group) => group.group)).toEqual([
      'age18to24',
      'age25to34',
      'age35to44',
      'age45to54',
      'age55to64',
      'age65plus',
    ])
    expect(
      composition.groups.find((group) => group.group === 'age35to44'),
    ).toEqual({ group: 'age35to44', districtShare: 0.16, memberShare: 0.6 })
  })

  it('names race groups only when race may be named, never other', () => {
    const named = panelComposition(
      raceMixOf([
        cell({ count: 8, race: 'white' }),
        cell({ count: 4, race: 'black' }),
      ]),
    )
    expect(named.groups.map((group) => group.group)).toEqual(
      expect.arrayContaining(['white', 'black', 'hispanic']),
    )
    expect(named.groups.find((group) => group.group === 'white')).toEqual({
      group: 'white',
      districtShare: 0.5,
      memberShare: 8 / 12,
    })

    const unnamed = panelComposition(raceMixOf([cell({ count: 12 })]))
    expect(unnamed.groups.some((group) => group.group === 'white')).toBe(false)
  })
})

describe('tractNumber', () => {
  it('names a tract the way the census does', () => {
    expect(tractNumber('37021000100')).toBe('1')
    expect(tractNumber('53017950102')).toBe('9501.02')
  })
})

describe('precinctPlaces', () => {
  it('shares the district by precinct, leaving the unknown precinct out', () => {
    expect(
      precinctPlaces(
        [
          { county: 'BUNCOMBE', precinct: '01.1', people: 300 },
          { county: 'BUNCOMBE', precinct: '02.1', people: 100 },
          { county: 'BUNCOMBE', precinct: '', people: 50 },
        ],
        [{ county: 'BUNCOMBE', precinct: '02.1', people: 7 }],
      ),
    ).toEqual([
      {
        key: 'BUNCOMBE|01.1',
        name: '01.1',
        districtShare: 0.75,
        members: 0,
      },
      {
        key: 'BUNCOMBE|02.1',
        name: '02.1',
        districtShare: 0.25,
        members: 7,
      },
    ])
    expect(precinctPlaces([], [])).toEqual([])
  })
})

describe('panelGaps', () => {
  it('compares unweighted member shares with the census, leaving tenure out', () => {
    const { gaps } = panelGaps(
      mixOf([
        cell({ count: 30, tract: A }),
        cell({ count: 10, ageBand: '65plus', tract: B }),
        cell({ count: 10, ageBand: null, tract: B }),
      ]),
    )
    const gap = (dimension: string, value: string) =>
      gaps.find((g) => g.dimension === dimension && g.value === value)
    // Unknown ages sit out the age base: 10 of 40.
    expect(gap('age', '65plus')?.panelShare).toBeCloseTo(0.25)
    expect(gap('age', '65plus')?.censusShare).toBeCloseTo(0.2)
    expect(gap('tract', B)?.panelShare).toBeCloseTo(0.4)
    expect(new Set<string>(gaps.map((g) => g.dimension)).has('tenure')).toBe(
      false,
    )
  })

  it('pools tracts holding fewer than 5 members', () => {
    const { gaps, pooled } = panelGaps(
      mixOf([
        cell({ count: 40, tract: A }),
        cell({ count: 3, tract: B }),
        cell({ count: 2, tract: C }),
      ]),
    )
    expect([...pooled.tract].sort()).toEqual([B, C])
    const other = gaps.find(
      (g) => g.dimension === 'tract' && g.value === 'other',
    )
    expect(other?.censusShare).toBeCloseTo(0.5)
    expect(other?.panelShare).toBeCloseTo(5 / 45)
  })
})

describe('panelGaps race', () => {
  it('compares race once enough members have one on file', () => {
    const { gaps } = panelGaps(
      raceMixOf([
        cell({ count: 80, race: 'white' }),
        cell({ count: 10, race: 'black' }),
        cell({ count: 10, race: 'hispanic' }),
      ]),
    )
    const black = gaps.find(
      (g) => g.dimension === 'race' && g.value === 'black',
    )
    expect(black?.panelShare).toBeCloseTo(0.1)
    expect(black?.censusShare).toBeCloseTo(0.3)
  })

  it('leaves race out when under 70% of members have one', () => {
    const { gaps } = panelGaps(
      raceMixOf([
        cell({ count: 60, race: 'white' }),
        cell({ count: 40, race: null }),
      ]),
    )
    expect(gaps.some((g) => g.dimension === 'race')).toBe(false)
  })
})

describe('panelCoverage', () => {
  it('counts the major groups holding enough members to expect three answers', () => {
    // Everyone 35 to 44, tracts A 85 and B 15 (8 members is enough), C none.
    const coverage = panelCoverage(
      mixOf([cell({ count: 85, tract: A }), cell({ count: 15, tract: B })]),
    )
    // Six age bands and three tracts; 35 to 44, A and B are in.
    expect(coverage).toMatchObject({ groupsCovered: 3, groupsTotal: 9 })
  })

  it('counts a group at exactly the members it takes', () => {
    const at = (members: number) =>
      panelCoverage(
        mixOf([
          cell({ count: 50, tract: A }),
          cell({ count: members, tract: B }),
        ]),
      ).groupsCovered
    expect(at(7)).toBe(2)
    expect(at(8)).toBe(3)
  })

  it('names the missing groups, the largest first', () => {
    const { missing } = panelCoverage(mixOf([cell({ count: 100, tract: A })]))
    expect(missing[0]).toBe('unreachedAreas')
    expect(missing).toContain('age65plus')
  })
})

describe('panelCoverage members short', () => {
  it('is the most a dimension still needs, since a member sits in one value of each', () => {
    // Everyone 35 to 44 in tract A: the five other age bands (8 each) need
    // 40, the two other tracts 16.
    const { membersShort } = panelCoverage(
      mixOf([cell({ count: 100, tract: A })]),
    )
    expect(membersShort).toBe(40)
  })

  it('is 0 once every group has its members', () => {
    const bands = [
      '18to24',
      '25to34',
      '35to44',
      '45to54',
      '55to64',
      '65plus',
    ] as const
    const { membersShort } = panelCoverage(
      mixOf(
        bands.flatMap((ageBand) =>
          [A, B, C].map((tract) => cell({ count: 8, ageBand, tract })),
        ),
      ),
    )
    expect(membersShort).toBe(0)
  })
})

describe('panelBalance', () => {
  const coverage = (groupsCovered: number) => ({
    groupsCovered,
    groupsTotal: 12,
    missing: ['age65plus' as const],
    membersShort: 0,
  })

  it('has too few members under 30', () => {
    expect(panelBalance({ members: 29, coverage: coverage(2) })).toEqual({
      status: 'tooFewMembers',
      inviteMore: null,
    })
  })

  it('names a group to invite while any group is missing, at any size', () => {
    expect(panelBalance({ members: 30, coverage: coverage(11) })).toEqual({
      status: 'missingGroups',
      inviteMore: 'age65plus',
    })
    expect(panelBalance({ members: 400, coverage: coverage(11) })).toEqual({
      status: 'missingGroups',
      inviteMore: 'age65plus',
    })
  })

  it('has every group once none is missing', () => {
    expect(panelBalance({ members: 100, coverage: coverage(12) })).toEqual({
      status: 'everyGroup',
      inviteMore: null,
    })
  })

  it('counts the groups short of active members past the goal, and names the largest', () => {
    const fresh = {
      groupsCovered: 9,
      groupsTotal: 12,
      missing: ['black' as const, 'age65plus' as const],
      membersShort: 20,
    }
    expect(
      panelBalance({ members: 250, coverage: coverage(12), fresh }),
    ).toEqual({
      status: 'everyGroup',
      inviteMore: 'black',
      groupsNeedingFresh: 3,
    })
  })

  it('has no group to invite once every group has active members', () => {
    const fresh = { ...coverage(12), missing: [] }
    expect(
      panelBalance({ members: 250, coverage: coverage(12), fresh }),
    ).toEqual({
      status: 'everyGroup',
      inviteMore: null,
      groupsNeedingFresh: 0,
    })
  })
})

describe('doorTractFor', () => {
  it('walks the barely reached tract trailing its share most', () => {
    // A holds 90% of members (50% of adults), B 10% (40%), C none (10%).
    const mix = mixOf([
      cell({ count: 90, tract: A }),
      cell({ count: 10, tract: B }),
    ])
    expect(doorTractFor(mix)).toBe(B)
  })

  it('is null when every tract is reached', () => {
    const mix = mixOf([
      cell({ count: 50, tract: A }),
      cell({ count: 40, tract: B }),
      cell({ count: 10, tract: C }),
    ])
    expect(doorTractFor(mix)).toBeNull()
  })
})

describe('panelSteering past the goal', () => {
  const members = mixOf([
    cell({ count: 85, tract: A }),
    cell({ count: 15, tract: B }),
  ])

  it('judges and leans by the active members, not the members', () => {
    // Every member covers A and B, but only A's 30 answered lately.
    const active = mixOf([cell({ count: 30, tract: A })])
    const steering = panelSteering({
      members: 100,
      mix: members,
      activeMix: active,
    })
    expect(steering.coverage?.groupsCovered).toBe(3)
    expect(steering.fresh?.groupsCovered).toBe(2)
    expect(steering.balance?.groupsNeedingFresh).toBe(7)
    expect(steering.weights?.tract[B]).toBe(2)
  })

  it('still names groups to freshen with nobody active', () => {
    const steering = panelSteering({
      members: 100,
      mix: members,
      activeMix: { cells: [], census: members.census },
    })
    expect(steering.balance?.groupsNeedingFresh).toBe(9)
    expect(steering.balance?.inviteMore).not.toBeNull()
    expect(steering.weights).toBeNull()
  })

  it('names a group short of members before one only short of active members', () => {
    // 65 and over has no members; tract B has members but none active.
    const steering = panelSteering({
      members: 100,
      mix: members,
      activeMix: mixOf([cell({ count: 30, tract: A })]),
    })
    const memberShort = panelCoverage(members).missing
    expect(steering.balance?.status).toBe('missingGroups')
    expect(steering.fresh?.missing).toEqual(expect.arrayContaining(memberShort))
    expect(steering.balance?.inviteMore).toBe(steering.leansToward)
    expect(steering.balance?.inviteMore).toBe(memberShort[0])
  })

  it('does not report freshness before the goal', () => {
    expect(
      panelSteering({ members: 100, mix: members }).balance?.groupsNeedingFresh,
    ).toBeUndefined()
  })
})

describe('panelSteering', () => {
  it('leans nowhere below 30 members', () => {
    expect(
      panelSteering({
        members: 29,
        mix: mixOf([cell({ count: 29 })]),
      }),
    ).toMatchObject({
      balance: { status: 'tooFewMembers', inviteMore: null },
      weights: null,
      leansToward: null,
      doorTract: null,
      landlineFirst: true,
    })
  })

  it('leans nowhere when the census could not be read', () => {
    expect(panelSteering({ members: 100, mix: null })).toMatchObject({
      balance: null,
      coverage: null,
      weights: null,
      landlineFirst: true,
    })
  })

  it('weights each value by census over panel share, within 0.5 to 2', () => {
    // Everyone 35 to 44, so the other bands pool and draw at the most;
    // tracts A 85%, B 15%, C none.
    const steering = panelSteering({
      members: 100,
      mix: mixOf([
        cell({ count: 85, tract: A }),
        cell({ count: 15, tract: B }),
      ]),
    })
    expect(steering.weights?.age).toEqual({
      '18to24': 2,
      '25to34': 2,
      '35to44': 0.5,
      '45to54': 2,
      '55to64': 2,
      '65plus': 2,
    })
    expect(steering.weights?.tract[A]).toBeCloseTo(0.5 / 0.85)
    expect(steering.weights?.tract[B]).toBe(2)
    expect(steering.weights?.tract[C]).toBe(2)
    expect(steering.weights?.minWeight).toBe(0.5)
    expect(steering.weights?.maxWeight).toBe(2)
    // The largest group short of members, the one the balance names too.
    expect(steering.leansToward).toBe('age65plus')
    expect(steering.balance?.inviteMore).toBe(steering.leansToward)
    expect(steering.balance?.status).toBe('missingGroups')
    expect(steering.landlineFirst).toBe(true)
  })

  it('leans toward a race group the panel trails, never toward other', () => {
    const steering = panelSteering({
      members: 100,
      mix: raceMixOf([
        cell({ count: 50, tract: A, race: 'white' }),
        cell({ count: 5, tract: A, race: 'black' }),
        cell({ count: 15, tract: B, race: 'hispanic' }),
        cell({ count: 20, tract: B, race: 'white' }),
        cell({ count: 10, tract: C, race: 'white' }),
      ]),
    })
    expect(steering.weights?.race.black).toBe(2)
    expect(steering.weights?.race.white).toBeCloseTo(0.5 / 0.8)
    expect(steering.weights?.race.other).toBeUndefined()
    expect(steering.leansToward).toBe('black')
  })

  it('drops landline-first once the panel holds its share of people 65 and over', () => {
    const steering = panelSteering({
      members: 100,
      mix: mixOf([
        cell({ count: 45, tract: A }),
        cell({ count: 5, ageBand: '18to24', tract: A }),
        cell({ count: 40, ageBand: '65plus', tract: B }),
        cell({ count: 10, tract: C }),
      ]),
    })
    expect(steering.landlineFirst).toBe(false)
    // 18 to 24 holds 5% of members against 16% of adults.
    expect(steering.leansToward).toBe('age18to24')
  })
})
