import { HttpStatus } from '@nestjs/common'
import { differenceInMilliseconds } from 'date-fns'
import {
  CreateChatResponseSchema,
  type ChatAnchor,
  type CreateChatResponse,
} from '@goodparty_org/contracts'
import { ChatMessageRole } from '../../../../generated/prisma'
import { LlmService } from '@/llm/services/llm.service'
import { CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER } from '@/chats/services/chatStream.service'
import type { TestServiceContext } from '@/test-service'
import {
  caseTurns,
  CaseListError,
  type ChatAccountState,
  type SeededTurn,
  type ToolFailure,
} from '../cases'
import { PRICING_VERSION, UnpriceableRunError, priceUsd } from '../pricing'
import {
  isoUtc,
  RunRecordSchema,
  type Arm,
  type CiContext,
  type Cost,
  type JsonValue,
  type Payload,
  type RunRecord,
  type RunStatus,
  type TokenUsage,
  type TraceStep,
} from '../record'
import { WIN_CONSTITUENT_TABLES } from '@/chats/general/campaign-manager/services/constituentDataScope'
import { CONSTITUENT_TABLES } from '@/chats/general/chief-of-staff/services/constituentDataScope'
import {
  buildTrace,
  configDigest,
  installLlmCapture,
  instrumentDatabricksProvider,
  parseStreamEvents,
  readTurnTokens,
  traceErrorText,
  type ChatTurnScript,
  type DeltaPin,
  type InstalledLlmCapture,
  type StreamEvent,
  type TurnCapture,
} from './chatSeam'
import { assertAccountStateSupported, chatScopeFor } from './seedChatOrg'
import { assertTranscriptFits, seedPriorTranscript } from './seedTranscript'

// One arm of one case for a chat agent: drive a real turn through the real
// HTTP routes and return a RunRecord. The orchestrator that runs both arms and
// the judge that compares their outputs are separate.
//
// There is no database-free path. ChatStreamService takes ChatStoreService as
// a required dependency and stream() makes three DB calls before the model is
// reached, so the turn needs Postgres. `useTestService()` supplies a throwaway
// container plus the booted app and an authenticated client; the caller owns
// that (it registers vitest hooks) and hands it in here.

// The model's own words when its tool budget ran out without an answer — see
// `toolBudgetExhaustedNote` in llm/services/llm.service.ts, which instructs
// this string verbatim. Duplicated rather than derived because the note is a
// longer instruction and this reply is only a substring of it, which is why
// chat.test.ts pins the two together with `toContain`. If the note is
// reworded and this copy is not, a run that hit it silently reads as
// `produced` instead of `blocked`.
export const TOOL_BUDGET_FALLBACK_REPLY =
  "I wasn't able to find what I needed to answer that question. You can " +
  'try again, rephrase your question, or ask me about something else.'

// Compared as numbers: an axios status is a plain number, and comparing it
// against the enum member directly is what no-unsafe-enum-comparison rejects.
const HTTP_CREATED: number = HttpStatus.CREATED
const HTTP_OK: number = HttpStatus.OK

// The case, as the runner needs it. Structurally the loaded `ChatCase` minus
// the caseId's path-segment regex, which the loader has already applied —
// so a case list's case is assignable here and a hand-built one in a test
// needs no file on disk.
export interface ChatJudgeCase {
  caseId: string
  // The turn the agent is asked to take. Must not be a scope's canned-reply
  // sentinel (campaign_assistant has two), or the handler answers from a
  // script and the record describes no model behavior at all.
  question?: string
  // Several USER turns, posted in order to ONE conversation. Nothing here
  // hand-builds the history between them: the route persists each turn, so
  // turn 2 is answered against turn 1 and its reply exactly the way
  // production would.
  turns?: string[]
  // A transcript written onto the conversation before the first driven turn.
  priorTranscript?: SeededTurn[]
  toolFailure?: ToolFailure
  // Recorded and CHECKED here, not applied here: the seed happens in the
  // caller, which owns the Prisma client. See assertSeededAccountState.
  accountState?: ChatAccountState
}

export interface ChatRunnerPorts {
  service: TestServiceContext
}

