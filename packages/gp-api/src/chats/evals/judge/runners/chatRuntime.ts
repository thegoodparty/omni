import { HttpStatus } from '@nestjs/common'
import {
  CreateChatResponseSchema,
  type ChatAnchor,
  type CreateChatResponse,
} from '@goodparty_org/contracts'
import { ChatMessageRole, ChatScope } from '../../../../generated/prisma'
import {
  createBriefingChatResponseSchema,
  type CreateBriefingChatResponse,
} from '@/chats/briefing-chats/schemas/CreateBriefingChat.schema'
import { LlmService } from '@/llm/services/llm.service'
import type { TestServiceContext } from '@/test-service'
import {
  seedOptionsFor,
  type BriefingChatTarget,
  type SeededChatOrg,
} from '@/testFixtures/judgeChatFixture/seed'
import { JUDGE_BRIEFING_BUCKET } from '@/testFixtures/judgeChatFixture/briefingRows'
import type { ChatAccountState, SeededTurn, ToolFailure } from '../cases'
import type { ArmRuntimeKind } from '../sweepEnv'
import {
  configDigest,
  installBriefingFixture,
  installLlmCapture,
  instrumentDatabricksProvider,
  readTurnTokens,
  type ChatTurnScript,
  type DeltaPin,
  type InstalledBriefingFixture,
  type InstalledLlmCapture,
  type TurnCapture,
} from './chatSeam'
import {
  JUDGE_BRIEFING_ARTIFACT,
  JUDGE_BRIEFING_TODAY,
} from './briefingFixture'
import { seedChatOrg } from './seedChatOrg'
import { seedPriorTranscript } from './seedTranscript'

// WHERE A CHAT ARM DRIVES THE AGENT, as an interface rather than as a handle
// on the app.
//
// What this replaces was `{ service: TestServiceContext }`, which is not an
// abstraction: `TestServiceContext` is the in-process Nest app, its Prisma
// client, its authenticated axios client and its user, and the runner reached
// through it at nine sites. Four of those nine reached a Prisma client, one
// reached the Nest container for a singleton to monkeypatch, and one reached
// the booted app to write chat rows directly. A deployed gp-api behind an
// HTTP boundary has none of them, so there was nothing to implement against
// and the first HTTP arm would have had to fork the runner.
//
// The operations below are the nine sites, named for what they DO rather
// than for what they happened to touch:
//
//   stageCase / tearDownCase     the fixture organization this case runs on
//   readSeededAccountRows        the two Prisma reads behind the account-state
//                                check
//   openConversation             POST /v1/chats or POST /v1/briefing-chats
//   seedPriorTranscript          the one write no route performs
//   postTurn                     POST a turn and hand back the SSE body whole
//   readAssistantText            the persisted assistant row the `done` frame
//                                names
//   beginCase                    the per-case observation: the prompt, the
//                                tool names, the model, the tokens and the
//                                generated SQL
//
// `assertCanDrive` is what keeps this honest. A runtime that cannot serve a
// directive refuses it by name, up front, before a conversation is opened and
// before a paid turn is reached — it never serves a weaker version of it
// quietly. The HTTP runtime refuses seven kinds of case for six distinct
// reasons; see `httpChatRuntime.ts`.

export interface StageCaseRequest {
  agentId: string
  // The caller's case id and attempt. Never the slug: the slug is derived
  // from this, which is what makes attempt i of both arms seed the same
  // organization and so render the same system prompt.
  slugKey: string
  accountState?: ChatAccountState
}

export interface OpenConversationRequest {
  scope: ChatScope
  organizationSlug: string
  anchor?: ChatAnchor
  briefing?: BriefingChatTarget
}

export interface OpenedConversation {
  conversationId: string
  // Where each turn of this conversation is posted.
  messagesPath: string
}

export interface PostTurnRequest {
  messagesPath: string
  organizationSlug: string
  content: string
}

export interface PostedTurn {
  status: number
  // The SSE body, whole and unparsed. The runner parses it with
  // `parseStreamEvents`, which is what keeps `toolCallId` intact on both
  // runtimes — see buildTrace, where an unmatched call id is the only
  // evidence of a failed tool an HTTP arm has.
  body: string
}

export interface PriorTranscriptRequest {
  conversationId: string
  turns: readonly SeededTurn[]
  drivenTurns: number
}

// Exactly what `assertSeededAccountState` compares against, derived rather
// than raw: the three columns are read two different ways and the comparison
// must not be.
export interface SeededAccountRows {
  // Null when nothing carries the slug at all, which is a different failure
  // from a row whose column is wrong.
  organization: { hasDistrict: boolean } | null
  // `boolean | null`, not `boolean`: `campaign.isPro` is nullable, and a
  // case asking for `pro: false` against a null column is a seed that does
  // not match rather than one that does.
  campaign: { pro: boolean | null; hasCampaignDetails: boolean } | null
}

