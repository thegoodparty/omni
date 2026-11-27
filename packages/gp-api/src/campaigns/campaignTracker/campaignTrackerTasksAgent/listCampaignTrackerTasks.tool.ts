import { z } from 'zod'
import { defineTool } from '@/agents/tools/tool'
import { CampaignTrackerTaskResponseSchema } from '../schemas/trackerTaskResponse.schema'
import { CampaignTrackerTasksService } from '../services/campaignTrackerTasks.service'

const listCampaignTrackerTasksInput = z.object({})

// The run's own campaign's tracker tasks, exactly as the PMF Engine's
// GET_v1_campaigns_tracker_tasks MCP tool reads them (the GET
// /v1/campaigns/tracker-tasks response): every row, static and dynamic, open
// and completed. The campaign comes from the run's organization, never from
// the model, and the rows are projected through the endpoint's response schema
// so both readers hand out the same payload — the run's bookkeeping columns,
// such as the `sourceRunId` that makes a replayed append a no-op, stay inside
// the service.
export const listCampaignTrackerTasks = defineTool({
  description:
    "List the candidate's current campaign tracker tasks, each with its " +
    'title, phase, channel, due date, and whether it is completed. Use this ' +
    'in weekly mode to see what was generated before and which tasks the ' +
    'candidate already finished, so you can carry forward ' +
    'incomplete-but-important work and avoid repeating completed tasks.',
  input: listCampaignTrackerTasksInput,
  execute: async (_input, ctx) => {
    const tracker = ctx.get(CampaignTrackerTasksService)
    const campaign = await tracker.client.campaign.findUnique({
      where: { organizationSlug: ctx.organizationSlug },
    })
    if (!campaign) return []
    return z
      .array(CampaignTrackerTaskResponseSchema)
      .parse(await tracker.readTrackerTasks(campaign))
  },
})
