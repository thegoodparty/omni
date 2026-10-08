import { differenceInMilliseconds } from 'date-fns'
import { z } from 'zod'
import { caseTurns } from '../cases'
import { PRICING_VERSION, UnpriceableRunError, priceUsd } from '../pricing'
import {
  isoUtc,
  RunRecordSchema,
  type Arm,
  type CiContext,
  type Cost,
  type Payload,
  type RunRecord,
  type RunStatus,
  type TokenUsage,
  type ToolErrorDetail,
  type TraceStep,
} from '../record'
import {
  UNRECORDED_TOOL_ERROR,
  capToolErrorDetails,
  publicToolName,
  redactToolError,
  toolErrorDetail,
} from '../toolErrorDetails'
import { chatScopeFor, type JudgeAccount } from './judgeAccount'

// ONE CHAT CASE, DRIVEN AGAINST A DEPLOYED gp-api AS A BLACK BOX. The base
// arm talks to dev, the candidate arm to the PR's preview. Everything the
// record says comes off the wire: the SSE frames of each turn, the persisted
// conversation, its usage and the commit the deployment serves. Nothing in
// the app knows a judge is calling it.

// The model's own words when its tool budget ran out without an answer — see
// `toolBudgetExhaustedNote` in llm/services/llm.service.ts, which instructs
// this string verbatim. chatHttp.test.ts pins the two together.
export const TOOL_BUDGET_FALLBACK_REPLY =
  "I wasn't able to find what I needed to answer that question. You can " +
  'try again, rephrase your question, or ask me about something else.'

// What the route persists as the assistant turn when the stream died before
// any output. A copy of CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER in
// chatStream.service.ts, which this tsx entry does not import because the
// service drags the whole Nest graph in; chatHttp.test.ts pins the two.
export const CHAT_INTERRUPTED_MARKER = '__chat:interrupted_before_output__'

// Above the server's own 300s stream timeout, so a turn the server gives up
// on arrives as the server's timeout frame rather than as our abort.
export const TURN_TIMEOUT_MS = 330_000
const REQUEST_TIMEOUT_MS = 60_000

const UNOBSERVED = 'unobserved'
const WEB_SEARCH = 'web_search'

export interface ChatJudgeCase {
  caseId: string
  question?: string
  turns?: string[]
}

export interface ChatHttpRequest {
  agentId: string
  case: ChatJudgeCase
  sweepId: string
  arm: Arm
  attempt: number
  ref: string
  baseUrl: string
  // Made inside the run, so an account that could not be made is an
  // infraError record like any other failure to reach the app.
  account: () => Promise<JudgeAccount>
  ci?: CiContext
  fetchImpl?: typeof fetch
}

// GitHub provenance, so a stored record leads back to the change it judged.
// Absent on a local run, which has no Actions run to point at.
export const ciContextFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): CiContext | undefined => {
  const repo = env.GITHUB_REPOSITORY
  const workflowRunId = env.GITHUB_RUN_ID
  if (!repo || !workflowRunId) return undefined
  const attempt = Number.parseInt(env.GITHUB_RUN_ATTEMPT ?? '1', 10)
  const fromRef = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? '')?.[1]
  // JUDGE_PR_NUMBER FIRST: it is what judge.yml hands the arms, and a sweep is
  // dispatched or commented from main, so its GITHUB_REF is never a pull ref.
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

export const classifyChatStatus = (
  output: string | null,
  streamErrored: boolean,
  fallbackReplies: readonly string[],
): RunStatus => {
  if (streamErrored) return 'infraError'
  if (output === null) return 'infraError'
  if (output === CHAT_INTERRUPTED_MARKER) return 'infraError'
  const trimmed = output.trim()
  if (trimmed.length === 0) return 'infraError'
  return fallbackReplies.some((reply) => trimmed.includes(reply.trim()))
    ? 'blocked'
    : 'produced'
}

// ONE STATUS FOR THE WHOLE CONVERSATION, worst turn wins. A broken turn means
// the conversation the case authored did not happen. A declined turn is an
// agent result and stays judgeable, but a conversation that had to recover
// from one is the behavior being compared, so it keeps the mark.
export const combineChatStatus = (perTurn: readonly RunStatus[]): RunStatus => {
  if (perTurn.length === 0) return 'infraError'
  if (perTurn.includes('infraError')) return 'infraError'
  return perTurn.includes('blocked') ? 'blocked' : 'produced'
}

// EVERY assistant reply, in order. A one-turn case is unlabelled; the labels
// exist because a reply can itself contain blank lines.
export const joinTurnReplies = (replies: readonly string[]): string => {
  const [only] = replies
  if (replies.length === 1 && only !== undefined) return only
  return replies
    .map((reply, index) => `[turn ${index + 1}]\n${reply}`)
    .join('\n\n')
}

