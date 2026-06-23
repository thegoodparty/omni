import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

// Sales-facing 400 shown when the HubSpot contact is missing a usable name.
// The provisioned Clerk identity and onboarding greeting rely on a real
// first/last name, so we reject blank or whitespace-only values up front.
export const CAMPAIGN_MAGIC_LINK_NAME_REQUIRED_ERROR =
  'First and last name are required — add them to the HubSpot contact before sending the magic link.'

export const CreateCampaignMagicLinkSchema = z.object({
  email: z.string().email(),
  // Accept any string here; the controller trims and rejects blank/whitespace
  // names with CAMPAIGN_MAGIC_LINK_NAME_REQUIRED_ERROR so the message is
  // predictable.
  firstName: z.string(),
  lastName: z.string(),
})

export class CreateCampaignMagicLinkDto extends createZodDto(
  CreateCampaignMagicLinkSchema,
) {}

export type CreateCampaignMagicLinkInput = z.infer<
  typeof CreateCampaignMagicLinkSchema
>
