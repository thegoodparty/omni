import { CIVIC_PANEL_SEGMENT } from '@goodparty_org/contracts'

export const CITIZENS_PANEL_PATH = '/dashboard/contacts/citizens-panel'

// Where the official came to the panel page from, for its Panel Viewed event.
export const CIVIC_PANEL_ENTRY_PARAM = 'from'
export type CivicPanelEntry =
  | 'chief_of_staff_home'
  | 'chief_of_staff_chat'
  | 'contacts'
  | 'outreach'
export const civicPanelHref = (from: CivicPanelEntry): string =>
  `${CITIZENS_PANEL_PATH}?${CIVIC_PANEL_ENTRY_PARAM}=${from}`
// The built-in list under Constituent lists. The segment doubles as the list
// id in the path, the way "all" does for All constituents.
export const CITIZENS_PANEL_LIST_PATH = `/dashboard/contacts/lists/${CIVIC_PANEL_SEGMENT}`

export const SERVE_CITIZENS_PANEL_COPY = {
  title: 'Your civic panel',
  caption: 'Residents who said yes to being asked for their views.',
  members: 'Members',
  reachedRecently: 'Reached in the last 30 days',
  reachedRecentlyDetail: 'Texted, called or visited by your office.',
  askableNow: 'Can be asked now',
  seePanel: 'See your panel',
  empty: 'Nobody has joined your civic panel yet.',
  emptyAction: 'Build it with texts, calls and door knocking.',
  buildPanel: 'Build your civic panel',
  loadError:
    "We couldn't load your civic panel. Refresh the page to try again.",
  backToContacts: 'Back to constituents',
  seeMembers: 'See members',
  listTitle: 'Civic panel',
  listFilter: 'On your civic panel.',
  representationTitle: "Who's on your panel",
  representationCaption:
    'Compares the neighborhoods members live in with your whole district.',
  representationEmpty: (minimum: number) =>
    `Once your panel has ${minimum} members, you can compare it with your district.`,
  representationUnmapped:
    'Not enough members have an address we can map yet. This fills in as more people join.',
  representationError:
    "We couldn't load this comparison. Refresh the page to try again.",
  shares: (member: number, district: number) =>
    `${member}% of members, ${district}% of your district`,
  weeklyQuestion: 'How much time can you give each week?',
  weeklyCaption:
    'Your own calls and door knocking reach the residents a text misses.',
  hoursPerWeek: (hours: number) =>
    hours === 1 ? '1 hour a week' : `${hours} hours a week`,
  moreHoursPerWeek: '4 or more hours a week',
  moreHoursLabel: 'Hours each week',
  hoursMissing: 'Enter a number of hours, like 5.',
  hoursInvalid: (max: number) => `Enter a whole number from 1 to ${max}.`,
  makePlan: 'Make my plan',
  makePlanError: "We couldn't make your plan. Try again in a minute.",
  makePlanRefused: "We couldn't make a plan for your office",
  planLoadError: "We couldn't load your plan. Refresh the page to try again.",
  planTitle: 'Your plan',
  planCaption: 'Each step invites residents to your civic panel.',
  stepTitle: {
    text: (size: string) => `Text ${size} residents`,
    phone_banking: (size: string) => `Call ${size} residents`,
    door_knocking: (size: string, position: number) =>
      position > 1
        ? `Knock on ${size} doors in a second walkable area`
        : `Knock on ${size} doors in a walkable area`,
  },
  // One line under each step's title.
  stepDetail: {
    text: 'Residents with a cell phone, picked at random.',
    phone_banking: (time: string) =>
      `People a text can't reach, landlines first. ${time} of your time.`,
    door_knocking: (time: string) => `One walkable area. ${time} of your time.`,
  },
  duration: (minutes: number) =>
    minutes < 50
      ? `About ${Math.max(5, Math.round(minutes / 5) * 5)} minutes`
      : minutes < 90
        ? 'About an hour'
        : `About ${Math.round(minutes / 60)} hours`,
  textGoesOut: (date: string) => `Goes out ${date}.`,
  calledSoFar: (called: string) => `Called ${called} so far.`,
  knockedSoFar: (visited: string) => `Visited ${visited} residents so far.`,
  sentRepliesBy: (sent: string, replies: string) =>
    `Sent ${sent}. Replies come in by ${replies}.`,
  sentJoined: (sent: string, joined: string) =>
    `Sent ${sent}. ${joined} joined.`,
  calledJoined: (called: string, joined: string) =>
    `Called ${called}. ${joined} joined.`,
  knockedJoined: (visited: string, joined: string) =>
    `Visited ${visited} residents. ${joined} joined.`,
  joined: (joined: string) => `${joined} joined.`,
  markDone: 'Mark done',
  markNotDone: 'Mark not done',
  markError: "We couldn't change this step. Try again.",
  getStarted: 'Get started',
  startStep: {
    text: 'Start the text',
    phone_banking: 'Start the calls',
    door_knocking: 'Start door knocking',
  },
  keepGoing: {
    phone_banking: 'Keep calling',
    door_knocking: 'Keep knocking',
  },
  skipStep: 'Skip',
  stepError: "We couldn't get this step ready. Try again.",
  skipError: "We couldn't skip this step. Try again.",
  textingOff: "Texting isn't set up for your office yet.",
  callListName: 'Civic panel calls',
  progressLabel: 'Members toward your goal',
  ofGoal: (goal: string) => ` of ${goal} members`,
  answersToday: (answers: string) =>
    `About ${answers} answers per question today`,
  // The goal in answers: members × the panel reply rate, as "4 in 10".
  goalWhy: (inTen: number, goal: string, needed: string) =>
    `About ${inTen} in 10 members answer each question, so ${goal} members gets you the ${needed} answers you need.`,
  yourTime: 'Your time',
  changeHours: 'Change',
  changeHoursLabel: 'Change your weekly time',
  changeHoursCaption: 'Your next round of invites uses the new time.',
  saveHours: 'Save weekly time',
  cancel: 'Cancel',
  saveHoursError: "We couldn't change your weekly time. Try again.",
} as const