// The case as a runtime has to judge whether it can drive it.
export interface DriveableCase {
  agentId: string
  caseId: string
  scope: ChatScope
  accountState?: ChatAccountState
  priorTranscript?: readonly SeededTurn[]
  toolFailure?: ToolFailure
  script?: ChatTurnScript
  realModel?: boolean
  dataVersion?: string
}

export interface CaseInstrumentationRequest {
  scope: ChatScope
  script?: ChatTurnScript
  realModel?: boolean
  toolFailure?: ToolFailure
  pin?: DeltaPin
}

export interface ObserveTurnRequest {
  conversationId: string
  // Which DRIVEN turn of this case has just finished, from 1. Deliberately
  // not the server's own `turnIndex`: that is derived from the conversation's
  // replay window and an arm cannot predict it. See `httpChatRuntime.ts`.
  drivenTurn: number
  // Whether the turn wrote a `done` frame. The in-process runtime ignores
  // it — its usage promise resolves either way — and the HTTP one needs it,
  // because gp-api records a telemetry row only on a clean finish and would
  // otherwise spend its whole wait on a row that was never going to arrive.
  completed: boolean
}

// What `readAssistantText` needs on each runtime. In process the id alone
// settles it; over HTTP the row is reached through the conversation read,
// which is scoped and organization-scoped the way the product's own read is.
export interface AssistantTextRequest {
  conversationId: string
  scope: ChatScope
  organizationSlug: string
  assistantMessageId: string
}

// One case's observation, for as long as the case is running.
export interface CaseInstrumentation {
  // Shaped as the in-process capture because the in-process capture IS one
  // of the two implementations and must not be adapted into anything. The
  // HTTP runtime fills the same fields from the telemetry route; the ones it
  // cannot see stay undefined or empty, which is what every reader of them
  // already handles.
  readonly capture: TurnCapture
  // The SQL the turn's constituent-data tools ran, verbatim and unpinned, in
  // call order, accumulated across the case.
  readonly toolQueries: string[]
  // Once after every driven turn, before the next is posted.
  observeTurn(request: ObserveTurnRequest): Promise<void>
  // 'unobserved' when the run learned nothing about the config, which is
  // more useful on the record than a digest of two empty strings.
  configDigest(): string
  restore(): void
}

export interface ChatArmRuntime {
  readonly kind: ArmRuntimeKind
  assertCanDrive(one: DriveableCase): void
  stageCase(request: StageCaseRequest): Promise<SeededChatOrg>
  tearDownCase(organizationSlug: string): Promise<void>
  readSeededAccountRows(organizationSlug: string): Promise<SeededAccountRows>
  openConversation(
    request: OpenConversationRequest,
  ): Promise<OpenedConversation>
  seedPriorTranscript(request: PriorTranscriptRequest): Promise<void>
  postTurn(request: PostTurnRequest): Promise<PostedTurn>
  readAssistantText(request: AssistantTextRequest): Promise<string | null>
  beginCase(request: CaseInstrumentationRequest): Promise<CaseInstrumentation>
}

// A case this runtime will not drive. Separate from `ChatDirectiveError`,
// which is about a directive the MODEL could not honour mid-run: this one is
// refused before anything is opened, and the fix is the workflow's runtime
// setting or the case list, not the agent.
export class UnsupportedOnRuntimeError extends Error {}

// Every reason, not the first, and in one sentence per reason. A case list
// that uses three things an HTTP arm cannot do should learn all three from
// one failed arm rather than from three.
export const unsupportedText = (
  kind: ArmRuntimeKind,
  one: DriveableCase,
  reasons: readonly string[],
): string =>
  `${one.agentId}/${one.caseId} cannot be driven on the "${kind}" runtime: ` +
  reasons.join('; ')

// WHAT ONE CASE SAYS, minus everything that is the ARM's setting rather than
// the case's. A case list carries these three and nothing else a runtime
// cares about.
export type CaseDirectives = Pick<
  DriveableCase,
  'caseId' | 'accountState' | 'priorTranscript' | 'toolFailure'
>

export interface AgentDriveability {
  agentId: string
  scope: ChatScope
  cases: readonly CaseDirectives[]
  // The arm's settings, not the case's, passed so the question asked here is
  // the same question asked per case rather than a narrower one.
  script?: ChatTurnScript
  realModel?: boolean
  dataVersion?: string
}