export interface ChatRunRequest {
  agentId: string
  case: ChatJudgeCase
  sweepId: string
  arm: Arm
  attempt?: number
  // What the orchestrator knows and the runner cannot: which ref and commit
  // this arm is. `model` is the model expected from the scope's chain; the
  // observed one replaces it whenever the turn reached the model.
  variant: { ref: string; commit: string; model: string }
  organizationSlug: string
  anchor?: ChatAnchor
  // The canned model. Omitting it means the real, paid model answers, which
  // no track in this build does: that needs `realModel` and JUDGE_SPEND=1,
  // and omitting both throws rather than quietly dialling Anthropic.
  script?: ChatTurnScript
  realModel?: boolean
  // The Delta table version BOTH arms must read. Pins every generated query
  // at the provider seam and is recorded on the run.
  dataVersion?: string
  // Replies that mean the agent declined or fell back. The tool-budget
  // fallback is always treated as one.
  fallbackReplies?: string[]
  ci?: CiContext
}

// The tables a pin may rewrite, per agent: the same app-layer allowlists the
// scope handlers inject into the constituent tool, so a pin can only touch a
// reference the validator would have accepted as a table. Everything else a
// `FROM` introduces — EXTRACT(... FROM col) and its siblings — is left alone.
// Partial, not Record: most agent ids have no entry, which is the case
// `pinnableTablesFor` exists to refuse. A bare Record would claim every key
// resolves and leave that guard looking redundant.
const PINNABLE_TABLES: Partial<Record<string, string[]>> = {
  chief_of_staff: CONSTITUENT_TABLES.map((config) => config.table),
  priority_flow: CONSTITUENT_TABLES.map((config) => config.table),
  campaign_assistant: WIN_CONSTITUENT_TABLES.map((config) => config.table),
}

const pinnableTablesFor = (agentId: string): string[] => {
  const tables = PINNABLE_TABLES[agentId]
  if (!tables || tables.length === 0) {
    throw new Error(
      `"${agentId}" reads no version-pinnable table, so a dataVersion for ` +
        'it could only ever be recorded and never applied',
    )
  }
  return tables
}

// GitHub provenance, so a stored record leads back to the change it judged.
// Absent on a local run, which has no Actions run to point at.
export const ciContextFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): CiContext | undefined => {
  const repo = env.GITHUB_REPOSITORY
  const workflowRunId = env.GITHUB_RUN_ID
  if (!repo || !workflowRunId) return undefined
  // Actions always sets this; a 1 is what an unset value would have meant
  // anyway, and refusing the whole context over it would throw away the ids.
  const attempt = Number.parseInt(env.GITHUB_RUN_ATTEMPT ?? '1', 10)
  const fromRef = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? '')?.[1]
  // JUDGE_PR_NUMBER FIRST: it is what judge.yml hands the arms, and a sweep is
  // dispatched or commented from main, so its GITHUB_REF is never a pull ref.
  // Reading only the ref and PR_NUMBER, every live sweep's records carried no
  // PR at all, and the report could not say which change it judged.
  const prNumber = Number.parseInt(
    env.JUDGE_PR_NUMBER || fromRef || env.PR_NUMBER || '',
    10,
  )
  return {
    repo,
    ...(Number.isInteger(prNumber) && prNumber > 0 && { prNumber }),
    workflowRunId,
    workflowRunAttempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1,
    workflowRunUrl:
      `https://github.com/${repo}/actions/runs/${workflowRunId}` +
      (attempt > 1 ? `/attempts/${attempt}` : ''),
  }
}

// The tool-budget fallback plus whatever the case list declared. Blank
// entries are dropped: `includes('')` is true of every string, so one empty
// reply in a case list would mark every run in the sweep `blocked`.
export const buildFallbackReplies = (declared?: string[]): string[] =>
  [TOOL_BUDGET_FALLBACK_REPLY, ...(declared ?? [])]
    .map((reply) => reply.trim())
    .filter((reply) => reply.length > 0)

export const classifyChatStatus = (
  output: string | null,
  streamErrored: boolean,
  fallbackReplies: string[],
): RunStatus => {
  if (streamErrored) return 'infraError'
  if (output === null) return 'infraError'
  if (output === CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER) return 'infraError'
  const trimmed = output.trim()
  if (trimmed.length === 0) return 'infraError'
  return fallbackReplies.some((reply) => trimmed.includes(reply.trim()))
    ? 'blocked'
    : 'produced'
}

