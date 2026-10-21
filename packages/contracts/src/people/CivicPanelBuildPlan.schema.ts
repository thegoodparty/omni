import { z } from 'zod'
import { zDate } from '../shared/Date.schema'
import { GeoJsonPolygonSchema } from '../doorKnocking/DoorKnockingTurf.schema'
import {
  UNDERREPRESENTED_GROUP_NAMES,
  UnderrepresentedGroupSchema,
} from '../priorities/PriorityResults.schema'

// Building the civic panel across texts, calls and doors, in waves
// (/v1/contacts/civic-panel/plan). Texts are cheap and go first; calls reach
// the residents a text cannot; doors cover one or two walkable areas. The
// official gives one number, the hours they can give each week (at least
// one: a text alone does not build a panel), and every size below follows
// from it.

// The panel page, the plan's home. A step's link opens it on that step.
export const CIVIC_PANEL_PAGE_HREF = '/dashboard/contacts/citizens-panel'

// The weekly time a plan asks of the official. Never 0: their own calls and
// doors reach the residents a text misses. A wave is sized from about a
// month of it.
export const PANEL_MIN_HOURS_PER_WEEK = 1
export const PANEL_MAX_HOURS_PER_WEEK = 20
export const PANEL_WEEKS_PER_WAVE = 4

// The official's pace on the panel ask, including the conversation. Slower
// than a turnout walk (45 doors an hour) because every door that answers is
// asked a question and may want it explained.
export const PANEL_CALLS_PER_HOUR = 15
export const PANEL_DOORS_PER_HOUR = 20

// The share of a call or a knock that ends in a yes to joining. Assumptions,
// like the cold text rate, until offices' own calls and doors measure them:
// a call reaches fewer people than a door, and a door converts best.
export const PANEL_CALL_ASSUMED_JOIN_RATE = 0.05
export const PANEL_DOOR_ASSUMED_JOIN_RATE = 0.1

// How a wave's hours divide when both calls and doors are possible.
export const PANEL_DOOR_SHARE_OF_HOURS = 0.5

// One walkable area is about an evening's knocking, and a wave asks for at
// most two of them. Door hours past that go to calls.
export const PANEL_DOORS_PER_AREA = 100
export const PANEL_MAX_DOOR_AREAS = 2

// A panel member is active when they answered a priority's text, call or
// door within this many days. Past its goal the panel is kept fresh by
// every major group holding PANEL_MEMBERS_PER_GROUP active members.
export const PANEL_ACTIVE_WINDOW_DAYS = 90

// Replies to a text arrive in batches, about three business days after it
// goes out (the same window the results upload works to).
export const PANEL_TEXT_REPLY_BUSINESS_DAYS = 3

// A call list or a walk counts as done this long after it started, even if
// not every name was reached, so one slow list never holds up the next wave.
export const PANEL_STEP_WINDOW_DAYS = 30

// Once the rest of a wave is done, a step nobody started waits this long
// before the next wave goes ahead without it.
export const PANEL_UNSTARTED_STEP_DAYS = 14

export const CIVIC_PANEL_BUILD_CHANNELS = [
  'text',
  'phone_banking',
  'door_knocking',
] as const
export const CivicPanelBuildChannelSchema = z.enum(CIVIC_PANEL_BUILD_CHANNELS)
export type CivicPanelBuildChannel = z.infer<
  typeof CivicPanelBuildChannelSchema
>

// active: being worked. completed: the panel reached its goal, the members
// it takes to answer one question (panelGoalMembers in PanelAnswers). exhausted:
// nobody reachable is left to ask. One active plan per office.
export const CIVIC_PANEL_BUILD_PLAN_STATUSES = [
  'active',
  'completed',
  'exhausted',
] as const
export const CivicPanelBuildPlanStatusSchema = z.enum(
  CIVIC_PANEL_BUILD_PLAN_STATUSES,
)
export type CivicPanelBuildPlanStatus = z.infer<
  typeof CivicPanelBuildPlanStatusSchema
>

// Read off real data on every read, never set by the official:
// not_started: nothing sent, called or knocked from it yet.
// in_progress: a text paid for but not yet out; a call list or a walk
//   created and not finished.
// waiting_on_replies: a text that went out, until its replies are in.
// done: replies in (or their window passed); calls or knocks logged for
//   everyone on the list, the list or walk marked done, or its window passed.
// skipped: never started, and the official skipped it or a later wave went
//   ahead without it.
export const CIVIC_PANEL_BUILD_STEP_STATUSES = [
  'not_started',
  'in_progress',
  'waiting_on_replies',
  'done',
  'skipped',
] as const
export const CivicPanelBuildStepStatusSchema = z.enum(
  CIVIC_PANEL_BUILD_STEP_STATUSES,
)
export type CivicPanelBuildStepStatus = z.infer<
  typeof CivicPanelBuildStepStatusSchema
