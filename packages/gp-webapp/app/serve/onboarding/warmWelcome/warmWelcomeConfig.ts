import type {
  FirstWinHorizon,
  OnboardingFocusKind,
  ResidentInterest,
} from '@goodparty_org/contracts'
import type { ElectedOffice } from 'gpApi/api-endpoints'
import { isServeMajorParty } from '../serveOnboardingConfig'
import {
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
  'warm-residents',
  'warm-priorities',
  'warm-recap',
] as const

export type WarmWelcomeStepId = (typeof WARM_WELCOME_STEPS)[number]

export const WARM_WELCOME_STEP_LABELS: Record<WarmWelcomeStepId, string> = {
  'warm-won': 'You won',
  'warm-meeting': 'First meeting',
  'warm-briefing': 'Meeting Briefing',
  'warm-residents': 'Residents',
  'warm-priorities': 'Priorities',
  'warm-recap': 'Recap',
}

// A step with nothing to show leaves the flow and its breadcrumb. First
// meeting needs a meeting on the office's schedule to confirm. Meeting
// Briefing needs a meeting date, from the schedule or from the official.
// Residents needs comments to show or a Civic Panel to offer. Priorities
// needs issues to pick from, or a search for them that is still running.
export const warmWelcomeSteps = ({
  foundMeeting,
  meetingKnown,
  residents,
  priorities,
}: {
  foundMeeting: boolean
  meetingKnown: boolean
  residents: boolean
  priorities: boolean
}): WarmWelcomeStepId[] =>
  WARM_WELCOME_STEPS.filter((step) => {
    if (step === 'warm-meeting') return foundMeeting
    if (step === 'warm-briefing') return meetingKnown
    if (step === 'warm-residents') return residents
    if (step === 'warm-priorities') return priorities
    return true
  })

// The warm welcome is the onboarding for someone who just won: an office
// that came from a campaign and is not finished. It has no party step, so
// an office without a party Serve works with keeps the stepper, which asks.
export const isWarmWelcomeOffice = (
  office: Pick<ElectedOffice, 'campaignId' | 'onboardingCompletedAt'>,
  party: string | null,
): boolean =>
  office.campaignId != null &&
  !office.onboardingCompletedAt &&
  party !== null &&
  party !== '' &&
  !isServeMajorParty(party)

export const resumeWarmWelcomeStep = (
  checkpoint: string | null | undefined,
  steps: WarmWelcomeStepId[],
): WarmWelcomeStepId =>
  steps.find((step) => step === checkpoint) ?? steps[0] ?? 'warm-won'

// The words that change with the office. The design is written for a city
// council member; every other winner reads the same sentences with their
// own office's words in them.
export interface OfficeWords {
  // Who publishes the meeting calendar ("The city"), or null when the
  // office does not say.
  poster: string | null
  // What people in this office are called, plural ("councilors").
  peers: string
  // The office as an invite names it ("Northampton City Council Member"),
  // or null when the office has no name on file.
  title: string | null
}

const PEERS: [RegExp, string][] = [
  [/school|education/i, 'school board members'],
  [/mayor/i, 'mayors'],
  [/supervisor/i, 'supervisors'],
  [/commission/i, 'commissioners'],
  [/alder/i, 'alders'],
  [/trustee/i, 'trustees'],
  [/select\s?(man|men|board|person)/i, 'select board members'],
  [/council/i, 'councilors'],
]

const POSTERS: [RegExp, string][] = [
  [/school|education/i, 'The school district'],
  [/county|parish/i, 'The county'],
  [/township/i, 'The township'],
  [/village/i, 'The village'],
  [/town\b/i, 'The town'],
  [/city|mayor|alder|council/i, 'The city'],
]

export const officeWords = (
  positionName: string | null | undefined,
  title: string | null,
): OfficeWords => {
  const name = positionName?.trim() ?? ''
  return {
    poster: POSTERS.find(([test]) => test.test(name))?.[1] ?? null,
    peers: PEERS.find(([test]) => test.test(name))?.[1] ?? 'officials',
    title,
  }
}

// "your first City Council meeting", or "your first meeting" when the
// schedule does not name the body.
const firstMeetingOf = (meeting: Pick<FirstMeeting, 'name'>): string =>
  `first ${meeting.name ? `${meeting.name} ` : ''}meeting`

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
  // What follows the bold part on the same line.
  end?: string
}

export type FirstWin = FirstWinHorizon
export type FocusKind = OnboardingFocusKind
export type { ResidentInterest }

const INTEREST_RANK: Record<ResidentInterest, 1 | 2 | 3> = {
  high: 3,
  medium: 2,
  low: 1,
}

