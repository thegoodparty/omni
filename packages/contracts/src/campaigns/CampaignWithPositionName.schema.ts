import { z } from 'zod'
import {
  ReadCampaignOutputSchema,
  type ReadCampaignOutput,
} from './ReadCampaignOutput.schema'

/**
 * Campaign list items are enriched with `positionName` (resolved from the
 * campaign's organization) so admin/M2M consumers can render the
 * human-readable position without a per-row roundtrip.
 *
 * `raceTargetMetrics` is intentionally NOT included here — it requires
 * per-campaign external lookups and would be too expensive for list
 * endpoints. Use `CampaignWithLiveContextSchema` for the single-campaign
 * read shape that includes those metrics.
 */
export const CampaignWithPositionNameSchema = ReadCampaignOutputSchema.extend({
  positionName: z.string().nullable(),
})

// The exported type intersects the hand-typed `ReadCampaignOutput` (which
// overrides `data`/`details`/`aiContent` with their rich shapes) rather than the
// schema's loose `z.infer`, so consumers keep strong typing on those fields. The
// schema above stays the runtime source of truth for response validation.
export type CampaignWithPositionName = ReadCampaignOutput & {
  positionName: string | null
}
