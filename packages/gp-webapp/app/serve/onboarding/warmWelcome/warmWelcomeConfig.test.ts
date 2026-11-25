import { describe, expect, it } from 'vitest'
import {
  isWarmWelcomeOffice,
  resumeWarmWelcomeStep,
  WARM_WELCOME_COPY,
  warmWelcomeSteps,
} from './warmWelcomeConfig'
import type { FirstMeeting } from './firstMeeting'

const office = {
  campaignId: 7,
  onboardingCompletedAt: null,
  termStartDate: '2027-01-04',
  termEndDate: '2031-01-04',
}

const meeting: FirstMeeting = {
  day: new Date(2027, 0, 7),
  startMinutes: 19 * 60,
  durationMinutes: 120,
  name: 'City Council',
  location: 'City Hall, 210 Main Street',
  timeZone: 'America/New_York',
  source: 'found',
}

describe('warmWelcomeSteps', () => {
  it('runs every step when the schedule has a first meeting', () => {
    expect(
      warmWelcomeSteps({ foundMeeting: true, briefingDated: true }),
    ).toEqual(['warm-won', 'warm-meeting', 'warm-briefing', 'warm-recap'])
  })

  it('drops the briefing when no day can be promised for it', () => {
    expect(
      warmWelcomeSteps({ foundMeeting: true, briefingDated: false }),
    ).toEqual(['warm-won', 'warm-meeting', 'warm-recap'])
  })

  it('goes from the win to the recap when no meeting was found', () => {
    expect(
      warmWelcomeSteps({ foundMeeting: false, briefingDated: false }),
    ).toEqual(['warm-won', 'warm-recap'])
  })
})

describe('isWarmWelcomeOffice', () => {
  it('opens for a win’s unfinished office with a full term and a party', () => {
    expect(isWarmWelcomeOffice(office, 'independent')).toBe(true)
    expect(isWarmWelcomeOffice(office, 'nonpartisan')).toBe(true)
  })

  it('leaves an office that did not come from a win to the stepper', () => {
    expect(
      isWarmWelcomeOffice({ ...office, campaignId: null }, 'independent'),
    ).toBe(false)
  })

  // Done makes the save gp-api refuses without both dates, and the warm
  // welcome has no screen that asks for them.
  it('leaves an office missing either term date to the stepper', () => {
    expect(
      isWarmWelcomeOffice({ ...office, termStartDate: null }, 'independent'),
    ).toBe(false)
    expect(
      isWarmWelcomeOffice({ ...office, termEndDate: null }, 'independent'),
    ).toBe(false)
  })

  it('leaves a major party or no party to the stepper’s party step', () => {
    expect(isWarmWelcomeOffice(office, 'democratic')).toBe(false)
    expect(isWarmWelcomeOffice(office, 'republican')).toBe(false)
    expect(isWarmWelcomeOffice(office, null)).toBe(false)
    expect(isWarmWelcomeOffice(office, '')).toBe(false)
  })

  it('never reopens a finished office', () => {
    expect(
      isWarmWelcomeOffice(
        { ...office, onboardingCompletedAt: '2026-11-24T00:00:00.000Z' },
        'independent',
      ),
    ).toBe(false)
  })
})

describe('resumeWarmWelcomeStep', () => {
  const steps = warmWelcomeSteps({ foundMeeting: true, briefingDated: true })

  it('returns to the step the official had reached', () => {
    expect(resumeWarmWelcomeStep('warm-briefing', steps)).toBe('warm-briefing')
  })

  it('starts at the win with no checkpoint, or the stepper’s', () => {
    expect(resumeWarmWelcomeStep(null, steps)).toBe('warm-won')
    expect(resumeWarmWelcomeStep('confirm', steps)).toBe('warm-won')
  })

  it('starts at the win when the saved step is no longer in the flow', () => {
    expect(
      resumeWarmWelcomeStep(
        'warm-briefing',
        warmWelcomeSteps({ foundMeeting: false, briefingDated: false }),
      ),
    ).toBe('warm-won')
  })
})

describe('WARM_WELCOME_COPY', () => {
  it('names the official, their place and the body that meets', () => {
    expect(WARM_WELCOME_COPY.won.title('Anna')).toBe(
      'Well done, Anna. You won!',
    )
    expect(WARM_WELCOME_COPY.won.lede('Northampton')).toBe(
      'All of Northampton is counting on you now, not just the people who voted. Let’s get you ready for that.',
    )
    expect(WARM_WELCOME_COPY.meeting.askTitle(meeting)).toEqual({
      lead: 'It looks like your first City Council meeting is',
      accent: 'Thursday, January 7 at 7:00 pm.',
    })
    expect(WARM_WELCOME_COPY.briefing.title(new Date(2027, 0, 5))).toEqual({
      lead: 'Your first Meeting Briefing will be ready by',
      accent: 'Tuesday, January 5.',
    })
    expect(WARM_WELCOME_COPY.briefing.agenda(meeting)).toBe('Agenda, Jan 7')
    expect(
      WARM_WELCOME_COPY.recap.briefing(meeting, new Date(2027, 0, 5)),
    ).toEqual({
      lead: 'Your Meeting Briefing for January 7 lands on',
      strong: 'Tuesday, January 5.',
    })
    expect(WARM_WELCOME_COPY.recap.meeting(meeting)).toEqual({
      lead: 'Your first City Council meeting is',
      strong: 'Thursday, January 7 at 7:00 pm.',
    })
  })

  it('still reads when a name, a place or a body is missing', () => {
    expect(WARM_WELCOME_COPY.won.title(null)).toBe('Well done. You won!')
    expect(WARM_WELCOME_COPY.won.lede(null)).toBe(
      'Your whole district is counting on you now, not just the people who voted. Let’s get you ready for that.',
    )
    expect(
      WARM_WELCOME_COPY.meeting.askTitle({ ...meeting, name: '' }).lead,
    ).toBe('It looks like your first meeting is')
    expect(WARM_WELCOME_COPY.briefing.lede(null)).toBe(
      'What’s on the agenda, what it costs, what people in your district think, and what to ask.',
    )
    expect(WARM_WELCOME_COPY.recap.title(null)).toBe('You’re all set.')
  })
})
