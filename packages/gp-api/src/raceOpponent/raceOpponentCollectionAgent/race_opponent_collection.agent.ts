import { defineAgent } from '@/agents/defineAgent'
import { fetchPage } from '@/agents/tools/fetchPage'
import { renderPage } from '@/agents/tools/renderPage'
import { webSearch } from '@/agents/tools/webSearch'
import { RACE_OPPONENT_COLLECTION_PROMPT } from './race_opponent_collection.prompt'
import {
  RaceOpponentCollectionInputSchema,
  RaceOpponentCollectionOutputSchema,
} from './race_opponent_collection.schema'

// The race_opponent_collection experiment on gp-api's own agents: the first link
// of the relaxed opponent chain, collecting raw sourced text about each opponent.
// The manifest's model is "sonnet" with thinking off, and its only outside-world
// tools were WebSearch and the broker's page fetch.
export const raceOpponentCollectionAgent = defineAgent({
  input: RaceOpponentCollectionInputSchema,
  output: RaceOpponentCollectionOutputSchema,
  model: 'claude-sonnet-4-6',
  prompt: RACE_OPPONENT_COLLECTION_PROMPT,
  tools: { webSearch, fetchPage, renderPage },
  // The collection's own persist, shared with the PMF Engine's result consumer:
  // it replaces the campaign's collected rows and chains the summary run, so a
  // gp-api run lands where the page already reads it.
  //
  // Resolved lazily, not imported: this module is imported by the agents
  // registry, and the persist service imports the registry through
  // RaceOpponentService, so a static import back would close a cycle.
  onArtifact: async (output, run, context) => {
    const { RaceOpponentPersistService } =
      await import('../services/raceOpponentPersist.service.js')
    await context
      .get(RaceOpponentPersistService)
      .onCollectionArtifact({ runId: run.runId, artifact: output })
  },
})
