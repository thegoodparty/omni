import { z } from 'zod'
import { CaseListError, loadCaseList } from './cases'
import { AgentShapeSchema } from './record'

// Every agent the judge is meant to cover, wired or not. This file is the
// denominator in the coverage line the report prints, and listing an
// unwired agent here on purpose is the point: a gap nobody can see is a gap
// nobody closes.
//
// Adding an agent is an entry here plus a case list. If it needs code, the
// runner is wrong — see the TDD.

export const AgentStatusSchema = z.enum([
  // Judgeable, not yet verified. The normal starting state.
  'pending',
  // A live sweep from main has judged at least one of its pairs. The entry
  // links that run, so the count can be checked rather than believed.
  'wired',
  // Cannot be judged yet for a reason outside this build. Excluded from the
  // coverage denominator so the number is not permanently unreachable, and
  // named in the report so it is not forgotten.
  'blocked',
])
export type AgentStatus = z.infer<typeof AgentStatusSchema>

export const WiredBySchema = z.object({
  runUrl: z
    .string()
    .regex(
      /^https:\/\/github\.com\/thegoodparty\/omni\/actions\/runs\/\d+$/,
      'runUrl must be a github.com/thegoodparty/omni/actions/runs/<id> URL',
    ),
  date: z.iso.date(),
})
export type WiredBy = z.infer<typeof WiredBySchema>

export const AgentEntrySchema = z
  .object({
    agentId: z.string().min(1),
    shape: AgentShapeSchema,
    // The case-list file this agent draws inputs from. Authored per agent in
    // a later wave, so null until it exists.
    cases: z.string().min(1).nullable(),
    status: AgentStatusSchema,
    // Required on a blocked entry, so "blocked" can never be a shrug.
    blockedReason: z.string().min(1).optional(),
    // A background agent whose main path reads gp-api over the broker. Only
    // these run as the seeded account in judgeFixtureIdentity.ts; every other
    // dispatch names no user, so the broker cannot reach gp-api for it.
    readsGpApi: z.literal(true).optional(),
    // Required on a wired entry, so "wired" can never be a claim with no run
    // behind it.
    wiredBy: WiredBySchema.optional(),
  })
  .refine((a) => (a.status === 'blocked') === (a.blockedReason !== undefined), {
    message: 'blockedReason is required on a blocked agent, and only there',
    path: ['blockedReason'],
  })
  .refine((a) => (a.status === 'wired') === (a.wiredBy !== undefined), {
    message: 'wiredBy is required on a wired agent, and only there',
    path: ['wiredBy'],
  })
  // The coverage line reads a wired agent's case list for its placeholder
  // flag, and a judged pair was drawn from one.
  .refine((a) => a.status !== 'wired' || a.cases !== null, {
    message: 'a wired agent needs a case list',
    path: ['cases'],
  })
export type AgentEntry = z.infer<typeof AgentEntrySchema>

// The four chat scopes registered in CHAT_SCOPE_HANDLERS today, plus the one
// that is not. Ids match ChatScope in the Prisma schema, so the runner can
// resolve a handler straight from the registry with no mapping table.
const CHAT_AGENT_IDS = [
  'chief_of_staff',
  'campaign_assistant',
  'ordinance_flow',
  'priority_flow',
  'briefing_annotation',
] as const

type ChatAgentId = (typeof CHAT_AGENT_IDS)[number]

// The chat agents that have an authored case list. Keyed by the id union for
// the same reason the background map is: a mistyped agent id is a typecheck
// failure rather than a silently absent entry. The FILENAME is only a string,
// so a typo there compiles — what catches a registry entry pointing at a file
// nobody wrote is the directory check in chatCaseLists.test.ts.
//
// briefing_annotation is absent on purpose. It is blocked, not unwritten, so
// a case list would be inputs for a runner that cannot drive it.
//
// All four are placeholder lists — see the `note` in each file. That does
// not stop an agent being wired; the coverage line counts it separately.
const CHAT_CASE_LISTS: Partial<Record<ChatAgentId, string>> = {
  chief_of_staff: 'chief_of_staff.json',
  campaign_assistant: 'campaign_assistant.json',
  ordinance_flow: 'ordinance_flow.json',
  priority_flow: 'priority_flow.json',
}

