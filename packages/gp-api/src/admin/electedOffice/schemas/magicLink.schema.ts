import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

// Sales-facing 400 shown when the HubSpot contact is missing a usable name.
// The provisioned Clerk identity and onboarding greeting rely on a real
// first/last name, so we reject blank or whitespace-only values up front.
export const MAGIC_LINK_NAME_REQUIRED_ERROR =
  'First and last name are required — add them to the HubSpot contact before sending the magic link.'

export const CreateMagicLinkSchema = z.object({
  email: z.string().email(),
  // Accept any string here; the controller trims and rejects blank/whitespace
  // names with MAGIC_LINK_NAME_REQUIRED_ERROR so the message is predictable.
  firstName: z.string(),
  lastName: z.string(),
  // BallotReady person node id. When present, we pre-fill the elected office
  // (position + term dates) from BR's office-holder record.
  personId: z.string().optional(),
})

export class CreateMagicLinkDto extends createZodDto(CreateMagicLinkSchema) {}

export type CreateMagicLinkInput = z.infer<typeof CreateMagicLinkSchema>
