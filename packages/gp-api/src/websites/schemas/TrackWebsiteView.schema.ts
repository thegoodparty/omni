import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

export class TrackWebsiteViewSchema extends createZodDto(
  z.object({
    // The site issues this from `crypto.randomUUID()` and keeps it in
    // localStorage, so the handler's `(websiteId, visitorId)` dedupe only
    // means anything if the shape is pinned to what that issues.
    visitorId: z.guid(),
  }),
) {}
