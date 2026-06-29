import { CampaignWithPositionNameSchema } from './CampaignWithPositionName.schema'
import { OrganizationSchema, type Organization } from './Organization.schema'
import {
  RaceTargetMetricsSchema,
  type RaceTargetMetrics,
} from './RaceTargetMetrics.schema'
import type { ReadCampaignOutput } from './ReadCampaignOutput.schema'

/**
 * The full single-campaign read shape (e.g. `GET /v1/campaigns/:id` over
 * M2M), enriched with both `positionName` and live race-target metrics.
 *
 * `organization` is optional because some endpoints (e.g. `GET /v1/campaigns/:id`)
 * strip it from the response while others (e.g. `GET /v1/campaigns/mine`)
 * include it for downstream consumers that need `organization.positionId`.
 *
 * For list endpoints, prefer `CampaignWithPositionNameSchema` to avoid the
 * expensive per-row metrics lookup.
 */
export const CampaignWithLiveContextSchema =
  CampaignWithPositionNameSchema.extend({
    raceTargetMetrics: RaceTargetMetricsSchema.nullable(),
    organization: OrganizationSchema.optional(),
  })

// Mirrors `ReadCampaignOutput`'s hand-typed `data`/`details`/`aiContent` instead
// of the schema's loose `z.infer`, so consumers keep strong typing on those
// fields. The schema above remains the runtime source of truth.
export type CampaignWithLiveContext = ReadCampaignOutput & {
  positionName: string | null
  raceTargetMetrics: RaceTargetMetrics | null
  organization?: Organization
}