>

export const CreateCivicPanelBuildPlanInputSchema = z.object({
  hoursPerWeek: z
    .number()
    .int()
    .min(PANEL_MIN_HOURS_PER_WEEK)
    .max(PANEL_MAX_HOURS_PER_WEEK),
})
export type CreateCivicPanelBuildPlanInput = z.infer<
  typeof CreateCivicPanelBuildPlanInputSchema
>

// PATCH /v1/contacts/civic-panel/plan: a new answer to the weekly time question.
// Waves made from now on are sized from it; the current one stays as it is.
export const UpdateCivicPanelBuildPlanInputSchema =
  CreateCivicPanelBuildPlanInputSchema
export type UpdateCivicPanelBuildPlanInput = z.infer<
  typeof UpdateCivicPanelBuildPlanInputSchema
>

// POST /v1/contacts/civic-panel/plan/steps/:id/mark: the official ticks a
// call or door step done, or unticks it, over what its list says. A text
// checks itself once it is sent.
export const MarkCivicPanelBuildStepInputSchema = z.object({
  done: z.boolean(),
})
export type MarkCivicPanelBuildStepInput = z.infer<
  typeof MarkCivicPanelBuildStepInputSchema
>

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
// `inviteMore` is the largest group short of members, else of active members. Absent before the goal.
export const CivicPanelBalanceSchema = z.object({
  status: CivicPanelBalanceStatusSchema,
  inviteMore: UnderrepresentedGroupSchema.nullable(),
  groupsNeedingFresh: z.number().int().nonnegative().optional(),
})
export type CivicPanelBalance = z.infer<typeof CivicPanelBalanceSchema>

// targetSize is residents to text, residents to call, or households to
// knock, by channel. `markedDone` is the official's own tick (true) or
// untick (false), null while the step reads off its list. `reached` is the
// residents called or knocked (null for a text or before anything was
// logged), `joined` the residents the step drew who are on the panel now
// (null before its list is drawn).
export const CivicPanelBuildStepSchema = z.object({
  id: z.string(),
  wave: z.number().int(),
  channel: CivicPanelBuildChannelSchema,
  position: z.number().int(),
  targetSize: z.number().int(),
  status: CivicPanelBuildStepStatusSchema,
  voterFileFilterId: z.number().int().nullable(),
  outreachId: z.number().int().nullable(),
  phoneBankingListId: z.number().int().nullable(),
  doorKnockingTurfId: z.number().int().nullable(),
  startedAt: zDate().nullable(),
  completedAt: zDate().nullable(),
  expectedRepliesBy: zDate().nullable(),
  markedDone: z.boolean().nullable(),
  reached: z.number().int().nullable(),
  joined: z.number().int().nullable(),
  // The group the step's draw leans toward: the one its text or calls
  // weight up, or unreachedAreas for doors in a part of the district the
  // panel has barely reached. Before the list is drawn, what it would lean
  // toward now; after, what it did. Null when it leans toward nobody.
  steeredToward: UnderrepresentedGroupSchema.nullable(),
  // A call step's draw puts landlines first, or draws from every phone once
  // the panel holds its share of people 65 and over. Before the list is
  // drawn, what it would do now; after, what it did. Null for texts and
  // doors.
  landlineFirst: z.boolean().nullable(),
})
export type CivicPanelBuildStep = z.infer<typeof CivicPanelBuildStepSchema>

// The one thing to do next, in the words the panel page's Next line and a
// Chief of Staff card both show. `href` is null while there is nothing to
// do but wait.
export const CivicPanelBuildNextSchema = z.object({
  stepId: z.string().nullable(),
  channel: CivicPanelBuildChannelSchema.nullable(),
  status: CivicPanelBuildStepStatusSchema.nullable(),
  line: z.string(),
  href: z.string().nullable(),
})
export type CivicPanelBuildNext = z.infer<typeof CivicPanelBuildNextSchema>

export const CivicPanelBuildPlanSchema = z.object({
  id: z.string(),
  status: CivicPanelBuildPlanStatusSchema,
  goalMembers: z.number().int(),
  keepFresh: z.boolean().default(false),
  hoursPerWeek: z.number().int(),
  currentWave: z.number().int(),
  createdAt: zDate(),
  completedAt: zDate().nullable(),
  steps: z.array(CivicPanelBuildStepSchema),
})
export type CivicPanelBuildPlan = z.infer<typeof CivicPanelBuildPlanSchema>

