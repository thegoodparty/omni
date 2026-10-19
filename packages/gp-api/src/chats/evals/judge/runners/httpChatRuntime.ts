import { z } from 'zod'
import { zCoerceDate } from '@goodparty_org/contracts'
import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios'
import { HttpStatus } from '@nestjs/common'
import {
  ChatConversationSchema,
  CreateChatResponseSchema,
  type ChatConversation,
  type CreateChatResponse,
} from '@goodparty_org/contracts'
import { ChatMessageRole, ChatScope } from '../../../../generated/prisma'
import {
  JudgeChatCaseResponseSchema,
  TearDownJudgeChatCaseResponseSchema,
} from '@/testFixtures/schemas/judgeChatFixture.schema'
import {
  JudgeTurnSchema,
  ListJudgeTurnsResponseSchema,
} from '@/judge/schemas/listJudgeTurns.schema'
import type { SeededChatOrg } from '@/testFixtures/judgeChatFixture/seed'
import { sleep } from '@/shared/util/sleep.util'
import type { TestServiceContext } from '@/test-service'
import {
  createJudgeSession,
  parseJudgeSessionFromEnv,
  type JudgeSession,
} from '../judgeClerkSession'
import { SPEND_ENV, SPEND_VALUE, spendsRealMoney } from '../config'
import { ARM_RUNTIME_ENV, type ArmEnv } from '../sweepEnv'
import { httpConfigDigest, type TurnCapture } from './chatSeam'
import {
  UnsupportedOnRuntimeError,
  inProcessChatRuntime,
  unsupportedText,
  type CaseInstrumentation,
  type ChatArmRuntime,
  type DriveableCase,
} from './chatRuntime'

// DRIVING A DEPLOYED gp-api, with no seam inside it.
//
// The three `client.post` sites transfer almost directly — they were already
// HTTP, and all they needed was an origin and a bearer token. Everything the
// in-process runtime learned by patching a singleton is read back from
// `GET /v1/judge/conversations/:id/turns` instead, and everything it learned
// from a Prisma client is either asked for over the fixture routes or is not
// available at all, which is what `assertCanDrive` is for.
//
// WHAT THIS RUNTIME IS FOR IS THE SPENDING ARM AND ONLY THE SPENDING ARM. A
// dry run replaces the model with a canned script inside the arm process's
// own LlmService, and a deployed container is not that process. parseArmEnv
// refuses the pair before anything boots; `assertCanDrive` below refuses it
// again per case, because a caller that built this runtime by hand did not
// go through parseArmEnv.

const HTTP_CREATED: number = HttpStatus.CREATED
const HTTP_OK: number = HttpStatus.OK
const HTTP_UNAUTHORIZED: number = HttpStatus.UNAUTHORIZED
const HTTP_NOT_FOUND: number = HttpStatus.NOT_FOUND

// HOW LONG A TURN'S TELEMETRY ROW IS WAITED FOR, and why it is a wait at all.
//
// `ChatStreamService` writes the row with `void …​.catch(log)` on purpose: a
// judge observation must never cost a user their turn. The call is issued
// before the `done` frame, so by the time this arm holds the whole SSE body
// the upsert is in flight — but "in flight" is not "committed", and reading
// once lost the row often enough on a loaded box to matter.
//
// Fifteen seconds is sized against what is actually being waited for: ONE
// upsert on a conversation that is already in the page cache, issued before
// the response this arm has already finished reading. A second would cover
// it on an idle preview; fifteen covers a preview sharing a task with
// another sweep's turns and a cold connection pool. It cannot meaningfully
// extend a sweep either way, because the turn it follows streamed for
// minutes. And at fifteen seconds a miss is no longer a slow write: it is
// the write having thrown into the log the arm cannot read, which is a
// different problem and needs a different sentence.
export const TELEMETRY_WAIT_MS = 15_000
export const TELEMETRY_POLL_MS = 250

export interface HttpChatRuntimeOptions {
  // Origin only, no trailing slash. sweepEnv's TARGET_BASE_URL_ENV.
  baseUrl: string
  session: JudgeSession
  // Overridden only by tests, which have no reason to spend fifteen seconds
  // proving that a row never arrives.
  waitMs?: number
  pollMs?: number
  sleepFor?: (ms: number) => Promise<void>
  now?: () => number
}

