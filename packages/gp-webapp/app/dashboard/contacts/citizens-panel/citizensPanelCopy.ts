import {
  CIVIC_PANEL_SEGMENT,
  type CivicPanelPlaceKind,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'

// Where the panel stands, for the page's lead card.
export type CivicPanelStage =
  | 'start'
  | 'building'
  | 'paused'
  | 'ready'
  | 'exhausted'

const count = (n: number): string => n.toLocaleString('en-US')

// A name that starts its line: a group, or a tract label like "around Calm
// Water Dr", which reads lower case mid-sentence.
export const capitalizeFirst = (words: string): string =>
  words.charAt(0).toUpperCase() + words.slice(1)

export const CITIZENS_PANEL_PATH = '/dashboard/contacts/citizens-panel'

// Where the official came to the panel page from, for its Civic Panel Viewed event.
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
  askableNow: 'Ready to ask',
  askableNowDetail: 'Not contacted in the last 30 days',
  seePanel: 'See your civic panel',
  empty: 'Nobody has joined your civic panel yet.',
  loadError:
    "We couldn't load your civic panel. Refresh the page to try again.",
  backToContacts: 'Back to constituents',
  seeMembers: 'See members',
  membersLoading: 'Loading members…',
  membersError: "We couldn't load the members right now.",
  membersShown: (shown: number, total: number) =>
    `Showing the first ${count(shown)} of ${count(total)}.`,
  listTitle: 'Civic panel',
  listFilter: 'On your civic panel.',
  // The seats' places in the words of what the district was split by.
  seatPlaces: {
    tract: {
      title: "Who's on your civic panel, by census tract",
      name: (name: string) => `Tract ${name}`,
      one: 'tract',
      many: 'tracts',
      full: 'Every tract has its share of seats filled.',
    },
    precinct: {
      title: "Who's on your civic panel, by precinct",
      name: (name: string) => `Precinct ${name}`,
      one: 'precinct',
      many: 'precincts',
      full: 'Every precinct has its share of seats filled.',
    },
  } satisfies Record<
    CivicPanelPlaceKind,
    {
      title: string
      name: (name: string) => string
      one: string
      many: string
      full: string
    }
  >,
  milestone: {
    firstYes: () => 'First yes',
    canCompare: (at: number) => `${at} members`,
    halfway: () => 'Halfway',
    full: () => 'Full civic panel',
  },
  milestoneState: {
    done: 'Done',
    next: 'Next',
    upcoming: 'Not yet',
  },
  milestonesLabel: "Your civic panel's milestones",
  seatsCaption:
    'Your district as 100 seats, filling as people join your civic panel.',
  // The tract chart's count: a place's seats fill only up to its share, so
  // this is never the member total the hero and the section lead with.
  seatsAtShare: (filled: number, one: string) =>
    `${filled} of 100 seats filled, counting each ${one} only up to its share`,
  seatsAtShareSummary: (
    filled: number,
    behind: number,
    one: string,
    many: string,
  ) =>
    `Your district as 100 seats. ${filled} of 100 seats filled, counting each ${one} only up to its share.${
      behind > 0
        ? ` ${behind} ${behind === 1 ? `${one} is` : `${many} are`} behind the rest.`
        : ''
    }`,
  seatsSummary: (filled: number, behind: number, one: string, many: string) =>
    behind > 0
      ? `Your district as 100 seats. ${filled} of 100 seats filled. ${behind} ${
          behind === 1 ? `${one} is` : `${many} are`
        } behind the rest.`
      : `Your district as 100 seats. ${filled} of 100 seats filled.`,
  legendMember: 'Someone from your civic panel',
  legendNotFilled: 'Not filled yet',
  legendBehind: 'Behind the rest',
  legendEmpty: 'Empty seat',
  furthestBehind: 'Furthest behind',
  mostEmptySeats: 'Most empty seats',
  seatsOf: (filled: number, count: number) =>
    `${filled} of ${count} ${count === 1 ? 'seat' : 'seats'} filled`,
  emptySeats: (empty: number) => `${empty} empty`,
  placeFull: 'Full',
  placesBehind: (behind: number, total: number, many: string) =>
    `${behind} of ${total} ${many} ${behind === 1 ? 'is' : 'are'} behind the rest.`,
  emptyIn: (places: number, total: number, many: string) =>
    `Empty seats are in ${places} of ${total} ${many}.`,
  bloomCaption:
    'Each petal is a group, and past the ring means more than its share.',
  bloomAtShare: (atShare: number, total: number) => `${atShare} of ${total}`,
  bloomAtShareLabel: 'at their share',
  bloomSummary: (atShare: number, total: number) =>
    `${atShare} of ${total} groups have at least their share of members.`,
  aboutShare: 'About its share',
  percentOfShare: (percent: number) => `${percent}% of its share`,
  legendOver: 'More than their share',
  legendUnder: 'Fewer than their share',
  legendEven: 'About even',
  legendRing: 'Their share of your district',
  everyGroupShare: 'Every group has its share.',
  // A petal's name, short enough to sit around the flower.
  groupLabel: {
    age18to24: '18 to 24',
    age25to34: '25 to 34',
    age35to44: '35 to 44',
    age45to54: '45 to 54',
    age55to64: '55 to 64',
    age65plus: '65 and over',
    unreachedAreas: 'Unreached areas',
    men: 'Men',
    women: 'Women',
    white: 'White',
    black: 'Black',
    hispanic: 'Hispanic or Latino',
    asian: 'Asian',
  } satisfies Record<UnderrepresentedGroup, string>,
  balanceTooFew: (minimum: number) =>
    `We'll compare your civic panel with your district once ${minimum} people join.`,
  // The page's lead card, by where the panel stands.
  hero: {
    start: {
      title: 'Your civic panel starts here',
      line: () => 'Every resident who says yes takes a seat.',
    },
    building: {
      title: 'Your civic panel is filling up',
      line: (members: number, goal: number, place: string | null) =>
        `${count(members)} ${place ? `${place} ` : ''}${members === 1 ? 'resident is' : 'residents are'} ready to share their views, on the way to ${count(goal)}.`,
    },
    // The home card says the same (gp-api's managedPanelProgressCardContent).
    paused: {
      title: 'Your civic panel is paused',
      line: (members: number, goal: number) =>
        members === 0
          ? 'Nobody has joined yet. Resume invites to start filling it.'
          : `${count(members)} of ${count(goal)} residents have joined. Resume invites to keep filling it.`,
    },
    ready: {
      title: 'Your civic panel is ready',
      // A managed panel stays ready as members leave, so it only claims
      // every seat while they still fill the goal.
      line: (members: number, goal: number) =>
        members >= goal
          ? `All ${count(goal)} seats are filled. Ask them before your next vote.`
          : `${count(members)} ${members === 1 ? 'resident is' : 'residents are'} on your civic panel. Ask them before your next vote.`,
    },
    exhausted: {
      title: 'Every resident we can text has an invite',
      line: (members: number, goal: number) =>
        `${count(members)} of ${count(goal)} residents have joined your civic panel.`,
    },
  } satisfies Record<
    CivicPanelStage,
    {
      title: string
      line: (members: number, goal: number, place: string | null) => string
    }
  >,
  // The hero's bar below lg, in place of the seats.
  joinedOfGoal: (members: number, goal: number) =>
    `${count(members)} of ${count(goal)} residents have joined`,
  firstJoinTitle: 'Who joins first',
  firstJoinLine: (firstInvites: string | null, place: string) =>
    `${firstInvites ? `Your first invites go out ${firstInvites}. ` : ''}As residents reply, they take their seats here, and you'll see which parts of ${place} we still need to hear from.`,
  nextTitle: "Who we're inviting next",
  nextTitleExhausted: 'Groups still short',
  nextLine: (place: string) =>
    `These groups have fewer seats than their share of ${place}, so the next invites lean toward them.`,
  nextLineExhausted: (place: string) =>
    `Everyone we can text has been invited. These groups have fewer seats than their share of ${place}.`,
  groupSeats: (have: number, need: number) =>
    `${have} of ${need} ${need === 1 ? 'seat' : 'seats'}`,
  seeEveryGroup: 'See every group',
  // A tract with no human name yet, never its number.
  unnamedTract: (place: string) => `A part of ${place}`,
  yourDistrict: 'your district',
  // The pinned chat bar's question on this page. "civic panel" never
  // breaks across its two lines on a phone.
  chatPlaceholder: 'Ask who still needs to join your civic\u00a0panel',
} as const
