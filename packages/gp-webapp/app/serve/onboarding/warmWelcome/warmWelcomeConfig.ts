import type { ElectedOffice } from 'gpApi/api-endpoints'
import { isServeMajorParty } from '../serveOnboardingConfig'
import {
  briefingDay,
  clockTime,
  longDay,
  monthDay,
  shortMonthDay,
  type FirstMeeting,
} from './firstMeeting'

// The warm welcome's steps, in order. Each id is also the resume checkpoint
// written to ElectedOffice.onboardingStep, so gp-api's SERVE_ONBOARDING_STEPS
// lists them too.
export const WARM_WELCOME_STEPS = [
  'warm-won',
  'warm-meeting',
  'warm-briefing',
  'warm-recap',
] as const

export type WarmWelcomeStepId = (typeof WARM_WELCOME_STEPS)[number]

export const WARM_WELCOME_STEP_LABELS: Record<WarmWelcomeStepId, string> = {
  'warm-won': 'You won',
  'warm-meeting': 'First meeting',
  'warm-briefing': 'Meeting Briefing',
  'warm-recap': 'Recap',
}

// A step with nothing to show leaves the flow and its breadcrumb. The first
// meeting step needs a meeting on the office's schedule to confirm. The
// briefing step needs a meeting date from anywhere: the schedule, or the
// official on the step before.
export const warmWelcomeSteps = ({
  foundMeeting,
  knownMeeting,
}: {
  foundMeeting: boolean
  knownMeeting: boolean
}): WarmWelcomeStepId[] =>
  WARM_WELCOME_STEPS.filter((step) => {
    if (step === 'warm-meeting') return foundMeeting
    if (step === 'warm-briefing') return knownMeeting
    return true
  })

// The warm welcome has no party step and no term step, and finishing it is
// the save gp-api refuses without a full term. So it opens only for a win's
// unfinished office that already has both, with a party Serve works with;
// any other office keeps the stepper onboarding, which asks.
export const isWarmWelcomeOffice = (
  office: Pick<
    ElectedOffice,
    'campaignId' | 'onboardingCompletedAt' | 'termStartDate' | 'termEndDate'
  >,
  party: string | null,
): boolean =>
  office.campaignId != null &&
  !office.onboardingCompletedAt &&
  !!office.termStartDate &&
  !!office.termEndDate &&
  party !== null &&
  party !== '' &&
  !isServeMajorParty(party)

export const resumeWarmWelcomeStep = (
  checkpoint: string | null | undefined,
  steps: WarmWelcomeStepId[],
): WarmWelcomeStepId =>
  steps.find((step) => step === checkpoint) ?? steps[0] ?? 'warm-won'

// A headline with one part in the accent color.
export interface AccentTitle {
  lead?: string
  accent: string
  tail?: string
}

// A recap row: a plain line, then the part that matters in bold, on its own
// line unless the two read as one sentence.
export interface RecapLine {
  lead: string
  strong: string
  oneSentence?: boolean
}

export const WARM_WELCOME_COPY = {
  back: 'Back',
  steps: 'Steps',
  won: {
    title: (firstName: string | null): string =>
      firstName ? `Well done, ${firstName}. You won!` : 'Well done. You won!',
    serveLabel: 'People you now serve',
    lede: (place: string | null): string =>
      `${place ? `All of ${place}` : 'Your whole district'} is counting on you now, not just the people who voted. Let’s get you ready for that.`,
    next: 'Let’s get ready',
  },
  meeting: {
    askTitle: (meeting: FirstMeeting): AccentTitle => ({
      lead: `It looks like your first ${meeting.name ? `${meeting.name} ` : ''}meeting is`,
      accent: `${longDay(meeting.day)} at ${clockTime(meeting.startMinutes)}.`,
    }),
    askPrompt: 'Does that sound right?',
    no: 'That’s not right',
    yes: 'Yes, that’s it',
    calendarTitle: (meeting: FirstMeeting): AccentTitle => ({
      accent: longDay(meeting.day),
      tail: 'it is.',
    }),
    calendarPrompt: 'Want it on your calendar?',
    calendarOpened: (calendar: string): string => `Opened in ${calendar}.`,
    calendarSaved: (calendar: string): string => `Saved for ${calendar}.`,
    calendarFile: (title: string): string => `${title}.ics`,
    calendarNext: 'Let’s keep going',
    pickTitle: 'No problem. When is it?',
    pickLabel: 'Pick the month, day and time',
    month: 'Month',
    day: 'Day',
    time: 'Time',
    at: 'at',
    unknown: 'I don’t know yet',
    usePicked: 'Use this date',
    findTitle: 'That’s okay. We’ll find it and let you know.',
    findLede:
      'Your meeting calendar is posted publicly. We check it every day.',
    findNext: 'Keep going',
  },
  briefing: {
    title: (meeting: FirstMeeting): AccentTitle => ({
      lead: 'Your first Meeting Briefing will be ready by',
      accent: `${longDay(briefingDay(meeting))}.`,
    }),
    lede: (place: string | null): string =>
      `What’s on the agenda, what it costs, what people in ${place ?? 'your district'} think, and what to ask.`,
    folderLabel: 'Meeting Briefing',
    folderAlt: (name: string | null): string =>
      name
        ? `Documents dropping into a folder with ${name}’s name on it`
        : 'Documents dropping into a folder',
    agenda: (meeting: FirstMeeting): string =>
      `Agenda, ${shortMonthDay(meeting.day)}`,
    restingDocs: ['Last meeting’s minutes', 'Fiscal note'],
    droppingDocs: [
      'Staff report',
      'Ordinance, 2nd reading',
      'Public hearing notice',
      'Resident letters',
      'Your priorities',
      'Budget summary',
      'Talking points',
    ],
    next: 'Let’s keep going',
  },
  recap: {
    title: (firstName: string | null): string =>
      firstName ? `You’re all set, ${firstName}.` : 'You’re all set.',
    next: 'Here’s what happens next:',
    briefing: (meeting: FirstMeeting): RecapLine => ({
      lead: `Your Meeting Briefing for ${monthDay(meeting.day)} lands on`,
      strong: `${longDay(briefingDay(meeting))}.`,
    }),
    noMeeting: {
      lead: 'You won. Next up is your first meeting.',
      strong: 'We’ll help you get ready for it.',
    } satisfies RecapLine,
    serve: {
      lead: 'We’re here to help you',
      strong:
        'prepare for meetings, draft ordinances, and connect with residents.',
      oneSentence: true,
    } satisfies RecapLine,
    done: 'Done',
    saveFailed: 'We couldn’t finish setting up your office. Please try again.',
  },
}
