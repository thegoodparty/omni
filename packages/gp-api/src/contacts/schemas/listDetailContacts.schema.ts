import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// segment identifies a saved VoterFileFilter (never "all" or a built-in
// channel name). Omitted entirely = the universe row's detail view
// (ENG-10778): the whole unfiltered district, with outreachHistory always
// empty since there's no filter id to key it on.
export const listDetailContactsSchema = z.object({
  segment: z.coerce.number().int().positive().optional(),
})

export class ListDetailContactsDTO extends createZodDto(
  listDetailContactsSchema,
) {}
