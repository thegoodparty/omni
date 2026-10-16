import { CIVIC_PANEL_SEGMENT } from '@goodparty_org/contracts'
import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// segment identifies a saved VoterFileFilter (never "all" or a built-in
// channel name), or is Serve's built-in civic panel list. Omitted entirely =
// the universe row's detail view (ENG-10778): the whole unfiltered district,
// with outreachHistory always empty since there's no filter id to key it on.
export const listDetailContactsSchema = z.object({
  segment: z
    .union([z.literal(CIVIC_PANEL_SEGMENT), z.coerce.number().int().positive()])
    .optional(),
})

export class ListDetailContactsDTO extends createZodDto(
  listDetailContactsSchema,
) {}
