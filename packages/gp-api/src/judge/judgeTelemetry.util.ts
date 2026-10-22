import { createHash } from 'node:crypto'
import { isRecord } from '@/llm/tools/util/isRecord.util'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import type { TurnToolEvent } from '@/chats/services/chatStream.service'

// A copy of the prefix the sweep runner owns, not an import of it: this is
// read on every judge chat turn, and `evals/judge/runners/background.ts`
// pulls the whole eval harness in behind it. judgeTelemetry.util.test.ts
// asserts the two never drift.
export const JUDGE_ORG_SLUG_PREFIX = 'judge-'

// THE CHAT JUDGE'S OWN ADDRESS, and deliberately not the background
// fixture's. The two identities were conflated once and it cost a live
// sweep: `judgeFixtureSeed.ts` seeds a gp-api user holding
// judge-sweep@example.com under the placeholder clerk id
// `user_judge_fixture`, because background agents authenticate with a
// self-signed broker token that `Session.guard.ts` restricts to the MCP
// endpoint and never reaches Clerk at all. A chat arm needs a REAL Clerk
// session, so it needs a real Clerk account — and an account under the
// fixture's address cannot be provisioned, because `User.email` is unique
// and the fixture row already holds it. gp-api turns that failed lookup
// into a bare 401, which reads like a bad token rather than a taken email.
// Measured against dev: the fixture address 401s, a distinct one returns
// 200 and provisions.
//
// Copied rather than imported for the reason the prefix above is:
// tsconfig.build drops `src/chats/evals/**`, so a module that ships cannot
// import the harness. judgeTelemetry.util.test.ts pins the two together.
export const JUDGE_CHAT_EMAIL = 'judge-chat@example.com'

// Names the implementation that produced `promptHash`. A reader compares two
// hashes only when their versions match, so bump this on any change to what
// is hashed or to how.
export const PROMPT_HASH_VERSION = 'sha256-system-prompt-v1'

export const hashPrompt = (systemPrompt: string): string =>
  `sha256:${createHash('sha256').update(systemPrompt).digest('hex')}`

// Whether this conversation belongs to the judge, and what to file it under.
// The `judge-` prefix is the discriminator: every organization either arm
// seeds carries it and nothing a real official owns does.
//
// WHAT COMES BACK IS SWEEP-ID-PREFIXED, NOT A BARE SWEEP ID. A chat arm's
// organization is slugged `judge-<sweepId>-<agentId>-<caseId>-<digest>` by
// `seedChatOrg.chatOrgSlug`, so stripping `judge-` leaves the sweep id
// followed by the case's own key. It is therefore still unique per case, and
// it is groupable by sweep with a PREFIX MATCH on `<sweepId>-`.
//
// No split rule here on purpose. Nothing reads this column — a record groups
// by the `sweepId` written onto its RunRecord — and a sweep id may contain
// hyphens (judge.yml builds `judge-<run_id>-<run_attempt>`), so any rule for
// cutting the case key back off would be guesswork.
//
// The deploy gate is checked here rather than at the call site so that a
// production turn pays one comparison against a module constant and stops.
export const judgeSweepIdFromOrgSlug = (
  organizationSlug: string | null,
): string | null =>
  IS_NON_PROD_DEPLOY &&
  organizationSlug !== null &&
  organizationSlug.startsWith(JUDGE_ORG_SLUG_PREFIX)
    ? organizationSlug.slice(JUDGE_ORG_SLUG_PREFIX.length)
    : null

// An `unpaired` event is a result or error that matched no open call, so it
// is evidence about a call already recorded rather than a call of its own.
const isCall = (event: TurnToolEvent): boolean => event.status !== 'unpaired'

// Which tools the turn called, as a set: sorted so registration or call order
// cannot forge a difference between two arms, deduplicated because
// multiplicity and order are what `toolSteps` carries.
export const judgeToolNames = (events: TurnToolEvent[]): string[] =>
  [...new Set(events.filter(isCall).map((event) => event.name))].sort()

// One entry per call, in call order, carrying only the call's identity.
// Deliberately not the args or the result: a tool result can hold constituent
// data, which the turn keeps in memory and never persists. Deliberately not
// the status either, for the reason the table has no error column. A failure
// is an unmatched toolCallId in the stream, which the judge infers on its own
// side, and a second recording of that fact is one that can disagree.
export interface JudgeToolStep {
  toolCallId: string
  name: string
}

export const judgeToolSteps = (events: TurnToolEvent[]): JudgeToolStep[] =>
  events.filter(isCall).map(({ toolCallId, name }) => ({ toolCallId, name }))

// The SQL the agent generated, verbatim and unpinned, in call order. Read off
// the tool arguments rather than off the warehouse provider: the two tools
// that reach constituent data (`query_constituent_data`, `district_insights`)
// both take `sql` as an input, so the agent's query is already in the turn's
// tool events and no provider instrumentation is needed to see it.
export const judgeToolQueries = (events: TurnToolEvent[]): string[] =>
  events.flatMap((event) =>
    isCall(event) &&
    'args' in event &&
    isRecord(event.args) &&
    typeof event.args.sql === 'string'
      ? [event.args.sql]
      : [],
  )