// ONE STATUS FOR THE WHOLE CONVERSATION, worst turn wins.
//
// A turn that broke means the conversation the case authored did not happen,
// so there is no honest way to judge what is left: the later turns were
// answered against a history missing a reply, and the earlier ones are half a
// case. infraError says that, and infraError is excluded from the delta
// rather than counted as a loss.
//
// A turn that fell back to the declined reply is different: it is an agent
// RESULT, it stays judgeable, and whether declining there was right is
// exactly what a verdict should capture. It marks the case `blocked` even
// when a later turn recovered, because a conversation that needed to recover
// is the behavior being compared.
export const combineChatStatus = (perTurn: readonly RunStatus[]): RunStatus => {
  // Empty means no turn was driven at all, which is never a result.
  if (perTurn.length === 0) return 'infraError'
  if (perTurn.includes('infraError')) return 'infraError'
  return perTurn.includes('blocked') ? 'blocked' : 'produced'
}

// EVERY assistant reply, in order — not the last one alone.
//
// The case is a conversation, so the conversation is what the judge compares.
// Scoring only the final reply would hide a regression in an earlier turn
// behind whatever the agent said last, and it would hide it asymmetrically:
// the earlier reply still shaped the later one, so the difference would reach
// the verdict as an unexplained change in the only text anybody read.
//
// A ONE-TURN CASE IS UNLABELLED AND BYTE-IDENTICAL TO BEFORE. The labels
// exist because a reply can itself contain blank lines, which makes an
// unlabelled join ambiguous about where one turn ended — and they are the
// same on both arms, so they add nothing a judge could read as a difference.
export const joinTurnReplies = (replies: readonly string[]): string => {
  const [only] = replies
  if (replies.length === 1 && only !== undefined) return only
  return replies
    .map((reply, index) => `[turn ${index + 1}]\n${reply}`)
    .join('\n\n')
}

interface TurnOutcome {
  output: string | null
  events: StreamEvent[]
  streamErrored: boolean
}

interface CaseOutcome {
  // One per driven turn, in order.
  turns: TurnOutcome[]
  // Accumulated across every turn, re-indexed so the steps read as one
  // sequence rather than as several restarting at zero.
  trace: TraceStep[]
  // Why a turn's token usage never resolved, one per turn that failed to
  // report. Non-fatal: token accounting is not the turn.
  usageErrors: string[]
}

const infraTrace = (message: string): TraceStep[] => [
  { index: 0, kind: 'error', error: message },
]

const errorStep = (trace: TraceStep[], error: string): TraceStep[] => [
  ...trace,
  { index: trace.length, kind: 'error', error },
]

export interface PricedRun {
  // Omitted when the model has no rates on record. pricing.ts throws rather
  // than guessing, because the cost delta is printed beside a verdict as
  // evidence and a guessed rate makes that evidence fiction.
  //
  // An unpriceable run is NOT a harness failure. Cost is measured evidence
  // and measured evidence never gates a verdict, so the run keeps its status
  // and its answer and loses only its cost line. This matters in practice:
  // every chat scope declares a `claude-opus-4-7` fallback that pricing.ts
  // has no rates for, so treating it as fatal would silently discard a real
  // answer every time a turn fell back.
  cost?: Cost
  unpriceable?: string
}

export const priceRun = (tokens: TokenUsage, model: string): PricedRun => {
  try {
    return {
      cost: {
        usdAtCapture: priceUsd(tokens, model),
        pricingVersion: PRICING_VERSION,
      },
    }
  } catch (err) {
    if (!(err instanceof UnpriceableRunError)) throw err
    return { unpriceable: err.message }
  }
}

// The persisted turn, not the stream: `content` always carries the full
// assistant text (including a finalizeAssistantText line), while segments are
// only written for tool-bearing turns.
//
// Keyed on the id the `done` frame names, rather than every assistant row in
// the conversation: campaign_assistant seeds a scripted opener as the first
// assistant message, and joining it into the output would have the judge
// compare two arms partly on boilerplate that varies with seed data. No id
// means the turn persisted nothing, which is not a result.
const readAssistantText = async (
  ports: ChatRunnerPorts,
  assistantMessageId: string | undefined,
): Promise<string | null> => {
  if (assistantMessageId === undefined) return null
  const row = await ports.service.prisma.chatMessage.findFirst({
    where: { id: assistantMessageId, role: ChatMessageRole.assistant },
  })
  return row?.content ?? null
}

