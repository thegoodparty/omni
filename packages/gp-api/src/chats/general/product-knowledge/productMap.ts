// The product map: what GoodParty.org's product does, where each part of it
// lives, and what the assistants can and cannot change from chat.
//
// WHY THIS FILE EXISTS. A quarter of everything candidates ask the Campaign
// Manager is a product question, and until this existed neither assistant had
// any description of the platform in its prompt. They guessed at menu
// locations they could not see, relayed stale web-search results about
// GoodParty back to GoodParty users, recommended two third-party canvassing
// apps to a candidate who already had our door-knocking tool, and named eight
// different support routes across fifteen sessions. (Campaign manager
// conversation audit, September 2026, section 3; the chief of staff audit
// found the same gap in July.)
//
// HOW TO CHANGE IT. This is one source of truth for both assistants, rendered
// into each prompt by productKnowledgePrompt.ts. Every nav tab in
// gp-webapp's DashboardMenu.tsx must have an entry here, and CI fails a PR
// that adds one without it (scripts/product-map-coverage.ts). Read
// docs/product-knowledge.md before editing.
//
// WHAT BELONGS HERE. Only what a user could see and act on: the name of the
// tab as it reads in the left rail, what they do there, and where things sit
// inside it. Not our architecture, not service names, not flag names. If a
// statement would be wrong the day a designer renames a button, it is too
// specific to be worth the staleness.

export type ProductMode = 'win' | 'serve'

export interface ProductArea {
  // The nav item id in gp-webapp's DashboardMenu.tsx, which the coverage
  // check matches against. Null for a real surface with no tab of its own
  // (door knocking and the website builder are both reached from elsewhere).
  navId: string | null
  // Exactly what the tab reads in the left rail. The assistant tells users to
  // click this string, so it must match the UI character for character.
  name: string
  path: string
  modes: ProductMode[]
  // One sentence, in the user's terms: what they do here.
  does: string
  // Notable things INSIDE the area, for the "where do I find X" questions
  // that made the assistant guess. Each entry names what it is and where it
  // sits on the page.
  inside?: string[]
  // Access note, when the area is not simply available: Pro, a payment, a
  // prerequisite. Stated as the user experiences it.
  gate?: string
  // A second nav entry pointing at an area already described above (the
  // account menu repeats Profile and Community). It still needs an entry so
  // the coverage check sees the id, but rendering it again would tell the
  // assistant the same thing twice under the same name.
  aliasOf?: string
}

// Areas both products share. Billing lives in Account Settings, which is the
// single most common escalation the assistants get wrong.
const SHARED_AREAS: ProductArea[] = [
  {
    // The rendered one. `campaign-details-dashboard` below carries the label
    // 'My Profile', but that menu item has no v2Category and the nav filters
    // it out, so no user has ever seen those words. What they see is this.
    navId: 'nav-dash-profile',
    name: 'Profile',
    path: '/dashboard/profile',
    modes: ['win', 'serve'],
    does: 'Edit your own name, contact details, and campaign or office details.',
    inside: ['In the account menu, at the bottom of the left-hand menu'],
  },
  {
    navId: 'campaign-details-dashboard',
    name: 'My Profile',
    path: '/dashboard/profile',
    modes: ['win', 'serve'],
    does: 'The same profile page. This menu entry is filtered out of the nav and never renders.',
    aliasOf: 'Profile',
  },
  {
    navId: 'nav-dash-account',
    name: 'Account Settings',
    path: '/dashboard/account',
    modes: ['win', 'serve'],
    does: 'Billing, subscription, and closing an account. This is where every payment and cancellation question goes.',
  },
  {
    navId: 'nav-dash-support',
    name: 'Get help',
    // Not a section: it ends the main nav on desktop and sits in the account
    // group on mobile. See SUPPORT_ROUTE in productKnowledgePrompt.ts.
    path: 'the bottom of the left-hand menu',
    modes: ['win', 'serve'],
    does: 'Opens the support chat, where a person answers billing, account, and anything that needs changing on their behalf.',
    inside: [
      'It opens the chat in place; there is no separate page to navigate to',
    ],
  },
  {
    // Same story as Profile: the rendered label is "Community Forum", in the
    // account menu. The 'community-dashboard' entry's "Community" label is
    // filtered out of the nav and never reaches a screen.
    navId: 'nav-dash-community',
    name: 'Community Forum',
    path: 'the GoodParty.org community on Circle',
    modes: ['win', 'serve'],
    does: 'A separate community site where candidates and elected officials talk to each other. It opens in a new tab and is not part of the dashboard.',
    inside: ['In the account menu, at the bottom of the left-hand menu'],
  },
  {
    navId: 'community-dashboard',
    name: 'Community',
    path: 'the GoodParty.org community on Circle',
    modes: ['win', 'serve'],
    does: 'The same community site. This menu entry is filtered out of the nav and never renders.',
    aliasOf: 'Community Forum',
  },
]

