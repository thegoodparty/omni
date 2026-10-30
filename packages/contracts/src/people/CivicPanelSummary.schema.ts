import { z } from 'zod'
import { zDate } from '../shared/Date.schema'
import { UnderrepresentedGroupSchema } from '../priorities/PriorityResults.schema'

// The built-in `segment` for the panel's members on the contacts list,
// download and people reads: no saved list behind it, so it is always the
// current members and never a copy in the lists index.
export const CIVIC_PANEL_SEGMENT = 'civicPanel'

// The panel page.
export const CIVIC_PANEL_PAGE_HREF = '/dashboard/contacts/citizens-panel'

// A panel member is active when they answered a priority's text, call or
// door within this many days. Past its goal the panel is judged on every
// major group holding PANEL_MEMBERS_PER_GROUP active members.
export const PANEL_ACTIVE_WINDOW_DAYS = 90

// Whether the panel has members in every major group of the district: 3% or
// more of it by age band, gender and tract (and race when enough members
// have one). The official sees the status and the one group to invite more
// of, never a share or a target. Below this many members it is too few to
// tell.
export const PANEL_MIN_MEMBERS_FOR_BALANCE = 30

export const CIVIC_PANEL_BALANCE_STATUSES = [
  'tooFewMembers',
  'missingGroups',
  'everyGroup',
] as const
export const CivicPanelBalanceStatusSchema = z.enum(
  CIVIC_PANEL_BALANCE_STATUSES,
)
export type CivicPanelBalanceStatus = z.infer<
  typeof CivicPanelBalanceStatusSchema
>

export const CIVIC_PANEL_BALANCE_STATUS_LABELS: Record<
  CivicPanelBalanceStatus,
  string
> = {
  tooFewMembers: 'Too few members yet',
  missingGroups: 'Missing some groups',
  everyGroup: 'Every group on your panel',
}

// `groupsNeedingFresh` is set only once the panel is past its goal, where
// the panel is judged on its active members: the major groups holding fewer
// than PANEL_MEMBERS_PER_GROUP of them (PANEL_ACTIVE_WINDOW_DAYS), and
// `inviteMore` is the largest group short of members, else of active
// members. Absent before the goal.
export const CivicPanelBalanceSchema = z.object({
  status: CivicPanelBalanceStatusSchema,
  inviteMore: UnderrepresentedGroupSchema.nullable(),
  groupsNeedingFresh: z.number().int().nonnegative().optional(),
})
export type CivicPanelBalance = z.infer<typeof CivicPanelBalanceSchema>

export const civicPanelFreshnessText = (groupsNeedingFresh: number): string =>
  groupsNeedingFresh === 0
    ? 'Every group has fresh voices'
    : groupsNeedingFresh === 1
      ? '1 group needs fresh voices'
      : `${groupsNeedingFresh} groups need fresh voices`

// Where the panel stands. `groupsCovered` of `groupsTotal` major groups
// have enough members to expect three answers (PANEL_MEMBERS_PER_GROUP);
// both are 0 when the district could not be read. `goal` is the district's
// member goal, from `answersNeeded` (the district's, of its smallest major
// group); `expectedAnswers` is what the members are expected to give.
export const CivicPanelProgressSchema = z.object({
  members: z.number().int(),
  goal: z.number().int(),
  answersNeeded: z.number().int(),
  expectedAnswers: z.number().int(),
  groupsCovered: z.number().int().nonnegative().default(0),
  groupsTotal: z.number().int().nonnegative().default(0),
})
export type CivicPanelProgress = z.infer<typeof CivicPanelProgressSchema>

// Who the members are beside the district, for the panel page's seats and
// petals. `places` splits the district by census tract (each tract's share
// of its adults), or by precinct (each precinct's share of the people on
// file) when the district has no tract data; `placeKind` says which, and
// `name` is the tract number ("9501.02") or the precinct as filed, and
// `label` a tract's human name once it has one ("West Asheville", "around
// Haywood Rd"), distinct within the district; without it the page shows
// the number. Members with no known place sit out. `groups` is each major
// group by age band, gender, and race when it may be named: its share of
// the district and of the members whose value is known. Shares are
// fractions, 0.25 is 25%. The page draws from them and never prints a share.
export const CIVIC_PANEL_PLACE_KINDS = ['tract', 'precinct'] as const
export const CivicPanelPlaceKindSchema = z.enum(CIVIC_PANEL_PLACE_KINDS)
export type CivicPanelPlaceKind = z.infer<typeof CivicPanelPlaceKindSchema>

export const CivicPanelCompositionPlaceSchema = z.object({
  key: z.string(),
  name: z.string(),
  label: z.string().optional(),
  districtShare: z.number(),
  members: z.number().int().nonnegative(),
})
export type CivicPanelCompositionPlace = z.infer<
  typeof CivicPanelCompositionPlaceSchema
>

export const CivicPanelCompositionGroupSchema = z.object({
  group: UnderrepresentedGroupSchema,
  districtShare: z.number(),
  memberShare: z.number(),
})
export type CivicPanelCompositionGroup = z.infer<
  typeof CivicPanelCompositionGroupSchema
>

export const CivicPanelCompositionSchema = z.object({
  placeKind: CivicPanelPlaceKindSchema,
  places: z.array(CivicPanelCompositionPlaceSchema),
  groups: z.array(CivicPanelCompositionGroupSchema),
})
export type CivicPanelComposition = z.infer<typeof CivicPanelCompositionSchema>

// How the members joined: the source of the event that most recently made
// each one a member. `text` is a JOIN reply, `door` and `phone` a yes marked
// at a door or on a call, `hand` someone the office added themselves. The
// four add up to `members`.
export const CivicPanelJoinedBySchema = z.object({
  text: z.number().int().nonnegative(),
  door: z.number().int().nonnegative(),
  phone: z.number().int().nonnegative(),
  hand: z.number().int().nonnegative(),
})
export type CivicPanelJoinedBy = z.infer<typeof CivicPanelJoinedBySchema>

export const NO_CIVIC_PANEL_JOINS: CivicPanelJoinedBy = {
  text: 0,
  door: 0,
  phone: 0,
  hand: 0,
}

// Serve's civic panel at a glance (GET /v1/contacts/civic-panel).
// `reachedRecently` uses the same rule as the notContactedRecently list
// filter, so askableNow matches what a "Not contacted in the last 30 days"
// panel list holds. The two always add up to members. `lastOutreachAt` is
// the newest row of the built-in list's outreach history (a send that
// reached a current member), null when there is none. `progress` is the
// panel toward the district's goal. `balance` is null when the district's
// census or the members could not be read; `composition` is null with no
// members, or when neither could be read. `joinedBy` splits the members by
// how they joined.
export const CivicPanelSummarySchema = z.object({
  members: z.number().int(),
  joinedBy: CivicPanelJoinedBySchema.default(NO_CIVIC_PANEL_JOINS),
  reachedRecently: z.number().int(),
  askableNow: z.number().int(),
  lastOutreachAt: zDate().nullable(),
  progress: CivicPanelProgressSchema,
  balance: CivicPanelBalanceSchema.nullable(),
  composition: CivicPanelCompositionSchema.nullable(),
})
export type CivicPanelSummary = z.infer<typeof CivicPanelSummarySchema>
