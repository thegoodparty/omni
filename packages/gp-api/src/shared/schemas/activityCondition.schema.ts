import { z } from 'zod'
import {
  ActivityConditionActionSchema,
  OutreachTypeSchema,
  type ActivityConditionAction,
  type OutreachType,
} from '@goodparty_org/contracts'

// Per-channel outcome vocabulary the activity-condition action multi-select is
// restricted to (2026-07-16 CRM tech design revision, mirrors the Prisma
// `ActivityConditionAction` enum comment). Task 05 (resolution engine) and
// task 09 (wizard UI) render against this same map so the vocabulary can't
// drift between validation, resolution, and display. Only channels with an
// interaction model are keys here — socialMedia stays out until its model
// exists.
export type ActivityConditionChannel = Extract<
  OutreachType,
  'text' | 'p2p' | 'doorKnocking' | 'robocall' | 'phoneBanking'
>

export const ACTIVITY_CONDITION_CHANNEL_ACTIONS: Record<
  ActivityConditionChannel,
  readonly ActivityConditionAction[]
> = {
  text: ['responded', 'no_response', 'opted_out'],
  p2p: ['responded', 'no_response', 'opted_out'],
  doorKnocking: [
    'answered',
    'not_home',
    'refused_to_engage',
    'support_yes',
    'support_unsure',
    'support_no',
  ],
  robocall: ['answered', 'voicemail_left', 'no_answer'],
  phoneBanking: [
    'answered',
    'no_answer',
    'voicemail',
    'wrong_number',
    'refused',
    'support_yes',
    'support_unsure',
    'support_no',
  ],
}

const isActivityConditionChannel = (
  outreachType: OutreachType,
): outreachType is ActivityConditionChannel =>
  outreachType in ACTIVITY_CONDITION_CHANNEL_ACTIONS

export const activityConditionSchema = z
  .object({
    outreachType: OutreachTypeSchema,
    outreachId: z.number().int().nullish(),
    actions: z.array(ActivityConditionActionSchema).default([]),
  })
  .superRefine((condition, ctx) => {
    if (!isActivityConditionChannel(condition.outreachType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outreachType'],
        message: `Activity conditions aren't supported for the "${condition.outreachType}" channel yet — no interaction model exists for it.`,
      })
      return
    }

    const allowedActions =
      ACTIVITY_CONDITION_CHANNEL_ACTIONS[condition.outreachType]
    const invalidActions = condition.actions.filter(
      (action) => !allowedActions.includes(action),
    )
    if (invalidActions.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actions'],
        message: `${invalidActions.join(', ')} not valid for "${condition.outreachType}"; allowed actions: ${allowedActions.join(', ')}`,
      })
    }
  })

export type ActivityCondition = z.infer<typeof activityConditionSchema>