// Win: the candidate product. Campaign Manager is the home tab.
const WIN_AREAS: ProductArea[] = [
  {
    navId: 'campaign-tracker-dashboard',
    name: 'Campaign Manager',
    path: '/dashboard',
    modes: ['win'],
    does: 'The home tab, and where this chat lives, alongside the week’s highest-impact tasks.',
    inside: [
      'Each reply carries a copy button and a thumbs up / thumbs down',
      'Rating a reply opens a bubble for an optional note; tapping the same thumb again takes the rating back',
    ],
  },
  {
    navId: 'campaign-story-dashboard',
    name: 'Your Story',
    path: '/dashboard/campaign-story',
    modes: ['win'],
    does: 'The three Campaign Story questions (why you are running, your background, your positions), which the campaign plan and tracker are generated from.',
    inside: [
      'One Save in the page title bar commits every field at once; nothing saves until they press it',
      'Start over at the bottom clears the fields on screen but deletes nothing until they Save',
    ],
  },
  {
    navId: 'campaign-plan-dashboard',
    name: 'Campaign Tracker',
    path: '/dashboard/campaign-plan',
    modes: ['win'],
    does: 'The generated campaign plan and the week-by-week task list built from the Campaign Story.',
    gate: 'Generated from a finished Campaign Story, so it is empty until the story is complete.',
  },
  {
    navId: 'outreach-dashboard',
    name: 'Voter Outreach',
    path: '/dashboard/outreach',
    modes: ['win'],
    does: 'Build and send outreach to a voter audience, and see the history of what has gone out.',
    inside: [
      'Five channels: SMS, Robocall, Social media, Phone banking, and Door knocking',
      'Door knocking opens its own page rather than a flow here',
      'Each channel starts by asking who to reach, which reads from your saved lists',
    ],
  },
  {
    navId: 'win-contacts-dashboard',
    name: 'Voter Data',
    path: '/dashboard/contacts',
    modes: ['win'],
    does: 'Browse the district’s voter file, filter it, and save lists to use for outreach.',
    inside: [
      'Saved lists live HERE, on the lists index below the district stat card. This is the answer to "where are my lists" and it is not under Contacts',
      'Create new list is in the top bar of the page',
      'The district stat card carries projected turnout and voters needed to win',
      'Recommended voter lists sit above the saved lists: ready-made audiences (voters who have not heard from you, persuadable independent-leaning voters, your supporters to invite or turn out) with a Details view and a Send outreach button, no saving needed',
      'Send outreach on any list, saved or recommended, opens Choose a channel, then that channel’s outreach flow with the list already picked',
      'Opening a list shows its filter summary and outreach history, never a table of individual voters',
    ],
    gate: 'Filtering the voter file needs the Pro upgrade. Without Pro the page still shows district aggregates and a blurred preview.',
  },
  {
    navId: 'race-opponent-dashboard',
    name: 'Know Your Opponent',
    path: '/dashboard/race-opponent',
    modes: ['win'],
    does: 'Opposition research on the other candidates in the race, starting with a pass on the candidate’s own public record.',
    gate: 'Pro only. The tab is visible without Pro but shows an upgrade view instead of the research.',
  },
  {
    navId: 'public-profile-campaign',
    name: 'Public Profile',
    path: '/dashboard/public-profile',
    modes: ['win'],
    does: 'Edit the public page voters see, including its own "Why I’m running" and priorities.',
  },
  {
    navId: null,
    name: 'Candidate website',
    path: '/dashboard/website',
    modes: ['win'],
    does: 'A free campaign website: pick a theme, edit it section by section, and connect a custom domain.',
    inside: [
      'Reached from the dashboard rather than the left rail',
      'Custom domain setup and its DNS instructions are under the site’s Domain settings',
    ],
  },
  {
    // The nav id belongs to a placeholder that holds the Voter Data slot
    // for the moment before we know whether the org is a campaign.
    // Describing it as a second "Voter Data" tab would be wrong: what a
    // candidate can actually reach here is the upgrade flow.
    navId: 'upgrade-pro-dashboard',
    name: 'Pro upgrade',
    path: '/dashboard/pro-upgrade',
    modes: ['win'],
    does: 'Upgrade to Pro, which is what unlocks filtering the voter file and Know Your Opponent.',
    inside: [
      'One flow: the Pro pitch, then EIN, filing details, and candidate profile for texting compliance, then payment',
      'All of the compliance data is collected before paying',
    ],
  },
  {
    navId: 'nav-dash-team',
    name: 'Team',
    path: '/dashboard/team',
    modes: ['win'],
    does: 'Invite campaign staff and manage who has access. In the account menu, and candidate campaigns only.',
    inside: [
      'Only the owner can remove members or change roles',
      'A member can also leave on their own: Leave campaign in the sidebar of their volunteer view',
    ],
  },
]