// The ROUTE's own schema, with the one field that cannot survive JSON
// relaxed. `createdAt` is `zDate()` there — a Date instance, which is what
// the handler hands the serializer — and off the wire it is the ISO string
// that serializer wrote. Extended rather than restated so a column added to
// the route reaches this parse rather than being silently dropped.
const WireJudgeTurnsSchema = ListJudgeTurnsResponseSchema.extend({
  turns: z.array(JudgeTurnSchema.extend({ createdAt: zCoerceDate() })),
})
type WireJudgeTurn = z.infer<typeof WireJudgeTurnsSchema>['turns'][number]

const orgHeader = (organizationSlug: string): Record<string, string> => ({
  'X-Organization-Slug': organizationSlug,
})

// A body that is never JSON.parsed. The turn route answers
// `text/event-stream`, and axios' default transform would try the whole body
// as JSON, fail, and hand back the string anyway — but a single-frame body
// that happens to parse would come back as an object and
// `parseStreamEvents` would see nothing. Identity removes the guess.
const asText = [(data: string) => data]

const createClient = (baseUrl: string): AxiosInstance =>
  axios.create({
    baseURL: baseUrl,
    // Explicit assertions everywhere, the way the in-process test client
    // does it: a 401 has to be visible here so the session can be renewed.
    validateStatus: () => true,
    // A chat turn streams for minutes. The arm's own wall-clock budget is
    // what bounds a sweep; a socket timeout under that would kill paid turns.
    timeout: 15 * 60 * 1000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  })

