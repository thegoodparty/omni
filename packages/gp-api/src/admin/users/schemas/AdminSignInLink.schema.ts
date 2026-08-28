import { createZodDto } from 'nestjs-zod'
import { WriteEmailSchema } from 'src/shared/schemas/Email.schema'
import { z } from 'zod'

export class AdminSignInLinkSchema extends createZodDto(
  z
    .object({
      // Optional: a direct admin session resolves its actor from the JWT. Only
      // an M2M caller (gp-admin) has to name the admin it is acting for. The
      // default keeps the route callable with no body at all.
      actorEmail: WriteEmailSchema.optional(),
    })
    .strict()
    .default({}),
) {}
