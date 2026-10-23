import {
  CIVIC_PANEL_SEGMENT,
  type CivicPanelPlaceKind,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'

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
  loadError:
    "We couldn't load your civic panel. Refresh the page to try again.",
  backToContacts: 'Back to constituents',
  seeMembers: 'See members',
  listTitle: 'Civic panel',
  listFilter: 'On your civic panel.',
  // The seats' places in the words of what the district was split by.
  seatPlaces: {
    tract: {
      title: "Who's on your panel, by census tract",
      name: (name: string) => `Tract ${name}`,
      one: 'tract',
      many: 'tracts',
      full: 'Every tract has its share of seats filled.',
    },
    precinct: {
      title: "Who's on your panel, by precinct",
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
    full: () => 'Full panel',
  },
  milestoneState: {
    done: 'Done',
    next: 'Next',
    upcoming: 'Not yet',
  },
  milestonesLabel: "Your panel's milestones",
  cheerStart: 'Your panel starts here',
  cheerStartLine: 'Every resident who says yes takes a seat.',
  cheerStarted: 'Your panel has started',
  cheerGrowing: 'Your panel is growing',
  cheerHalfway: 'Halfway there',
  cheerAlmost: 'Almost there',
  saidYes: (members: number) =>
    members === 1
      ? '1 resident has said yes.'
      : `${members.toLocaleString('en-US')} residents have said yes.`,
  keepingPace: (members: number, pace: number, total: number, many: string) =>
    `${members.toLocaleString('en-US')} residents have said yes, and ${pace} of ${total} ${many} are keeping pace.`,
  seatsToGo: (seats: number, full: number, total: number, many: string) =>
    `${seats} ${seats === 1 ? 'seat' : 'seats'} to go, and ${full} of ${total} ${many} are full.`,
  membersToGo: (members: number) =>
    `${members.toLocaleString('en-US')} more ${members === 1 ? 'resident' : 'residents'} to go.`,
  fullTitle: 'Every seat is filled',
  fullLine: (members: number, places: number, many: string) =>
    `${members.toLocaleString('en-US')} residents from all ${places} ${many} said yes.`,
  fullLineNoPlaces: (members: number) =>
    `${members.toLocaleString('en-US')} residents said yes.`,
  fullMembers: ' members',
  fullPlaces: (places: number, many: string) => ` of ${places} ${many}`,
  fullGroups: (total: number) => ` of ${total} groups at their share`,
  askPanel: 'Ask your panel a question',
  seatsCaption:
    'Your district as 100 seats, filling as people join your panel.',
  seatsFilled: ' of 100 seats filled',
  seatsSummary: (filled: number, behind: number, one: string, many: string) =>
    behind > 0
      ? `Your district as 100 seats. ${filled} of 100 seats filled. ${behind} ${
          behind === 1 ? `${one} is` : `${many} are`
        } behind the rest.`
      : `Your district as 100 seats. ${filled} of 100 seats filled.`,
  legendMember: 'Someone from your panel',
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
  balanceTitle: 'How your panel compares with your district',
  balanceTooFew: (minimum: number) =>
    `We'll compare your panel with your district once ${minimum} people join.`,
  inviteMore: (group: string) => `Invite more ${group} next.`,
} as const
