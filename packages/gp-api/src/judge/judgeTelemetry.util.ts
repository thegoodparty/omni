import { createHash } from 'node:crypto'
import { isRecord } from '@/llm/tools/util/isRecord.util'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import type { TurnToolEvent } from '@/chats/services/chatStream.service'

// A copy of the prefix the sweep runner owns, not an import of it: this is
// read on every judge chat turn, and `evals/judge/runners/background.ts`
// pulls the whole eval harness in behind it. judgeTelemetry.util.test.ts
// asserts the two never drift.
export const JUDGE_ORG_SLUG_PREFIX = 'judge-'

// A copy of the judge account's address for the same reason as the prefix
// above, and this one is load-bearing rather than cosmetic: tsconfig.build
// and .swcrc.build drop `src/chats/evals/**` from the production build, so a
// module under `src/judge/` that imports the harness compiles and tests
// clean and then fails at `require` time in the container, which ECS sees as
// a crash-looping task rather than as a build error. judgeTelemetry.util.
// test.ts asserts this equals JUDGE_FIXTURE.email, from the test side of
// that boundary, where importing the harness is fine.
export const JUDGE_FIXTURE_EMAIL = 'judge-sweep@example.com'

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
// WHAT COMES BACK IS NOT A SWEEP ID, and nothing on this side of the wire can
// make it one. A chat arm's organization is slugged
// `judge-<agentId>-<caseId>-<digest>` by `seedChatOrg.chatOrgSlug`, which
// never embeds the sweep; the sweep id lives in the arm process's
// JUDGE_SWEEP_ID and does not cross the HTTP boundary. So this is a stable
// per-case run key, and a reader that groups by it groups by case. For the
// column to mean its name, the arm has to send its sweep id.
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