// Serve: the elected-official product. Chief of Staff is the home tab.
const SERVE_AREAS: ProductArea[] = [
  {
    navId: 'chief-of-staff-dashboard',
    name: 'Chief of Staff',
    path: '/dashboard/chief-of-staff',
    modes: ['serve'],
    does: 'The home tab, and where this chat lives.',
    inside: [
      'Each reply carries a copy button and a thumbs up / thumbs down',
      'Rating a reply opens a bubble for an optional note; tapping the same thumb again takes the rating back',
      'A list shown on a map here has Draw an area / Edit area beside Open list, which narrows that list to the shape without leaving the conversation',
      'A list already used for outreach is locked, so its map offers no draw button',
    ],
  },
  {
    navId: 'briefings-dashboard',
    name: 'Briefing Assistant',
    path: '/dashboard/briefings',
    modes: ['serve'],
    does: 'Prepared briefings for upcoming meetings: what is on the agenda and what is worth knowing before the room.',
    inside: [
      'Ask AI on a briefing opens a chat about that briefing',
      'Highlighting text in a briefing starts a question anchored to that passage',
      'Notes taken on a briefing stay with it',
    ],
  },
  {
    navId: 'community-issues-dashboard',
    name: 'Community Issues',
    path: '/dashboard/community-issues',
    modes: ['serve'],
    does: 'A researched feed of what the district is talking about, split into the top ongoing issues and what is trending now.',
    inside: [
      'View all issues and View all open the full lists',
      'An issue’s detail page shows its category, rank, sources, and the briefings it touches',
    ],
  },
  {
    navId: 'ordinances-dashboard',
    name: 'Ordinances',
    path: '/dashboard/ordinances',
    modes: ['serve'],
    does: 'Work a policy idea up into a drafted ordinance, one step at a time.',
    inside: [
      'The steps run in order: whether the body has the authority, what the current law says, what comparable places did, then a draft',
      'Each step has its own chat, so a question asked on one step stays there',
    ],
  },
  {
    navId: 'polls-dashboard',
    name: 'Polls',
    path: '/dashboard/polls',
    modes: ['serve'],
    does: 'Commission a poll of the district and read the results.',
    gate: 'Polls are paid for individually, and a poll’s reach can be extended by paying more.',
  },
  {
    navId: 'constituent-outreach-dashboard',
    name: 'Constituent Outreach',
    path: '/dashboard/constituent-outreach',
    modes: ['serve'],
    does: 'Build and send outreach to constituents, and see what has gone out.',
    inside: [
      'Four channels: Social media, SMS, Phone banking, and Door knocking',
      'Door knocking opens its own page rather than a flow here',
      'SMS drafts a text, picks a saved constituent list, and is paid for before it sends',
      'A text send goes out at 11am local on the date chosen, which must be at least 2 business days ahead and no more than 30 days out',
    ],
    gate: 'Texting is being rolled out office by office, so the SMS channel is not on every account yet. It is paid for per message at checkout, with no subscription.',
  },
  {
    navId: 'contacts-dashboard',
    name: 'Constituent Data',
    path: '/dashboard/contacts',
    modes: ['serve'],
    does: 'Browse the district’s people, filter them, and save lists to use for outreach.',
    inside: [
      'Saved lists live HERE, on the lists index below the district stat card',
      'Create new list is in the top bar of the page',
      'Opening a list shows its filter summary and outreach history, never a table of individual people',
      'Opening a list also shows a map of where its people are',
      'Draw an area on that map to narrow the list to one part of the district',
      'The create-list flow asks for that area too, between the filters and the name, and it can be skipped',
      'An area can be changed or removed until the list has been used for outreach',
      'A constituent’s record carries an "Asked for follow-up" toggle, and the record’s activity history shows who set it and when',
      'A finished phone banking campaign’s results show how many constituents are still owed a follow-up, and can turn them into a call list or a saved list',
      'Party is not a filter in this product',
    ],
  },
  {
    navId: 'public-profile-dashboard',
    name: 'Public Profile',
    path: '/dashboard/public-profile',
    modes: ['serve'],
    does: 'Edit the public page constituents see, including its own "What I’m working on" and priorities.',
  },
]