// What we say when they pick: it weighs how much residents care against
// how soon a first win could come. Encouraging, and hedged.
const VERDICTS: Record<string, [string, string]> = {
  '3weeks': [
    'Great choice.',
    'Residents are asking for this, and you should be able to get it done fast. We’ll help you line it up.',
  ],
  '3months': [
    'Strong choice.',
    'Residents want this. It should take a few months, and we’ll help you show progress along the way.',
  ],
  '3year_or_more': [
    'Powerful choice.',
    'A lot of people want this, but it could take a year or more. We’ll help you break it into steps people can see.',
  ],
  '2weeks': [
    'Good choice.',
    'Some residents have raised it, and you should be able to finish it quickly. We’ll help you get it moving.',
  ],
  '2months': [
    'Solid choice.',
    'Some residents are asking for this, and it should take a few months. We’ll help you work toward it.',
  ],
  '2year_or_more': [
    'Big choice.',
    'This could take a year or more. We’ll help you find the first step and keep it moving.',
  ],
  '1weeks': [
    'A quick win.',
    'Fewer residents have raised it, but it should be doable fast. We’ll help you get it done.',
  ],
  '1months': [
    'Fair choice.',
    'Not many residents have raised it yet, and it should take a few months. We’ll help you work toward it.',
  ],
  '1year_or_more': [
    'Ambitious choice.',
    'Few residents have raised it, and it could take over a year. We’ll help you find a first step people can see.',
  ],
}

export const focusVerdict = (
  interest: ResidentInterest,
  firstWin: FirstWin,
): { title: string; text: string } => {
  const [title, text] = VERDICTS[`${INTEREST_RANK[interest]}${firstWin}`] ?? [
    'Good choice.',
    'We’ll help you get it moving.',
  ]
  return { title, text }
}

// The part of the invite the official can change, as the design words it.
// Texts sent before the swearing-in say "-elect".
export const inviteChunk = ({
  name,
  title,
  elect,
}: {
  name: string | null
  title: string | null
  elect: boolean
}): string => {
  const office = title ? `${title}${elect ? '-elect' : ''}` : null
  const who = [
    name ? `this is ${name}` : null,
    office ? `your ${office}` : null,
  ].filter(Boolean)
  const opening =
    who.length > 0
      ? `${who.join(', ')}.`
      : 'this is your local elected official.'
  return `${opening}\n\nI’d like to hear from residents who want a voice in our community. So, I’m inviting a select group of neighbors to share their views. I’ll text you about once a month to ask what you think. If you’d like to be part of this civic panel, please reply with JOIN.`
}