// Where the panel stands. `groupsCovered` of `groupsTotal` major groups
// have enough members to expect three answers (PANEL_MEMBERS_PER_GROUP);
// both are 0 when the district could not be read. `goal` is the members the
// plan is sized to, from `answersNeeded` (the district's, of its smallest
// major group); `expectedAnswers` is what the members are expected to give.
export const CivicPanelBuildProgressSchema = z.object({
  members: z.number().int(),
  goal: z.number().int(),
  answersNeeded: z.number().int(),
  expectedAnswers: z.number().int(),
  groupsCovered: z.number().int().nonnegative().default(0),
  groupsTotal: z.number().int().nonnegative().default(0),
})
export type CivicPanelBuildProgress = z.infer<
  typeof CivicPanelBuildProgressSchema
>

export const civicPanelFreshnessText = (groupsNeedingFresh: number): string =>
  groupsNeedingFresh === 0
    ? 'Every group has fresh voices'
    : groupsNeedingFresh === 1
      ? '1 group needs fresh voices'
      : `${groupsNeedingFresh} groups need fresh voices`

// Where the panel stands, in the words the Chief of Staff's card and chat
// both use: "62 members so far, from 9 of 12 groups in your district." Past
// the goal it is judged on active members instead: "250 members. 3 groups
// need fresh voices."
export const civicPanelStandingLine = (
  progress: Pick<
    CivicPanelBuildProgress,
    'members' | 'groupsCovered' | 'groupsTotal'
  >,
  balance: Pick<CivicPanelBalance, 'groupsNeedingFresh'> | null = null,
): string => {
  if (balance?.groupsNeedingFresh != null) {
    const members = `${progress.members.toLocaleString('en-US')} ${
      progress.members === 1 ? 'member' : 'members'
    }`
    return `${members}. ${civicPanelFreshnessText(balance.groupsNeedingFresh)}.`
  }
  const members = `${progress.members.toLocaleString('en-US')} ${
    progress.members === 1 ? 'member' : 'members'
  } so far`
  return progress.groupsTotal > 0
    ? `${members}, from ${progress.groupsCovered} of ${progress.groupsTotal} groups in your district.`
    : `${members}.`
}

// A plan step in the words the panel page, the Chief of Staff's chat card and
// its home card all use: a title naming who to reach, and one line on who
// they are and how long it takes.
export const CIVIC_PANEL_STEP_COPY = {
  stepTitle: {
    text: (size: string) => `Text ${size} residents`,
    phone_banking: (size: string) => `Call ${size} residents`,
    door_knocking: (size: string, position: number) =>
      position > 1
        ? `Knock on ${size} doors in a second walkable area`
        : `Knock on ${size} doors in a walkable area`,
  },
  stepDetail: {
    text: 'Residents with a cell phone, from every part of your district.',
    phone_banking: (time: string) =>
      `People a text can't reach, landlines first. ${time} of your time.`,
    door_knocking: (time: string) => `One walkable area. ${time} of your time.`,
  },
  // A step's line when its draw leans toward a group the panel trails.
  stepLean: {
    text: (group: string) => `This batch invites more ${group}.`,
    phone_banking: (time: string) =>
      `People a text can't reach. ${time} of your time.`,
    door_knocking: (time: string) =>
      `A part of your district we haven't reached. ${time} of your time.`,
  },
  duration: (minutes: number) =>
    minutes < 50
      ? `About ${Math.max(5, Math.round(minutes / 5) * 5)} minutes`
      : minutes < 90
        ? 'About an hour'
        : `About ${Math.round(minutes / 60)} hours`,
  calledSoFar: (called: string) => `Called ${called} so far.`,
  knockedSoFar: (visited: string) => `Visited ${visited} residents so far.`,
  startStep: {
    text: 'Start the text',
    phone_banking: 'Start the calls',
    door_knocking: 'Start door knocking',
  },
  keepGoing: {
    phone_banking: 'Keep calling',
    door_knocking: 'Keep knocking',
  },
} as const

const countOf = (value: number): string => value.toLocaleString('en-US')

export const civicPanelStepMinutes = (
  step: Pick<CivicPanelBuildStep, 'channel' | 'targetSize'>,
): number =>
  (step.targetSize /
    (step.channel === 'door_knocking'
      ? PANEL_DOORS_PER_HOUR
      : PANEL_CALLS_PER_HOUR)) *
  60

