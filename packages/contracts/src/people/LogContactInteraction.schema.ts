import { z } from 'zod'
import { DoorKnockOutcomeSchema, SupportAnswerSchema } from '../generated/enums'
import { zCoerceDate } from '../shared/Date.schema'

// Manual interaction logging (Feature 3 of the CRM TDD). The request is a
// discriminated union on `channel` so an outcome from the wrong channel's
// vocabulary — or a `supportAnswer` on anything but `doorKnock` — is
// structurally impossible to construct and 400s at the Zod boundary rather
// than needing a runtime cross-field check.
const TextOutcomeSchema = z.enum(['responded', 'opted_out'])
const RobocallOutcomeSchema = z.enum(['answered', 'voicemail_left'])

const NoteSchema = z.string().min(1).max(10_000).optional()

// occurredAt defaults to now when omitted (applied by the caller, not here,
// per the repo's date-fns convention for "now").
const OccurredAtSchema = zCoerceDate().optional()

// .strict() on every branch: a plain z.object() silently strips unknown
// keys, which would let `supportAnswer` ride along on a text/robocall
// payload instead of 400ing at the boundary as the spec requires.
export const LogDoorKnockInteractionSchema = z
  .object({
    channel: z.literal('doorKnock'),
    outcome: DoorKnockOutcomeSchema,
    supportAnswer: SupportAnswerSchema.optional(),
    note: NoteSchema,
    occurredAt: OccurredAtSchema,
  })
  .strict()

export const LogTextInteractionSchema = z
  .object({
    channel: z.literal('text'),
    outcome: TextOutcomeSchema.optional(),
    note: NoteSchema,
    occurredAt: OccurredAtSchema,
  })
  .strict()

export const LogRobocallInteractionSchema = z
  .object({
    channel: z.literal('robocall'),
    outcome: RobocallOutcomeSchema.optional(),
    note: NoteSchema,
    occurredAt: OccurredAtSchema,
  })
  .strict()

export const LogContactInteractionInputSchema = z.discriminatedUnion(
  'channel',
  [
    LogDoorKnockInteractionSchema,
    LogTextInteractionSchema,
    LogRobocallInteractionSchema,
  ],
)

export type LogContactInteractionInput = z.infer<
  typeof LogContactInteractionInputSchema
>

const LoggedInteractionBaseSchema = z.object({
  id: z.string(),
  personId: z.string(),
  occurredAt: zCoerceDate(),
  note: z.string().nullable(),
  manual: z.boolean(),
})

export const LoggedDoorKnockInteractionSchema =
  LoggedInteractionBaseSchema.extend({
    channel: z.literal('doorKnock'),
    outcome: DoorKnockOutcomeSchema,
    supportAnswer: SupportAnswerSchema.nullable(),
  })

export const LoggedTextInteractionSchema = LoggedInteractionBaseSchema.extend({
  channel: z.literal('text'),
  outcome: TextOutcomeSchema.nullable(),
})

export const LoggedRobocallInteractionSchema =
  LoggedInteractionBaseSchema.extend({
    channel: z.literal('robocall'),
    outcome: RobocallOutcomeSchema.nullable(),
  })

export const LogContactInteractionResponseSchema = z.discriminatedUnion(
  'channel',
  [
    LoggedDoorKnockInteractionSchema,
    LoggedTextInteractionSchema,
    LoggedRobocallInteractionSchema,
  ],
)

export type LogContactInteractionResponse = z.infer<
  typeof LogContactInteractionResponseSchema
>
