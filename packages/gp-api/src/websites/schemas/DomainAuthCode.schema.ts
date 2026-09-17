import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { isFQDN } from 'validator'
import { WriteEmailSchema } from '@/shared/schemas/Email.schema'

export class DomainAuthCodeSchema extends createZodDto(
  z.object({
    domain: z.string().refine((v) => isFQDN(v), {
      message:
        'Invalid domain format. Must be a Fully Qualified Domain Name (e.g., example.com or foo.example.com)',
    }),
    // Optional: an admin session resolves the acting human from the JWT. Only
    // an M2M caller (gp-admin) has to name the admin it is acting for, because
    // gp-admin runs on a separate Clerk instance and its session token is not
    // verifiable here. Same convention as AdminSignInLinkSchema.
    actorEmail: WriteEmailSchema.optional(),
  }),
) {}
