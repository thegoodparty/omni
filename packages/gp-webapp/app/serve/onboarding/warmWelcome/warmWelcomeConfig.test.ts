import { describe, expect, it } from 'vitest'
import {
  focusVerdict,
  inviteChunk,
  isWarmWelcomeOffice,
  officeWords,
  resumeWarmWelcomeStep,
  WARM_WELCOME_COPY,
  warmWelcomeSteps,
} from './warmWelcomeConfig'
import type { FirstMeeting } from './firstMeeting'

const office = { campaignId: 7, onboardingCompletedAt: null }

const meeting: FirstMeeting = {
  day: new Date(2027, 0, 7),
  startMinutes: 19 * 60,
  durationMinutes: 120,
  name: 'City Council',
  location: 'City Hall, 210 Main Street',
  timeZone: 'America/New_York',
  source: 'found',
  point: null,
}

const everything = {
  foundMeeting: true,
  meetingKnown: true,
  residents: true,
  priorities: true,
}

describe('warmWelcomeSteps', () => {
  it('runs all six steps when every one has something to show', () => {
    expect(warmWelcomeSteps(everything)).toEqual([
      'warm-won',
      'warm-meeting',
      'warm-briefing',
      'warm-residents',
      'warm-priorities',
      'warm-recap',
    ])
  })

  it('drops the briefing once the official does not know the date', () => {
    expect(warmWelcomeSteps({ ...everything, meetingKnown: false })).toEqual([
      'warm-won',
      'warm-meeting',
      'warm-residents',
      'warm-priorities',
      'warm-recap',
    ])
  })

  it('drops both meeting steps when no meeting was found', () => {
    expect(
      warmWelcomeSteps({
        ...everything,
        foundMeeting: false,
        meetingKnown: false,
      }),
    ).toEqual(['warm-won', 'warm-residents', 'warm-priorities', 'warm-recap'])
  })

  it('drops residents with no comments and no panel to offer', () => {
    expect(warmWelcomeSteps({ ...everything, residents: false })).not.toContain(
      'warm-residents',
    )
  })

  it('drops priorities with no issues to pick from', () => {
    expect(
      warmWelcomeSteps({ ...everything, priorities: false }),
    ).not.toContain('warm-priorities')
  })

  it('goes from the win to the recap when there is nothing else', () => {
    expect(
      warmWelcomeSteps({
        foundMeeting: false,
        meetingKnown: false,
        residents: false,
        priorities: false,
      }),
    ).toEqual(['warm-won', 'warm-recap'])
  })
})

