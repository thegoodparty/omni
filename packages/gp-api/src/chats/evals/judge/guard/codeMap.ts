import { AGENTS } from '../agents'

// The picker's map from code to agents (TDD "Picking agents"; Implementation
// Notes 2.5). The real source is `routines/surfaces.json` in the research
// team's private chat-transcript-audit repo, which this story could not pull
// from a headless run with no access to that repo — coordinating the fetch
// needs a person. Until that hand-off happens, this is a reconstruction from
// this repo's own directory layout: every path below is a real shared
// directory, and every agentId is checked against the registry by
// codeMap.test.ts. Replace the relevant rows in place once the real file is
// available; don't restructure around it, since the picker only consumes
// `CODE_MAP`.
//
// Each row says "a diff touching `path` can change what every agent in
// `agentIds` does." The picker is told to add an agent only when the diff
// plausibly reaches it, so a coarse row (e.g. all 21 agents for the shared
// LLM client) is fine — the model still decides per-diff whether to add.

export interface CodeMapRow {
  readonly path: string
  readonly agentIds: readonly string[]
  readonly note: string
}

const CHAT_AGENT_IDS = [
  'chief_of_staff',
  'campaign_assistant',
  'ordinance_flow',
  'priority_flow',
  'briefing_annotation',
] as const

const BACKGROUND_AGENT_IDS = AGENTS.filter((a) => a.shape === 'background').map(
  (a) => a.agentId,
)

export const CODE_MAP: readonly CodeMapRow[] = [
  {
    path: 'packages/gp-api/src/llm/',
    agentIds: AGENTS.map((a) => a.agentId),
    note:
      'LlmService is the one call path every chat and background agent ' +
      "reaches a model through, so a change here can shift any agent's " +
      'output even though the diff never touches the agent itself.',
  },
  {
    path: 'packages/gp-api/src/chats/general/types/chatScopeHandler.ts',
    agentIds: CHAT_AGENT_IDS,
    note:
      'The shared handler contract every chat scope implements against ' +
      '(CHAT_SCOPE_HANDLERS). A shape change here can alter all five ' +
      "chat agents' turn handling at once.",
  },
  {
    path: 'packages/gp-api/src/chats/general/services/chatScopeRegistry.service.ts',
    agentIds: CHAT_AGENT_IDS,
    note: 'Resolves which handler serves a chat turn for all five scopes.',
  },
  {
    path: 'packages/gp-api/src/chats/general/chat-tools/',
    agentIds: CHAT_AGENT_IDS,
    note: 'Tool implementations shared across the chat agents.',
  },
  {
    path: 'packages/gp-api/src/chats/general/crm-tools/',
    agentIds: ['chief_of_staff', 'campaign_assistant'],
    note:
      'CRM tool implementations the chief-of-staff and campaign-manager ' +
      'chats call into.',
  },
  {
    path: 'packages/gp-api/src/chats/general/product-knowledge/',
    agentIds: ['chief_of_staff', 'campaign_assistant'],
    note:
      "The assistants' product map (root AGENTS.md: 'The Campaign Manager " +
      "and Chief of Staff answer product questions from that map').",
  },
  {
    path: 'packages/contracts/src/chats/',
    agentIds: CHAT_AGENT_IDS,
    note: 'Shared chat contract shapes (cards, attachments) all five read.',
  },
  {
    path: 'packages/gp-ai/broker/',
    agentIds: BACKGROUND_AGENT_IDS,
    note:
      'The scoped capability gateway every background agent dispatches ' +
      "through (docs/'The Broker'). A change here can alter any " +
      'background agent regardless of which experiment directory it owns.',
  },
  {
    path: 'packages/runbooks/scripts/python/',
    agentIds: BACKGROUND_AGENT_IDS,
    note: 'Shared Python harness code the published experiments run under.',
  },
  {
    path: 'packages/runbooks/experiments/_schema/',
    agentIds: BACKGROUND_AGENT_IDS,
    note:
      'The manifest/instruction schema every experiment directory is ' +
      'validated against.',
  },
]

// codeMap.test.ts fails if an agent in the registry has no row here, so the
// map cannot go stale as agents are added or files move (TDD "Picking
// agents"; Implementation Notes 2.5). Exported so the picker's own prompt and
// the test share one reading of "every agentId this map ever names."
export const codeMapAgentIds = (
  rows: readonly CodeMapRow[] = CODE_MAP,
): ReadonlySet<string> => new Set(rows.flatMap((row) => row.agentIds))