// Re-numbered so several turns' traces read as one sequence. A one-turn case
// is unchanged in value: buildTrace already numbers from zero.
export const reindexTrace = (steps: readonly TraceStep[]): TraceStep[] =>
  steps.map((step, index) => ({ ...step, index }))

// EVERY USER TURN OF THE CASE, POSTED TO ONE CONVERSATION.
//
// Turn 2 sees turn 1 because the ROUTE persisted it, not because anything
// here assembled a history: `ChatStreamService.run` appends the user message
// and then replays the conversation's recent rows. That is the only way a
// multi-turn case measures the agent rather than the harness's idea of what
// a conversation looks like.
const driveCase = async (
  ports: ChatRunnerPorts,
  request: ChatRunRequest,
  capture: TurnCapture,
  turns: readonly string[],
): Promise<CaseOutcome> => {
  const scope = chatScopeFor(request.agentId)
  const headers = {
    headers: { 'X-Organization-Slug': request.organizationSlug },
  }

  const created = await ports.service.client.post<CreateChatResponse>(
    '/v1/chats',
    { scope, ...(request.anchor && { anchor: request.anchor }) },
    headers,
  )
  if (created.status !== HTTP_CREATED) {
    throw new Error(
      `POST /v1/chats returned ${created.status} for scope "${scope}"`,
    )
  }
  const { conversationId } = CreateChatResponseSchema.parse(created.data)

  // Before the first turn, so the agent's first reply is already a
  // mid-conversation one. No route writes an assistant message, so this
  // reaches the store directly — through the same two methods the live turn
  // uses. See seedTranscript.ts.
  if (request.case.priorTranscript !== undefined) {
    await seedPriorTranscript(ports.service.app, {
      conversationId,
      ownerUserId: ports.service.user.id,
      turns: request.case.priorTranscript,
      drivenTurns: turns.length,
    })
  }

  const outcomes: TurnOutcome[] = []
  const trace: TraceStep[] = []
  const usageErrors: string[] = []
  for (const content of turns) {
    // The outcomes array is shared by every turn of the case, so each turn's
    // trace is built from ITS slice. Handing the whole array to buildTrace
    // would have turn two re-consume turn one's outcomes and attach them a
    // second time.
    const outcomesBefore = capture.outcomes.length

    // No clientMessageId: the route requires a GUID and it only buys
    // user-turn dedup, which a run that opens its own conversation cannot
    // need.
    const streamed = await ports.service.client.post<string>(
      `/v1/chats/${conversationId}/messages?scope=${scope}`,
      { content },
      headers,
    )
    if (streamed.status !== HTTP_OK) {
      throw new Error(`POST /v1/chats/:id/messages returned ${streamed.status}`)
    }

    const events = parseStreamEvents(String(streamed.data))
    const done = events.find((event) => event.type === 'done')
    const turn: TurnOutcome = {
      output: await readAssistantText(ports, done?.assistantMessageId),
      events,
      streamErrored: events.some((event) => event.type === 'error'),
    }
    outcomes.push(turn)
    trace.push(...buildTrace(events, capture.outcomes.slice(outcomesBefore)))

    // Per turn, because the capture's usage promise is replaced by the next
    // turn's. Read here and accumulated, rather than once at the end, which
    // would report the last turn's tokens as the whole conversation's.
    //
    // Caught rather than thrown: token accounting is not the turn, and
    // abandoning turn three because turn two's usage promise rejected would
    // discard two answers that are already persisted and judgeable.
    try {
      await readTurnTokens(capture)
    } catch (usageErr) {
      usageErrors.push(traceErrorText(usageErr))
    }

    // STOP ON A BROKEN TURN, and do not post the rest. The conversation this
    // case authored is already over: the next turn would be answered against
    // a history whose last reply is missing or is the interrupted sentinel,
    // and `combineChatStatus` discards the whole case as infraError anyway —
    // so every turn after this one is real model spend on output nothing
    // reads. A DECLINED turn is not this: a fallback reply is an agent
    // result, the history is intact, and the conversation continues.
    if (
      classifyChatStatus(turn.output, turn.streamErrored, []) === 'infraError'
    ) {
      break
    }
  }

  return { turns: outcomes, trace: reindexTrace(trace), usageErrors }
}