// "Call 60 residents".
export const civicPanelStepTitle = (
  step: Pick<CivicPanelBuildStep, 'channel' | 'position' | 'targetSize'>,
): string => {
  const size = countOf(step.targetSize)
  return step.channel === 'door_knocking'
    ? CIVIC_PANEL_STEP_COPY.stepTitle.door_knocking(size, step.position)
    : CIVIC_PANEL_STEP_COPY.stepTitle[step.channel](size)
}

// The line under a step still to take: who it reaches and how long it
// takes, or how far a call list or walk underway has got. A text underway
// or sent has a dated line of its own on the panel page.
export const civicPanelOpenStepDetail = (
  step: Pick<
    CivicPanelBuildStep,
    | 'channel'
    | 'targetSize'
    | 'status'
    | 'reached'
    | 'steeredToward'
    | 'landlineFirst'
  >,
): string => {
  const copy = CIVIC_PANEL_STEP_COPY
  if (step.channel === 'text') {
    return step.steeredToward && step.status === 'not_started'
      ? copy.stepLean.text(UNDERREPRESENTED_GROUP_NAMES[step.steeredToward])
      : copy.stepDetail.text
  }
  const calls = step.channel === 'phone_banking'
  if (step.status === 'in_progress' && step.reached !== null) {
    const reached = countOf(step.reached)
    return calls ? copy.calledSoFar(reached) : copy.knockedSoFar(reached)
  }
  const time = copy.duration(civicPanelStepMinutes(step))
  if (calls) {
    return step.landlineFirst === false
      ? copy.stepLean.phone_banking(time)
      : copy.stepDetail.phone_banking(time)
  }
  return step.steeredToward === 'unreachedAreas'
    ? copy.stepLean.door_knocking(time)
    : copy.stepDetail.door_knocking(time)
}

// The step's button: start it, or keep going on a call list or walk
// underway. Null when there is nothing to press, such as a text on its way.
export const civicPanelStepAction = (
  step: Pick<CivicPanelBuildStep, 'channel' | 'status'>,
): string | null => {
  if (step.status === 'not_started') {
    return CIVIC_PANEL_STEP_COPY.startStep[step.channel]
  }
  if (step.status !== 'in_progress' || step.channel === 'text') return null
  return CIVIC_PANEL_STEP_COPY.keepGoing[step.channel]
}

// Who the members are beside the district, for the panel page's seats and
// petals. `places` splits the district by census tract (each tract's share
// of its adults), or by precinct (each precinct's share of the people on
// file) when the district has no tract data; `placeKind` says which, and
// `name` is the tract number ("9501.02") or the precinct as filed. Members
// with no known place sit out. `groups` is each major group by age band,
// gender, and race when it may be named: its share of the district and of
// the members whose value is known. Shares are fractions, 0.25 is 25%. The
// page draws from them and never prints a share.
export const CIVIC_PANEL_PLACE_KINDS = ['tract', 'precinct'] as const
export const CivicPanelPlaceKindSchema = z.enum(CIVIC_PANEL_PLACE_KINDS)
export type CivicPanelPlaceKind = z.infer<typeof CivicPanelPlaceKindSchema>

export const CivicPanelCompositionPlaceSchema = z.object({
  key: z.string(),
  name: z.string(),
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

// GET and POST /v1/contacts/civic-panel/plan. `plan` is null before the
// official has made one; progress and balance are always the panel as it
// stands.
export const CivicPanelBuildPlanResponseSchema = z.object({
  plan: CivicPanelBuildPlanSchema.nullable(),
  next: CivicPanelBuildNextSchema.nullable(),
  progress: CivicPanelBuildProgressSchema,
  // Null when the district's census or the members could not be read.
  balance: CivicPanelBalanceSchema.nullable(),
  // Null with no members, or when the census or the members could not be
  // read.
  composition: CivicPanelCompositionSchema.nullable().optional(),
})
export type CivicPanelBuildPlanResponse = z.infer<
  typeof CivicPanelBuildPlanResponseSchema
>

// POST /v1/contacts/civic-panel/plan/steps/:id/prepare: the list the step
// drew, and what the standard flow needs to open on it. `area` is the
// walkable area a door step drew, one shape like a turf, for the turf's
// map; null otherwise.
export const PrepareCivicPanelBuildStepResponseSchema = z.object({
  stepId: z.string(),
  channel: CivicPanelBuildChannelSchema,
  voterFileFilterId: z.number().int(),
  purpose: z.string(),
  size: z.number().int(),
  area: GeoJsonPolygonSchema.nullable(),
})
export type PrepareCivicPanelBuildStepResponse = z.infer<
  typeof PrepareCivicPanelBuildStepResponseSchema
>
