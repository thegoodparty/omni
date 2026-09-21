import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'
import { voterFilterBaseSchema } from '@/shared/schemas/voterFilterBase.schema'

// The map behind the draw step, for a list that is still being built — so
// the filter arrives as the same unsaved-draft grammar `POST
// /v1/contacts/count` and `polygon-preview` take rather than a saved
// `voter_file_filter` id. Nested under `filters` rather than spread, to
// match its polygon-preview sibling exactly: the two are asked the same
// question about the same draft, one for dots and one for a count, and a
// payload that differed between them would let the map and the pill drift.
//
// `filters.search` is accepted and ignored for the same reason it is there:
// the bbox query has no free-text key, so dots drawn from a searched-down
// list would not be the list.
const filterPointsContactsSchema = z
  .object({
    filters: voterFilterBaseSchema,
  })
  .strict()

export class FilterPointsContactsDTO extends createZodDto(
  filterPointsContactsSchema,
) {}