export const reindexTrace = (steps: readonly TraceStep[]): TraceStep[] =>
  steps.map((step, index) => ({ ...step, index }))

// A case asked with `question` records exactly what it always has; one asked
// with `turns` records the general shape, so an older base ref that read the
// list differently mismatches rather than compares.
export const caseInput = (one: ChatJudgeCase): Payload =>
  one.turns === undefined
    ? { kind: 'question', value: caseTurns(one)[0] ?? '' }
    : { kind: 'transcript', value: { turns: one.turns } }

const MAX_ERROR_CHARS = 200

// Redacted on the whole text before it is cut, so a cut cannot leave half a
// secret that no longer matches its shape.
export const traceErrorText = (err: unknown): string => {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return redactToolError(raw).slice(0, MAX_ERROR_CHARS)
}

const SSE_DATA_PREFIX = 'data: '

// The subset of the route's frames this runner reads. Parsed rather than
// typed from ChatStreamChunk because they arrive off the wire, and a frame
// carrying a field this build does not know must not fail a run.
const StreamFrameSchema = z.object({
  type: z.string().min(1),
  toolName: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  assistantMessageId: z.string().optional(),
})
export type StreamFrame = z.infer<typeof StreamFrameSchema>

// A stream cut off mid-frame leaves a partial JSON tail. Skipped rather than
// thrown, so an answer that was already persisted is not discarded.
const parseFrame = (json: string): StreamFrame | null => {
  try {
    const parsed = StreamFrameSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const parseStreamFrames = (body: string): StreamFrame[] =>
  body.split('\n\n').flatMap((frame) => {
    const line = frame.trim()
    if (!line.startsWith(SSE_DATA_PREFIX)) return []
    const parsed = parseFrame(line.slice(SSE_DATA_PREFIX.length))
    return parsed === null ? [] : [parsed]
  })

// One turn's shape. A failed tool emits a tool_call and never a tool_result,
// so a call left unanswered when the turn ends is the tool error. Native web
// search is run by the provider, which reports no result frame for it, so it
// is never counted as one.
export const turnTrace = (frames: readonly StreamFrame[]): TraceStep[] => {
  const steps: TraceStep[] = []
  const unanswered = new Map<string, number[]>()
  let openText = false
  for (const frame of frames) {
    if (frame.type === 'text') {
      if (!openText) steps.push({ index: steps.length, kind: 'text' })
      openText = true
      continue
    }
    if (frame.type === 'tool_call' && frame.toolName !== undefined) {
      openText = false
      const queue = unanswered.get(frame.toolName) ?? []
      queue.push(steps.length)
      unanswered.set(frame.toolName, queue)
      steps.push({ index: steps.length, kind: 'tool', tool: frame.toolName })
      continue
    }
    if (frame.type === 'tool_result' && frame.toolName !== undefined) {
      unanswered.get(frame.toolName)?.shift()
      continue
    }
    if (frame.type === 'error') {
      openText = false
      steps.push({
        index: steps.length,
        kind: 'error',
        error: frame.message || frame.code || 'unknown stream error',
      })
    }
  }
  for (const [tool, indexes] of unanswered) {
    if (tool === WEB_SEARCH) continue
    for (const index of indexes) {
      const step = steps[index]
      if (step !== undefined)
        steps[index] = { ...step, error: UNRECORDED_TOOL_ERROR }
    }
  }
  return steps
}

export const chatToolErrorDetails = (
  steps: readonly TraceStep[],
): ToolErrorDetail[] =>
  capToolErrorDetails(
    steps.flatMap((step) =>
      step.kind !== 'tool' || step.error === undefined
        ? []
        : [
            toolErrorDetail(
              step.tool === undefined
                ? undefined
                : publicToolName(step.tool, 'chat'),
              step.error,
            ),
          ],
    ),
  )

const UsageSchema = z.object({
  complete: z.boolean(),
  byModel: z.array(
    z.object({
      model: z.string().min(1),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    }),
  ),
})
export type ConversationUsage = z.infer<typeof UsageSchema>

export interface UsageOutcome {
  model: string
  tokens: TokenUsage
  cost?: Cost
  // Why there is no cost, for the trace.
  unpriced?: string
}

const NO_TOKENS: TokenUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
}

// PRICED ONLY WHEN THE WHOLE CONVERSATION WAS MEASURED BY ONE MODEL. A
// partial count under a real pricing version reads as a cheaper run rather
// than an unknown one, and a record carries one model, so a conversation
// answered by two cannot be priced on it. Tokens are then zero, the only
// other thing TokenUsageSchema can say, and the trace carries the reason.
export const usageOutcome = (usage?: ConversationUsage): UsageOutcome => {
  if (usage === undefined) {
    return {
      model: UNOBSERVED,
      tokens: NO_TOKENS,
      unpriced:
        'this deployment reported no usage for the conversation, so the ' +
        'cost is unknown rather than zero',
    }
  }
  const [only, ...rest] = usage.byModel
  const model =
    only !== undefined && rest.length === 0 ? only.model : UNOBSERVED
  if (!usage.complete) {
    return {
      model,
      tokens: NO_TOKENS,
      unpriced:
        'usage was not recorded for every assistant message, so the cost ' +
        'is unknown rather than zero',
    }
  }
  if (only === undefined || rest.length > 0) {
    return {
      model,
      tokens: NO_TOKENS,
      unpriced:
        only === undefined
          ? 'no assistant message reported usage'
          : `the conversation was answered by ${usage.byModel.length} ` +
            'models, and a record prices one',
    }
  }
  const tokens: TokenUsage = {
    input: only.inputTokens,
    output: only.outputTokens,
    cacheRead: 0,
    cacheWrite: 0,
  }
  try {
    return {
      model,
      tokens,
      cost: {
        usdAtCapture: priceUsd(tokens, model),
        pricingVersion: PRICING_VERSION,
      },
    }
  } catch (err) {
    if (!(err instanceof UnpriceableRunError)) throw err
    return { model, tokens, unpriced: err.message }
  }
}

const VersionSchema = z.object({ commit: z.string().min(1) })

const ConversationSchema = z.object({
  messages: z.array(
    z.object({ id: z.string(), role: z.string(), content: z.string() }),
  ),
  usage: z.unknown().optional(),
})

interface OpenedConversation {
  messagesPath: string
  conversationPath: string
}

const headersFor = (
  token: string,
  organizationSlug: string,
  json: boolean,
): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  'x-organization-slug': organizationSlug,
  ...(json && { 'content-type': 'application/json' }),
})

