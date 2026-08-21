import { describe, expect, it } from 'vitest'
import type {
  PhoneBankingList,
  PhoneBankingListEntry,
  PhoneBankingListPerson,
} from '@goodparty_org/contracts'
import {
  applyCallResults,
  buildRecordCallRequest,
  calledPeopleCount,
  draftFromInteraction,
  draftWithEngagement,
  draftWithOutcome,
  draftWithSupportAnswer,
  draftWithWillVote,
  engagementStatusFor,
  isDraftComplete,
  hasNoLiveEnrichment,
  isEntrySuppressed,
  outcomeCounts,
  totalPeopleCount,
} from './phoneBankingOutcome.util'

const makePerson = (
  overrides: Partial<PhoneBankingListPerson> = {},
): PhoneBankingListPerson => ({
  personId: 'p1',
  name: 'Jane Doe',
  age: 42,
  party: 'D',
  address: '1 Main St',
  cellPhone: '5551234567',
  landline: null,
  interaction: null,
  ...overrides,
})

const makeEntry = (
  overrides: Partial<PhoneBankingListEntry> = {},
): PhoneBankingListEntry => ({
  id: 1,
  seq: 1,
  sheetIndex: 1,
  phone: '5551234567',
  persons: [makePerson()],
  ...overrides,
})

const makeList = (entries: PhoneBankingListEntry[]): PhoneBankingList => ({
  id: 10,
  name: 'Test list',
  script: 'Hi, this is...',
  sheetCount: 1,
  purpose: 'introduce',
  createdAt: new Date('2026-01-01'),
  entries,
})

describe('totalPeopleCount / calledPeopleCount / outcomeCounts', () => {
  it('counts people, not entries', () => {
    const list = makeList([
      makeEntry({
        id: 1,
        persons: [makePerson({ personId: 'a' }), makePerson({ personId: 'b' })],
      }),
      makeEntry({ id: 2, persons: [makePerson({ personId: 'c' })] }),
    ])
    expect(totalPeopleCount(list)).toBe(3)
    expect(calledPeopleCount(list)).toBe(0)
  })

  it('a called person counts once toward calledPeopleCount and their outcome', () => {
    const list = makeList([
      makeEntry({
        persons: [
          makePerson({
            personId: 'a',
            interaction: {
              outcome: 'answered',
              supportAnswer: 'supporter',
              willVote: 'yes',
              occurredAt: new Date(),
            },
          }),
          makePerson({ personId: 'b' }),
        ],
      }),
    ])
    expect(calledPeopleCount(list)).toBe(1)
    expect(outcomeCounts(list).answered).toBe(1)
    expect(outcomeCounts(list).no_answer).toBe(0)
  })
})

describe('hasNoLiveEnrichment', () => {
  it('is true when every live leaf is null', () => {
    expect(
      hasNoLiveEnrichment(
        makePerson({
          age: null,
          party: null,
          address: null,
          cellPhone: null,
          landline: null,
        }),
      ),
    ).toBe(true)
  })

  it('is false when any live leaf is present', () => {
    expect(hasNoLiveEnrichment(makePerson({ age: 30 }))).toBe(false)
  })
})

describe('isEntrySuppressed', () => {
  it('is true once any person on the entry logged wrong_number', () => {
    const entry = makeEntry({
      persons: [
        makePerson({
          personId: 'a',
          interaction: {
            outcome: 'wrong_number',
            supportAnswer: null,
            willVote: null,
            occurredAt: new Date(),
          },
        }),
      ],
    })
    expect(isEntrySuppressed(entry)).toBe(true)
  })

  it('is false with no wrong_number interaction on the entry', () => {
    expect(isEntrySuppressed(makeEntry())).toBe(false)
  })
})

