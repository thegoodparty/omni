import { defineAgent } from '@/agents/defineAgent'
import { RACE_OPPONENT_SUMMARY_PROMPT } from './race_opponent_summary.prompt'
import {
  RaceOpponentSummaryInputSchema,
  RaceOpponentSummaryOutputSchema,
} from './race_opponent_summary.schema'

// The race_opponent_summary experiment on gp-api's own agents: the chain's
// second link, structuring the text the collection wrote into the analysis the
// page renders. The manifest's model is "sonnet" with thinking off, and the
// instruction forbids networking outright - this is a single-pass synthesis over
// its own input - so it has no tools at all.
export const raceOpponentSummaryAgent = defineAgent({
  input: RaceOpponentSummaryInputSchema,
  output: RaceOpponentSummaryOutputSchema,
  model: 'claude-sonnet-4-6',
  prompt: RACE_OPPONENT_SUMMARY_PROMPT,
  tools: {},
  // The summary's own persist, shared with the PMF Engine's result consumer: it
  // replaces the campaign's summary and field-analysis rows and chains the
  // actions run. Resolved lazily for the same import cycle the collection agent
  // avoids that way.
  onArtifact: async (output, run, context) => {
    const { RaceOpponentPersistService } =
      await import('../services/raceOpponentPersist.service.js')
    await context
      .get(RaceOpponentPersistService)
      .onSummaryArtifact({ runId: run.runId, artifact: output })
  },
  // A failed summary still releases the actions link: a newer collection may be
  // waiting on the summary this run's in-flight dedup skipped, and without the
  // re-chain the page would poll a chain that never settles (ENG-10614).
  onFailure: async (run, context) => {
    const { RaceOpponentPersistService } =
      await import('../services/raceOpponentPersist.service.js')
    await context
      .get(RaceOpponentPersistService)
      .onSummaryFailure({ runId: run.runId })
  },
})
