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
import { PRICING_VERSION, UnpriceableRunError, priceUsd } from '../pricing'
import {
  isoUtc,
  RunRecordSchema,
  type Arm,
  type CiContext,
  type Cost,
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
} from './chatSeam'
import { chatScopeFor } from './seedChatOrg'

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

export interface ChatJudgeCase {
  caseId: string
  // The turn the agent is asked to take. Must not be a scope's canned-reply
  // sentinel (campaign_assistant has two), or the handler answers from a
  // script and the record describes no model behavior at all.
  question: string
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
  const prNumber = Number.parseInt(fromRef ?? env.PR_NUMBER ?? '', 10)
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

interface TurnOutcome {
  output: string | null
  events: StreamEvent[]
  streamErrored: boolean
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

const driveTurn = async (
  ports: ChatRunnerPorts,
  request: ChatRunRequest,
): Promise<TurnOutcome> => {
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

  // No clientMessageId: the route requires a GUID and it only buys user-turn
  // dedup, which a run that opens its own conversation cannot need.
  const streamed = await ports.service.client.post<string>(
    `/v1/chats/${conversationId}/messages?scope=${scope}`,
    { content: request.case.question },
    headers,
  )
  if (streamed.status !== HTTP_OK) {
    throw new Error(`POST /v1/chats/:id/messages returned ${streamed.status}`)
  }

  const events = parseStreamEvents(String(streamed.data))
  const done = events.find((event) => event.type === 'done')
  return {
    output: await readAssistantText(ports, done?.assistantMessageId),
    events,
    streamErrored: events.some((event) => event.type === 'error'),
  }
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

export const runChatCase = async (
  ports: ChatRunnerPorts,
  request: ChatRunRequest,
): Promise<RunRecord> => {
  // Ahead of any instrumentation: an agent with no registered scope handler
  // cannot be driven at all, and emitting an infraError record for it would
  // put a coverage gap into the delta as though it were a failed run.
  chatScopeFor(request.agentId)

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
    })
  } catch (err) {
    databricks.restore()
    throw err
  }

  const startedAt = new Date()
  let outcome: TurnOutcome
  let trace: TraceStep[]
  // A rejected usage promise is already in the trace by its own message. The
  // pricing guard below would otherwise restate the same failure generically,
  // one step behind it.
  let usageErrorTraced = false
  try {
    outcome = await driveTurn(ports, request)
    trace = buildTrace(outcome.events, llm.capture.outcomes)
    try {
      await readTurnTokens(llm.capture)
    } catch (usageErr) {
      // Token accounting is not the turn. A rejected usage promise leaves the
      // counts at zero and says so in the trace rather than discarding an
      // answer that is already persisted and judgeable.
      trace = errorStep(trace, traceErrorText(usageErr))
      usageErrorTraced = true
    }
  } catch (err) {
    // A throw here is the harness or the route failing, never an agent
    // result: no output exists to judge, which is exactly what infraError
    // means and why the schema forbids one.
    outcome = { output: null, events: [], streamErrored: true }
    trace = infraTrace(traceErrorText(err))
  } finally {
    llm.restore()
    databricks.restore()
  }
  const endedAt = new Date()

  // Absent when the turn ended before usage resolved, which is not the same
  // as a turn that used nothing.
  const observed = llm.capture.tokens
  const tokens: TokenUsage = {
    input: observed?.input ?? 0,
    output: observed?.output ?? 0,
    // Zero because prompt caching is not enabled. Carried rather than
    // omitted so the day it is switched on, pricing fails loudly instead of
    // costing a cache read at the full input rate.
    cacheRead: 0,
    cacheWrite: 0,
  }
  const model = llm.capture.model || request.variant.model
  // Price only what was measured. When usage never resolved those counts are
  // defaults, not observations, and pricing them produces a confident $0 for
  // a run whose cost is genuinely unknown — the "this run was free" reading
  // the schema's absent-rather-than-zero rule exists to prevent. An
  // infraError turn is the usual way to get here, but the rule is about
  // whether the tokens were seen, not about the status: a turn that really
  // did use nothing reports a true zero, and one that died before reporting
  // reports nothing at all.
  const priced =
    observed === undefined
      ? {
          unpriceable:
            'usage never resolved: the turn ended before the model ' +
            'reported it, so its cost is unknown rather than zero',
        }
      : priceRun(tokens, model)
  const status = classifyChatStatus(
    outcome.output,
    outcome.streamErrored,
    fallbackReplies,
  )
  const answer = status === 'infraError' ? null : outcome.output
  if (status !== 'infraError' && answer === null) {
    throw new Error(
      'a non-infraError run must carry an agent result; classifyChatStatus ' +
        'and the record schema disagree',
    )
  }
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
    input: { kind: 'question', value: request.case.question },
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