describe('engagementStatusFor', () => {
  it('maps answered to engaged and refused to refused', () => {
    expect(engagementStatusFor('answered')).toBe('engaged')
    expect(engagementStatusFor('refused')).toBe('refused')
  })

  it('is undefined for the other three outcomes', () => {
    expect(engagementStatusFor('no_answer')).toBeUndefined()
    expect(engagementStatusFor('voicemail')).toBeUndefined()
    expect(engagementStatusFor('wrong_number')).toBeUndefined()
  })
})

describe('cascade state machine (draftWith*)', () => {
  it('changing the outcome clears support and will-vote', () => {
    const draft = draftWithWillVote(
      draftWithSupportAnswer(draftWithOutcome({}, 'answered'), 'supporter'),
      'yes',
    )
    expect(draft).toEqual({
      outcome: 'answered',
      supportAnswer: 'supporter',
      willVote: 'yes',
    })

    const changed = draftWithOutcome(draft, 'no_answer')
    expect(changed).toEqual({
      outcome: 'no_answer',
      supportAnswer: undefined,
      willVote: undefined,
    })
  })

  it('re-selecting the same outcome is a no-op (keeps support/will-vote)', () => {
    const draft = draftWithSupportAnswer(
      draftWithOutcome({}, 'answered'),
      'supporter',
    )
    expect(draftWithOutcome(draft, 'answered')).toBe(draft)
  })

  it('changing the support answer does not clear will-vote', () => {
    const draft = draftWithWillVote(
      draftWithSupportAnswer(draftWithOutcome({}, 'answered'), 'supporter'),
      'yes',
    )
    const changed = draftWithSupportAnswer(draft, 'non_supporter')
    expect(changed.willVote).toBe('yes')
  })

  it('changing the engagement clears support and will-vote; re-selecting is a no-op', () => {
    const draft = draftWithWillVote(
      draftWithSupportAnswer(
        draftWithEngagement(draftWithOutcome({}, 'answered'), 'engaged'),
        'supporter',
      ),
      'yes',
    )
    expect(draftWithEngagement(draft, 'engaged')).toBe(draft)

    const changed = draftWithEngagement(draft, 'refused')
    expect(changed).toEqual({ outcome: 'answered', engagement: 'refused' })
  })

  it('draftFromInteraction seeds from a logged interaction, and empty from none', () => {
    expect(draftFromInteraction(null)).toEqual({})
    expect(
      draftFromInteraction({
        outcome: 'answered',
        supportAnswer: 'supporter',
        willVote: 'unsure',
        occurredAt: new Date(),
      }),
    ).toEqual({
      outcome: 'answered',
      engagement: 'engaged',
      supportAnswer: 'supporter',
      willVote: 'unsure',
    })
  })

  it('a bare answered row (household fill) reopens with the engage question unanswered', () => {
    expect(
      draftFromInteraction({
        outcome: 'answered',
        supportAnswer: null,
        willVote: null,
        occurredAt: new Date(),
      }),
    ).toEqual({ outcome: 'answered' })
  })

  it('a persisted refused reopens as answered + engage Refused so an unchanged re-save stays person-attributed', () => {
    const draft = draftFromInteraction({
      outcome: 'refused',
      supportAnswer: null,
      willVote: null,
      occurredAt: new Date(),
    })
    expect(draft).toEqual({ outcome: 'answered', engagement: 'refused' })
    expect(buildRecordCallRequest(5, draft, 'active-person', false)).toEqual({
      entryId: 5,
      outcome: 'refused',
      personId: 'active-person',
    })
  })
})

