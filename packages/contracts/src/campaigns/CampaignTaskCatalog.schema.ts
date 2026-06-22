import { z } from 'zod'

/**
 * The Campaign Tracker task catalog — the closed, hand-authored list of every
 * task a candidate's plan can contain (transcribed from campaign-tasks-master).
 * Shared across services: gp-api materializes the static rows from it, the
 * tracker CAP experiment uses the dynamic subset as its menu, and gp-webapp
 * renders against it. The catalog data lives in `CampaignTaskCatalog.data.ts`.
 *
 * Note: `pills`, `personalization`, `generatorSource`, and `status` are vestigial
 * from the earlier pills/per-item design and are not used by the current tracker
 * model (events are CAP-found, tasks are CAP-prioritized). They are kept as
 * transcribed and can be pruned in a later pass.
 */

export const CampaignStrategyPhaseKeySchema = z.enum([
  'preLaunch',
  'launch',
  'active',
  'gotv',
])
export type CampaignStrategyPhaseKey = z.infer<
  typeof CampaignStrategyPhaseKeySchema
>

export const TaskTypeSchema = z.enum(['static', 'dynamic'])
export type TaskType = z.infer<typeof TaskTypeSchema>

export const TaskChannelSchema = z.enum([
  'text',
  'robocall',
  'doorKnocking',
  'phoneBanking',
  'directMail',
  'event',
  'awareness',
  'general',
])
export type TaskChannel = z.infer<typeof TaskChannelSchema>

export const DayOfWeekSchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
])
export type DayOfWeek = z.infer<typeof DayOfWeekSchema>

export const TaskStatusSchema = z.enum(['live', 'proposed'])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const TaskPersonalizationSchema = z.enum([
  'content-pill',
  'generated-per-item',
  'static',
])
export type TaskPersonalization = z.infer<typeof TaskPersonalizationSchema>

export const PriorityTierSchema = z.enum(['P1', 'P2', 'P3', 'P4'])
export type PriorityTier = z.infer<typeof PriorityTierSchema>

export const GeneratorSourceSchema = z.enum([
  'communityEvents',
  'pressOutlets',
  'officeMeetings',
])
export type GeneratorSource = z.infer<typeof GeneratorSourceSchema>

/**
 * Structured timing a sequencer resolves to a date (or leaves undated).
 * `electionRelative` carries an explicit unit because the sheet schedules sends
 * in weeks but the final GOTV ops in days.
 */
export const TaskTimingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('asap') }),
  z.object({ kind: z.literal('onboardingWeek') }),
  z.object({ kind: z.literal('preLaunch') }),
  z.object({ kind: z.literal('launch') }),
  z.object({
    kind: z.literal('electionRelative'),
    offset: z.number(),
    unit: z.enum(['weeks', 'days']),
  }),
  z.object({ kind: z.literal('electionDay') }),
  z.object({ kind: z.literal('afterElection'), weeks: z.number() }),
  z.object({ kind: z.literal('jurisdiction'), pill: z.string().optional() }),
  z.object({
    kind: z.literal('recurring'),
    interval: z.enum(['weekly', 'monthly', 'evenWeeks', 'oddWeeks', 'waves']),
  }),
  z.object({ kind: z.literal('perItem') }),
])
export type TaskTiming = z.infer<typeof TaskTimingSchema>

/** One hand-authored task in the catalog (mirrors the xlsx Tasks sheet). */
export const CampaignTaskDefinitionSchema = z.object({
  id: z.string(),
  phase: CampaignStrategyPhaseKeySchema,
  type: TaskTypeSchema,
  category: z.string(),
  title: z.string(),
  description: z.string(),
  channel: TaskChannelSchema,
  timing: TaskTimingSchema,
  dayOfWeek: DayOfWeekSchema.optional(),
  // 'adapts' = copy/sends adapt to primary vs general.
  electionType: z.enum(['both', 'adapts']),
  proRequired: z.boolean(),
  status: TaskStatusSchema,
  personalization: TaskPersonalizationSchema,
  pills: z.array(z.string()),
  priorityTier: PriorityTierSchema,
  // Raw prerequisite label from the sheet (a task title or a gate); a hint only.
  unlocksAfter: z.string().optional(),
  generatorSource: GeneratorSourceSchema.optional(),
})
export type CampaignTaskDefinition = z.infer<typeof CampaignTaskDefinitionSchema>
