import { z } from 'zod'
import { GeoJsonPolygonSchema } from '@goodparty_org/contracts'
import { voterFilterBaseSchema } from '@/shared/schemas/voterFilterBase.schema'

// The draft the create flow is holding, not a saved list: at draw time no
// `voter_file_filter` row exists yet, so the filter arrives as the same
// grammar `POST /v1/voters/voter-file/filter` accepts and
// `resolveSavedFilterForQuery` consumes. Reusing `voterFilterBaseSchema`
// rather than restating ~70 option keys in contracts is what keeps the
// audience previewed here and the audience saved a moment later from
// drifting apart — a second copy of this grammar is a second thing to keep
// in step with the filter catalog. The response, which is a genuinely new
// cross-boundary payload, does live in contracts.
export const DoorKnockingAddressPreviewSchema = z
  .object({
    geoPoly: GeoJsonPolygonSchema,
    filters: voterFilterBaseSchema,
  })
  .strict()

export type DoorKnockingAddressPreview = z.infer<
  typeof DoorKnockingAddressPreviewSchema
>