describe('isWarmWelcomeOffice', () => {
  it('opens for a win’s unfinished office with a party, term dates or not', () => {
    expect(isWarmWelcomeOffice(office, 'independent')).toBe(true)
    expect(isWarmWelcomeOffice(office, 'nonpartisan')).toBe(true)
  })

  it('leaves an office that did not come from a win to the stepper', () => {
    expect(
      isWarmWelcomeOffice({ ...office, campaignId: null }, 'independent'),
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
  const steps = warmWelcomeSteps(everything)

  it('returns to the step the official had reached', () => {
    expect(resumeWarmWelcomeStep('warm-residents', steps)).toBe(
      'warm-residents',
    )
  })

  it('starts at the win with no checkpoint, or the stepper’s', () => {
    expect(resumeWarmWelcomeStep(null, steps)).toBe('warm-won')
    expect(resumeWarmWelcomeStep('confirm', steps)).toBe('warm-won')
  })

  it('starts at the win when the saved step is no longer in the flow', () => {
    expect(
      resumeWarmWelcomeStep(
        'warm-briefing',
        warmWelcomeSteps({ ...everything, meetingKnown: false }),
      ),
    ).toBe('warm-won')
  })
})

describe('officeWords', () => {
  it('reads as the design does for a city council', () => {
    const words = officeWords('Northampton City Council - At Large', null)
    expect(words.poster).toBe('The city')
    expect(words.peers).toBe('councilors')
    expect(WARM_WELCOME_COPY.meeting.findLede(words)).toBe(
      'The city posts its meeting calendar. We check it every day.',
    )
    expect(WARM_WELCOME_COPY.priorities.lede(words)).toBe(
      'Most successful councilors tend to pick one focus for their first 60 days. Where do you want to start?',
    )
  })

  it('swaps in a school board’s own words', () => {
    const words = officeWords('Springfield School Board', null)
    expect(words.poster).toBe('The school district')
    expect(words.peers).toBe('school board members')
  })

  it('swaps in a mayor’s and a county’s words', () => {
    expect(officeWords('Mayor of Dayton', null)).toMatchObject({
      poster: 'The city',
      peers: 'mayors',
    })
    expect(
      officeWords('Wake County Board of Commissioners', null),
    ).toMatchObject({ poster: 'The county', peers: 'commissioners' })
    expect(officeWords('Yolo County Supervisor', null)).toMatchObject({
      poster: 'The county',
      peers: 'supervisors',
    })
    expect(officeWords('Hadley Town Council', null)).toMatchObject({
      poster: 'The town',
      peers: 'councilors',
    })
  })

  it('uses plain words for an office it cannot place', () => {
    const words = officeWords(null, null)
    expect(words.poster).toBeNull()
    expect(words.peers).toBe('officials')
    expect(WARM_WELCOME_COPY.meeting.findLede(words)).toBe(
      'Your meeting calendar is posted publicly. We check it every day.',
    )
    expect(WARM_WELCOME_COPY.priorities.lede(words)).toBe(
      'Most successful officials tend to pick one focus for their first 60 days. Where do you want to start?',
    )
  })
})

describe('inviteChunk', () => {
  it('is the design’s wording, with -elect until they are sworn in', () => {
    expect(
      inviteChunk({
        name: 'Anna Whitlock',
        title: 'Northampton City Council Member',
        elect: true,
      }),
    ).toBe(
      'this is Anna Whitlock, your Northampton City Council Member-elect.\n\nI’d like to hear from residents who want a voice in our community. So, I’m inviting a select group of neighbors to share their views. I’ll text you about once a month to ask what you think. If you’d like to be part of this civic panel, please reply with JOIN.',
    )
  })

  it('drops -elect once they hold the office', () => {
    expect(
      inviteChunk({
        name: 'Anna Whitlock',
        title: 'Northampton City Council Member',
        elect: false,
      }),
    ).toContain('your Northampton City Council Member.\n')
  })

  it('still reads with no name or no office on file', () => {
    expect(
      inviteChunk({ name: 'Anna Whitlock', title: null, elect: true }),
    ).toMatch(/^this is Anna Whitlock\.\n/)
    expect(inviteChunk({ name: null, title: null, elect: true })).toMatch(
      /^this is your local elected official\.\n/,
    )
  })
})

describe('focusVerdict', () => {
  it('weighs how much residents care against how soon a win could come', () => {
    expect(focusVerdict('high', 'weeks').title).toBe('Great choice.')
    expect(focusVerdict('high', 'year_or_more').title).toBe('Powerful choice.')
    expect(focusVerdict('medium', 'months').title).toBe('Solid choice.')
    expect(focusVerdict('low', 'weeks').title).toBe('A quick win.')
    expect(focusVerdict('low', 'year_or_more')).toEqual({
      title: 'Ambitious choice.',
      text: 'Few residents have raised it, and it could take over a year. We’ll help you find a first step people can see.',
    })
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
    expect(WARM_WELCOME_COPY.meeting.calendarDetails(meeting)).toBe(
      'Your first City Council meeting. Added from Serve.',
    )
    expect(WARM_WELCOME_COPY.briefing.agenda(meeting)).toBe('Agenda, Jan 7')
  })

  it('says when to expect the Meeting Briefing without promising a day', () => {
    expect(WARM_WELCOME_COPY.briefing.title).toEqual({
      lead: 'Your first Meeting Briefing should be ready around',
      accent: '2 days before',
      tail: 'your meeting.',
    })
    expect(WARM_WELCOME_COPY.recap.briefing(meeting)).toEqual({
      lead: 'Your Meeting Briefing for January 7 should be ready',
      strong: 'around 2 days before.',
    })
  })

  it('offers the district’s own panel size, never a fixed number', () => {
    expect(WARM_WELCOME_COPY.residents.askLede(240, 'Northampton')).toBe(
      'Let’s change that. In about two weeks we can have 240 Northampton residents from every part of town ready to answer your questions. Want to set that up?',
    )
    expect(WARM_WELCOME_COPY.recap.panelAsk(1240).strong).toBe(
      'We can gather 1,240 neighbors you can ask anything, by text.',
    )
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
    expect(WARM_WELCOME_COPY.residents.mapTitle(null)).toBe(
      'Here’s what people in your district are saying.',
    )
    expect(WARM_WELCOME_COPY.residents.askLede(100, null)).toContain(
      '100 residents from every part of your district',
    )
    expect(WARM_WELCOME_COPY.recap.title(null)).toBe('You’re all set.')
  })
})
