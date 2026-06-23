import { describe, it, expect } from 'vitest'
import {
  computeServeResumeStep,
  resolveServeBranch,
  resolveServeResumeStep,
  shouldSeedInOfficeOnResume,
} from './serveOnboardingConfig'

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

describe('resolveServeResumeStep', () => {
  const allSaved = { hasParty: true, hasOffice: true, hasDates: true }

  it('falls back to the data-derived step when there is no checkpoint', () => {
    expect(
      resolveServeResumeStep('net-new', null, {
        hasParty: true,
        hasOffice: false,
        hasDates: false,
      }),
    ).toBe('office')
    expect(
      resolveServeResumeStep('net-new', undefined, {
        hasParty: false,
        hasOffice: false,
        hasDates: false,
      }),
    ).toBe('welcome')
  })

  it('routes to a no-data-field checkpoint the data-derived step cannot pinpoint', () => {
    // inOffice has no persisted data, so computeServeResumeStep can only ever
    // say "welcome" here — the checkpoint is the only way to land back on it.
    expect(
      resolveServeResumeStep('net-new', 'inOffice', {
        hasParty: false,
        hasOffice: false,
        hasDates: false,
      }),
    ).toBe('inOffice')
    // constituents likewise carries no data field; with all data saved the
    // checkpoint keeps the user there instead of falling back.
    expect(resolveServeResumeStep('net-new', 'constituents', allSaved)).toBe(
      'constituents',
    )
  })

  it('honors a normal checkpoint that matches the persisted data', () => {
    expect(
      resolveServeResumeStep('net-new', 'term-dates', {
        hasParty: true,
        hasOffice: true,
        hasDates: false,
      }),
    ).toBe('term-dates')
    expect(
      resolveServeResumeStep('prefill', 'confirm', {
        hasParty: true,
        hasOffice: true,
        hasDates: false,
      }),
    ).toBe('confirm')
  })

  it('clamps a checkpoint that outruns the persisted data (a save that later failed)', () => {
    // Checkpoint says constituents, but office/dates never persisted — resume at
    // the first step whose answer is actually missing rather than skipping it.
    expect(
      resolveServeResumeStep('net-new', 'constituents', {
        hasParty: true,
        hasOffice: false,
        hasDates: false,
      }),
    ).toBe('office')
    // Checkpoint past party but party never saved → clamp back to party.
    expect(
      resolveServeResumeStep('net-new', 'office', {
        hasParty: false,
        hasOffice: false,
        hasDates: false,
      }),
    ).toBe('party')
  })

  it('ignores a checkpoint that is not a step in the resolved branch', () => {
    // `office` is a net-new-only step; a prefill record carrying it (e.g. a
    // branch flip between sessions) falls back to the data-derived step.
    expect(resolveServeResumeStep('prefill', 'office', allSaved)).toBe(
      'constituents',
    )
  })
})

describe('shouldSeedInOfficeOnResume', () => {
  it('seeds in-office for any step past the intro screens', () => {
    expect(shouldSeedInOfficeOnResume('welcome')).toBe(false)
    expect(shouldSeedInOfficeOnResume('inOffice')).toBe(false)
    expect(shouldSeedInOfficeOnResume('party')).toBe(true)
    expect(shouldSeedInOfficeOnResume('office')).toBe(true)
    expect(shouldSeedInOfficeOnResume('confirm')).toBe(true)
    expect(shouldSeedInOfficeOnResume('constituents')).toBe(true)
  })
})

describe('resolveServeBranch', () => {
  it('is net-new when nothing is present (fresh self-serve lead)', () => {
    expect(
      resolveServeBranch({
        officePresent: false,
        datesPresent: false,
        selfReported: false,
      }),
    ).toBe('net-new')
  })

  it('is prefill when office/dates are present without the self-reported marker', () => {
    // The arming condition for the BR suggestion-accuracy snapshot.
    expect(
      resolveServeBranch({
        officePresent: true,
        datesPresent: true,
        selfReported: false,
      }),
    ).toBe('prefill')
  })

  it('treats a PARTIAL prefill (office present, no dates, no marker) as prefill so the snapshot fires', () => {
    expect(
      resolveServeBranch({
        officePresent: true,
        datesPresent: false,
        selfReported: false,
      }),
    ).toBe('prefill')
  })

  it('keeps a self-reported record net-new even once its office/dates are present (no snapshot)', () => {
    // The disambiguation the marker buys: identical field shape to a prefill,
    // but the user entered it themselves, so it stays net-new.
    expect(
      resolveServeBranch({
        officePresent: true,
        datesPresent: false,
        selfReported: true,
      }),
    ).toBe('net-new')
    expect(
      resolveServeBranch({
        officePresent: true,
        datesPresent: true,
        selfReported: true,
      }),
    ).toBe('net-new')
  })
})
