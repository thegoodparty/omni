import { describe, expect, it } from 'vitest'
import {
  CandidateEditSmsScriptRequestSchema,
  CandidateSmsTestRequestSchema,
} from './CandidateSms.schema'
import { P2P_SCRIPT_MAX_LENGTH } from './OutreachScript.const'

describe('CandidateSmsTestRequestSchema', () => {
  it('accepts one to five valid phones', () => {
    expect(
      CandidateSmsTestRequestSchema.safeParse({ phones: ['+15551234567'] })
        .success,
    ).toBe(true)
    expect(
      CandidateSmsTestRequestSchema.safeParse({
        phones: Array(5).fill('5551234567'),
      }).success,
    ).toBe(true)
  })

  it('rejects no phones and more than five', () => {
    expect(
      CandidateSmsTestRequestSchema.safeParse({ phones: [] }).success,
    ).toBe(false)
    expect(
      CandidateSmsTestRequestSchema.safeParse({
        phones: Array(6).fill('5551234567'),
      }).success,
    ).toBe(false)
  })

  it('rejects a 9-digit number', () => {
    expect(
      CandidateSmsTestRequestSchema.safeParse({ phones: ['555123456'] })
        .success,
    ).toBe(false)
  })
})

describe('CandidateEditSmsScriptRequestSchema', () => {
  it('rejects an empty script and one over the P2P cap', () => {
    expect(
      CandidateEditSmsScriptRequestSchema.safeParse({ script: '' }).success,
    ).toBe(false)
    expect(
      CandidateEditSmsScriptRequestSchema.safeParse({
        script: 'a'.repeat(P2P_SCRIPT_MAX_LENGTH + 1),
      }).success,
    ).toBe(false)
    expect(
      CandidateEditSmsScriptRequestSchema.safeParse({
        script: 'a'.repeat(P2P_SCRIPT_MAX_LENGTH),
      }).success,
    ).toBe(true)
  })
})
