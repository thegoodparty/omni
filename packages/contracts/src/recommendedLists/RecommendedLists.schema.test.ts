import { describe, it, expect } from 'vitest'
import {
  RecommendedListsResponseSchema,
  RecommendedListsSchema,
  type RecommendedLists,
} from './RecommendedLists.schema'

const lists: RecommendedLists = {
  meta: {
    officeName: 'County Commissioner District 5',
    state: 'MN',
    districtType: 'County_Commissioner_District',
    districtName: 'SCOTT CNTY COMM DIST 5',
    districtLabel: 'SCOTT CNTY COMM DIST 5, MN',
    registeredVoters: 41230,
    projectedTurnout: 18400,
    votesNeeded: 9201,
    electionCode: 'General',
    electionDate: '2026-11-03',
    subGeoLabel: 'municipalities',
    doorRatio: 0.62,
  },
  lists: [
    {
      kind: 'voterSupportId',
      name: 'Candidate Intro & Voter Support ID',
      priority: 1,
      allowedOutreachTypes: ['doorKnocking'],
      allowedPhases: ['earlyCampaign', 'midCampaign'],
      details: {
        votescoreThreshold: 3,
        voterCount: 18500,
        doorCount: 11470,
        estimatedHours: 764.7,
        turfs: [
          { area: 'SHAKOPEE', voterCount: 7200 },
          { area: 'PRIOR LAKE', voterCount: 5100 },
        ],
      },
    },
    {
      kind: 'issueAligned',
      name: 'Voters who lean toward Protecting local water quality',
      priority: 2,
      allowedOutreachTypes: ['doorKnocking', 'phone', 'email', 'directMail'],
      allowedPhases: ['midCampaign'],
      details: {
        phrase: 'Protecting local water quality',
        opponentName: 'Jane Doe',
        threatTier: 'high',
        activeVoters: 30500,
        supporters: 12000,
        opponents: 4000,
        persuadable: 14500,
        supportersPlausible: 8000,
      },
    },
    {
      kind: 'partisanAligned',
      name: 'Partisanship-Aligned Voters',
      priority: 3,
      allowedOutreachTypes: ['doorKnocking', 'phone', 'email', 'directMail'],
      allowedPhases: ['midCampaign'],
      details: {
        shape: 'P4',
        isPartisanRace: true,
        hasDemOpponent: true,
        hasGopOpponent: false,
        targetParties: 'Republicans and Independents',
        cardSubtitle:
          'Moderate-to-high propensity voters who are registered Independents ' +
          'or Republicans, and voters showing signs of independence.',
        signals: {
          partySwitchers: 900,
          ticketSplitters: 1200,
          crossoverPrimary: 700,
          doubleDislike: 1500,
          modeledIndependents: 3400,
          registrationAddOn: 2100,
        },
        districtTotal: 41230,
        unionCount: 8200,
        plausibleElectorateCount: 18500,
        listCount: 5600,
        turfs: [{ area: 'SAVAGE', voterCount: 2100 }],
      },
    },
    {
      kind: 'gotv',
      name: 'Get Out The Vote',
      priority: 4,
      allowedOutreachTypes: ['doorKnocking', 'phone', 'robocall', 'email'],
      allowedPhases: ['gotvPhase'],
      details: {
        dropoffX: 4200,
        exponentA: 0.79,
      },
    },
  ],
}

const readyPayload = {
  status: 'ready' as const,
  computedAt: '2026-07-23T12:00:00.000Z',
  lists,
}

describe('RecommendedListsSchema', () => {
  it('parses a full ready lists payload of ordered envelopes', () => {
    const parsed = RecommendedListsSchema.parse(lists)
    expect(parsed.meta.electionCode).toBe('General')
    expect(parsed.lists.map((l) => l.kind)).toEqual([
      'voterSupportId',
      'issueAligned',
      'partisanAligned',
      'gotv',
    ])
    const anchor = parsed.lists.find((l) => l.kind === 'voterSupportId')
    if (anchor?.kind === 'voterSupportId') {
      expect(anchor.details.turfs).toHaveLength(2)
    }
    const gotv = parsed.lists.find((l) => l.kind === 'gotv')
    if (gotv?.kind === 'gotv') {
      expect(gotv.details.exponentA).toBe(0.79)
    }
  })

  it('accepts a payload without a partisan-aligned envelope', () => {
    const withoutPartisan = {
      ...lists,
      lists: lists.lists.filter((l) => l.kind !== 'partisanAligned'),
    }
    const parsed = RecommendedListsSchema.parse(withoutPartisan)
    expect(parsed.lists.some((l) => l.kind === 'partisanAligned')).toBe(false)
  })

  it('rejects an envelope with an unknown kind', () => {
    const bad = {
      ...lists,
      lists: [...lists.lists, { ...lists.lists[0], kind: 'mysteryList' }],
    }
    expect(RecommendedListsSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an envelope with no allowed outreach types', () => {
    const [anchor, ...rest] = lists.lists
    const bad = {
      ...lists,
      lists: [{ ...anchor, allowedOutreachTypes: [] }, ...rest],
    }
    expect(RecommendedListsSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a gotv envelope whose details omit exponentA', () => {
    const bad = {
      ...lists,
      lists: lists.lists.map((l) =>
        l.kind === 'gotv' ? { ...l, details: { dropoffX: 4200 } } : l,
      ),
    }
    expect(RecommendedListsSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an invalid electionCode', () => {
    const bad = { ...lists, meta: { ...lists.meta, electionCode: 'Runoff' } }
    expect(RecommendedListsSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a negative turf voterCount', () => {
    const [anchor, ...rest] = lists.lists
    const bad = {
      ...lists,
      lists: [
        { ...anchor, details: { turfs: [{ area: 'X', voterCount: -1 }] } },
        ...rest,
      ],
    }
    expect(RecommendedListsSchema.safeParse(bad).success).toBe(false)
  })
})

describe('RecommendedListsResponseSchema', () => {
  it('parses the ready variant with computedAt and lists', () => {
    const parsed = RecommendedListsResponseSchema.parse(readyPayload)
    expect(parsed.status).toBe('ready')
    if (parsed.status === 'ready') {
      expect(parsed.computedAt).toBe('2026-07-23T12:00:00.000Z')
      expect(parsed.lists.meta.state).toBe('MN')
    }
  })

  it.each(['pending', 'failed', 'unavailable'] as const)(
    'parses the %s status variant',
    (status) => {
      const parsed = RecommendedListsResponseSchema.parse({ status })
      expect(parsed.status).toBe(status)
    },
  )

  it('rejects an unknown status', () => {
    expect(
      RecommendedListsResponseSchema.safeParse({ status: 'computing' }).success,
    ).toBe(false)
  })

  it('rejects a ready variant missing computedAt', () => {
    expect(
      RecommendedListsResponseSchema.safeParse({ status: 'ready', lists })
        .success,
    ).toBe(false)
  })

  it('never leaks a Haystaq hs_ identifier into the candidate-facing payload', () => {
    expect(JSON.stringify(readyPayload)).not.toContain('hs_')
  })
})
