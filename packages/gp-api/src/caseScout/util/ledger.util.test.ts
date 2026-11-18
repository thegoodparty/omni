import { parseISO, subDays } from 'date-fns'
import { describe, expect, it } from 'vitest'
import { nightlyCapForMergeShare, trailingMergeShare } from './cap.util'
import {
  findDuplicate,
  findRejection,
  monthKeysCovering,
  parseLedgerText,
  recentProposalsForAgent,
  type LedgerEntry,
} from './ledger.util'

const NOW = parseISO('2026-11-16T09:17:00.000Z')

const entry = (overrides: Partial<LedgerEntry>): LedgerEntry => ({
  runId: '2026-11-10',
  conversationId: 'conv',
  agentId: 'chief_of_staff',
  outcome: 'proposed',
  caseId: 'a-case',
  failureSummary: 'States A Number',
  createdAt: subDays(NOW, 5),
  closedAt: undefined,
  ...overrides,
})

describe('parseLedgerText', () => {
  it('skips lines missing a required field or not JSON at all', () => {
    const text = [
      JSON.stringify({ conversationId: 'c', agentId: 'a', outcome: 'p' }),
      JSON.stringify({ conversationId: 'c', agentId: null, outcome: 'p' }),
      'not json',
      '',
    ].join('\n')
    expect(parseLedgerText(text)).toHaveLength(1)
  })

  it('tolerates an unreadable timestamp', () => {
    const [parsed] = parseLedgerText(
      JSON.stringify({
        conversationId: 'c',
        agentId: 'a',
        outcome: 'p',
        createdAt: 'yesterday',
      }),
    )
    expect(parsed?.createdAt).toBeUndefined()
  })
})

describe('findDuplicate', () => {
  it('matches a recent proposal by conversation, agent and summary', () => {
    expect(
      findDuplicate(
        [entry({})],
        'conv',
        'chief_of_staff',
        ' states a  number',
        NOW,
      ),
    ).toBeDefined()
  })

  it('ignores a proposal past 30 days, another outcome or summary', () => {
    const entries = [
      entry({ createdAt: subDays(NOW, 31) }),
      entry({ outcome: 'gated' }),
    ]
    expect(
      findDuplicate(entries, 'conv', 'chief_of_staff', 'states a number', NOW),
    ).toBeUndefined()
    expect(
      findDuplicate([entry({})], 'conv', 'chief_of_staff', 'other', NOW),
    ).toBeUndefined()
  })
})

describe('findRejection', () => {
  it('suppresses for 30 days from closure', () => {
    const rejected = (days: number) =>
      entry({ outcome: 'rejected', closedAt: subDays(NOW, days) })
    const find = (e: LedgerEntry) =>
      findRejection([e], 'conv', 'chief_of_staff', 'states a number', NOW)
    expect(find(rejected(10))).toBeDefined()
    expect(find(rejected(31))).toBeUndefined()
  })
})

describe('recentProposalsForAgent', () => {
  it('lists the agent proposals in the window, newest first', () => {
    const older = entry({ caseId: 'older', createdAt: subDays(NOW, 9) })
    const newer = entry({ caseId: 'newer', createdAt: subDays(NOW, 1) })
    const other = entry({ caseId: 'other', agentId: 'priority_flow' })
    expect(
      recentProposalsForAgent([older, other, newer], 'chief_of_staff', NOW).map(
        (e) => e.caseId,
      ),
    ).toEqual(['newer', 'older'])
  })
})

describe('monthKeysCovering', () => {
  it('returns one key inside a month and two across a boundary', () => {
    expect(monthKeysCovering(parseISO('2026-11-30T00:00:00Z'), 10)).toEqual([
      '2026-11',
    ])
    expect(monthKeysCovering(NOW, 30)).toEqual(['2026-10', '2026-11'])
  })
})

describe('the nightly cap', () => {
  it('keeps 3 without enough proposals to read a trend', () => {
    expect(trailingMergeShare([entry({}), entry({})], NOW)).toBeUndefined()
    expect(nightlyCapForMergeShare(undefined)).toBe(3)
  })

  it('moves with the merge share', () => {
    expect(nightlyCapForMergeShare(0.7)).toBe(5)
    expect(nightlyCapForMergeShare(0.5)).toBe(3)
    expect(nightlyCapForMergeShare(0.39)).toBe(2)
    expect(nightlyCapForMergeShare(0.1)).toBe(1)
  })

  it('counts a ruling recorded after the proposal window', () => {
    const proposals = ['a', 'b', 'c'].map((caseId) => entry({ caseId }))
    const merged = entry({ caseId: 'a', outcome: 'merged', createdAt: NOW })
    const rejected = ['b', 'c'].map((caseId) =>
      entry({ caseId, outcome: 'rejected', createdAt: NOW }),
    )
    const outside = entry({ caseId: 'd', createdAt: subDays(NOW, 20) })
    expect(
      trailingMergeShare([...proposals, merged, ...rejected, outside], NOW),
    ).toBeCloseTo(1 / 3)
  })

  it('leaves out proposals nobody has ruled on', () => {
    const unruled = ['a', 'b', 'c', 'd'].map((caseId) => entry({ caseId }))
    expect(trailingMergeShare(unruled, NOW)).toBeUndefined()

    const ruled = ['e', 'f', 'g'].map((caseId) => entry({ caseId }))
    const outcomes = [
      entry({ caseId: 'e', outcome: 'merged' }),
      entry({ caseId: 'f', outcome: 'merged' }),
      entry({ caseId: 'g', outcome: 'rejected' }),
    ]
    expect(
      trailingMergeShare([...unruled, ...ruled, ...outcomes], NOW),
    ).toBeCloseTo(2 / 3)
  })
})
