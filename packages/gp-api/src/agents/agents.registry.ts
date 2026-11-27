import { opportunitiesAndChallengesAgent } from '@/campaignStrategy/opportunitiesAndChallengesAgent/opportunitiesAndChallenges.agent'
import { oppositionResearchAgent } from '@/campaignStrategy/oppositionResearch/oppositionResearch.agent'
import { campaignTrackerTasksAgent } from '@/campaigns/campaignTracker/campaignTrackerTasksAgent/campaignTrackerTasks.agent'
import { topCommunityIssuesAgent } from '@/communityIssues/topCommunityIssuesAgent/topCommunityIssues.agent'
import { trendingIssuesAgent } from '@/communityIssues/trendingIssuesAgent/trendingIssues.agent'
import { meetingScheduleAgent } from '@/meetings/meetingScheduleAgent/meetingSchedule.agent'
import { raceOpponentActionsAgent } from '@/raceOpponent/raceOpponentActionsAgent/race_opponent_actions.agent'
import { raceOpponentCollectionAgent } from '@/raceOpponent/raceOpponentCollectionAgent/race_opponent_collection.agent'
import { raceOpponentSummaryAgent } from '@/raceOpponent/raceOpponentSummaryAgent/race_opponent_summary.agent'
import type { AgentDefinition } from './defineAgent'

// Every gp-api agent, by name. The name is the run's AgentRun.agentName. An
// agent moved from the PMF Engine keeps its experiment id as its name, so every
// reader of its runs keeps working. Start one with AgentsService.run(name,
// input).
export const AGENTS: Record<string, AgentDefinition> = {
  campaign_tracker_tasks: campaignTrackerTasksAgent,
  meeting_schedule: meetingScheduleAgent,
  opportunities_and_challenges: opportunitiesAndChallengesAgent,
  opposition_research: oppositionResearchAgent,
  race_opponent_actions: raceOpponentActionsAgent,
  race_opponent_collection: raceOpponentCollectionAgent,
  race_opponent_summary: raceOpponentSummaryAgent,
  top_community_issues: topCommunityIssuesAgent,
  trending_issues: trendingIssuesAgent,
}

// The per-agent switch while an agent runs on both engines: the experiment
// ids in AGENTS_ON_GP_API (comma-separated) dispatch here, every other one to
// the PMF Engine.
export const runsOnGpApi = (name: string): boolean =>
  name in AGENTS &&
  (process.env.AGENTS_ON_GP_API ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .includes(name)
