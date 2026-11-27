import { defineAgent } from '@/agents/defineAgent'
import { checkLink } from '@/agents/tools/checkLink'
import { fetchPage } from '@/agents/tools/fetchPage'
import { renderPage } from '@/agents/tools/renderPage'
import { webSearch } from '@/agents/tools/webSearch'
import { CampaignTrackerTasksService } from '../services/campaignTrackerTasks.service'
import { CAMPAIGN_TRACKER_TASKS_PROMPT } from './campaignTrackerTasks.prompt'
import {
  CampaignTrackerTasksInputSchema,
  CampaignTrackerTasksOutputSchema,
} from './campaignTrackerTasks.schema'
import { listCampaignTrackerTasks } from './listCampaignTrackerTasks.tool'

// The campaign_tracker_tasks experiment on gp-api's own agents. The manifest's
// model is "sonnet" with thinking off, and it declares no scope, so there is no
// warehouse tool: a task comes from the menu in the prompt and an event from a
// page this run read.
export const campaignTrackerTasksAgent = defineAgent({
  input: CampaignTrackerTasksInputSchema,
  output: CampaignTrackerTasksOutputSchema,
  model: 'claude-sonnet-4-6',
  prompt: CAMPAIGN_TRACKER_TASKS_PROMPT,
  tools: {
    listCampaignTrackerTasks,
    webSearch,
    checkLink,
    fetchPage,
    renderPage,
  },
  // The same append the PMF Engine's result consumer makes: this run's rows
  // land as the next generation, stamped with its id so a second onArtifact (a
  // crash after this, before the run is marked complete) appends nothing.
  onArtifact: (output, run, { get }) =>
    get(CampaignTrackerTasksService).onTrackerArtifact(
      { runId: run.runId, organizationSlug: run.input.organizationSlug },
      output,
    ),
})
