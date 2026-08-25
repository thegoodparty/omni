import { z } from 'zod'
import {
  ContactStatusFieldSchema,
  ContactStatusSourceSchema,
  DoorKnockOutcomeSchema,
  OutreachTypeSchema,
  PhoneBankCallOutcomeSchema,
  SupportAnswerSchema,
  VoterOutreachAttributionSourceSchema,
  WillVoteAnswerSchema,
} from '../generated/enums'

// The unified per-person activity feed (CRM TDD feature 3, ENG-10695): a
// discriminated union over Serve poll interactions, the sunset-compatibility
// Win legacy outreach rows, and the ContactInteraction* channels. Notes are
// deliberately excluded (ENG-10780) — they live only in the dedicated Notes
// section, not the feed. Produced by gp-api
// (GET /v1/contact-engagement/:id/activities) and consumed by gp-webapp —
// living here keeps the two from drifting.

export const ConstituentActivityTypeSchema = z.enum([
  'POLL_INTERACTIONS',
  'OUTREACH',
  'DOOR_KNOCK',
  'TEXT',
  'ROBOCALL',
  'PHONE_BANKING',
  'STATUS_CHANGE',
])
export type ConstituentActivityType = z.infer<
  typeof ConstituentActivityTypeSchema
>

export const ConstituentActivityEventTypeSchema = z.enum([
  'SENT',
  'RESPONDED',
  'OPTED_OUT',
])
export type ConstituentActivityEventType = z.infer<
  typeof ConstituentActivityEventTypeSchema
>

export const ConstituentActivityEventSchema = z.object({
  type: ConstituentActivityEventTypeSchema,
  date: z.string(),
})
export type ConstituentActivityEvent = z.infer<
  typeof ConstituentActivityEventSchema
>

// Serve poll-interaction activity (elected office context).
export const PollConstituentActivitySchema = z.object({
  type: z.literal(ConstituentActivityTypeSchema.enum.POLL_INTERACTIONS),
  date: z.string(),
  data: z.object({
    pollId: z.string(),
    pollTitle: z.string(),
    events: z.array(ConstituentActivityEventSchema),
  }),
})
export type PollConstituentActivity = z.infer<
  typeof PollConstituentActivitySchema
>

// Win campaign outreach, read from VoterOutreachActivity (keyed on the durable
// lalVoterId). Only present when the request supplies `lalVoterId` — the
// endpoint's sunset-compatibility path for the pre-ContactInteraction Win
// timeline. attributionSource lets the timeline label send-time vs
// per-recipient attribution honestly.
export const OutreachConstituentActivitySchema = z.object({
  type: z.literal(ConstituentActivityTypeSchema.enum.OUTREACH),
  date: z.string(),
  data: z.object({
    activityId: z.number(),
    outreachType: OutreachTypeSchema,
    attributionSource: VoterOutreachAttributionSourceSchema,
  }),
})
export type OutreachConstituentActivity = z.infer<
  typeof OutreachConstituentActivitySchema
>

export const DoorKnockConstituentActivitySchema = z.object({
  type: z.literal(ConstituentActivityTypeSchema.enum.DOOR_KNOCK),
  date: z.string(),
  data: z.object({
    activityId: z.string(),
    outcome: DoorKnockOutcomeSchema,
    supportAnswer: SupportAnswerSchema.nullable(),
    note: z.string().nullable(),
    manual: z.boolean(),
  }),
})
export type DoorKnockConstituentActivity = z.infer<
  typeof DoorKnockConstituentActivitySchema
>

export const TextConstituentActivitySchema = z.object({
  type: z.literal(ConstituentActivityTypeSchema.enum.TEXT),
  date: z.string(),
  data: z.object({
    activityId: z.string(),
    respondedAt: z.string().nullable(),
    optedOutAt: z.string().nullable(),
    note: z.string().nullable(),
    manual: z.boolean(),
    outreachId: z.number().nullable(),
  }),
})
export type TextConstituentActivity = z.infer<
  typeof TextConstituentActivitySchema
>

export const RobocallConstituentActivitySchema = z.object({
  type: z.literal(ConstituentActivityTypeSchema.enum.ROBOCALL),
  date: z.string(),
  data: z.object({
    activityId: z.string(),
    answeredAt: z.string().nullable(),
    voicemailLeftAt: z.string().nullable(),
    note: z.string().nullable(),
    manual: z.boolean(),
    outreachId: z.number().nullable(),
  }),
})
export type RobocallConstituentActivity = z.infer<
  typeof RobocallConstituentActivitySchema
>

// actorName/actorUserId follow the status-change pattern below: the writer's
// display name (null for a legacy row logged before ENG-10946), and the raw
// user id so the viewer can render "You" instead of their own name.
export const PhoneBankingConstituentActivitySchema = z.object({
  type: z.literal(ConstituentActivityTypeSchema.enum.PHONE_BANKING),
  date: z.string(),
  data: z.object({
    activityId: z.string(),
    outcome: PhoneBankCallOutcomeSchema,
    supportAnswer: SupportAnswerSchema.nullable(),
    willVote: WillVoteAnswerSchema.nullable(),
    note: z.string().nullable(),
    manual: z.boolean(),
    actorName: z.string().nullable(),
    actorUserId: z.number().nullable(),
  }),
})
export type PhoneBankingConstituentActivity = z.infer<
  typeof PhoneBankingConstituentActivitySchema
>

// A contact-status-field override change (ENG-10835), Win-only — Serve orgs
// can never write a ContactStatusEvent row (contacts.service.ts rejects the
// PATCH for elected-office organizations), so this variant never appears in a
// Serve feed. fromLabel/toLabel are the resolved display text (never the raw
// enum value — see resolveContactStatusLabel in ContactStatus.schema),
// fromLabel null for the never-seen-before edge (no prior override row).
// actorName is the writer's display name, null for a non-manual source
// (door_knock) that isn't user-attributed, or for a legacy phone_banking
// row logged before ENG-10946 added attribution to that channel.
export const StatusChangeConstituentActivitySchema = z.object({
  type: z.literal(ConstituentActivityTypeSchema.enum.STATUS_CHANGE),
  date: z.string(),
  data: z.object({
    activityId: z.string(),
    field: ContactStatusFieldSchema,
    fromLabel: z.string().nullable(),
    toLabel: z.string(),
    actorName: z.string().nullable(),
    actorUserId: z.number().nullable(),
    source: ContactStatusSourceSchema,
  }),
})
export type StatusChangeConstituentActivity = z.infer<
  typeof StatusChangeConstituentActivitySchema
>

export const ConstituentActivitySchema = z.discriminatedUnion('type', [
  PollConstituentActivitySchema,
  OutreachConstituentActivitySchema,
  DoorKnockConstituentActivitySchema,
  TextConstituentActivitySchema,
  RobocallConstituentActivitySchema,
  PhoneBankingConstituentActivitySchema,
  StatusChangeConstituentActivitySchema,
])
export type ConstituentActivity = z.infer<typeof ConstituentActivitySchema>

export const GetIndividualActivitiesResponseSchema = z.object({
  nextCursor: z.string().nullable(),
  results: z.array(ConstituentActivitySchema),
})
export type GetIndividualActivitiesResponse = z.infer<
  typeof GetIndividualActivitiesResponseSchema
>
