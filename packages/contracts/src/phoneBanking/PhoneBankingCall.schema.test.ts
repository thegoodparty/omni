import { describe, expect, it } from 'vitest'
import { RecordPhoneBankingCallSchema } from './PhoneBankingCall.schema'

describe('RecordPhoneBankingCallSchema', () => {
  it('accepts a bare no_answer with no personId', () => {
    const call = { entryId: 1, outcome: 'no_answer' }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).not.toThrow()
  })

  it('accepts an answered call with personId, supportAnswer, and willVote', () => {
    const call = {
      entryId: 1,
      outcome: 'answered',
      personId: 'person-1',
      supportAnswer: 'supporter',
      willVote: 'yes',
    }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).not.toThrow()
  })

  it('rejects supportAnswer when outcome is not answered', () => {
    const call = {
      entryId: 1,
      outcome: 'no_answer',
      supportAnswer: 'supporter',
    }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).toThrow(
      /supportAnswer is only valid when outcome is answered/,
    )
  })

  it('rejects willVote when outcome is not answered', () => {
    const call = { entryId: 1, outcome: 'voicemail', willVote: 'yes' }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).toThrow(
      /willVote is only valid when outcome is answered/,
    )
  })

  it('rejects an answered call with no personId', () => {
    const call = { entryId: 1, outcome: 'answered' }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).toThrow(
      /personId is required when outcome is answered/,
    )
  })

  it('rejects personId on a non-answered outcome', () => {
    const call = {
      entryId: 1,
      outcome: 'wrong_number',
      personId: 'person-1',
    }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).toThrow(
      /personId is only valid when outcome is answered/,
    )
  })

  it('accepts markHouseholdDone alongside an answered call', () => {
    const call = {
      entryId: 1,
      outcome: 'answered',
      personId: 'person-1',
      markHouseholdDone: true,
    }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).not.toThrow()
  })
})