export const httpChatRuntime = ({
  baseUrl,
  session,
  waitMs = TELEMETRY_WAIT_MS,
  pollMs = TELEMETRY_POLL_MS,
  sleepFor = sleep,
  now = () => Date.now(),
}: HttpChatRuntimeOptions): ChatArmRuntime => {
  const client = createClient(baseUrl)

  // ONE RETRY, ON 401 ONLY, and the session decides whether there is one to
  // make: `refused()` throws rather than re-minting when the token it issued
  // is too young for the refusal to be expiry, which is what keeps a judge
  // user with no row on the target from looping forever.
  const send = async <T>(
    config: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> => {
    const withToken = async (token: string): Promise<AxiosResponse<T>> =>
      client.request<T>({
        ...config,
        headers: { ...config.headers, Authorization: `Bearer ${token}` },
      })
    const first = await withToken(await session.token())
    if (first.status !== HTTP_UNAUTHORIZED) return first
    return withToken(await session.refused())
  }

  // The body, or a sentence naming the route and the status. Named for what
  // it returns rather than `assert…`, because every call site uses the value.
  const bodyOf = <T>(
    response: AxiosResponse<T>,
    status: number,
    what: string,
  ): T => {
    if (response.status !== status) {
      throw new Error(`${what} returned ${response.status}`)
    }
    return response.data
  }

  const listTurns = async (
    conversationId: string,
  ): Promise<WireJudgeTurn[]> => {
    const response = await send({
      method: 'GET',
      url: `/v1/judge/conversations/${conversationId}/turns`,
    })
    if (response.status === HTTP_NOT_FOUND) {
      throw new Error(
        `GET /v1/judge/conversations/${conversationId}/turns answered 404. ` +
          'That route is one 404 for three different things: the deploy is ' +
          'not preview or dev, the caller is not the judge fixture user, or ' +
          'the conversation is not theirs. Check which before re-running — ' +
          'none of the three is retryable.',
      )
    }
    return WireJudgeTurnsSchema.parse(
      bodyOf(
        response,
        HTTP_OK,
        `GET /v1/judge/conversations/${conversationId}/turns`,
      ),
    ).turns
  }

  // THE NEXT ROW, NOT A PREDICTED INDEX. `turnIndex` is `history.length` on
  // the server — the replayed conversation at the moment the turn ran — so
  // it counts a scope's scripted opener, dedups a retried user row and
  // saturates at the replay window. An arm that computed it would be
  // reimplementing all three and would be wrong on campaign_assistant from
  // the first turn. Strictly-greater-than-the-last-seen needs none of that
  // and is the same guarantee: one row per driven turn, in order.
  const waitForTurn = async (
    conversationId: string,
    afterTurnIndex: number,
    drivenTurn: number,
  ): Promise<WireJudgeTurn> => {
    const deadline = now() + waitMs
    for (;;) {
      const fresh = (await listTurns(conversationId))
        .filter((turn) => turn.turnIndex > afterTurnIndex)
        .sort((a, b) => a.turnIndex - b.turnIndex)
      const last = fresh.at(-1)
      if (last !== undefined) return last
      if (now() >= deadline) {
        throw new Error(
          `no judge telemetry row for turn ${drivenTurn} of conversation ` +
            `${conversationId} after ${waitMs}ms. The write is ` +
            'fire-and-forget inside ChatStreamService, so it never fails a ' +
            'turn and never reaches this arm when it throws: look for ' +
            '"failed to write judge turn telemetry" in the target\'s logs. ' +
            'A briefing chat records nothing at all — BriefingChatsService ' +
            'passes no sweep id — so this is also what driving one over ' +
            'HTTP looks like.',
        )
      }
      await sleepFor(pollMs)
    }
  }

  return {
    kind: 'http',

    assertCanDrive: (one) => {
      const reasons = unsupportedReasons(one)
      if (reasons.length > 0) {
        throw new UnsupportedOnRuntimeError(
          unsupportedText('http', one, reasons),
        )
      }
    },

    stageCase: async (request) =>
      JudgeChatCaseResponseSchema.parse(
        bodyOf(
          await send<SeededChatOrg>({
            method: 'POST',
            url: '/v1/test-fixtures/judge-chat-cases',
            data: {
              agentId: request.agentId,
              slugKey: request.slugKey,
              ...(request.accountState && {
                accountState: request.accountState,
              }),
            },
          }),
          HTTP_CREATED,
          'POST /v1/test-fixtures/judge-chat-cases',
        ),
      ),

    // The target's database outlives the sweep, unlike the throwaway
    // container the in-process runtime gets, so this is the only thing that
    // keeps a preview from accumulating one judge organization per case per
    // attempt per sweep forever.
    tearDownCase: async (organizationSlug) => {
      const { removed } = TearDownJudgeChatCaseResponseSchema.parse(
        bodyOf(
          await send({
            method: 'DELETE',
            url:
              '/v1/test-fixtures/judge-chat-cases/' +
              encodeURIComponent(organizationSlug),
          }),
          HTTP_OK,
          `DELETE /v1/test-fixtures/judge-chat-cases/${organizationSlug}`,
        ),
      )
      if (!removed) {
        throw new Error(
          `${organizationSlug} was not removed: it is already gone, or it ` +
            "is not this caller's fixture",
        )
      }
    },

    // Refused rather than approximated. `organization.positionId`,
    // `campaign.isPro` and `campaign.details` are not on any route the judge
    // user can reach, and the whole point of this check is that it reads the
    // rows back instead of trusting the directive. Unreachable in practice —
    // assertCanDrive refuses the same three states up front — and kept so
    // that a future caller which skips that guard fails loudly here rather
    // than silently recording a condition nobody verified.
    readSeededAccountRows: () => {
      throw new UnsupportedOnRuntimeError(
        'the account state is verified by reading organization.positionId ' +
          'and the campaign row back, and no route exposes either to the ' +
          'judge user; an HTTP arm can ask for the state to be seeded but ' +
          'cannot confirm it was',
      )
    },

    openConversation: async (request) => {
      if (request.scope === ChatScope.briefing_annotation) {
        // Unreachable: assertCanDrive refuses this scope. Here so the branch
        // is a sentence rather than a cast.
        throw new UnsupportedOnRuntimeError(
          'briefing_annotation cannot be driven over HTTP; see ' +
            'unsupportedReasons',
        )
      }
      const data = CreateChatResponseSchema.parse(
        bodyOf(
          await send<CreateChatResponse>({
            method: 'POST',
            url: '/v1/chats',
            data: {
              scope: request.scope,
              ...(request.anchor && { anchor: request.anchor }),
            },
            headers: orgHeader(request.organizationSlug),
          }),
          HTTP_CREATED,
          `POST /v1/chats for scope "${request.scope}"`,
        ),
      )
      return {
        conversationId: data.conversationId,
        messagesPath: `/v1/chats/${data.conversationId}/messages?scope=${request.scope}`,
      }
    },

    seedPriorTranscript: () => {
      throw new UnsupportedOnRuntimeError(
        'no route writes an assistant message — the row is a side effect of ' +
          'a turn — so a prior transcript cannot be seeded over HTTP',
      )
    },

    postTurn: async (request) => {
      const response = await send<string>({
        method: 'POST',
        url: request.messagesPath,
        data: { content: request.content },
        headers: {
          ...orgHeader(request.organizationSlug),
          Accept: 'text/event-stream',
        },
        responseType: 'text',
        // Buffered whole and handed on unparsed, which is what keeps every
        // `toolCallId` intact for buildTrace.
        transformResponse: asText,
      })
      return { status: response.status, body: String(response.data) }
    },

    // No route reads one message, so the conversation is read and the row
    // the `done` frame named is picked out of it. Still keyed on that id
    // rather than on "the last assistant row": campaign_assistant seeds a
    // scripted opener as its first assistant message, and folding that into
    // the output would have the judge compare two arms partly on seed data.
    //
    // No poll here, unlike the telemetry row. `persistOnce` is AWAITED
    // inside the stream before the `done` frame is written, so by the time
    // this arm holds the whole body the row is committed.
    readAssistantText: async (request) => {
      const response = await send<ChatConversation>({
        method: 'GET',
        url:
          `/v1/chats/${request.conversationId}` +
          `?scope=${encodeURIComponent(request.scope)}`,
        headers: orgHeader(request.organizationSlug),
      })
      if (response.status === HTTP_NOT_FOUND) return null
      const { messages } = ChatConversationSchema.parse(
        bodyOf(response, HTTP_OK, `GET /v1/chats/${request.conversationId}`),
      )
      const row = messages.find(
        (message) =>
          message.id === request.assistantMessageId &&
          message.role === ChatMessageRole.assistant,
      )
      return row?.content ?? null
    },

    beginCase: async (request) => {
      assertHttpMaySpend(request.script !== undefined, request.realModel)
      // Nothing is installed, so nothing is restored. Every field the
      // in-process capture fills by patching a singleton is filled from the
      // telemetry route instead, one turn at a time.
      const capture: TurnCapture = {
        toolNames: [],
        turnsPriced: 0,
        outcomes: [],
      }
      const toolQueries: string[] = []
      let lastTurnIndex = -1
      let promptHash: string | undefined
      let promptHashVersion = ''
      // The LAST turn's called-tool set, which is what the digest hashes.
      // `capture.toolNames` accumulates the UNION instead, because its other
      // reader — chatToolErrorDetails — uses it as the allowlist of names
      // gp-api really registered, and that has to cover the whole case.
      let lastToolNames: string[] = []

      return {
        capture,
        toolQueries,
        observeTurn: async ({ conversationId, drivenTurn, completed }) => {
          if (!completed) {
            throw new Error(
              `turn ${drivenTurn} of conversation ${conversationId} wrote ` +
                'no `done` frame, and gp-api records judge telemetry only ' +
                'on a clean finish, so there is no row to wait for',
            )
          }
          const turn = await waitForTurn(
            conversationId,
            lastTurnIndex,
            drivenTurn,
          )
          lastTurnIndex = turn.turnIndex
          promptHash = turn.promptHash
          promptHashVersion = turn.promptHashVersion
          lastToolNames = turn.toolNames
          capture.toolNames = [
            ...new Set([...capture.toolNames, ...turn.toolNames]),
          ].sort()
          toolQueries.push(...turn.toolQueries)
          if (turn.model !== null) capture.model = turn.model
          // Both or neither, the way the in-process read is: a turn whose
          // usage never resolved leaves `turnsPriced` behind the turn count,
          // which is what makes the run unpriceable rather than cheap.
          if (turn.inputTokens !== null && turn.outputTokens !== null) {
            capture.tokens = {
              input: (capture.tokens?.input ?? 0) + turn.inputTokens,
              output: (capture.tokens?.output ?? 0) + turn.outputTokens,
            }
            capture.turnsPriced += 1
          }
        },
        configDigest: () =>
          promptHash === undefined
            ? 'unobserved'
            : httpConfigDigest(promptHash, promptHashVersion, lastToolNames),
        restore: () => undefined,
      } satisfies CaseInstrumentation
    },
  }
}

// EVERY REASON, NOT THE FIRST. A case list that leans on three things an
// HTTP arm cannot do should learn all three from one failed arm.
//
// Each entry names what is missing on the far side rather than what the case
// asked for, because the fix is never "drop the directive" — it is either
// "run this agent in process" or "add the thing to gp-api".
export const unsupportedReasons = (one: DriveableCase): string[] => {
  const reasons: string[] = []
  if (one.script !== undefined) {
    reasons.push(
      "a canned script replaces the model by patching this process's own " +
        'LlmService, and the agent runs in a container this process cannot ' +
        `reach (${ARM_RUNTIME_ENV}=http drives a deployed gp-api)`,
    )
  }
  if (one.script === undefined && one.realModel !== true) {
    reasons.push(
      'the run names neither a script nor realModel, and over HTTP there is ' +
        'no third thing it could mean',
    )
  }
  if (one.realModel === true && !spendsRealMoney(process.env)) {
    reasons.push(
      `the real model was asked for but ${SPEND_ENV} is not ` +
        `"${SPEND_VALUE}"`,
    )
  }
  if (one.scope === ChatScope.briefing_annotation) {
    reasons.push(
      'briefing_annotation records no judge telemetry at all — ' +
        'BriefingChatsService carries no organization slug and so passes no ' +
        'sweep id — and its artifact and its "Today is" line are served by ' +
        'an in-process patch, so neither arm could read the same briefing ' +
        'on the same day',
    )
  }
  if (one.priorTranscript !== undefined) {
    reasons.push(
      'a prior transcript needs an assistant row written onto the ' +
        'conversation, and no route writes one: the row is a side effect of ' +
        'a turn',
    )
  }
  if (one.toolFailure !== undefined) {
    reasons.push(
      "a forced tool failure is honoured at the tool's execute hook, which " +
        'runs inside the agent process',
    )
  }
  if (one.dataVersion !== undefined) {
    reasons.push(
      'a Delta version is applied by rewriting the generated SQL in ' +
        'DatabricksSqlProvider.query, which runs inside the agent process; ' +
        'a deployed gp-api neither pins one nor reports one, and recording ' +
        'a version that was never applied is the one failure the field ' +
        'exists to catch',
    )
  }
  const state = one.accountState
  const unverifiable = (['district', 'pro', 'campaignDetails'] as const).filter(
    (key) => state?.[key] !== undefined,
  )
  if (unverifiable.length > 0) {
    reasons.push(
      `the account state names ${unverifiable.join(', ')}, which is ` +
        'verified by reading the organization and campaign rows back, and ' +
        'no route exposes either to the judge user',
    )
  }
  return reasons
}

// The same two refusals `assertMaySpend` makes for the in-process seam,
// restated here because there is no seam to make them: nothing is installed,
// so nothing would have thrown.
const assertHttpMaySpend = (scripted: boolean, realModel?: boolean): void => {
  if (scripted) {
    throw new UnsupportedOnRuntimeError(
      'a canned script cannot run against a deployed gp-api',
    )
  }
  if (realModel !== true || !spendsRealMoney(process.env)) {
    throw new UnsupportedOnRuntimeError(
      `an HTTP arm reaches the real, paid model: pass realModel and set ` +
        `${SPEND_ENV}=${SPEND_VALUE}`,
    )
  }
}

// WHICH RUNTIME THIS ARM DRIVES ON, from the one variable that decides it.
// The in-process one takes the booted app the caller already owns; the HTTP
// one takes an origin and a Clerk session the mint step published. The arm
// holds no Clerk secret, so `mint` is deliberately absent: a 401 that is not
// expiry is a sentence rather than a loop.
export const chatArmRuntimeFor = (
  env: ArmEnv,
  service: TestServiceContext,
): ChatArmRuntime => {
  if (env.armRuntime === 'inprocess') return inProcessChatRuntime(service)
  const { targetBaseUrl } = env
  if (targetBaseUrl === undefined) {
    throw new UnsupportedOnRuntimeError(
      `${ARM_RUNTIME_ENV} is "http" but no target origin was resolved; ` +
        'parseArmEnv is what supplies one',
    )
  }
  return httpChatRuntime({
    baseUrl: targetBaseUrl,
    session: createJudgeSession({ initial: parseJudgeSessionFromEnv() }),
  })
}
