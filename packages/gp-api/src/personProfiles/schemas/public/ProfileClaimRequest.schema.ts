import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { zDate } from '@goodparty_org/contracts'

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
