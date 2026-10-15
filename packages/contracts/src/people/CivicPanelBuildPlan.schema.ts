import { z } from 'zod'
import { zDate } from '../shared/Date.schema'
import { GeoJsonPolygonSchema } from '../doorKnocking/DoorKnockingTurf.schema'

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

// targetSize is residents to text, residents to call, or households to
// knock, by channel.
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
  hoursPerWeek: z.number().int(),
  currentWave: z.number().int(),
  createdAt: zDate(),
  completedAt: zDate().nullable(),
  steps: z.array(CivicPanelBuildStepSchema),
})
export type CivicPanelBuildPlan = z.infer<typeof CivicPanelBuildPlanSchema>

// Where the panel stands, in answers to one question. `answersNeeded` is
// the district's (answersNeeded in PanelAnswers), `expectedAnswers` what the
// members are expected to give it, and `goal` the members it takes to give
// all of them.
export const CivicPanelBuildProgressSchema = z.object({
  members: z.number().int(),
  goal: z.number().int(),
  answersNeeded: z.number().int(),
  expectedAnswers: z.number().int(),
})
export type CivicPanelBuildProgress = z.infer<
  typeof CivicPanelBuildProgressSchema
>

// GET and POST /v1/contacts/civic-panel/plan. `plan` is null before the
// official has made one; progress is always the panel as it stands.
export const CivicPanelBuildPlanResponseSchema = z.object({
  plan: CivicPanelBuildPlanSchema.nullable(),
  next: CivicPanelBuildNextSchema.nullable(),
  progress: CivicPanelBuildProgressSchema,
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
