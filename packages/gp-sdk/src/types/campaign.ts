import type { ReadCampaignOutput } from '@goodparty_org/contracts'

export type RaceTargetMetrics = {
  winNumber: number
  voterContactGoal: number
  projectedTurnout: number
}

/**
 * The full single-campaign read shape (e.g. `GET /campaigns/:id`),
 * enriched with both `positionName` and live race-target metrics.
 */
export type CampaignWithLiveContext = ReadCampaignOutput & {
  positionName: string | null
  raceTargetMetrics: RaceTargetMetrics | null
}

/**
 * The list-campaign read shape (e.g. `GET /campaigns/list`), enriched
 * only with `positionName`. Live race-target metrics are intentionally
 * excluded from list responses to avoid expensive per-row external
 * lookups.
 */
export type CampaignWithPositionName = ReadCampaignOutput & {
  positionName: string | null
}
