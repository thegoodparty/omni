import { defineAgent } from '@/agents/defineAgent'
import { fetchPage } from '@/agents/tools/fetchPage'
import { renderPage } from '@/agents/tools/renderPage'
import { webSearch } from '@/agents/tools/webSearch'
import { OPPORTUNITIES_AND_CHALLENGES_PROMPT } from './opportunitiesAndChallenges.prompt'
import {
  OpportunitiesAndChallengesInputSchema,
  OpportunitiesAndChallengesOutputSchema,
} from './opportunitiesAndChallenges.schema'

// The opportunities_and_challenges experiment on gp-api's own agents: the
// campaign plan's Opportunities and Challenges section. The manifest's model is
// "sonnet" with thinking off, and it declares no scope, so there is no warehouse
// tool: every bullet cites either the race numbers in the input or a page this
// run fetched.
export const opportunitiesAndChallengesAgent = defineAgent({
  input: OpportunitiesAndChallengesInputSchema,
  output: OpportunitiesAndChallengesOutputSchema,
  model: 'claude-sonnet-4-6',
  prompt: OPPORTUNITIES_AND_CHALLENGES_PROMPT,
  tools: { webSearch, fetchPage, renderPage },
  // The plan links this run's id immediately after dispatch, so in production
  // the section lands where the plan renders it. A judge run has no plan
  // pointing at it and this is a no-op: the run route hands back the artifact
  // instead.
  //
  // Resolved lazily, not imported: the campaign strategy service imports this
  // registry, so a static import back into it would close a cycle and leave one
  // side undefined whichever file loaded first (as the opposition agent does
  // for the same reason).
  onArtifact: async (output, run, context) => {
    const { CampaignStrategyService } =
      await import('../services/campaignStrategy.service.js')
    await context.get(CampaignStrategyService).onOpportunitiesArtifact({
      runId: run.runId,
      raceId: run.input.raceId,
      artifact: output,
    })
  },
})
