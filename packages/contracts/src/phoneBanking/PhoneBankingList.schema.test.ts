import { describe, expect, it } from 'vitest'
import {
  PhoneBankingListSchema,
  PhoneBankingOutreachDetailSchema,
} from './PhoneBankingList.schema'

const person = {
  personId: 'person-1',
  name: 'Marisol Vega',
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
      purpose: 'persuade',
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
    }
    expect(() => PhoneBankingListSchema.parse(list)).not.toThrow()
  })

  it('accepts a logged interaction with a nullable supportAnswer/willVote', () => {
    const list = {
      id: 1,
      name: 'GOTV week 1',
      script: 'Hi, this is a volunteer...',
      sheetCount: 1,
      purpose: 'persuade',
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
                occurredAt: '2026-08-20T12:05:00Z',
              },
            },
          ],
        },
      ],
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
      byOutcome: {
        answered: 2,
        no_answer: 1,
        voicemail: 1,
        wrong_number: 0,
        refused: 0,
      },
      supporters: 1,
    }
    expect(() => PhoneBankingOutreachDetailSchema.parse(detail)).not.toThrow()
  })

  it('rejects byOutcome missing an outcome key', () => {
    const detail = {
      listId: 1,
      entriesTotal: 10,
      entriesCalled: 4,
      byOutcome: { answered: 2 },
      supporters: 1,
    }
    expect(() => PhoneBankingOutreachDetailSchema.parse(detail)).toThrow()
  })
})