// Reached from inside another area rather than from a tab, and shared by both
// products. Declared last so neither product's map opens on it.
const CROSS_PRODUCT_AREAS: ProductArea[] = [
  {
    navId: null,
    name: 'Door knocking',
    path: '/dashboard/door-knocking',
    modes: ['win', 'serve'],
    does: 'GoodParty.org’s own canvassing tool: build a walk list, get turf on a map, and log what happened at each door.',
    inside: [
      'Reached from the Door knocking card on the outreach hub, not from a tab of its own',
      'Custom door-knocking surveys, so volunteers log answers in the field',
      'Summaries of interactions by day and by survey answer',
      'A campaign can hold several turfs. Mark the whole campaign done, or one turf at a time, from its row in outreach history. Done does not require every door to have been knocked',
    ],
  },
]

export const PRODUCT_AREAS: ProductArea[] = [
  ...WIN_AREAS,
  ...SERVE_AREAS,
  ...CROSS_PRODUCT_AREAS,
  ...SHARED_AREAS,
]

export const areasForMode = (mode: ProductMode): ProductArea[] =>
  PRODUCT_AREAS.filter((a) => a.modes.includes(mode))

// What chat cannot reach. Every line here is something a user has assumed the
// chat does. Stating them is what keeps the assistant from inventing a reason
// a save "did not go through" and sending someone to check a setting that had
// nothing to do with it.
export const CHAT_LINKAGE: Record<ProductMode, string[]> = {
  win: [
    'The Campaign Story you write with me is saved to Your Story, and finishing it is what generates the campaign plan and tracker.',
    'Your Public Profile is separate. It has its own "Why I’m running" on the Public Profile page, and writing your story here does not change it. If someone wants their story on their public page, say plainly that it has to be entered there and point them at the tab.',
    'Saved lists I create are real, and appear under Voter Data.',
    'I cannot edit the campaign plan, the tracker, your public page, your website, your account, or your billing. I also cannot export a list, a script, or a draft to a file.',
  ],
  serve: [
    'Priorities I record are real and appear in the product.',
    'Saved lists I create are real, and appear under Constituent Data.',
    'I cannot edit your public page, your account, or your billing, and I cannot export anything to a file.',
  ],
}

// The other product, named in one line so an assistant asked about it can
// answer instead of guessing. The office/campaign boundary itself is a
// guardrail, and lives in each prompt.
export const OTHER_PRODUCT: Record<ProductMode, string> = {
  win: 'GoodParty.org has a separate product for people already in office, with a Chief of Staff, meeting briefings, and community issues. A candidate does not have it.',
  serve:
    'GoodParty.org has a separate product for people running for office, with a campaign plan, a tracker, and voter outreach. It is a different account from this one.',
}
