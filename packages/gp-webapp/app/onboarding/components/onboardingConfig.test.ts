import { describe, expect, it } from 'vitest'
import { ONBOARDING_STEPS } from './onboardingConfig'
import type { ManualOfficeForm, OnboardingAnswers } from './onboardingTypes'

const manualOfficeStep = ONBOARDING_STEPS.find(
  (step) => step.id === 'manual-office-entry',
)!

const validForm: ManualOfficeForm = {
  office: 'Mayor',
  level: 'LOCAL',
  state: 'CA',
  city: 'Springfield',
  district: '',
  officeTermLength: '4 years',
  electionDate: '2099-01-01',
}

const isValid = (form: ManualOfficeForm): boolean =>
  manualOfficeStep.isValid!({
    answers: { manualOfficeForm: form } as OnboardingAnswers,
  })

describe('manual-office-entry isValid', () => {
  it('passes a complete form with a BallotReadyPositionLevel value', () => {
    expect(isValid(validForm)).toBe(true)
  })

  it('blocks Continue while no office level is selected', () => {
    // An unset level would persist a campaign without details.ballotLevel,
    // which downstream 10DLC compliance silently treats as local (ENG-11043).
    expect(isValid({ ...validForm, level: '' })).toBe(false)
  })

  it('rejects a level that is not a BallotReadyPositionLevel enum value', () => {
    // details.ballotLevel is enum-validated server-side — a UI label like
    // 'Federal' would 400 the whole campaign update.
    expect(isValid({ ...validForm, level: 'Federal' })).toBe(false)
  })
})
