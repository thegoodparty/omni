import { describe, it, expect } from 'vitest'
import { computeServeResumeStep } from './serveOnboardingConfig'

describe('computeServeResumeStep', () => {
  describe('un-started leads run the full intro', () => {
    it('starts a fresh net-new user at welcome', () => {
      expect(
        computeServeResumeStep('net-new', {
          hasParty: false,
          hasOffice: false,
          hasDates: false,
        }),
      ).toBe('welcome')
    })

    it('starts a prefilled-but-un-started lead at welcome (prefill is not user progress)', () => {
      expect(
        computeServeResumeStep('prefill', {
          hasParty: false,
          hasOffice: true,
          hasDates: true,
        }),
      ).toBe('welcome')
    })
  })

  describe('net-new branch resumes at the first unanswered step', () => {
    it('resumes at office once party is answered', () => {
      expect(
        computeServeResumeStep('net-new', {
          hasParty: true,
          hasOffice: false,
          hasDates: false,
        }),
      ).toBe('office')
    })

    it('resumes at term-dates once party and office are answered', () => {
      expect(
        computeServeResumeStep('net-new', {
          hasParty: true,
          hasOffice: true,
          hasDates: false,
        }),
      ).toBe('term-dates')
    })

    it('resumes at constituents once all data is answered', () => {
      expect(
        computeServeResumeStep('net-new', {
          hasParty: true,
          hasOffice: true,
          hasDates: true,
        }),
      ).toBe('constituents')
    })
  })

  describe('prefill branch reviews office/dates on the confirm hub', () => {
    it('resumes at confirm when party is answered but the office/dates pair is incomplete', () => {
      expect(
        computeServeResumeStep('prefill', {
          hasParty: true,
          hasOffice: true,
          hasDates: false,
        }),
      ).toBe('confirm')
      expect(
        computeServeResumeStep('prefill', {
          hasParty: true,
          hasOffice: false,
          hasDates: true,
        }),
      ).toBe('confirm')
    })

    it('resumes at constituents once party, office, and dates are all set', () => {
      expect(
        computeServeResumeStep('prefill', {
          hasParty: true,
          hasOffice: true,
          hasDates: true,
        }),
      ).toBe('constituents')
    })
  })

  it('never returns pledge (a completed office is redirected away first)', () => {
    const branches = ['net-new', 'prefill'] as const
    const bools = [false, true]
    for (const branch of branches) {
      for (const hasParty of bools) {
        for (const hasOffice of bools) {
          for (const hasDates of bools) {
            expect(
              computeServeResumeStep(branch, { hasParty, hasOffice, hasDates }),
            ).not.toBe('pledge')
          }
        }
      }
    }
  })
})