// WHETHER THIS RUNTIME CAN DRIVE A WHOLE AGENT, decided BEFORE the sweep
// plans it rather than per case while it walks.
//
// It CALLS `assertCanDrive`. There is deliberately no second statement of
// what a runtime supports: a second list is a list that drifts, and the
// failure mode of drift here is an arm that refuses a case the planner
// counted — which is a red sweep for an arm that behaved correctly.
//
// ALL OR NOTHING, naming the first case that cannot be driven. An agent
// whose list is part drivable could in principle be walked in part, but
// `captureArm` has no per-case skip: the manifest records `cases` and the
// walk asserts one record per case per attempt, so a partial walk would
// either go red or quietly report a corpus nobody selected. Refusing the
// agent says what happened in one line instead.
export const runtimeRefusal = (
  runtime: ChatArmRuntime,
  request: AgentDriveability,
): string | undefined => {
  for (const one of request.cases) {
    try {
      runtime.assertCanDrive({
        agentId: request.agentId,
        caseId: one.caseId,
        scope: request.scope,
        ...(one.accountState && { accountState: one.accountState }),
        ...(one.priorTranscript && { priorTranscript: one.priorTranscript }),
        ...(one.toolFailure && { toolFailure: one.toolFailure }),
        ...(request.script && { script: request.script }),
        ...(request.realModel === true && { realModel: true }),
        ...(request.dataVersion !== undefined && {
          dataVersion: request.dataVersion,
        }),
      })
    } catch (err) {
      // Only the runtime's own refusal is an answer to this question.
      // Anything else is a bug in the predicate and has to surface as one,
      // not as an agent quietly dropped from the sweep.
      if (err instanceof UnsupportedOnRuntimeError) return err.message
      throw err
    }
  }
  return undefined
}

// Compared as numbers: an axios status is a plain number, and comparing it
// against the enum member directly is what no-unsafe-enum-comparison rejects.
const HTTP_CREATED: number = HttpStatus.CREATED

