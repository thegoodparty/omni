import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

export const SetPersonRemovalSchema = z.object({
  personId: z.string().uuid(),
  // Optional, but the caller (gp-api's admin control) always sends one so a
  // takedown is attributable after the fact.
  reason: z.string().max(2000).optional(),
})

export class SetPersonRemovalDto extends createZodDto(SetPersonRemovalSchema) {}

// Path param, not a body: a DELETE body is optional in HTTP and some proxies
// drop it, which would silently clear the wrong thing (or nothing).
export const ClearPersonRemovalParamsSchema = z.object({
  personId: z.string().uuid(),
})

export class ClearPersonRemovalParamsDto extends createZodDto(
  ClearPersonRemovalParamsSchema,
) {}