// Extracted against the WET default on purpose: this guard has been wrong
// twice, in both directions, and it cannot be reached from a test without a
// real turn while it lives inside runChatCase.
//
// An unpriceable reason earns a trace step only when the trace does not
// already carry that reason. "No price on record for model X" is a fact
// nothing else records, so it belongs in the trace. But two cases already
// carry it: an infraError run's trace says why the turn ended, and a rejected
// usage promise put its own specific message there. In both, "usage never
// resolved" is the same failure restated, and appending it would stack a
// generic error step behind a specific one.
export const tracesUnpriceable = (
  unpriceable: string | undefined,
  status: RunRecord['status'],
  usageErrorTraced: boolean,
): boolean =>
  unpriceable !== undefined && status !== 'infraError' && !usageErrorTraced

// The reason to trace, or nothing. Returns the string itself rather than a
// boolean the caller then has to re-derive the string behind: a `?? ''`
// fallback there would put an empty error on a trace step, and the schema
// requires a non-empty one — so RunRecordSchema.parse would throw away a
// completed, judgeable run over the bookkeeping line beside it.
export const unpriceableStep = (
  priced: PricedRun,
  status: RunRecord['status'],
  usageErrorTraced: boolean,
): string | undefined =>
  tracesUnpriceable(priced.unpriceable, status, usageErrorTraced)
    ? priced.unpriceable
    : undefined

// WHAT BOTH ARMS WERE ASKED, and the one thing that makes the new case fields
// safe across two checkouts.
//
// A case that uses none of them records exactly what it recorded before:
// `{ kind: 'question', value: <the question> }`. A case that uses ANY of them
// records a different payload — so if an older base ref parsed the same list
// with an older copy of the schema, stripped the field it does not know, and
// drove a plainer run, the two arms' inputs no longer match and
// `MismatchedInputError` refuses the pair. That refusal is the version marker:
// the alternative is two arms driven under different conditions, compared, and
// reported as a verdict about the branch.
//
// `seededTranscript` is the mark AND the data, one field rather than a flag
// beside it, so a record cannot say it was seeded and not say with what.
export const caseInput = (one: ChatJudgeCase): Payload => {
  const synthetic =
    one.turns !== undefined ||
    one.priorTranscript !== undefined ||
    one.toolFailure !== undefined ||
    one.accountState !== undefined
  if (!synthetic) {
    return { kind: 'question', value: caseTurns(one)[0] ?? '' }
  }
  return {
    kind: 'transcript',
    value: {
      turns: caseTurns(one),
      ...(one.priorTranscript !== undefined && {
        seededTranscript: one.priorTranscript.map((turn) => ({
          role: turn.role,
          content: turn.content,
          ...(turn.toolCalls !== undefined && {
            toolCalls: turn.toolCalls.map((call) => ({
              tool: call.tool,
              input: call.input,
            })),
          }),
        })),
      }),
      ...(one.toolFailure !== undefined && {
        toolFailure: {
          tool: one.toolFailure.tool,
          mode: one.toolFailure.mode,
          ...(one.toolFailure.afterMs !== undefined && {
            afterMs: one.toolFailure.afterMs,
          }),
        },
      }),
      ...(one.accountState !== undefined && {
        accountState: { ...one.accountState },
      }),
    } satisfies JsonValue,
  }
}

