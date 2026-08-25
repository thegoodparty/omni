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

  it('accepts a person-attributed refused (answered but refused to engage)', () => {
    const call = { entryId: 1, outcome: 'refused', personId: 'person-1' }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).not.toThrow()
  })

  it('accepts a bare refused with no personId (number-level fan-out)', () => {
    const call = { entryId: 1, outcome: 'refused' }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).not.toThrow()
  })

  it('rejects personId on a number-only outcome', () => {
    const call = {
      entryId: 1,
      outcome: 'wrong_number',
      personId: 'person-1',
    }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).toThrow(
      /personId is only valid when outcome is answered, refused, or hung_up/,
    )
  })

  it('accepts a bare disconnected with no personId (number-level fan-out)', () => {
    const call = { entryId: 1, outcome: 'disconnected' }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).not.toThrow()
  })

  it('rejects personId on disconnected', () => {
    const call = { entryId: 1, outcome: 'disconnected', personId: 'person-1' }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).toThrow(
      /personId is only valid when outcome is answered, refused, or hung_up/,
    )
  })

  it('accepts a person-attributed hung_up', () => {
    const call = { entryId: 1, outcome: 'hung_up', personId: 'person-1' }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).not.toThrow()
  })

  it('accepts a bare hung_up with no personId (number-level fan-out)', () => {
    const call = { entryId: 1, outcome: 'hung_up' }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).not.toThrow()
  })

  it('rejects supportAnswer on hung_up', () => {
    const call = {
      entryId: 1,
      outcome: 'hung_up',
      personId: 'person-1',
      supportAnswer: 'supporter',
    }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).toThrow(
      /supportAnswer is only valid when outcome is answered/,
    )
  })

  it('rejects supportAnswer on a person-attributed refused', () => {
    const call = {
      entryId: 1,
      outcome: 'refused',
      personId: 'person-1',
      supportAnswer: 'supporter',
    }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).toThrow(
      /supportAnswer is only valid when outcome is answered/,
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

  it('rejects markHouseholdDone when outcome is not answered', () => {
    const call = { entryId: 1, outcome: 'no_answer', markHouseholdDone: true }
    expect(() => RecordPhoneBankingCallSchema.parse(call)).toThrow(
      /markHouseholdDone is only valid when outcome is answered/,
    )
  })
})
