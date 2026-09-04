import {
  BookOpenIcon,
  CircleUserRoundIcon,
  ClipboardListIcon,
  FlagIcon,
  LayoutDashboardIcon,
  MegaphoneIcon,
  ScrollTextIcon,
  SendIcon,
  SparklesIcon,
  SwordsIcon,
  UsersRoundIcon,
} from '@styleguide/components/ui/icons'

// One registry for the icon a sidebar tab and its page title bar share. Keyed
// by a serializable string rather than the icon component itself: the pages
// that set navHeader (chief-of-staff, briefings, race-opponent,
// public-profile) are Server Components, and a component reference can't cross
// the RSC boundary into the client DashboardLayout. DashboardMenu resolves its
// own v2Icon from this same map, so a tab's icon and its title bar can't drift.
export const NAV_HEADER_ICONS = {
  sparkles: SparklesIcon,
  clipboard: ClipboardListIcon,
  flag: FlagIcon,
  scroll: ScrollTextIcon,
  send: SendIcon,
  users: UsersRoundIcon,
  swords: SwordsIcon,
  dashboard: LayoutDashboardIcon,
  book: BookOpenIcon,
  profile: CircleUserRoundIcon,
  megaphone: MegaphoneIcon,
}

export type NavHeaderIconKey = keyof typeof NAV_HEADER_ICONS

// Tab names shared by the sidebar item, the page title bar, and the mobile top
// bar, so what a candidate reads at the top of a page always matches the item
// they clicked in the left rail. Same single-source rule as contactsLabels.ts.
export const NAV_LABELS = {
  campaignManager: 'Campaign Manager',
  campaignStory: 'Your Story',
  campaignTracker: 'Campaign Tracker',
  knowYourOpponent: 'Know Your Opponent',
  publicProfile: 'Public Profile',
  voterOutreach: 'Voter Outreach',
  constituentOutreach: 'Constituent Outreach',
} as const