// Keyed by the id union too, so dropping a scope from CHAT_AGENT_IDS without
// dropping its reason is a typecheck failure.
const CHAT_BLOCKED_REASONS: Partial<Record<ChatAgentId, string>> = {
  briefing_annotation:
    'Registered as a ChatScopeHandler, but the chat runner cannot drive it ' +
    'yet: a briefing conversation is created with its annotation, so ' +
    'POST /v1/chats refuses the scope, and there is no case list. ' +
    'Unblocked by a follow-up that adds a briefing seed and its cases.',
}

const CHAT_AGENTS: AgentEntry[] = CHAT_AGENT_IDS.map((agentId) => {
  const blockedReason = CHAT_BLOCKED_REASONS[agentId]
  return {
    agentId,
    shape: 'chat' as const,
    cases: CHAT_CASE_LISTS[agentId] ?? null,
    ...(blockedReason === undefined
      ? { status: 'pending' as const }
      : { status: 'blocked' as const, blockedReason }),
  }
})

// Every published PMF experiment. Matches the directories under
// packages/runbooks/experiments (excluding _schema), which is what
// publish_experiments.py walks.
const BACKGROUND_AGENT_IDS = [
  'campaign_tracker_tasks',
  'compliance_setup',
  'district_issue_pulse',
  'district_issue_snapshot',
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

type BackgroundAgentId = (typeof BACKGROUND_AGENT_IDS)[number]

// The background agents that have an authored case list. Keyed by the id
// union, so a mistyped agent id is a typecheck failure. As above, a mistyped
// filename compiles and is caught by the directory check in
// chatCaseLists.test.ts instead.
//
// Two groups, authored in two passes and deliberately indistinguishable here:
// nine take plain data, and six — campaign_tracker_tasks,
// find_existing_ordinances, opportunities_and_challenges, opposition_research,
// top_community_issues, trending_issues — have an input_schema naming an
// identifier no file can carry (an org slug, a race id, the candidate's own
// address), so their params hold the placeholders sweepFixture.ts substitutes
// per sweep. A registry entry is the same either way on purpose: the
// difference belongs to the case list and the sweep, not to the denominator.
//
// compliance_setup is absent on purpose, the same way briefing_annotation is
// above: it is blocked, so a case list would be inputs for a sweep that must
// not run.
//
// All but race_opponent_summary are placeholder lists — see the `note` in
// each file. As above, the coverage line counts a wired one separately.
const BACKGROUND_CASE_LISTS: Partial<Record<BackgroundAgentId, string>> = {
  campaign_tracker_tasks: 'campaign_tracker_tasks.json',
  district_issue_pulse: 'district_issue_pulse.json',
  district_issue_snapshot: 'district_issue_snapshot.json',
  find_existing_ordinances: 'find_existing_ordinances.json',
  meeting_briefing: 'meeting_briefing.json',
  meeting_schedule: 'meeting_schedule.json',
  opponent_research: 'opponent_research.json',
  opportunities_and_challenges: 'opportunities_and_challenges.json',
  opposition_research: 'opposition_research.json',
  race_opponent_actions: 'race_opponent_actions.json',
  race_opponent_collection: 'race_opponent_collection.json',
  race_opponent_summary: 'race_opponent_summary.json',
  self_research: 'self_research.json',
  top_community_issues: 'top_community_issues.json',
  trending_issues: 'trending_issues.json',
}

// The experiments whose main path reads from gp-api over the broker's MCP
// proxy: the issue feed, and for meeting_briefing the official's priorities
// too. The broker reaches gp-api as the run ticket's user, so these three are
// dispatched as the seeded fixture account (scripts/seed-judge-fixture.ts)
// against its `judge-fixture` organization. Without that a judge dispatch
// names no user, the proxy refuses the read on both arms, and a verdict would
// describe only the agent's empty-data fallback.
//
// campaign_tracker_tasks is NOT here: only its weekly-mode case reads from
// gp-api (prior tasks), and that case reads none on either arm, which its
// case list says.
const GP_API_READERS: ReadonlySet<BackgroundAgentId> = new Set([
  'meeting_briefing',
  'top_community_issues',
  'trending_issues',
])

// Keyed by the id union, so dropping an experiment without dropping its
// reason is a typecheck failure — the same shape as CHAT_BLOCKED_REASONS.
const BACKGROUND_BLOCKED_REASONS: Partial<Record<BackgroundAgentId, string>> = {
  compliance_setup:
    'The only experiment with permission_mode bypassPermissions, verified ' +
    'against every manifest under packages/runbooks/experiments. A judge ' +
    'arm of it would make whatever changes the agent decided to make, with ' +
    'no prompt to stop it, against a real organization — and the broker ' +
    'reaches gp-api through a proxy that does not read ticket.is_eval, so ' +
    'nothing downstream would mark those writes as a test. Blocked rather ' +
    'than left without a case list: captureArm skips a blocked agent, which ' +
    'makes this a control instead of a gap waiting for someone to fill it.',
}

const BACKGROUND_AGENTS: AgentEntry[] = BACKGROUND_AGENT_IDS.map((agentId) => {
  const blockedReason = BACKGROUND_BLOCKED_REASONS[agentId]
  return {
    agentId,
    shape: 'background' as const,
    cases: BACKGROUND_CASE_LISTS[agentId] ?? null,
    ...(blockedReason === undefined
      ? { status: 'pending' as const }
      : { status: 'blocked' as const, blockedReason }),
    ...(GP_API_READERS.has(agentId) && { readsGpApi: true as const }),
  }
})

// The runs that wired each agent. See "Marking an agent wired" in the README.
// Applied over the entries above rather than inside them: a blocked agent
// listed here keeps its blockedReason, which the schema then refuses.
const WIRED_BY: Partial<Record<string, WiredBy>> = {
  chief_of_staff: {
    runUrl: 'https://github.com/thegoodparty/omni/actions/runs/36999748321',
    date: '2026-10-02',
  },
  opposition_research: {
    runUrl: 'https://github.com/thegoodparty/omni/actions/runs/37161231631',
    date: '2026-10-03',
  },
  race_opponent_summary: {
    runUrl: 'https://github.com/thegoodparty/omni/actions/runs/37355882821',
    date: '2026-10-05',
  },
} satisfies Partial<Record<ChatAgentId | BackgroundAgentId, WiredBy>>

const withWiring = (entry: AgentEntry): AgentEntry => {
  const wiredBy = WIRED_BY[entry.agentId]
  return wiredBy === undefined ? entry : { ...entry, status: 'wired', wiredBy }
}

// Readonly: nine build tracks import this, and a coverage number that any
// one of them could push onto is not a number anyone should trust.
export const AGENTS: readonly AgentEntry[] = Object.freeze(
  [...CHAT_AGENTS, ...BACKGROUND_AGENTS].map(withWiring),
)

export interface Coverage {
  wired: number
  // Wired agents whose case list is marked placeholder: judged, but on inputs
  // written to exercise the pipeline rather than to test the agent.
  placeholder: number
  // Agents that could be wired: everything except the blocked ones. This is
  // the denominator the report prints.
  judgeable: number
  blocked: readonly AgentEntry[]
}

// A list that will not load counts as placeholder inputs: the conservative
// reading, and one agent's broken file must not fail the plan or the report
// of a sweep that never touches it. The case-list tests fail that PR anyway.
export const placeholderOrUnreadable = (agent: AgentEntry): boolean => {
  try {
    return loadCaseList(agent).placeholder
  } catch (err) {
    if (err instanceof CaseListError) return true
    throw err
  }
}

export const coverage = (
  agents: readonly AgentEntry[] = AGENTS,
  isPlaceholder: (agent: AgentEntry) => boolean = placeholderOrUnreadable,
): Coverage => {
  const blocked = agents.filter((a) => a.status === 'blocked')
  const wired = agents.filter((a) => a.status === 'wired')
  return {
    wired: wired.length,
    placeholder: wired.filter(isPlaceholder).length,
    judgeable: agents.length - blocked.length,
    blocked,
  }
}

export const findAgent = (agentId: string): AgentEntry | undefined =>
  AGENTS.find((a) => a.agentId === agentId)

// The narrowing every caller of `loadCaseList` needs, since that takes an
// entry and `findAgent` returns an optional. Here rather than inline in each
// reader, which was four copies of the same sentence.
export const requireAgent = (agentId: string): AgentEntry => {
  const agent = findAgent(agentId)
  if (agent === undefined) {
    throw new Error(`${agentId} is not in the agent registry`)
  }
  return agent
}
