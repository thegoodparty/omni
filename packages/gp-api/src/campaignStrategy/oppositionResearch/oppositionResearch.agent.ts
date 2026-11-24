import { defineAgent } from '@/agents/defineAgent'
import { fetchPage } from '@/agents/tools/fetchPage'
import { renderPage } from '@/agents/tools/renderPage'
import { webSearch } from '@/agents/tools/webSearch'
import { OPPOSITION_RESEARCH_PROMPT } from './oppositionResearch.prompt'
import {
  OppositionResearchInputSchema,
  OppositionResearchOutputSchema,
} from './oppositionResearch.schema'

// The opposition_research experiment on gp-api's own agents: the campaign
// plan's Opposition Research section. The manifest's model is "sonnet" with
// thinking off, and WebSearch was its only outside-world tool.
export const oppositionResearchAgent = defineAgent({
  input: OppositionResearchInputSchema,
  output: OppositionResearchOutputSchema,
  model: 'claude-sonnet-4-6',
  prompt: OPPOSITION_RESEARCH_PROMPT,
  tools: { webSearch, fetchPage, renderPage },
  // The plan links this run's id immediately after dispatch, so in production
  // the section lands where the plan renders it. A judge run has no plan pointing
  // at it and this is a no-op: the run route hands back the artifact instead.
  //
  // Resolved lazily, not imported: the campaign strategy service imports this
  // registry, so a static import back into it would close a cycle and leave one
  // side undefined whichever file loaded first (as campaigns.service.ts does
  // for the same reason).
  onArtifact: async (output, run, context) => {
    const { CampaignStrategyService } =
      await import('../services/campaignStrategy.service.js')
    await context.get(CampaignStrategyService).onOppositionResearchArtifact({
      runId: run.runId,
      raceId: run.input.raceId,
      artifact: output,
    })
  },
})
