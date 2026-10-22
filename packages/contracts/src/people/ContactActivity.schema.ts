import { z } from 'zod'
import {
  ContactStatusFieldSchema,
  ContactStatusSourceSchema,
  DoorKnockOutcomeSchema,
  FollowUpAnswerSchema,
  OutreachTypeSchema,
  PhoneBankCallOutcomeSchema,
  PriorityAnswerCodeSchema,
  PriorityAnswerSourceSchema,
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

// The priority a person's reply, call or knock answered, and how an AI
// classifier coded it (priorities/AGENTS.md "Answer coding"). Serve only:
// only a priority's outreach is coded, and a coded row is a model's reading,
// not something the person confirmed.
export const ConstituentPriorityAnswerSchema = z.object({
  priorityId: z.string(),
  priorityTitle: z.string(),
  answer: PriorityAnswerCodeSchema,
})
export type ConstituentPriorityAnswer = z.infer<
  typeof ConstituentPriorityAnswerSchema
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

// actorName/actorUserId follow the phone-banking pattern above: the writer's
// display name (null for a legacy row logged before ENG-10824), and the raw
// user id so the viewer can render "You" instead of their own name.
export const DoorKnockConstituentActivitySchema = z.object({
  type: z.literal(ConstituentActivityTypeSchema.enum.DOOR_KNOCK),
  date: z.string(),
  data: z.object({
    activityId: z.string(),
    outcome: DoorKnockOutcomeSchema,
    // One vocabulary per row, decided by the org the feed is read for:
    // supportAnswer is Win's and reads null for an `eo-` org, followUp is
    // Serve's and reads null otherwise (contactEngagement.service.ts). A row
    // logged before its surface asked its question carries neither.
    supportAnswer: SupportAnswerSchema.nullable(),
    followUp: FollowUpAnswerSchema.nullable(),
    note: z.string().nullable(),
    manual: z.boolean(),
    actorName: z.string().nullable(),
    actorUserId: z.number().nullable(),
    priorityAnswer: ConstituentPriorityAnswerSchema.nullable().optional(),
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
    // What they wrote back, oldest first. Only a Serve text keeps reply
    // bodies (Win's Peerly sweep records timestamps), and only the person
    // feed reads them; absent means none to show.
    replies: z.array(z.string()).optional(),
    priorityAnswer: ConstituentPriorityAnswerSchema.nullable().optional(),
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
    // Same rule as the door-knock row above.
    supportAnswer: SupportAnswerSchema.nullable(),
    willVote: WillVoteAnswerSchema.nullable(),
    followUp: FollowUpAnswerSchema.nullable(),
    note: z.string().nullable(),
    manual: z.boolean(),
    actorName: z.string().nullable(),
    actorUserId: z.number().nullable(),
    priorityAnswer: ConstituentPriorityAnswerSchema.nullable().optional(),
  }),
})
export type PhoneBankingConstituentActivity = z.infer<
  typeof PhoneBankingConstituentActivitySchema
>

// A contact-status-field override change (ENG-10835), on both products, each
// reading back only its own fields: Win sees support status, voter
// likelihood and the rest, Serve sees follow_up and civic_panel
// (contactEngagement.service.ts filters by field). fromLabel/toLabel are the resolved display text (never the raw
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

// Everything one person has told the office in answer to a priority's check,
// newest first, across texts, calls and doors. Produced by gp-api
// (GET /v1/contact-engagement/:id/priority-answers); empty for Win.
export const PersonPriorityAnswerSchema =
  ConstituentPriorityAnswerSchema.extend({
    id: z.string(),
    source: PriorityAnswerSourceSchema,
  })
export type PersonPriorityAnswer = z.infer<typeof PersonPriorityAnswerSchema>

export const GetPersonPriorityAnswersResponseSchema = z.object({
  results: z.array(PersonPriorityAnswerSchema),
})
export type GetPersonPriorityAnswersResponse = z.infer<
  typeof GetPersonPriorityAnswersResponseSchema
>
