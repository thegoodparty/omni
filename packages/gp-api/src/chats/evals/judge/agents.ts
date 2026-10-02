import { z } from 'zod'
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
  // Has produced a real verdict at least once.
  'wired',
  // Cannot be judged yet for a reason outside this build. Excluded from the
  // coverage denominator so the number is not permanently unreachable, and
  // named in the report so it is not forgotten.
  'blocked',
])
export type AgentStatus = z.infer<typeof AgentStatusSchema>

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
  })
  .refine((a) => (a.status === 'blocked') === (a.blockedReason !== undefined), {
    message: 'blockedReason is required on a blocked agent, and only there',
    path: ['blockedReason'],
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
// All four are placeholder lists — see the `note` in each file — so status
// stays `pending`. `wired` means an agent has produced a real verdict at
// least once, and none of these has driven a turn.
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
    'No ChatScopeHandler yet. Briefing chat still assembles its own ' +
    'prompt and tools, so the chat runner cannot drive it through the ' +
    'registry. Unblocked by the briefing-chats migration, which is a ' +
    'follow-on rather than a prerequisite.',
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
// All fifteen are placeholder lists — see the `note` in each file — so status
// stays `pending`. `wired` means an agent has produced a real verdict at
// least once, and none of these has been dispatched.
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
// too. The broker reaches gp-api as the run ticket's user, and a judge
// dispatch names none, so the proxy refuses the call before gp-api sees it:
// on both arms, every time. Each agent then takes its empty-data fallback, so
// a verdict would describe only that fallback and read as a real one.
// Unblocked by a long-lived dev user owning a `judge-` organization with an
// elected office, priorities and an issue feed, and the dispatch naming that
// user.
//
// campaign_tracker_tasks is NOT here: only its weekly-mode case reads from
// gp-api (prior tasks), and that case reads none on either arm, which its
// case list says.
const GP_API_TOOL_REASON =
  'Its main path reads from gp-api over the broker, and the broker reaches ' +
  "gp-api as the run ticket's user, which a judge dispatch does not name. " +
  'The read would fail on both arms and the agent would take its empty-data ' +
  'fallback, so a verdict would describe only that fallback. Unblocked by a ' +
  'seeded dev user and judge- organization the dispatch can name.'

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
  meeting_briefing: GP_API_TOOL_REASON,
  top_community_issues: GP_API_TOOL_REASON,
  trending_issues: GP_API_TOOL_REASON,
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
  }
})

// Readonly: nine build tracks import this, and a coverage number that any
// one of them could push onto is not a number anyone should trust.
export const AGENTS: readonly AgentEntry[] = Object.freeze([
  ...CHAT_AGENTS,
  ...BACKGROUND_AGENTS,
])

export interface Coverage {
  wired: number
  // Agents that could be wired: everything except the blocked ones. This is
  // the denominator the report prints.
  judgeable: number
  blocked: readonly AgentEntry[]
}

export const coverage = (agents: readonly AgentEntry[] = AGENTS): Coverage => {
  const blocked = agents.filter((a) => a.status === 'blocked')
  return {
    wired: agents.filter((a) => a.status === 'wired').length,
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
