import { defineAgent } from '@/agents/defineAgent'
import { checkLink } from '@/agents/tools/checkLink'
import { fetchPage } from '@/agents/tools/fetchPage'
import { renderPage } from '@/agents/tools/renderPage'
import { webSearch } from '@/agents/tools/webSearch'
import { RaceOpponentResearchPersistService } from '../services/raceOpponentResearchPersist.service'
import { SELF_RESEARCH_PROMPT } from './selfResearch.prompt'
import {
  SelfResearchInputSchema,
  SelfResearchOutputSchema,
  selfResearchArtifact,
} from './selfResearch.schema'

// The self_research experiment on gp-api's own agents. The manifest's model is
// "sonnet" with thinking off, and its six-category fan-out over researcher
// subagents has no equivalent here: a run is one long conversation
// (docs/adr/2026-11-14-background-agent-is-one-conversation-no-stages.md), so
// the prompt works the categories in sequence instead.
export const selfResearchAgent = defineAgent({
  input: SelfResearchInputSchema,
  output: SelfResearchOutputSchema,
  model: 'claude-sonnet-4-6',
  prompt: SELF_RESEARCH_PROMPT,
  tools: { webSearch, fetchPage, checkLink, renderPage },
  onArtifact: (output, run, { get }) =>
    get(RaceOpponentResearchPersistService).ingestAgentArtifact(
      { runId: run.runId, organizationSlug: run.input.organizationSlug },
      selfResearchArtifact(output),
    ),
})