// VERIFIED, NOT TRUSTED, and before the conversation is opened.
//
// The account state is seeded by the RUNNER'S CALLER, which owns the Prisma
// client — so the runner is handed a directive and a slug and has no way to
// know the two agree. A caller that forgot to apply it would produce a record
// claiming a condition the agent was never under, and every judgement drawn
// from that case would be about the wrong account. Reading the three rows back
// costs two queries and closes it.
//
// Refuses rather than proceeding, and early enough that nothing has been
// spent: no model is reached until the first message POST below.
export const assertSeededAccountState = async (
  ports: ChatRunnerPorts,
  request: ChatRunRequest,
): Promise<void> => {
  const state = request.case.accountState
  assertAccountStateSupported(request.agentId, state)
  if (state === undefined) return

  const wrong: string[] = []
  if (state.district !== undefined) {
    const organization = await ports.service.prisma.organization.findFirst({
      where: { slug: request.organizationSlug },
      select: { positionId: true },
    })
    if (!organization) {
      throw new CaseListError(
        `${request.organizationSlug} was never seeded, so the account ` +
          'state this case declares cannot be checked',
      )
    }
    if (
      state.district !== undefined &&
      state.district !== (organization.positionId !== null)
    ) {
      wrong.push(
        `district is ${state.district ? 'asked for' : 'asked to be absent'} ` +
          `but organization.positionId is ${
            organization.positionId === null ? 'null' : 'set'
          }`,
      )
    }
  }
  if (state.pro !== undefined || state.campaignDetails !== undefined) {
    const campaign = await ports.service.prisma.campaign.findFirst({
      where: { organizationSlug: request.organizationSlug },
      select: { isPro: true, details: true },
    })
    if (!campaign) {
      throw new CaseListError(
        `${request.organizationSlug} has no campaign, so the account state ` +
          'this case declares cannot be checked',
      )
    }
    if (state.pro !== undefined && state.pro !== campaign.isPro) {
      wrong.push(`pro is ${state.pro} but campaign.isPro is ${campaign.isPro}`)
    }
    if (state.campaignDetails !== undefined) {
      const seeded = Object.keys(campaign.details).length > 0
      if (state.campaignDetails !== seeded) {
        wrong.push(
          `campaignDetails is ${state.campaignDetails} but the campaign ` +
            `${seeded ? 'carries' : 'carries no'} details`,
        )
      }
    }
  }
  if (state.ordinanceStep !== undefined) {
    const step =
      request.anchor?.resourceType === 'ordinance'
        ? request.anchor.step
        : undefined
    if (step !== state.ordinanceStep) {
      wrong.push(
        `ordinanceStep is "${state.ordinanceStep}" but the anchor opens on ` +
          `${step === undefined ? 'no ordinance step' : `"${step}"`}`,
      )
    }
  }

  if (wrong.length > 0) {
    throw new CaseListError(
      `${request.agentId}/${request.case.caseId} declares an account state ` +
        `the seed does not match: ${wrong.join('; ')}`,
    )
  }
}

// PRICE ONLY WHAT WAS MEASURED, AND ONLY WHEN ALL OF IT WAS. An unreported
// turn leaves the counts short, and pricing what did report produces a
// confident figure for a run whose cost is genuinely unknown — the "this run
// was free" reading the schema's absent-rather-than-zero rule exists to
// prevent. The rule is about whether the tokens were seen, not about the
// status: a turn that really did use nothing reports a true zero.
//
// Counted against the turns the case ASKED FOR rather than the ones that
// completed, which is what makes a conversation that broke on its third turn
// unpriceable instead of priced at what its first two turns cost.
export const everyTurnPriced = (
  turnsPriced: number,
  turns: readonly string[],
): boolean => turnsPriced >= turns.length

// Zero — NOT the partial sum — when any turn went unreported, because a
// partial sum reads as the whole conversation's usage. There is no third
// thing to write: TokenUsageSchema's four fields are non-optional ints and
// cannot say "unknown", which is the follow-up the README already records.
// Zero is what a single unreported turn recorded before any of this, so it is
// the existing convention rather than a new reading, and the trace carries
// the reason either way.
export const turnTokens = (
  observed: { input: number; output: number } | undefined,
  turnsPriced: number,
  turns: readonly string[],
): TokenUsage => {
  const complete = observed !== undefined && everyTurnPriced(turnsPriced, turns)
  return {
    input: complete ? observed.input : 0,
    output: complete ? observed.output : 0,
    // Zero because prompt caching is not enabled. Carried rather than
    // omitted so the day it is switched on, pricing fails loudly instead of
    // costing a cache read at the full input rate.
    cacheRead: 0,
    cacheWrite: 0,
  }
}

// A run that could not honour a directive. NOT a CaseListError: that class is
// about a file that would not parse, and this skip reason ends up in the arm
// manifest and from there in a public summary — where "the case list is
// wrong" is the wrong thing to say about a run that also failed to reach the
// app. The two causes are independent, because the seam refuses before the
// model is called, so a `driveCase` throw is a second thing going wrong in
// the same run.
export class ChatDirectiveError extends Error {}