const expectOk = (response: Response, method: string, path: string): void => {
  if (!response.ok) {
    throw new Error(
      `${method} ${path.split('?')[0]} returned ${response.status}`,
    )
  }
}

// Briefing chat is opened the way the webapp opens it: POST
// /v1/briefing-chats creates the conversation and its annotation together,
// and the registry's POST /v1/chats refuses the scope on purpose.
const openConversation = async (
  request: ChatHttpRequest,
  account: JudgeAccount,
  scope: string,
): Promise<OpenedConversation> => {
  const fetchImpl = request.fetchImpl ?? fetch
  if (scope === 'briefing_annotation') {
    if (account.briefing === undefined) {
      throw new Error(
        'briefing_annotation is opened on a briefing, and the account has none',
      )
    }
    const path = '/v1/briefing-chats'
    const response = await fetchImpl(`${request.baseUrl}${path}`, {
      method: 'POST',
      headers: headersFor(account.token, account.organizationSlug, true),
      body: JSON.stringify(account.briefing),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    expectOk(response, 'POST', path)
    const { annotationId } = z
      .object({ annotationId: z.string() })
      .parse(await response.json())
    return {
      messagesPath: `/v1/briefing-chats/${annotationId}/messages`,
      conversationPath: `/v1/briefing-chats/${annotationId}`,
    }
  }
  const path = '/v1/chats'
  const response = await fetchImpl(`${request.baseUrl}${path}`, {
    method: 'POST',
    headers: headersFor(account.token, account.organizationSlug, true),
    body: JSON.stringify({
      scope,
      ...(account.anchor && { anchor: account.anchor }),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  expectOk(response, 'POST', path)
  const { conversationId } = z
    .object({ conversationId: z.string() })
    .parse(await response.json())
  return {
    messagesPath: `/v1/chats/${conversationId}/messages?scope=${scope}`,
    conversationPath: `/v1/chats/${conversationId}?scope=${scope}`,
  }
}

interface TurnOutcome {
  output: string | null
  streamErrored: boolean
}

export const runChatHttpCase = async (
  request: ChatHttpRequest,
): Promise<RunRecord> => {
  const scope = chatScopeFor(request.agentId)
  const turns = caseTurns(request.case)
  const fetchImpl = request.fetchImpl ?? fetch
  const fallbackReplies = [TOOL_BUDGET_FALLBACK_REPLY]

  let startedAt = new Date()
  let commit = UNOBSERVED
  const outcomes: TurnOutcome[] = []
  const trace: TraceStep[] = []
  let usage: ConversationUsage | undefined
  let liveWeb = false
  let driveError: string | undefined
  try {
    const version = await fetchImpl(`${request.baseUrl}/v1/version`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    expectOk(version, 'GET', '/v1/version')
    commit = VersionSchema.parse(await version.json()).commit

    const account = await request.account()
    startedAt = new Date()
    const conversation = await openConversation(request, account, scope)

    for (const content of turns) {
      const streamed = await fetchImpl(
        `${request.baseUrl}${conversation.messagesPath}`,
        {
          method: 'POST',
          headers: {
            ...headersFor(account.token, account.organizationSlug, true),
            accept: 'text/event-stream',
          },
          body: JSON.stringify({ content }),
          signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
        },
      )
      expectOk(streamed, 'POST', conversation.messagesPath)
      const frames = parseStreamFrames(await streamed.text())
      trace.push(...turnTrace(frames))
      if (
        frames.some(
          (frame) =>
            frame.type === 'tool_call' && frame.toolName === WEB_SEARCH,
        )
      ) {
        liveWeb = true
      }

      // The persisted turn rather than the streamed deltas: it carries the
      // full assistant text, and the `done` frame names the row THIS turn
      // wrote, which keeps campaign_assistant's scripted opener out of the
      // output.
      const read = await fetchImpl(
        `${request.baseUrl}${conversation.conversationPath}`,
        {
          headers: headersFor(account.token, account.organizationSlug, false),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
      expectOk(read, 'GET', conversation.conversationPath)
      const persisted = ConversationSchema.parse(await read.json())
      const parsedUsage = UsageSchema.safeParse(persisted.usage)
      usage = parsedUsage.success ? parsedUsage.data : undefined
      const assistantMessageId = frames.find(
        (frame) => frame.type === 'done',
      )?.assistantMessageId
      const turn: TurnOutcome = {
        output:
          persisted.messages.find(
            (message) =>
              message.id === assistantMessageId && message.role === 'assistant',
          )?.content ?? null,
        streamErrored: frames.some((frame) => frame.type === 'error'),
      }
      outcomes.push(turn)

      // A broken turn ends the conversation the case authored, so the turns
      // after it would be paid for and read by nobody. A declined turn is an
      // agent result and the conversation continues.
      if (
        classifyChatStatus(turn.output, turn.streamErrored, []) === 'infraError'
      ) {
        break
      }
    }
  } catch (err) {
    driveError = traceErrorText(err)
  }
  const endedAt = new Date()

  const status =
    driveError === undefined
      ? combineChatStatus(
          outcomes.map((turn) =>
            classifyChatStatus(
              turn.output,
              turn.streamErrored,
              fallbackReplies,
            ),
          ),
        )
      : 'infraError'
  const replies = outcomes.flatMap((turn) =>
    turn.output === null ? [] : [turn.output],
  )
  const measured = usageOutcome(usage)
  const steps = reindexTrace([
    ...trace,
    ...(driveError === undefined
      ? []
      : [{ index: 0, kind: 'error' as const, error: driveError }]),
    ...(status !== 'infraError' && measured.unpriced !== undefined
      ? [{ index: 0, kind: 'error' as const, error: measured.unpriced }]
      : []),
  ])
  const toolSteps = steps.filter((step) => step.kind === 'tool')
  const toolErrorDetails = chatToolErrorDetails(toolSteps)

  return RunRecordSchema.parse({
    schemaVersion: 1,
    sweepId: request.sweepId,
    runId: `${request.sweepId}:${request.case.caseId}:${request.arm}:${request.attempt}`,
    agentId: request.agentId,
    agentShape: 'chat',
    arm: request.arm,
    variant: {
      ref: request.ref,
      commit,
      model: measured.model,
      // What the agent read is whatever the deployment serves, so the
      // deployment's commit stands in for a hash of the rendered prompt.
      configDigest: commit === UNOBSERVED ? UNOBSERVED : `deploy:${commit}`,
    },
    caseId: request.case.caseId,
    attempt: request.attempt,
    startedAt: isoUtc(startedAt),
    endedAt: isoUtc(endedAt),
    input: caseInput(request.case),
    output:
      status === 'infraError'
        ? null
        : { kind: 'text', value: joinTurnReplies(replies) },
    trace: steps,
    telemetry: {
      latencyMs: differenceInMilliseconds(endedAt, startedAt),
      tokens: measured.tokens,
      ...(measured.cost !== undefined && { cost: measured.cost }),
      toolCalls: toolSteps.length,
      toolErrors: toolSteps.filter((step) => step.error !== undefined).length,
      retries: 0,
    },
    toolQueries: [],
    ...(toolErrorDetails.length > 0 && { toolErrorDetails }),
    liveWeb,
    status,
    ...(request.ci && { ci: request.ci }),
  })
}
