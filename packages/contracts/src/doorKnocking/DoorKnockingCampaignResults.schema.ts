import { z } from 'zod'
import {
  DoorKnockOutcomeSchema,
  FollowUpAnswerSchema,
  SupportAnswerSchema,
  WillVoteAnswerSchema,
} from '../generated/enums'

// A door-knocking campaign's results across all its turfs, counted by DOOR:
// a door is knocked once anybody behind it is logged, reads Answered when
// anybody behind it answered (else its latest outcome), and counts toward an
// answer when anybody behind it gave it. Every share is over `doorsKnocked`.
export const DoorKnockingCampaignResultsSchema = z.object({
  doorsKnocked: z.number().int(),
  byOutcome: z.record(DoorKnockOutcomeSchema, z.number().int()),
  bySupport: z.record(SupportAnswerSchema, z.number().int()),
  byWillVote: z.record(WillVoteAnswerSchema, z.number().int()),
  byFollowUp: z.record(FollowUpAnswerSchema, z.number().int()),
})
export type DoorKnockingCampaignResults = z.infer<
  typeof DoorKnockingCampaignResultsSchema
>
