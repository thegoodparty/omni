export const CITIZENS_PANEL_PATH = '/dashboard/contacts/citizens-panel'
export const CHIEF_OF_STAFF_PATH = '/dashboard/chief-of-staff'

export const SERVE_CITIZENS_PANEL_COPY = {
  title: 'Your civic panel',
  caption: 'Residents who said yes to being asked for their views.',
  members: 'Members',
  reachedRecently: 'Reached in the last 30 days',
  reachedRecentlyDetail: 'Texted, called or visited by your office.',
  askableNow: 'Can be asked now',
  seePanel: 'See your panel',
  empty: 'Nobody has joined your civic panel yet.',
  emptyAction: 'Your Chief of Staff can help you build it.',
  buildPanel: 'Build your civic panel',
  loadError:
    "We couldn't load your civic panel. Refresh the page to try again.",
  backToContacts: 'Back to constituent data',
  pageCaption:
    'How many people are on it, and how they compare with your district.',
  seeMembers: 'See members',
  seeMembersError: "We couldn't open your panel list. Try again.",
  listName: 'Civic panel',
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
} as const
