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

export interface AgentDirectory {
  readonly path: string
  readonly agentId: string
}

// The chat half of the path-matched floor's table
// (.github/scripts/judge-path-floor.sh), mirrored so the picker can be told
// which changed files the floor already attributed to one agent. Without it
// the picker saw `chats/general/campaign-manager/...` beside rows mapping
// other `chats/general/` paths to both assistants, and added chief_of_staff
// to every Campaign Manager prompt change (PR #3737). codeMap.test.ts fails
// if this drifts from the floor script.
export const AGENT_DIRECTORIES: readonly AgentDirectory[] = [
  {
    path: 'packages/gp-api/src/chats/general/chief-of-staff/',
    agentId: 'chief_of_staff',
  },
  {
    path: 'packages/gp-api/src/chats/general/campaign-manager/',
    agentId: 'campaign_assistant',
  },
  {
    path: 'packages/gp-api/src/chats/general/ordinance-flow/',
    agentId: 'ordinance_flow',
  },
  {
    path: 'packages/gp-api/src/chats/general/priority-flow/',
    agentId: 'priority_flow',
  },
  {
    path: 'packages/gp-api/src/chats/briefing-chats/',
    agentId: 'briefing_annotation',
  },
]

const COS_DIR = 'packages/gp-api/src/chats/general/chief-of-staff/'

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
  // Files inside one agent's own directory that another agent imports. The
  // picker is told a file under an agent directory reaches only that agent
  // unless a row here covers it, so these rows are what keep a real
  // cross-agent import visible. codeMap.test.ts fails on a direct import
  // between agent directories that no row covers.
  {
    path: `${COS_DIR}chiefOfStaff.handler.ts`,
    agentIds: ['chief_of_staff', 'priority_flow'],
    note: 'Priority flow reads its constituent data provider tokens.',
  },
  {
    path: `${COS_DIR}services/constituentDataScope.ts`,
    agentIds: [
      'chief_of_staff',
      'campaign_assistant',
      'priority_flow',
      'briefing_annotation',
    ],
    note:
      'Priority flow and briefing annotation build their constituent data ' +
      'scope here; the Campaign Manager builds its contact overlay table.',
  },
  {
    path: `${COS_DIR}services/constituentDimensions.serveAgentVoters.ts`,
    agentIds: ['chief_of_staff', 'priority_flow', 'briefing_annotation'],
    note: 'Serve dimensions behind constituentDataScope.ts.',
  },
  {
    path: `${COS_DIR}services/constituentSuggestedDimensions.serveAgentVoters.ts`,
    agentIds: ['chief_of_staff', 'priority_flow', 'briefing_annotation'],
    note: 'Serve suggested dimensions behind constituentDataScope.ts.',
  },
  {
    path: `${COS_DIR}services/composeHandoff.tool.ts`,
    agentIds: ['chief_of_staff', 'campaign_assistant'],
    note: 'The compose handoff tool both assistants offer.',
  },
  {
    path: `${COS_DIR}services/communityIssueRead.`,
    agentIds: ['chief_of_staff', 'priority_flow'],
    note: 'The community issue read port, adapter and tool.',
  },
  {
    path: `${COS_DIR}services/managedCivicPanel.tools.ts`,
    agentIds: ['chief_of_staff', 'priority_flow'],
    note: 'Managed civic panel tools and timeline.',
  },
  {
    path: 'packages/gp-api/src/chats/general/priority-flow/services/priorityFlowOutreach.service.ts',
    agentIds: CHAT_AGENT_IDS,
    note:
      'Imported by the Chief of Staff and Campaign Manager handlers and by ' +
      'the shared chat-tools outreach readers.',
  },
  {
    path: 'packages/gp-api/src/chats/briefing-chats/services/districtResolver.service.ts',
    agentIds: CHAT_AGENT_IDS,
    note: 'Every chat handler resolves its district through this service.',
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
// agents"; Implementation Notes 2.5).
//
// A CATCH-ALL ROW DOES NOT COUNT AS COVERAGE (delegate review, this story's
// resume). The `llm/` row above deliberately names every registered agent —
// correct, since LlmService is a call path they all share — but if that row
// alone satisfied "has a row", a brand new agent with no code-specific row
// would still read as covered purely because it is also in AGENTS, which
// every row built from `AGENTS.map(...)` always is. This only counts a row
// toward coverage when it names a strict subset of the registry, so a new
// agent still needs its own row (or a place in an existing coarse-but-not-
// total one, like BACKGROUND_AGENT_IDS) to pass.
const isCatchAll = (row: CodeMapRow, registry: ReadonlySet<string>): boolean =>
  row.agentIds.length === registry.size &&
  row.agentIds.every((id) => registry.has(id))

export const codeMapAgentIds = (
  rows: readonly CodeMapRow[] = CODE_MAP,
  registryIds: readonly string[] = AGENTS.map((a) => a.agentId),
): ReadonlySet<string> => {
  const registry = new Set(registryIds)
  return new Set(
    rows
      .filter((row) => !isCatchAll(row, registry))
      .flatMap((row) => row.agentIds),
  )
}
