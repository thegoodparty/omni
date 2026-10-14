import { describe, expect, it } from 'vitest'
import { outreachLandingStep } from './landingStep'

describe('outreachLandingStep', () => {
  it('lands on the message when the audience and the message are settled', () => {
    expect(
      outreachLandingStep({
        purposeSettled: false,
        audienceSettled: true,
        messageSettled: true,
      }),
    ).toBe('message')
    expect(
      outreachLandingStep({
        purposeSettled: true,
        audienceSettled: true,
        messageSettled: true,
      }),
    ).toBe('message')
  })

  it('lands on the audience when the message is settled but who gets it is not', () => {
    expect(
      outreachLandingStep({
        purposeSettled: false,
        audienceSettled: false,
        messageSettled: true,
      }),
    ).toBe('audience')
  })

  it('lands on the audience when only the purpose is settled', () => {
    expect(
      outreachLandingStep({
        purposeSettled: true,
        audienceSettled: false,
        messageSettled: false,
      }),
    ).toBe('audience')
    expect(
      outreachLandingStep({
        purposeSettled: true,
        audienceSettled: true,
        messageSettled: false,
      }),
    ).toBe('audience')
  })

  it('lands on the purpose when the entry settled nothing to write from', () => {
    expect(
      outreachLandingStep({
        purposeSettled: false,
        audienceSettled: false,
        messageSettled: false,
      }),
    ).toBe('purpose')
    expect(
      outreachLandingStep({
        purposeSettled: false,
        audienceSettled: true,
        messageSettled: false,
      }),
    ).toBe('purpose')
  })
})