export const WARM_WELCOME_COPY = {
  back: 'Back',
  steps: 'Steps',
  brand: 'GoodParty.org',
  won: {
    title: (firstName: string | null): string =>
      firstName ? `Well done, ${firstName}. You won!` : 'Well done. You won!',
    votesLabel: 'People who voted for you',
    serveLabel: 'People you now serve',
    lede: (place: string | null): string =>
      `${place ? `All of ${place}` : 'Your whole district'} is counting on you now, not just the people who voted. Let’s get you ready for that.`,
    next: 'Let’s get ready',
  },
  meeting: {
    askTitle: (meeting: FirstMeeting): AccentTitle => ({
      lead: `It looks like your ${firstMeetingOf(meeting)} is`,
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
    calendarDetails: (meeting: Pick<FirstMeeting, 'name'>): string =>
      `Your ${firstMeetingOf(meeting)}. Added from Serve.`,
    calendarNext: 'Let’s keep going',
    pickTitle: 'No problem. When is it?',
    pickLabel: 'Pick the month and day',
    month: 'Month',
    months: 'Months',
    day: 'Day',
    days: 'Days',
    time: 'Time',
    times: 'Times',
    at: 'at',
    unknown: 'I don’t know yet',
    usePicked: 'Use this date',
    findTitle: 'That’s okay. We’ll find it and let you know.',
    findLede: (words: OfficeWords): string =>
      words.poster
        ? `${words.poster} posts its meeting calendar. We check it every day.`
        : 'Your meeting calendar is posted publicly. We check it every day.',
    findNext: 'Keep going',
    saveFailed: 'We couldn’t save that date. Please try again.',
  },
  briefing: {
    title: {
      lead: 'Your first Meeting Briefing should be ready around',
      accent: '2 days before',
      tail: 'your meeting.',
    } satisfies AccentTitle,
    lede: (place: string | null): string =>
      `What’s on the agenda, what it costs, what people in ${place ?? 'your district'} think, and what to ask.`,
    remindPrompt: 'Want a reminder via text when it’s ready?',
    noReminder: 'That’s okay',
    remind: 'Remind me',
    reminded: 'You got it',
    folderLabel: 'Meeting Briefing',
    folderAlt: (name: string | null): string =>
      name
        ? `Documents dropping into a folder called ${name}’s Meeting Briefing`
        : 'Documents dropping into a folder called Meeting Briefing',
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
  },
  residents: {
    mapTitle: (place: string | null): string =>
      `Here’s what people in ${place ?? 'your district'} are saying.`,
    mapAlt: (place: string | null): string =>
      `A map of ${place ?? 'your district'} that moves from place to place, showing a short comment at each one.`,
    allSynthetic: '*Comments are synthesized from real ones in similar places.',
    someSynthetic:
      '*Some comments are synthesized from real ones in similar places.',
    previous: 'Previous message',
    nextMessage: 'Next message',
    next: 'Next',
    askTitle: 'Most officials only hear from the loudest voices.',
    askLede: (goal: number, place: string | null): string =>
      `Let’s change that. In about two weeks we can have ${goal.toLocaleString('en-US')} ${place ? `${place} residents` : 'residents'} from every part of ${place ? 'town' : 'your district'} ready to answer your questions. Want to set that up?`,
    skip: 'Skip for now',
    yes: 'Yes',
    inviteTitle: 'Here’s the text we’ll send.',
    inviteLede:
      'It’s friendly and clear, and the neighbors who answer will tell you what people here need,',
    inviteLedeEnd: 'month after month.',
    inviteAlt: 'The invitation, as a text message',
    resident: 'David',
    greeting: (first: string): string => `Hi ${first}, `,
    inviteTime: 'Today 9:41 AM',
    chunkLabel: 'The part of the invitation you can change',
    pledge:
      'This is a nonpartisan panel. Your replies come straight to me, and I won’t share them publicly without asking you first.',
    delivered: 'Delivered',
    edit: 'Edit message',
    doneEditing: 'Done editing',
    pickDay: 'Pick a day',
    whenTitle: 'When should the first invites go out?',
    whenLede: (hour: string, place: string | null): string =>
      place
        ? `Texts go out at ${hour} ${place} time.`
        : `Texts go out at ${hour} your time.`,
    startDay: 'Start day',
    tomorrow: 'Tomorrow',
    monday: 'Monday',
    sworn: 'After I’m sworn in',
    pick: 'Pick a day',
    anyDay: 'Any day',
    tipLabel: 'Tip',
    tip: 'Tuesdays and Thursdays tend to get the most replies.',
    startDate: 'Start date',
    backToText: 'Back to the text',
    setUp: 'Set it up',
    setUpFailed: 'We couldn’t set up your Civic Panel. Please try again.',
    doneTitle: (day: string): string =>
      `All set! We’ll start texting on ${day}.`,
    doneLede: 'We’ll keep you posted as residents join.',
    doneNext: 'Let’s keep going',
  },
  priorities: {
    tease: 'One last thing',
    titleLead: 'Let’s get another',
    titleAccent: 'win',
    titleTail: 'under your belt.',
    lede: (words: OfficeWords): string =>
      `Most successful ${words.peers} tend to pick one focus for their first 60 days. Where do you want to start?`,
    caption: (kind: FocusKind, place: string | null): string =>
      ({
        ran_on: 'Here’s what you ran on, pick one to start.',
        community:
          'These issues are important to your community, pick one to start.',
        mixed: `Here’s what you ran on and what people in ${place ?? 'your community'} are talking about, pick one to start.`,
      })[kind],
    group: (kind: FocusKind): string =>
      ({
        ran_on: 'What you ran on',
        community: 'Issues important to your community',
        mixed: 'What you ran on and issues important to your community',
      })[kind],
    interest: 'Resident interest',
    interestWord: {
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    } satisfies Record<ResidentInterest, string>,
    firstWin: 'First win',
    firstWinWord: {
      weeks: 'Weeks',
      months: 'Months',
      year_or_more: 'A year or more',
    } satisfies Record<FirstWin, string>,
    searching: 'Finding issues in your community',
    start: 'Start with this',
    saveFailed: 'We couldn’t save your focus. Please try again.',
  },
  recap: {
    title: (firstName: string | null): string =>
      firstName ? `You’re all set, ${firstName}.` : 'You’re all set.',
    next: 'Here’s what happens next:',
    briefing: (meeting: FirstMeeting): RecapLine => ({
      lead: `Your Meeting Briefing for ${monthDay(meeting.day)} should be ready`,
      strong: 'around 2 days before.',
    }),
    noMeeting: {
      lead: 'You won. Next up is your first meeting.',
      strong: 'We’ll help you get ready for it.',
    } satisfies RecapLine,
    focus: (line: string): RecapLine => ({
      lead: 'We’ll help you make progress on',
      strong: line,
      end: '.',
    }),
    serve: {
      lead: 'We’re here to help you',
      strong:
        'prepare for meetings, draft ordinances, and connect with residents.',
      oneSentence: true,
    } satisfies RecapLine,
    panelOn: (sendDay: string, readyDay: string): RecapLine => ({
      lead: `Invites go out ${sendDay}.`,
      strong: `Your Civic Panel should be ready around ${readyDay}.`,
    }),
    panelAsk: (goal: number): RecapLine => ({
      lead: 'Want to stay connected to your community?',
      strong: `We can gather ${goal.toLocaleString('en-US')} neighbors you can ask anything, by text.`,
    }),
    panelOpen: 'See how the Civic Panel works',
    done: 'Done',
    saveFailed: 'We couldn’t finish setting up your office. Please try again.',
  },
}
