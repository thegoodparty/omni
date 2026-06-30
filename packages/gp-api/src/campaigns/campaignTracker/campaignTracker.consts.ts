import { CampaignTaskType } from '../../generated/prisma'

// The CAP experiment id (matches the runbooks manifest + AgentJobContracts key).
export const CAMPAIGN_TRACKER_EXPERIMENT_TYPE = 'campaign_tracker_tasks'

// CronRun lease key for the weekly re-prioritization job.
export const CAMPAIGN_TRACKER_WEEKLY_CRON_JOB = 'campaignTrackerWeeklyRegen'

// Catalog / artifact channel -> CampaignTaskType enum. Events use 'events';
// channels with no enum value (directMail, general) stay null.
export const CHANNEL_TO_FLOW_TYPE: Record<string, CampaignTaskType> = {
  text: CampaignTaskType.text,
  robocall: CampaignTaskType.robocall,
  doorKnocking: CampaignTaskType.doorKnocking,
  phoneBanking: CampaignTaskType.phoneBanking,
  event: CampaignTaskType.events,
  awareness: CampaignTaskType.awareness,
}
