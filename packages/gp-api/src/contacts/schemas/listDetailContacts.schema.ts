import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// segment is always a saved VoterFileFilter id here (never "all" or a
// built-in channel name) — the detail page's aggregates and outreach
// history are both scoped to one persisted list.
export const listDetailContactsSchema = z.object({
  segment: z.coerce.number().int().positive(),
})

export class ListDetailContactsDTO extends createZodDto(
  listDetailContactsSchema,
) {}
