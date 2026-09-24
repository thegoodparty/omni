import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'
import { GeoJsonShapeSchema } from '@goodparty_org/contracts'
import { voterFilterBaseSchema } from '@/shared/schemas/voterFilterBase.schema'

// A boundary drawn over a list that is still being built, so the filter
// arrives as the same unsaved-draft grammar `POST /v1/contacts/count` takes
// rather than a saved `voter_file_filter` id. Reusing `voterFilterBaseSchema`
// is what keeps the audience counted here and the audience saved a moment
// later from drifting apart.
//
// `filters.search` is accepted and then ignored: the bbox query has no
// free-text key, so a count taken here against a searched-down list would
// exceed the same list's live count.
const polygonPreviewContactsSchema = z
  .object({
    geoPoly: GeoJsonShapeSchema,
    filters: voterFilterBaseSchema,
  })
  .strict()

export class PolygonPreviewContactsDTO extends createZodDto(
  polygonPreviewContactsSchema,
) {}
