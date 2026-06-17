import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

export const CreateMagicLinkSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // BallotReady person node id. When present, we pre-fill the elected office
  // (position + term dates) from BR's office-holder record.
  personId: z.string().optional(),
})

export class CreateMagicLinkDto extends createZodDto(CreateMagicLinkSchema) {}

export type CreateMagicLinkInput = z.infer<typeof CreateMagicLinkSchema>
