import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// Slugs are nanoid(12) over its URL-safe alphabet (A-Za-z0-9_-). Validating the
// shape here turns a malformed or probing request into a 400 without a DB hit.
export const RESOLVE_MAGIC_LINK_SLUG_LENGTH = 12

export const ResolveMagicLinkSchema = z.object({
  slug: z
    .string()
    .length(RESOLVE_MAGIC_LINK_SLUG_LENGTH)
    .regex(/^[A-Za-z0-9_-]+$/),
})

export class ResolveMagicLinkDto extends createZodDto(ResolveMagicLinkSchema) {}
