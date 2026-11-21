// The picker's map from code to suites. Each row says "a diff touching `path`
// can change what every suite in `suites` judges." The picker adds a suite only
// when the diff plausibly reaches it, so a coarse row is fine.

export interface CodeMapRow {
  readonly path: string
  readonly suites: readonly string[]
  readonly note: string
}

const CHAT_SUITES = [
  'chief_of_staff',
  'campaign_assistant',
  'ordinance_flow',
  'priority_flow',
  'briefing_annotation',
] as const

export interface SuiteDirectory {
  readonly path: string
  readonly suites: readonly string[]
}

const BACKGROUND_SUITES = [
  'campaign_tracker_tasks',
  'find_existing_ordinances',
  'meeting_briefing',
  'meeting_schedule',
  'opponent_research',
  'opportunities_and_challenges',
  'opposition_research',
  'race_opponent_actions',
  'race_opponent_collection',
  'race_opponent_summary',
  'self_research',
  'top_community_issues',
  'trending_issues',
] as const

const ALL_SUITES = [...CHAT_SUITES, ...BACKGROUND_SUITES]

const COS_DIR = 'packages/gp-api/src/chats/general/chief-of-staff/'

export const CODE_MAP: readonly CodeMapRow[] = [
  {
    path: 'packages/gp-api/src/llm/',
    suites: ALL_SUITES,
    note:
      'LlmService is the one call path every chat and background agent ' +
      "reaches a model through, so a change here can shift any agent's " +
      'output even though the diff never touches the agent itself.',
  },
  {
    path: 'packages/gp-api/src/chats/general/types/chatScopeHandler.ts',
    suites: CHAT_SUITES,
    note:
      'The shared handler contract every chat scope implements against ' +
      '(CHAT_SCOPE_HANDLERS). A shape change here can alter all five ' +
      "chat agents' turn handling at once.",
  },
  {
    path: 'packages/gp-api/src/chats/general/services/chatScopeRegistry.service.ts',
    suites: CHAT_SUITES,
    note: 'Resolves which handler serves a chat turn for all five scopes.',
  },
  {
    path: 'packages/gp-api/src/chats/general/chat-tools/',
    suites: CHAT_SUITES,
    note: 'Tool implementations shared across the chat agents.',
  },
  {
    path: 'packages/gp-api/src/chats/general/crm-tools/',
    suites: ['chief_of_staff', 'campaign_assistant'],
    note:
      'CRM tool implementations the chief-of-staff and campaign-manager ' +
      'chats call into.',
  },
  {
    path: 'packages/gp-api/src/chats/general/product-knowledge/',
    suites: ['chief_of_staff', 'campaign_assistant'],
    note:
      "The assistants' product map (root AGENTS.md: 'The Campaign Manager " +
      "and Chief of Staff answer product questions from that map').",
  },
  {
    path: 'packages/contracts/src/chats/',
    suites: CHAT_SUITES,
    note: 'Shared chat contract shapes (cards, attachments) all five read.',
  },
  // Files inside one agent's own directory that another agent imports. The
  // picker is told a file under an agent directory reaches only that agent
  // unless a row here covers it, so these rows are what keep a real
  // cross-agent import visible. codeMap.test.ts fails on a direct import
  // between agent directories that no row covers.
  {
    path: `${COS_DIR}chiefOfStaff.handler.ts`,
    suites: ['chief_of_staff', 'priority_flow'],
    note: 'Priority flow reads its constituent data provider tokens.',
  },
  {
    path: `${COS_DIR}services/constituentDataScope.ts`,
    suites: [
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
    suites: ['chief_of_staff', 'priority_flow', 'briefing_annotation'],
    note: 'Serve dimensions behind constituentDataScope.ts.',
  },
  {
    path: `${COS_DIR}services/constituentSuggestedDimensions.serveAgentVoters.ts`,
    suites: ['chief_of_staff', 'priority_flow', 'briefing_annotation'],
    note: 'Serve suggested dimensions behind constituentDataScope.ts.',
  },
  {
    path: `${COS_DIR}services/composeHandoff.tool.ts`,
    suites: ['chief_of_staff', 'campaign_assistant'],
    note: 'The compose handoff tool both assistants offer.',
  },
  {
    path: `${COS_DIR}services/communityIssueRead.`,
    suites: ['chief_of_staff', 'priority_flow'],
    note: 'The community issue read port, adapter and tool.',
  },
  {
    path: `${COS_DIR}services/managedCivicPanel.tools.ts`,
    suites: ['chief_of_staff', 'priority_flow'],
    note: 'Managed civic panel tools and timeline.',
  },
  {
    path: 'packages/gp-api/src/chats/general/priority-flow/services/priorityFlowOutreach.service.ts',
    suites: CHAT_SUITES,
    note:
      'Imported by the Chief of Staff and Campaign Manager handlers and by ' +
      'the shared chat-tools outreach readers.',
  },
  {
    path: 'packages/gp-api/src/chats/briefing-chats/services/districtResolver.service.ts',
    suites: CHAT_SUITES,
    note: 'Every chat handler resolves its district through this service.',
  },
  {
    path: 'packages/gp-api/src/agents/',
    suites: BACKGROUND_SUITES,
    note: 'The background-agent runtime every background agent imports.',
  },
  {
    path: 'packages/judge/src/',
    suites: ALL_SUITES,
    note: 'The eval framework every suite runs on.',
  },
  {
    path: 'packages/gp-ai/broker/',
    suites: BACKGROUND_SUITES,
    note:
      'The scoped capability gateway every background agent dispatches ' +
      "through (docs/'The Broker'). A change here can alter any " +
      'background agent regardless of which experiment directory it owns.',
  },
  {
    path: 'packages/runbooks/scripts/python/',
    suites: BACKGROUND_SUITES,
    note: 'Shared Python harness code the published experiments run under.',
  },
  {
    path: 'packages/runbooks/experiments/_schema/',
    suites: BACKGROUND_SUITES,
    note:
      'The manifest/instruction schema every experiment directory is ' +
      'validated against.',
  },
]

const isCatchAll = (row: CodeMapRow, registry: ReadonlySet<string>): boolean =>
  row.suites.length === registry.size &&
  row.suites.every((id) => registry.has(id))

// A catch-all row does not count as coverage: a new suite still needs a row of
// its own, or a place in a coarse row that falls short of every suite.
export const codeMapSuites = (
  registrySuites: readonly string[],
  rows: readonly CodeMapRow[] = CODE_MAP,
): ReadonlySet<string> => {
  const registry = new Set(registrySuites)
  return new Set(
    rows
      .filter((row) => !isCatchAll(row, registry))
      .flatMap((row) => row.suites),
  )
}
