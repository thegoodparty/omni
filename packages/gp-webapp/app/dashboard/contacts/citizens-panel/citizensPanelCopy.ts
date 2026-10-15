import { CIVIC_PANEL_SEGMENT } from '@goodparty_org/contracts'

export const CITIZENS_PANEL_PATH = '/dashboard/contacts/citizens-panel'
// The built-in list under Constituent lists. The segment doubles as the list
// id in the path, the way "all" does for All constituents.
export const CITIZENS_PANEL_LIST_PATH = `/dashboard/contacts/lists/${CIVIC_PANEL_SEGMENT}`
export const CHIEF_OF_STAFF_PATH = '/dashboard/chief-of-staff'

export const SERVE_CITIZENS_PANEL_COPY = {
  title: 'Your civic panel',
  caption: 'Residents who said yes to being asked for their views.',
  members: 'Members',
  reachedRecently: 'Reached in the last 30 days',
  reachedRecentlyDetail: 'Texted, called or visited by your office.',
  askableNow: 'Can be asked now',
  askableNowList: 'Make a list of who can be asked now',
  seePanel: 'See your panel',
  empty: 'Nobody has joined your civic panel yet.',
  emptyAction: 'Build it with texts, calls and door knocking.',
  buildPanel: 'Build your civic panel',
  loadError:
    "We couldn't load your civic panel. Refresh the page to try again.",
  backToContacts: 'Back to constituents',
  pageCaption:
    'How many people are on it, and how they compare with your district.',
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
  makePlanBlockedAction: 'Ask your Chief of Staff for another way to start.',
  planLoadError: "We couldn't load your plan. Refresh the page to try again.",
  planTitle: 'Your plan',
  planCaption: 'Each step invites residents to your civic panel.',
  currentWave: 'Up now',
  earlierWaves: 'Earlier',
  stepTitle: {
    text: (size: string) => `Text ${size} residents`,
    phone_banking: (size: string) => `Call ${size} residents`,
    door_knocking: (size: string, position: number) =>
      position > 1
        ? `Knock on ${size} doors in a second walkable area`
        : `Knock on ${size} doors in a walkable area`,
  },
  stepStatus: {
    not_started: 'Not started',
    in_progress: 'In progress',
    waiting_on_replies: (date: string | null) =>
      date ? `Waiting on replies until ${date}` : 'Waiting on replies',
    done: 'Done',
    skipped: 'Skipped',
  },
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
  railTitle: 'Where your panel stands',
  // In answers to one question, the panel's goal: what its members are
  // expected to give against what a clear read needs.
  answers: (expected: string, needed: string) =>
    `Your panel can give about ${expected} of the ${needed} answers you need`,
  answersReached: (needed: string) =>
    `Your panel can give the ${needed} answers you need`,
  memberCount: (members: number, formatted: string) =>
    `${formatted} ${members === 1 ? 'member' : 'members'}`,
  next: 'Next',
  changeHours: 'Change your weekly time',
  changeHoursCaption: 'Your next round of invites uses the new time.',
  saveHours: 'Save weekly time',
  cancel: 'Cancel',
  saveHoursError: "We couldn't change your weekly time. Try again.",
} as const
