import { describe, expect, it } from 'vitest'
import {
  DOOR_KNOCK_STATUSES,
  DoorKnockStatus,
  RoutePayloadTarget,
  RouteTargetActivity,
} from '@goodparty_org/contracts'
import { supportAsOf, supportStatus } from './supportPresentation'

const target = (history?: RouteTargetActivity[]): RoutePayloadTarget => ({
  stopTargetId: 21,
  personId: 'person-1',
  name: 'Dorian Fen',
  age: 31,
  politicalParty: 'Independent',
  cellPhone: null,
  landline: null,
  knockStatus: 'supporter',
  mayHaveMoved: false,
  doNotKnock: false,
  ...(history ? { history } : {}),
})

const knock = (
  date: string,
  supportAnswer: 'supporter' | 'unsure' | 'non_supporter' | null,
): RouteTargetActivity => ({
  type: 'DOOR_KNOCK',
  date,
  data: {
    activityId: `dk-${date}`,
    outcome: 'answered',
    supportAnswer,
    note: null,
    manual: false,
  },
})

const override = (date: string, toLabel: string): RouteTargetActivity => ({
  type: 'STATUS_CHANGE',
  date,
  data: {
    activityId: `se-${date}`,
    field: 'support_status',
    fromLabel: null,
    toLabel,
    actorName: 'Rosa Iyer',
    actorUserId: 77,
    source: 'manual',
  },
})

const text = (date: string): RouteTargetActivity => ({
  type: 'TEXT',
  date,
  data: {
    activityId: `tx-${date}`,
    respondedAt: null,
    optedOutAt: null,
    note: null,
    manual: false,
    outreachId: null,
  },
})

// The whole vocabulary, swept — a status added to `DOOR_KNOCK_STATUSES` without
// a decision here fails this rather than quietly reading as a support level or
// quietly disappearing.
describe('supportStatus', () => {
  const SUPPORT: DoorKnockStatus[] = ['supporter', 'non_supporter']

  it.each(DOOR_KNOCK_STATUSES)(
    'answers for %s only when the status is a stance',
    (status) => {
      expect(supportStatus(status)).toBe(
        SUPPORT.includes(status) ? status : null,
      )
    },
  )

  // Named individually because these are the two that look like support and
  // are not: `unknown` covers never-knocked as well as an explicit `unsure`,
  // and `refused` is the same status whether it came from a CRM support
  // override or from a door that refused to engage.
  it('declines the two statuses that look like support and are not', () => {
    expect(supportStatus('unknown')).toBeNull()
    expect(supportStatus('refused')).toBeNull()
  })
})

describe('supportAsOf', () => {
  it('reads the month off the knock that gave the answer', () => {
    expect(
      supportAsOf(
        target([knock('2026-08-10T15:00:00.000Z', 'supporter')]),
        'supporter',
      ),
    ).toBe('August 2026')
  })

  it('reads it off a support-status override, which outranks the history', () => {
    expect(
      supportAsOf(
        target([
          override('2026-08-11T15:00:00.000Z', 'Supporter'),
          knock('2026-06-02T15:00:00.000Z', 'non_supporter'),
        ]),
        'supporter',
      ),
    ).toBe('August 2026')
  })

  // The newest support-bearing row is the only one that may date the card. An
  // older row that agrees is a superseded answer, and dating a stance to it
  // would put a June date under an August fact.
  it('stays silent when the newest support answer disagrees with the status', () => {
    expect(
      supportAsOf(
        target([
          knock('2026-08-12T15:00:00.000Z', 'non_supporter'),
          knock('2026-06-02T15:00:00.000Z', 'supporter'),
        ]),
        'supporter',
      ),
    ).toBeNull()
    expect(
      supportAsOf(
        target([override('2026-08-12T15:00:00.000Z', 'Undecided')]),
        'supporter',
      ),
    ).toBeNull()
  })

  // Rows that say nothing about support are read past rather than treated as
  // disagreement: a text sent last week does not supersede what someone said at
  // the door in June.
  it('reads past rows that say nothing about support', () => {
    expect(
      supportAsOf(
        target([
          text('2026-08-20T15:00:00.000Z'),
          knock('2026-08-19T15:00:00.000Z', null),
          knock('2026-06-02T15:00:00.000Z', 'supporter'),
        ]),
        'supporter',
      ),
    ).toBe('June 2026')
  })

  // Both silences that are facts about the payload rather than about the
  // person: history capped past the answering row (ADR 0009), and a route the
  // service worker snapshotted before history rode it at all.
  it('stays silent when the history cannot date the answer', () => {
    expect(
      supportAsOf(target([text('2026-08-20T15:00:00.000Z')]), 'supporter'),
    ).toBeNull()
    expect(supportAsOf(target([]), 'supporter')).toBeNull()
    expect(supportAsOf(target(), 'supporter')).toBeNull()
  })

  it('stays silent on a date it cannot parse', () => {
    expect(
      supportAsOf(target([knock('not a date', 'supporter')]), 'supporter'),
    ).toBeNull()
  })
})