// BOTH REASONS, AND THE INFRASTRUCTURE ONE FIRST when there is one. A reader
// sent to fix a case list will not find the 502 that actually ended the run,
// and the directive is the cheaper of the two to fix once they have.
export const directiveFailureText = (
  agentId: string,
  caseId: string,
  directiveError: string,
  driveError?: string,
): string =>
  driveError === undefined
    ? `${agentId}/${caseId}: ${directiveError}`
    : `${agentId}/${caseId}: the run did not complete — ${driveError} — ` +
      `and its directive could not be honoured either: ${directiveError}`

// NOT A RECORD, whatever else went wrong. A run whose condition was never
// applied has no comparable result to store: an infraError record for it is a
// quiet exclusion the report counts and moves past, so the next sweep repeats
// the same unhonourable directive and pays for it again. The throw is what
// puts the agent and the reason in the manifest instead, and `captureArm`
// keeps every record the agent had already written.

export const runChatCase = async (
  ports: ChatRunnerPorts,
  request: ChatRunRequest,
): Promise<RunRecord> => {
  // Ahead of any instrumentation: an agent with no registered scope handler
  // cannot be driven at all, and emitting an infraError record for it would
  // put a coverage gap into the delta as though it were a failed run.
  chatScopeFor(request.agentId)
  // Every directive this run cannot honour, refused HERE — before a
  // conversation is opened and long before the model is reached. A chat turn
  // costs real money, and a directive discovered mid-run has already spent it
  // on a case whose condition was never applied.
  const turns = caseTurns(request.case)
  if (request.case.priorTranscript !== undefined) {
    assertTranscriptFits(request.case.priorTranscript.length, turns.length)
  }
  await assertSeededAccountState(ports, request)

  const attempt = request.attempt ?? 1
  const runId = `${request.sweepId}:${request.case.caseId}:${request.arm}:${attempt}`
  const fallbackReplies = buildFallbackReplies(request.fallbackReplies)

  // Both patches are process-global for as long as they are installed, and
  // BOTH installs can throw — installLlmCapture on a non-test process, on a
  // second install against the same instance, or on a request that would
  // spend real money. So the second one failing has to unwind the first by
  // hand: there is no restore handle to hand back out of here, and a patch
  // installed and then abandoned would rewrite the SQL of, and answer from a
  // canned script, every later request in the process.
  const pin: DeltaPin | undefined =
    request.dataVersion === undefined
      ? undefined
      : {
          version: request.dataVersion,
          tables: pinnableTablesFor(request.agentId),
        }
  const llmService = ports.service.app.get(LlmService)
  // Installed on DatabricksSqlProvider's prototype rather than on a provider
  // resolved by token: `CONSTITUENT_DATA_PROVIDER` is registered by two
  // modules with two factories, so a token lookup cannot say which instance
  // the handler for this scope holds. Unconditional for the same reason —
  // there is no instance to be handed, or withheld.
  const databricks = instrumentDatabricksProvider(pin)
  let llm: InstalledLlmCapture
  try {
    llm = installLlmCapture(llmService, {
      ...(request.script && { script: request.script }),
      ...(request.realModel === true && { realModel: true }),
      ...(request.case.toolFailure && {
        toolFailure: request.case.toolFailure,
      }),
    })
  } catch (err) {
    databricks.restore()
    throw err
  }

  const startedAt = new Date()
  let outcome: CaseOutcome
  let trace: TraceStep[]
  // A rejected usage promise is already in the trace by its own message. The
  // pricing guard below would otherwise restate the same failure generically,
  // one step behind it.
  let usageErrorTraced = false
  // Carried so the directive refusal below can say the turn ALSO broke,
  // rather than replacing one reason with the other.
  let driveError: string | undefined
  try {
    outcome = await driveCase(ports, request, llm.capture, turns)
    trace = outcome.trace
    for (const reason of outcome.usageErrors) {
      // Token accounting is not the turn. A rejected usage promise leaves the
      // counts short and says so in the trace rather than discarding answers
      // that are already persisted and judgeable.
      trace = errorStep(trace, reason)
      usageErrorTraced = true
    }
  } catch (err) {
    // A throw here is the harness or the route failing, never an agent
    // result: no output exists to judge, which is exactly what infraError
    // means and why the schema forbids one.
    outcome = { turns: [], trace: [], usageErrors: [] }
    driveError = traceErrorText(err)
    trace = infraTrace(driveError)
  } finally {
    llm.restore()
    databricks.restore()
  }
  const endedAt = new Date()

  // A forced-failure directive that named a tool the turn never registered.
  // Thrown rather than recorded, and thrown AFTER the restores above so the
  // singleton is left clean: the record would otherwise be indistinguishable
  // from a case the agent simply never needed the tool for, and the sweep
  // would report a verdict about a condition nobody applied. Nothing was
  // spent — the seam refuses before the model is called.
  if (llm.capture.directiveError !== undefined) {
    throw new ChatDirectiveError(
      directiveFailureText(
        request.agentId,
        request.case.caseId,
        llm.capture.directiveError,
        driveError,
      ),
    )
  }

  const tokens = turnTokens(llm.capture.tokens, llm.capture.turnsPriced, turns)
  const model = llm.capture.model || request.variant.model
  const priced = !everyTurnPriced(llm.capture.turnsPriced, turns)
    ? {
        unpriceable:
          `usage resolved for ${llm.capture.turnsPriced} of ` +
          `${turns.length} turn(s): the rest ended before the model ` +
          'reported it, so the cost is unknown rather than zero',
      }
    : priceRun(tokens, model)
  const perTurnStatus = outcome.turns.map((turn) =>
    classifyChatStatus(turn.output, turn.streamErrored, fallbackReplies),
  )
  const status = combineChatStatus(perTurnStatus)
  const replies = outcome.turns.flatMap((turn) =>
    turn.output === null ? [] : [turn.output],
  )
  // A turn with a null output classifies as infraError and combineChatStatus
  // carries that to the case, so a non-infraError case cannot be short a
  // reply. Kept as a guard rather than a `?? ''` because if the two ever
  // disagree, the schema throws away a run that otherwise looks fine and the
  // message is what says where to look.
  if (status !== 'infraError' && replies.length !== outcome.turns.length) {
    throw new Error(
      'a non-infraError run must carry an agent result for every turn; ' +
        'classifyChatStatus and the record schema disagree',
    )
  }
  const answer = status === 'infraError' ? null : joinTurnReplies(replies)
  const unpriceable = unpriceableStep(priced, status, usageErrorTraced)
  const finalTrace =
    unpriceable === undefined ? trace : errorStep(trace, unpriceable)
  const toolSteps = finalTrace.filter((step) => step.kind === 'tool')

  return RunRecordSchema.parse({
    schemaVersion: 1,
    sweepId: request.sweepId,
    runId,
    agentId: request.agentId,
    agentShape: 'chat',
    arm: request.arm,
    variant: {
      ref: request.variant.ref,
      commit: request.variant.commit,
      model,
      // 'unobserved' rather than a hash of two empty strings: a run that
      // died before the model was reached learned nothing about the config,
      // and saying so is more useful than a digest that looks real.
      configDigest:
        llm.capture.systemPrompt === undefined
          ? 'unobserved'
          : configDigest(llm.capture.systemPrompt, llm.capture.toolNames),
    },
    caseId: request.case.caseId,
    attempt,
    startedAt: isoUtc(startedAt),
    endedAt: isoUtc(endedAt),
    input: caseInput(request.case),
    output: answer === null ? null : { kind: 'text', value: answer },
    trace: finalTrace,
    telemetry: {
      latencyMs: differenceInMilliseconds(endedAt, startedAt),
      tokens,
      ...(priced.cost === undefined ? {} : { cost: priced.cost }),
      toolCalls: toolSteps.length,
      toolErrors: toolSteps.filter((step) => step.error !== undefined).length,
      // withModelFallback retries inside LlmService and reports no count, so
      // this is the retries the runner itself made: none.
      retries: 0,
    },
    toolQueries: databricks.queries,
    // Recorded only when a query actually ran against the pinned version. A
    // run that read no versioned table has no version to report, and claiming
    // one it never applied is the silent failure this field exists to catch —
    // no provider is constructed at all wherever no credential is configured,
    // which is every local and CI run.
    ...(request.dataVersion !== undefined &&
      databricks.queries.length > 0 && {
        dataVersion: request.dataVersion,
      }),
    liveWeb: toolSteps.some((step) => step.tool === 'web_search'),
    status,
    ...(request.ci && { ci: request.ci }),
  })
}