describe('isDraftComplete (terminal states that reveal Save/Cancel)', () => {
  it('is false with no outcome and true for any non-answered outcome', () => {
    expect(isDraftComplete({})).toBe(false)
    expect(isDraftComplete({ outcome: 'no_answer' })).toBe(true)
    expect(isDraftComplete({ outcome: 'refused' })).toBe(true)
  })

  it('answered is incomplete until the whole engaged cascade is answered', () => {
    expect(isDraftComplete({ outcome: 'answered' })).toBe(false)
    expect(
      isDraftComplete({ outcome: 'answered', engagement: 'engaged' }),
    ).toBe(false)
    expect(
      isDraftComplete({
        outcome: 'answered',
        engagement: 'engaged',
        supportAnswer: 'supporter',
      }),
    ).toBe(false)
    expect(
      isDraftComplete({
        outcome: 'answered',
        engagement: 'engaged',
        supportAnswer: 'supporter',
        willVote: 'yes',
      }),
    ).toBe(true)
  })

  it('answered + engage refused is terminal on its own', () => {
    expect(
      isDraftComplete({ outcome: 'answered', engagement: 'refused' }),
    ).toBe(true)
  })
})

describe('buildRecordCallRequest', () => {
  it('an answered call carries the active tab personId and no household flag by default', () => {
    const request = buildRecordCallRequest(
      5,
      { outcome: 'answered', supportAnswer: 'supporter', willVote: 'yes' },
      'active-person',
      false,
    )
    expect(request).toEqual({
      entryId: 5,
      outcome: 'answered',
      personId: 'active-person',
      supportAnswer: 'supporter',
      willVote: 'yes',
    })
    expect(request).not.toHaveProperty('markHouseholdDone')
  })

  it('markHouseholdDone rides the same request only when true', () => {
    const request = buildRecordCallRequest(
      5,
      { outcome: 'answered' },
      'active-person',
      true,
    )
    expect(request).toMatchObject({ markHouseholdDone: true })
  })

  it('a number-level outcome carries no personId, supportAnswer, or willVote', () => {
    const request = buildRecordCallRequest(
      5,
      { outcome: 'no_answer' },
      'active-person',
      false,
    )
    expect(request).toEqual({ entryId: 5, outcome: 'no_answer' })
  })

  it('answered + engage refused posts a person-attributed refused with no cascade fields', () => {
    const request = buildRecordCallRequest(
      5,
      { outcome: 'answered', engagement: 'refused' },
      'active-person',
      false,
    )
    expect(request).toEqual({
      entryId: 5,
      outcome: 'refused',
      personId: 'active-person',
    })
  })

  it('a top-level refused stays number-level (no personId)', () => {
    const request = buildRecordCallRequest(
      5,
      { outcome: 'refused' },
      'active-person',
      false,
    )
    expect(request).toEqual({ entryId: 5, outcome: 'refused' })
  })

  it('throws when saving with no outcome selected', () => {
    expect(() =>
      buildRecordCallRequest(5, {}, 'active-person', false),
    ).toThrow()
  })
})

describe('applyCallResults (fan-out rendering)', () => {
  it('a no_answer response marks every person on the entry', () => {
    const list = makeList([
      makeEntry({
        id: 1,
        persons: [makePerson({ personId: 'a' }), makePerson({ personId: 'b' })],
      }),
    ])
    const occurredAt = new Date()
    const patched = applyCallResults(list, [
      {
        personId: 'a',
        interaction: {
          outcome: 'no_answer',
          supportAnswer: null,
          willVote: null,
          occurredAt,
        },
      },
      {
        personId: 'b',
        interaction: {
          outcome: 'no_answer',
          supportAnswer: null,
          willVote: null,
          occurredAt,
        },
      },
    ])
    expect(
      patched.entries[0]?.persons.every(
        (person) => person.interaction?.outcome === 'no_answer',
      ),
    ).toBe(true)
  })

  it('leaves persons not present in results untouched', () => {
    const list = makeList([
      makeEntry({
        id: 1,
        persons: [makePerson({ personId: 'a' }), makePerson({ personId: 'b' })],
      }),
    ])
    const patched = applyCallResults(list, [
      {
        personId: 'a',
        interaction: {
          outcome: 'voicemail',
          supportAnswer: null,
          willVote: null,
          occurredAt: new Date(),
        },
      },
    ])
    expect(patched.entries[0]?.persons[1]?.interaction).toBeNull()
  })
})
