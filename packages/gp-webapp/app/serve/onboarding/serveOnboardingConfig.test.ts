import { describe, it, expect } from 'vitest'
import {
  computeServeResumeStep,
  getServeBranchSteps,
  getServeProgress,
  resolveConfirmEntryStep,
  resolveServeBranch,
  resolveServeResumeStep,
  SERVE_CITIZEN_PANELS_WELCOME_VALUE_PROPS,
  SERVE_WELCOME_VALUE_PROPS,
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

describe('resolveConfirmEntryStep', () => {
  it('routes to the office step first when the office is missing', () => {
    expect(
      resolveConfirmEntryStep({ officeReady: false, datesReady: false }),
    ).toBe('office')
    // Office takes priority even when dates are already valid.
    expect(
      resolveConfirmEntryStep({ officeReady: false, datesReady: true }),
    ).toBe('office')
  })

  it('routes to the term-dates step when the office is set but dates are missing/invalid', () => {
    expect(
      resolveConfirmEntryStep({ officeReady: true, datesReady: false }),
    ).toBe('term-dates')
  })

  it('shows the confirm hub only once office AND valid dates are present', () => {
    expect(
      resolveConfirmEntryStep({ officeReady: true, datesReady: true }),
    ).toBe('confirm')
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

describe('the district story behind serve-citizen-panels', () => {
  const done = { hasParty: true, hasOffice: true, hasDates: true }
  const story = [
    'story-represent',
    'story-loudest',
    'story-sample',
    'story-grow',
  ]

  it('replaces constituents with the story, then priorities and pledge', () => {
    expect(getServeBranchSteps('net-new', true)).toEqual([
      'welcome',
      'inOffice',
      'party',
      'office',
      'term-dates',
      ...story,
      'priorities',
      'pledge',
    ])
    expect(getServeBranchSteps('prefill', true)).toEqual([
      'welcome',
      'inOffice',
      'party',
      'confirm',
      ...story,
      'priorities',
      'pledge',
    ])
    expect(getServeProgress('prefill', 'pledge', true).total).toBe(10)
    expect(getServeProgress('net-new', 'story-sample', true)).toEqual({
      current: 8,
      total: 11,
    })
  })

  it('keeps constituents and no story or priorities when off', () => {
    expect(getServeBranchSteps('prefill').slice(-2)).toEqual([
      'constituents',
      'pledge',
    ])
    for (const step of [...story, 'priorities']) {
      expect(getServeBranchSteps('net-new')).not.toContain(step)
    }
  })

  it('resumes on a story or priorities checkpoint only when on', () => {
    expect(resolveServeResumeStep('net-new', 'story-sample', done, true)).toBe(
      'story-sample',
    )
    expect(resolveServeResumeStep('prefill', 'priorities', done, true)).toBe(
      'priorities',
    )
    expect(resolveServeResumeStep('net-new', 'story-sample', done)).toBe(
      'constituents',
    )
    expect(resolveServeResumeStep('net-new', 'priorities', done)).toBe(
      'constituents',
    )
  })

  it('sends a constituents checkpoint to the start of the story when on', () => {
    expect(resolveServeResumeStep('net-new', 'constituents', done, true)).toBe(
      'story-represent',
    )
    expect(resolveServeResumeStep('prefill', null, done, true)).toBe(
      'story-represent',
    )
  })

  it('never lets a story checkpoint skip a missing term', () => {
    expect(
      resolveServeResumeStep(
        'net-new',
        'story-grow',
        { ...done, hasDates: false },
        true,
      ),
    ).toBe('term-dates')
  })
})

describe('the welcome tiles behind serve-citizen-panels', () => {
  it('fills the 2x2 grid like the flag-off tiles', () => {
    expect(SERVE_CITIZEN_PANELS_WELCOME_VALUE_PROPS).toHaveLength(4)
    expect(SERVE_WELCOME_VALUE_PROPS).toHaveLength(4)
  })

  it('ends with meeting briefings', () => {
    expect(
      SERVE_CITIZEN_PANELS_WELCOME_VALUE_PROPS.map(({ title }) => title),
    ).toEqual([
      'Ask residents before you vote',
      'Know what your community is talking about',
      'Follow through on the issues you were elected to solve',
      'Walk into every meeting prepared',
    ])
  })
})
