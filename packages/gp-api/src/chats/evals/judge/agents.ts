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
// the same reason the background map is: a typo here is a typecheck failure
// rather than a registry entry pointing at a file nobody wrote.
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
// union, so a typo here is a typecheck failure rather than a registry entry
// pointing at a file nobody wrote.
//
// All nine are placeholder lists — see the `note` in each file — so status
// stays `pending`. `wired` means an agent has produced a real verdict at
// least once, and none of these has been dispatched.
const BACKGROUND_CASE_LISTS: Partial<Record<BackgroundAgentId, string>> = {
  district_issue_pulse: 'district_issue_pulse.json',
  district_issue_snapshot: 'district_issue_snapshot.json',
  meeting_briefing: 'meeting_briefing.json',
  meeting_schedule: 'meeting_schedule.json',
  opponent_research: 'opponent_research.json',
  race_opponent_actions: 'race_opponent_actions.json',
  race_opponent_collection: 'race_opponent_collection.json',
  race_opponent_summary: 'race_opponent_summary.json',
  self_research: 'self_research.json',
}

const BACKGROUND_AGENTS: AgentEntry[] = BACKGROUND_AGENT_IDS.map((agentId) => ({
  agentId,
  shape: 'background' as const,
  cases: BACKGROUND_CASE_LISTS[agentId] ?? null,
  status: 'pending' as const,
}))

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
