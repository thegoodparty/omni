import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { zDate } from '@goodparty_org/contracts'
import { ProfileClaimRequestSource } from '../../../generated/prisma'

// Inbound lead capture from the public "claim this profile" modal. Email is
// required (that's the whole point — how we reach the person); name is a
// courtesy field. personId identifies the civics Person being claimed.
const CreateProfileClaimRequestSchema = z
  .object({
    personId: z.guid('personId must be a valid UUID'),
    requesterEmail: z.string().email(),
    requesterName: z.string().max(200).nullable().optional(),
    // Opt-in to GoodParty.org marketing comms from the modal checkbox. Absent
    // means no consent; we only record the boolean (no HubSpot sync here).
    marketingConsent: z.boolean().optional().default(false),
    // Which public form this came from. Both the visitor-facing "notify" form
    // and the owner-facing claim band POST here, and only the former counts
    // towards the person's HubSpot candidate_profile_requests. Optional and
    // deliberately NOT defaulted: an older marketing deploy sends nothing, and
    // an unattributed submission must not be guessed into either bucket —
    // undercounting is recoverable, attributing an owner's own claim to visitor
    // demand is not.
    source: z.nativeEnum(ProfileClaimRequestSource).optional(),
  })
  .strict()

export class CreateProfileClaimRequestDto extends createZodDto(
  CreateProfileClaimRequestSchema,
) {}

export type CreateProfileClaimRequestInput = z.infer<
  typeof CreateProfileClaimRequestSchema
>

// Minimal acknowledgement — we only echo back that the lead was stored.
export const ProfileClaimRequestResponseSchema = z.object({
  id: z.string(),
  personId: z.string(),
  createdAt: zDate(),
})

export class ProfileClaimRequestResponseDto extends createZodDto(
  ProfileClaimRequestResponseSchema,
) {}

export type ProfileClaimRequestResponse = z.infer<
  typeof ProfileClaimRequestResponseSchema
>