// THE RUNTIME EVERY ARM HAS ALWAYS USED, moved behind the interface and
// otherwise untouched. Each method below is the statement that used to sit at
// the reach-through site, in the same order, with the same arguments — so a
// sweep that does not set JUDGE_ARM_RUNTIME drives exactly what it drove.
export const inProcessChatRuntime = (
  service: TestServiceContext,
): ChatArmRuntime => ({
  kind: 'inprocess',

  // Refuses nothing. This runtime is the one every directive in the case
  // schema was designed against, and a refusal here would be a regression
  // rather than honesty.
  assertCanDrive: () => undefined,

  stageCase: async (request) =>
    seedChatOrg(
      service.prisma,
      service.user.id,
      request.agentId,
      request.slugKey,
      seedOptionsFor(request.agentId, request.accountState),
    ),

  // Nothing to remove. `useTestService` gives the arm a throwaway database
  // and drops it when the suite ends, so the teardown already happened by
  // the time anybody could call this. The HTTP runtime's database outlives
  // the sweep, which is the whole reason this is on the interface.
  tearDownCase: async () => undefined,

  readSeededAccountRows: async (organizationSlug) => {
    const organization = await service.prisma.organization.findFirst({
      where: { slug: organizationSlug },
      select: { positionId: true },
    })
    const campaign = await service.prisma.campaign.findFirst({
      where: { organizationSlug },
      select: { isPro: true, details: true },
    })
    return {
      organization:
        organization === null
          ? null
          : { hasDistrict: organization.positionId !== null },
      campaign:
        campaign === null
          ? null
          : {
              pro: campaign.isPro,
              hasCampaignDetails: Object.keys(campaign.details).length > 0,
            },
    }
  },

  // THE CONVERSATION, OPENED THE WAY THE PRODUCT OPENS IT.
  //
  // Every registry scope is created through POST /v1/chats. A briefing chat
  // is not: the webapp creates it with POST /v1/briefing-chats, which writes
  // the conversation and its annotation in one transaction, and posts its
  // turns to /v1/briefing-chats/:annotationId/messages. The registry's create
  // path refuses briefing_annotation on purpose, because a conversation with
  // no annotation is one the briefing context cannot load. So this drives
  // the briefing routes — production code untouched, and the turn the judge
  // measures is the one users take, through the same handler the registry
  // holds.
  openConversation: async (request) => {
    const headers = {
      headers: { 'X-Organization-Slug': request.organizationSlug },
    }
    if (request.scope === ChatScope.briefing_annotation) {
      const target = request.briefing
      if (target === undefined) {
        throw new Error(
          'briefing_annotation is opened on a briefing, and the request ' +
            "names none; pass the seeded org's `briefing`",
        )
      }
      const created = await service.client.post<CreateBriefingChatResponse>(
        '/v1/briefing-chats',
        { meetingDate: target.meetingDate, anchor: target.anchor },
        headers,
      )
      if (created.status !== HTTP_CREATED) {
        throw new Error(`POST /v1/briefing-chats returned ${created.status}`)
      }
      const { annotationId, conversationId } =
        createBriefingChatResponseSchema.parse(created.data)
      return {
        conversationId,
        messagesPath: `/v1/briefing-chats/${annotationId}/messages`,
      }
    }

    const created = await service.client.post<CreateChatResponse>(
      '/v1/chats',
      {
        scope: request.scope,
        ...(request.anchor && { anchor: request.anchor }),
      },
      headers,
    )
    if (created.status !== HTTP_CREATED) {
      throw new Error(
        `POST /v1/chats returned ${created.status} for scope ` +
          `"${request.scope}"`,
      )
    }
    const { conversationId } = CreateChatResponseSchema.parse(created.data)
    return {
      conversationId,
      messagesPath: `/v1/chats/${conversationId}/messages?scope=${request.scope}`,
    }
  },

  seedPriorTranscript: async (request) =>
    seedPriorTranscript(service.app, {
      conversationId: request.conversationId,
      ownerUserId: service.user.id,
      turns: request.turns,
      drivenTurns: request.drivenTurns,
    }),

  postTurn: async (request) => {
    // No clientMessageId: the route requires a GUID and it only buys
    // user-turn dedup, which a run that opens its own conversation cannot
    // need.
    const streamed = await service.client.post<string>(
      request.messagesPath,
      { content: request.content },
      { headers: { 'X-Organization-Slug': request.organizationSlug } },
    )
    return { status: streamed.status, body: String(streamed.data) }
  },

  readAssistantText: async ({ assistantMessageId }) => {
    const row = await service.prisma.chatMessage.findFirst({
      where: { id: assistantMessageId, role: ChatMessageRole.assistant },
    })
    return row?.content ?? null
  },

  // Both patches are process-global for as long as they are installed, and
  // BOTH installs can throw — installLlmCapture on a non-test process, on a
  // second install against the same instance, or on a request that would
  // spend real money. So the second one failing has to unwind the first by
  // hand: there is no restore handle to hand back out of here, and a patch
  // installed and then abandoned would rewrite the SQL of, and answer from a
  // canned script, every later request in the process.
  beginCase: async (request) => {
    const llmService = service.app.get(LlmService)
    // Installed on DatabricksSqlProvider's prototype rather than on a
    // provider resolved by token: `CONSTITUENT_DATA_PROVIDER` is registered
    // by two modules with two factories, so a token lookup cannot say which
    // instance the handler for this scope holds. Unconditional for the same
    // reason — there is no instance to be handed, or withheld.
    const databricks = instrumentDatabricksProvider(request.pin)
    let llm: InstalledLlmCapture
    try {
      llm = installLlmCapture(llmService, {
        ...(request.script && { script: request.script }),
        ...(request.realModel === true && { realModel: true }),
        ...(request.toolFailure && { toolFailure: request.toolFailure }),
      })
    } catch (err) {
      databricks.restore()
      throw err
    }
    // A third patch, for the briefing scope alone, and unwound the same way:
    // it serves the seeded briefing's artifact and pins the `today` the
    // briefing prompt renders, so both arms read the same briefing on the
    // same day. See installBriefingFixture.
    let briefing: InstalledBriefingFixture | undefined
    try {
      briefing =
        request.scope === ChatScope.briefing_annotation
          ? installBriefingFixture({
              bucket: JUDGE_BRIEFING_BUCKET,
              artifactContent: JUDGE_BRIEFING_ARTIFACT,
              today: JUDGE_BRIEFING_TODAY,
            })
          : undefined
    } catch (err) {
      llm.restore()
      databricks.restore()
      throw err
    }

    return {
      capture: llm.capture,
      toolQueries: databricks.queries,
      // Per turn, because the capture's usage promise is replaced by the
      // next turn's. Read here and accumulated, rather than once at the end,
      // which would report the last turn's tokens as the whole
      // conversation's.
      observeTurn: async () => readTurnTokens(llm.capture),
      configDigest: () =>
        llm.capture.systemPrompt === undefined
          ? 'unobserved'
          : configDigest(llm.capture.systemPrompt, llm.capture.toolNames),
      restore: () => {
        briefing?.restore()
        llm.restore()
        databricks.restore()
      },
    }
  },
})
