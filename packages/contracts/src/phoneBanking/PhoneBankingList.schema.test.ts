import { describe, expect, it } from 'vitest'
import {
  PhoneBankingListSchema,
  PhoneBankingOutreachDetailSchema,
} from './PhoneBankingList.schema'

const person = {
  personId: 'person-1',
  name: 'Marisol Vega',
  firstName: null,
  age: null,
  party: null,
  address: null,
  cellPhone: null,
  landline: null,
  interaction: null,
}

describe('PhoneBankingListSchema', () => {
  it('accepts a list whose live-enrichment leaves are all null', () => {
    const list = {
      id: 1,
      name: 'GOTV week 1',
      script: 'Hi, this is a volunteer...',
      sheetCount: 1,
      purpose: 'persuade_voters',
      createdAt: '2026-08-20T12:00:00Z',
      entries: [
        {
          id: 1,
          seq: 1,
          sheetIndex: 0,
          phone: '+15555550100',
          persons: [person],
        },
      ],
      isServe: false,
    }
    expect(() => PhoneBankingListSchema.parse(list)).not.toThrow()
  })

  it('accepts a logged interaction with nullable answer fields', () => {
    const list = {
      id: 1,
      name: 'GOTV week 1',
      script: 'Hi, this is a volunteer...',
      sheetCount: 1,
      purpose: 'persuade_voters',
      createdAt: '2026-08-20T12:00:00Z',
      entries: [
        {
          id: 1,
          seq: 1,
          sheetIndex: 0,
          phone: '+15555550100',
          persons: [
            {
              ...person,
              interaction: {
                outcome: 'answered',
                supportAnswer: null,
                willVote: null,
                followUp: null,
                occurredAt: '2026-08-20T12:05:00Z',
              },
            },
          ],
        },
      ],
      isServe: true,
    }
    expect(() => PhoneBankingListSchema.parse(list)).not.toThrow()
  })
})

describe('PhoneBankingOutreachDetailSchema', () => {
  it('requires every outcome key in byOutcome', () => {
    const detail = {
      listId: 1,
      entriesTotal: 10,
      entriesCalled: 4,
      peopleTotal: 16,
      peopleCalled: 6,
      byOutcome: {
        answered: 2,
        no_answer: 1,
        voicemail: 1,
        wrong_number: 0,
        refused: 0,
        disconnected: 0,
        hung_up: 0,
      },
      supporters: 1,
      unsure: 0,
      nonSupporters: 0,
      byFollowUp: { yes: 0, no: 0 },
    }
    expect(() => PhoneBankingOutreachDetailSchema.parse(detail)).not.toThrow()
  })

  it('rejects byOutcome missing an outcome key', () => {
    const detail = {
      listId: 1,
      entriesTotal: 10,
      entriesCalled: 4,
      peopleTotal: 16,
      peopleCalled: 6,
      byOutcome: { answered: 2 },
      supporters: 1,
    }
    expect(() => PhoneBankingOutreachDetailSchema.parse(detail)).toThrow()
  })

  // The drawer reads `byFollowUp.yes` / `.no` directly, so the contract has to
  // be what guarantees both are there — a record over the enum enforces every
  // key at parse time, the same way byOutcome above does, rather than leaving
  // the producer's discipline as the only thing standing behind the read.
  it('requires both follow-up keys, not just one', () => {
    const detail = {
      listId: 1,
      entriesTotal: 10,
      entriesCalled: 4,
      peopleTotal: 16,
      peopleCalled: 6,
      byOutcome: {
        answered: 2,
        no_answer: 1,
        voicemail: 1,
        wrong_number: 0,
        refused: 0,
        disconnected: 0,
        hung_up: 0,
      },
      supporters: 0,
      unsure: 0,
      nonSupporters: 0,
    }

    expect(() =>
      PhoneBankingOutreachDetailSchema.parse({
        ...detail,
        byFollowUp: { yes: 1, no: 2 },
      }),
    ).not.toThrow()
    for (const byFollowUp of [{ yes: 1 }, { no: 2 }, {}]) {
      expect(() =>
        PhoneBankingOutreachDetailSchema.parse({ ...detail, byFollowUp }),
      ).toThrow()
    }
  })
})
