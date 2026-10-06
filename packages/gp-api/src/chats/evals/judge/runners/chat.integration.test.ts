import { describe, expect, it, vi } from 'vitest'
import { differenceInMilliseconds, parseISO } from 'date-fns'
import { useTestService } from '@/test-service'
import { PRICING_VERSION } from '../pricing'
import { isComparable, type RunRecord } from '../record'
import { instrumentDatabricksProvider, type ChatTurnScript } from './chatSeam'
import {
  ChatDirectiveError,
  TOOL_BUDGET_FALLBACK_REPLY,
  runChatCase,
  type ChatRunRequest,
} from './chat'
import { CaseListError } from '../cases'
import { MAX_CHAT_HISTORY_MESSAGES } from '@/chats/services/chatStream.service'
import { chatOrgSlug, seedChatOrg, seedOptionsFor } from './seedChatOrg'
import {
  AnnotationKind,
  ChatMessageRole,
  ChatScope,
  Prisma,
} from '../../../../generated/prisma'
import {
  ChatStreamService,
  type StreamArgs,
} from '@/chats/services/chatStream.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { DatabricksSqlProvider } from '@/llm/tools/databricksProvider'
import { BriefingAnnotationHandler } from '@/chats/briefing-chats/briefingAnnotation.handler'
import { JUDGE_POSITION } from './seedChatOrg'
import {
  JUDGE_BRIEFING_TODAY,
  JUDGE_HIGHLIGHT_ANCHOR,
  TOP_LEVEL_ANCHOR,
} from './briefingFixture'

// The chat runner against the real app: real routes, real scope handlers, real
// stream service, real tools, a throwaway Postgres — and a canned model, so
// nothing is spent and the turn is deterministic.
//
// Nothing here asserts what a turn looks like. Three real Chief of Staff turns
// on identical seeded state produced 6, 4 and 2 tool steps and replies of
// 1831, 1135 and 1137 characters, so any assertion on turn shape is an
// assertion about the weather. What is asserted is the causal wiring: a
// failing tool is counted as one, a missing org is an infraError with no
// output, a version nobody pinned is not reported as pinned.

const service = useTestService()

const TURN_TIMEOUT_MS = 60_000

const TOKENS = { inputTokens: 31_213, outputTokens: 227 }

// 31,213 input at $3/M plus 227 output at $15/M.
const EXPECTED_USD = 0.097044

const ANSWER = 'You have three priorities on file. Housing is the oldest.'

// Never a real model id, so a record that carries one can only have got it
// from the seam that watched the turn.
const UNOBSERVED_MODEL = 'model-not-observed'

const textOnlyScript: ChatTurnScript = {
  steps: [{ kind: 'text', text: ANSWER }],
  usage: TOKENS,
}

const request = (
  overrides: Partial<ChatRunRequest> & {
    agentId: string
    organizationSlug: string
  },
): ChatRunRequest => ({
  case: { caseId: 'judge-case', question: 'What are my top priorities?' },
  sweepId: 'swp_integration',
  arm: 'candidate',
  variant: {
    ref: 'judge-track-a',
    commit: 'b'.repeat(40),
    model: UNOBSERVED_MODEL,
  },
  script: textOnlyScript,
  ...overrides,
})

const runFor = async (
  agentId: string,
  overrides: Partial<ChatRunRequest> = {},
): Promise<RunRecord> => {
  const seeded = await seedChatOrg(
    service.prisma,
    service.user.id,
    agentId,
    // Keyed on the case id the way the sweep's arm suite keys it, so a test
    // that drives two cases in one database does not collide on
    // `organization.slug`.
    overrides.case?.caseId ?? 'judge-case',
    // The same translation the sweep's arm suite does, so a case's account
    // state reaches the seed here exactly the way it reaches it in a sweep.
    seedOptionsFor(agentId, overrides.case?.accountState),
  )
  return runChatCase(
    { service },
    request({
      agentId,
      organizationSlug: seeded.organizationSlug,
      ...(seeded.anchor && { anchor: seeded.anchor }),
      ...(seeded.briefing && { briefing: seeded.briefing }),
      ...overrides,
    }),
  )
}

// The rows the routes and the seeder left behind, in order. This is the exact
// list `listRecentMessagesByConversation` reads for the next turn, which is
// why asserting on it is what proves a turn was answered against the ones
// before it rather than against an empty thread.
const transcriptRows = async (): Promise<
  { role: ChatMessageRole; content: string; segments: number }[]
> => {
  const rows = await service.prisma.chatMessage.findMany({
    orderBy: { createdAt: Prisma.SortOrder.asc },
    include: { segments: true },
  })
  return rows.map((row) => ({
    role: row.role,
    content: row.content,
    segments: row.segments.length,
  }))
}

describe('runChatCase', () => {
  it(
    'produces a judgeable record from a real chief of staff turn',
    async () => {
      const record = await runFor('chief_of_staff')

      expect(record.status).toBe('produced')
      expect(record.output).toEqual({ kind: 'text', value: ANSWER })
      expect(record.input).toEqual({
        kind: 'question',
        value: 'What are my top priorities?',
      })
      expect(record.runId).toBe('swp_integration:judge-case:candidate:1')
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'hashes the prompt and tools the turn actually offered the model',
    async () => {
      const record = await runFor('chief_of_staff')

      // Not 'unobserved': the digest can only carry a hash when the turn
      // reached the model, which is the whole point of hashing at that seam.
      expect(record.variant.configDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'records the model that answered, not the one the sweep expected',
    async () => {
      const record = await runFor('chief_of_staff')

      expect(record.variant.model).toBe('claude-sonnet-4-6')
      expect(record.variant.model).not.toBe(UNOBSERVED_MODEL)
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'carries the aggregate turn usage and the cost of exactly that',
    async () => {
      const record = await runFor('chief_of_staff')

      expect(record.telemetry.tokens).toEqual({
        input: TOKENS.inputTokens,
        output: TOKENS.outputTokens,
        cacheRead: 0,
        cacheWrite: 0,
      })
      expect(record.telemetry.cost?.usdAtCapture ?? NaN).toBeCloseTo(
        EXPECTED_USD,
        6,
      )
      expect(record.telemetry.cost?.pricingVersion).toBe(PRICING_VERSION)
      expect(record.telemetry.latencyMs).toBe(
        differenceInMilliseconds(
          parseISO(record.endedAt),
          parseISO(record.startedAt),
        ),
      )
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'keeps the answer when nobody can price the model',
    async () => {
      // Every chat scope's chain falls back to claude-opus-4-7, which has no
      // rates on record. A guessed rate would make the cost delta printed
      // beside a verdict fiction, so the run goes unpriced — but cost is
      // measured evidence, and measured evidence never gates a verdict. The
      // answer survives and only the cost line is missing.
      const record = await runFor('chief_of_staff', {
        script: { ...textOnlyScript, model: 'claude-opus-4-7' },
      })

      expect(record.status).toBe('produced')
      expect(record.output).toEqual({ kind: 'text', value: ANSWER })
      // Absent, not zero: a stored 0 under a real pricing version reads as
      // "this run was free".
      expect(record.telemetry.cost).toBeUndefined()
      expect(record.trace.at(-1)?.error).toContain('no price on record')
      // Still judgeable, which is the whole point of the change.
      expect(isComparable(record)).toBe(true)
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'counts a real tool failure without losing the answer',
    async () => {
      const record = await runFor('chief_of_staff', {
        script: {
          steps: [
            {
              kind: 'tool',
              tool: 'crud_priorities',
              // No such priority, so the port throws. The turn keeps going,
              // which is exactly how a dead Databricks credential behaves.
              input: { action: 'archive', id: 'no-such-priority' },
            },
            { kind: 'text', text: ANSWER },
          ],
          usage: TOKENS,
        },
      })

      expect(record.status).toBe('produced')
      expect(record.output).toEqual({ kind: 'text', value: ANSWER })
      expect(record.telemetry.toolCalls).toBe(1)
      expect(record.telemetry.toolErrors).toBe(1)
      expect(
        record.trace.find((step) => step.tool === 'crud_priorities')?.error,
      ).toContain('Priority not found')
      expect(record.toolErrorDetails).toEqual([
        {
          tool: 'crud_priorities',
          message: expect.stringContaining('Priority not found'),
        },
      ])
      // A tool failure is never a quality signal: both arms degrade the same
      // way and a judge shown two degraded answers reports a regression.
      expect(isComparable(record)).toBe(false)
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'counts a tool that succeeded as a call and not as an error',
    async () => {
      const record = await runFor('chief_of_staff', {
        script: {
          steps: [
            {
              kind: 'tool',
              tool: 'crud_priorities',
              input: { action: 'list' },
            },
            { kind: 'text', text: ANSWER },
          ],
          usage: TOKENS,
        },
      })

      expect(record.telemetry.toolCalls).toBe(1)
      expect(record.telemetry.toolErrors).toBe(0)
      expect(isComparable(record)).toBe(true)
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'keeps a fallback reply as a judgeable, blocked result',
    async () => {
      const record = await runFor('chief_of_staff', {
        script: {
          steps: [{ kind: 'text', text: TOOL_BUDGET_FALLBACK_REPLY }],
          usage: TOKENS,
        },
      })

      expect(record.status).toBe('blocked')
      // A refusal is a result: whether declining was right is exactly what a
      // verdict should capture, so the output has to survive.
      expect(record.output?.value).toContain(TOOL_BUDGET_FALLBACK_REPLY)
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'does not report a pinned version no query ever applied',
    async () => {
      // Nothing configures a Databricks credential locally or in CI, so the
      // constituent tool never registers and no provider is ever constructed.
      // The seam is installed on DatabricksSqlProvider's prototype either
      // way, so the pin is armed and nothing reaches it. Recording the version
      // anyway would claim a pin that never happened, which is the one
      // failure the field exists to prevent.
      const record = await runFor('chief_of_staff', { dataVersion: '3237' })

      expect(record.toolQueries).toEqual([])
      expect(record.dataVersion).toBeUndefined()
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'reports a harness failure as infraError with no output',
    async () => {
      const record = await runChatCase(
        { service },
        request({
          agentId: 'chief_of_staff',
          organizationSlug: 'judge-org-that-does-not-exist',
          variant: {
            ref: 'judge-track-a',
            commit: 'b'.repeat(40),
            model: 'claude-sonnet-4-6',
          },
        }),
      )

      expect(record.status).toBe('infraError')
      expect(record.output).toBeNull()
      expect(record.variant.configDigest).toBe('unobserved')
      // The turn never reached the model, so its token counts are defaults
      // rather than observations. Pricing them would state $0 for a run
      // whose cost is unknown, which is the "free" reading the schema's
      // absent-rather-than-zero rule exists to prevent.
      expect(record.telemetry.cost).toBeUndefined()
      expect(record.telemetry.tokens).toEqual({
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      })
      expect(record.trace).toEqual([
        {
          index: 0,
          kind: 'error',
          error:
            'Error: POST /v1/chats returned 404 for scope ' +
            '"chief_of_staff"',
        },
      ])
      expect(isComparable(record)).toBe(false)
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'leaves a seeded opener out of the campaign assistant output',
    async () => {
      // campaign_assistant writes a scripted greeting as the conversation's
      // first assistant row. Folding it in would have the judge compare two
      // arms partly on boilerplate that varies with the seeded candidate.
      const record = await runFor('campaign_assistant')

      expect(record.status).toBe('produced')
      expect(record.output).toEqual({ kind: 'text', value: ANSWER })
      expect(record.variant.configDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'drives the two anchor-keyed scopes through the same runner',
    async () => {
      for (const agentId of ['ordinance_flow', 'priority_flow']) {
        const record = await runFor(agentId)

        expect(record.status, agentId).toBe('produced')
        expect(record.output, agentId).toEqual({ kind: 'text', value: ANSWER })
        expect(record.variant.configDigest, agentId).toMatch(
          /^sha256:[0-9a-f]{64}$/,
        )
      }
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'leaves no patch behind when the LLM seam refuses to install',
    async () => {
      // Both patches are process-global and there is no restore handle
      // outside runChatCase, so a first install left standing would rewrite
      // the SQL of every later request in the process — and, being recorded
      // as installed, would fail every later arm with a concurrency error.
      // The Databricks patch is on DatabricksSqlProvider's prototype now, so
      // it is installed on every run rather than only when a provider was
      // handed in: this unwind is on the path every case takes.
      await expect(
        runChatCase(
          { service },
          request({
            agentId: 'chief_of_staff',
            organizationSlug: 'judge-unused',
            script: undefined,
          }),
        ),
      ).rejects.toThrow('was given no script')

      // Claimable again, which the prototype would not be if the refusal had
      // left the first install recorded.
      instrumentDatabricksProvider().restore()
    },
    TURN_TIMEOUT_MS,
  )

  // The pinnable tables are resolved per agent, from the same app-layer
  // allowlists the scope handlers inject. `ordinance_flow` is drivable but
  // reads none of them, so a dataVersion for it could only ever be recorded
  // and never applied — and a pin the prototype patch cannot apply is the
  // silent skew JUDGE_DATA_VERSION exists to prevent. Refused before either
  // seam is installed, so there is nothing to unwind.
  it(
    'refuses a pinned run for an agent that reads no pinnable table',
    async () => {
      await expect(
        runChatCase(
          { service },
          request({
            agentId: 'ordinance_flow',
            organizationSlug: 'judge-unused',
            dataVersion: '3237',
          }),
        ),
      ).rejects.toThrow('reads no version-pinnable table')
    },
    TURN_TIMEOUT_MS,
  )

  // Without a dataVersion there is no pin to resolve, so the same agent runs.
  it(
    'does not refuse that agent when nothing asked for a pin',
    async () => {
      const record = await runFor('ordinance_flow')

      expect(record.dataVersion).toBeUndefined()
      expect(record.toolQueries).toEqual([])
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'refuses an agent it cannot drive rather than emitting a record',
    async () => {
      await expect(
        runChatCase(
          { service },
          request({
            // A real registry agent, but a background one: no scope handler
            // answers for it.
            agentId: 'meeting_briefing',
            organizationSlug: 'judge-unused',
          }),
        ),
      ).rejects.toThrow('not a chat scope the runner can drive')
    },
    TURN_TIMEOUT_MS,
  )

  // SEVERAL USER TURNS, ONE CONVERSATION. The point is that nothing here
  // hand-builds the history: the route persists each turn and replays the
  // conversation's rows, so turn two is answered the way production would
  // answer it.
  it(
    'posts every user turn to the same conversation, in order',
    async () => {
      const record = await runFor('chief_of_staff', {
        case: {
          caseId: 'judge-case',
          turns: ['What are my priorities?', 'Which one is oldest?'],
        },
      })

      expect(record.status).toBe('produced')
      // Exactly the list the second turn's history read returned. Four rows
      // on one conversation is the proof the second turn saw the first: a
      // second POST /v1/chats would have produced two conversations and a
      // two-row history.
      expect(await transcriptRows()).toEqual([
        {
          role: ChatMessageRole.user,
          content: 'What are my priorities?',
          segments: 0,
        },
        { role: ChatMessageRole.assistant, content: ANSWER, segments: 0 },
        {
          role: ChatMessageRole.user,
          content: 'Which one is oldest?',
          segments: 0,
        },
        { role: ChatMessageRole.assistant, content: ANSWER, segments: 0 },
      ])
      expect(await service.prisma.chatConversation.count()).toBe(1)
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'accumulates a conversation rather than reporting its last turn',
    async () => {
      const record = await runFor('chief_of_staff', {
        case: {
          caseId: 'judge-case',
          turns: ['What are my priorities?', 'Which one is oldest?'],
        },
        script: {
          steps: [
            {
              kind: 'tool',
              tool: 'crud_priorities',
              input: { action: 'list' },
            },
            { kind: 'text', text: ANSWER },
          ],
          usage: TOKENS,
        },
      })

      // Every reply, in order, and labelled — not the last one alone.
      expect(record.output?.value).toBe(
        `[turn 1]\n${ANSWER}\n\n[turn 2]\n${ANSWER}`,
      )
      // One tool step per turn, both counted.
      expect(record.telemetry.toolCalls).toBe(2)
      expect(record.telemetry.toolErrors).toBe(0)
      // Summed, not the last turn's. Reading the capture's usage promise once
      // at the end would have reported half of this.
      expect(record.telemetry.tokens.input).toBe(TOKENS.inputTokens * 2)
      expect(record.telemetry.tokens.output).toBe(TOKENS.outputTokens * 2)
      expect(record.telemetry.cost?.usdAtCapture ?? NaN).toBeCloseTo(
        EXPECTED_USD * 2,
        6,
      )
      // One sequence, renumbered. Two turns' traces concatenated unchanged
      // would carry two step 0s and a reader could not order them.
      expect(record.trace.map((step) => step.index)).toEqual([0, 1, 2, 3])
      expect(record.trace.map((step) => step.kind)).toEqual([
        'tool',
        'text',
        'tool',
        'text',
      ])
    },
    TURN_TIMEOUT_MS,
  )

  // STOPS ON A BROKEN TURN, which is money rather than tidiness. The
  // conversation the case authored is already over — the next turn would be
  // answered against a history whose last reply is the interrupted sentinel,
  // and combineChatStatus discards the whole case as infraError anyway — so
  // every turn after the broken one is real model spend on output nothing
  // reads.
  it(
    'posts no further turn once one has broken',
    async () => {
      const record = await runFor('chief_of_staff', {
        case: {
          caseId: 'breaks-on-one',
          turns: ['first?', 'second?', 'third?'],
        },
        script: {
          // A tool this turn never registered. runScript throws while the
          // route drains the stream, which is the ordinary shape of a turn
          // that dies mid-generation.
          steps: [{ kind: 'tool', tool: 'no_such_tool', input: {} }],
          usage: TOKENS,
        },
      })

      expect(record.status).toBe('infraError')
      // One user row, not three: the two later turns were never posted.
      const users = (await transcriptRows()).filter(
        (row) => row.role === ChatMessageRole.user,
      )
      expect(users.map((row) => row.content)).toEqual(['first?'])
      // And the counts say so. Two of the three turns never reported, so the
      // run is unpriceable and the tokens are not the partial sum of the one
      // that did — which would read as the whole conversation's usage.
      expect(record.telemetry.cost).toBeUndefined()
      expect(record.telemetry.tokens).toEqual({
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      })
    },
    TURN_TIMEOUT_MS,
  )

  // And a DECLINED turn is not a broken one: a fallback reply is an agent
  // result, the history is intact, and the conversation has to continue or
  // the case measures the harness's patience instead of the agent.
  it(
    'keeps going after a turn the agent declined',
    async () => {
      const record = await runFor('chief_of_staff', {
        case: { caseId: 'declines-then-answers', turns: ['first?', 'second?'] },
        script: {
          steps: [{ kind: 'text', text: TOOL_BUDGET_FALLBACK_REPLY }],
          usage: TOKENS,
        },
      })

      expect(record.status).toBe('blocked')
      const users = (await transcriptRows()).filter(
        (row) => row.role === ChatMessageRole.user,
      )
      expect(users.map((row) => row.content)).toEqual(['first?', 'second?'])
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'records a multi-turn case under an input the judge can read',
    async () => {
      const record = await runFor('chief_of_staff', {
        case: { caseId: 'judge-case', turns: ['first?', 'second?'] },
      })

      // NOT `{ kind: 'question' }`. An older base ref that stripped `turns`
      // and drove one turn records that payload, and the mismatch is what
      // refuses the pair instead of comparing two different conversations.
      expect(record.input).toEqual({
        kind: 'transcript',
        value: { turns: ['first?', 'second?'] },
      })
    },
    TURN_TIMEOUT_MS,
  )

  // A SEEDED PRIOR TRANSCRIPT, THROUGH THE STORE PATH THE LIVE TURN READS.
  // No route writes an assistant message, so this is the one capability that
  // has to reach the store directly — and a hand-built row would be the wrong
  // shape in ways nobody would notice.
  it(
    'answers mid-conversation against rows the store wrote',
    async () => {
      const record = await runFor('chief_of_staff', {
        case: {
          caseId: 'judge-case',
          question: 'And which of those is oldest?',
          priorTranscript: [
            { role: 'user', content: 'What are my priorities?' },
            {
              role: 'assistant',
              content: 'You have three on file.',
              toolCalls: [
                { tool: 'crud_priorities', input: { action: 'list' } },
              ],
            },
          ],
        },
      })

      expect(record.status).toBe('produced')
      // The seeded rows come first, the driven turn after — which is what
      // makes the agent's reply a mid-conversation one.
      expect(await transcriptRows()).toEqual([
        {
          role: ChatMessageRole.user,
          content: 'What are my priorities?',
          segments: 0,
        },
        // TWO segments: the tool call and the text after it. That count is
        // the evidence the row went through ChatStreamService's own
        // persistAssistantText — its rule is to store the structure only when
        // the turn used a tool or a citation.
        {
          role: ChatMessageRole.assistant,
          content: 'You have three on file.',
          segments: 2,
        },
        {
          role: ChatMessageRole.user,
          content: 'And which of those is oldest?',
          segments: 0,
        },
        { role: ChatMessageRole.assistant, content: ANSWER, segments: 0 },
      ])
    },
    TURN_TIMEOUT_MS,
  )

  // The other half of the same rule, and the part a hand-built insert would
  // get wrong: a pure-text turn renders identically from `content`, so
  // storing a single text segment would be rows no real turn produces.
  it(
    'stores no segments for a seeded turn that used no tool',
    async () => {
      await runFor('chief_of_staff', {
        case: {
          caseId: 'judge-case',
          question: 'and now?',
          priorTranscript: [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'Hello. How can I help?' },
          ],
        },
      })

      const rows = await transcriptRows()
      expect(rows[1]).toEqual({
        role: ChatMessageRole.assistant,
        content: 'Hello. How can I help?',
        segments: 0,
      })
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'marks a seeded case on the record it writes',
    async () => {
      const record = await runFor('chief_of_staff', {
        case: {
          caseId: 'judge-case',
          question: 'and now?',
          priorTranscript: [{ role: 'user', content: 'earlier' }],
        },
      })

      expect(record.input).toEqual({
        kind: 'transcript',
        value: {
          turns: ['and now?'],
          seededTranscript: [{ role: 'user', content: 'earlier' }],
        },
      })
    },
    TURN_TIMEOUT_MS,
  )

  // Refused BEFORE a turn is driven: the rows would be written, the turns
  // paid for, and the oldest seeded rows then pushed out of the route's
  // replay window — so the record would claim a mid-conversation condition
  // the agent was never under.
  //
  // Longer than any SCHEMA-valid case can be, on purpose: the authoring
  // bounds already make this unreachable from a case list (see
  // 'the authoring bounds cannot overflow the replay window' below), and this
  // is the runner's own backstop against one of them being raised.
  it(
    'refuses a transcript the replay window would drop',
    async () => {
      await expect(
        runFor('chief_of_staff', {
          case: {
            caseId: 'judge-case',
            question: 'and now?',
            priorTranscript: Array.from(
              { length: MAX_CHAT_HISTORY_MESSAGES },
              (_, index) => ({
                role: 'user' as const,
                content: `turn ${index}`,
              }),
            ),
          },
        }),
      ).rejects.toThrow(/never reach the model/)
    },
    TURN_TIMEOUT_MS,
  )

  // A FORCED TOOL FAILURE, honoured at the seam that already wrapped every
  // tool's execute. Compare with 'counts a tool that succeeded': the same
  // script, the same tool, and only the directive differs.
  it(
    'fails the tool a case named, and counts it as a tool error',
    async () => {
      const script: ChatTurnScript = {
        steps: [
          { kind: 'tool', tool: 'crud_priorities', input: { action: 'list' } },
          { kind: 'text', text: ANSWER },
        ],
        usage: TOKENS,
      }
      const forced = await runFor('chief_of_staff', {
        case: {
          caseId: 'judge-case',
          question: 'What are my priorities?',
          toolFailure: { tool: 'crud_priorities', mode: 'error' },
        },
        script,
      })

      // The answer survives: the AI SDK turns a throwing tool into a
      // tool-error result and the loop carries on, worse informed.
      expect(forced.status).toBe('produced')
      expect(forced.output).toEqual({ kind: 'text', value: ANSWER })
      expect(forced.telemetry.toolCalls).toBe(1)
      expect(forced.telemetry.toolErrors).toBe(1)
      expect(
        forced.trace.find((step) => step.tool === 'crud_priorities')?.error,
      ).toContain('forced failure')
      // AND THE CONSEQUENCE WORTH KNOWING: isComparable is false for any run
      // that hit a tool error, so a forced-failure pair resolves CAN'T SAY
      // rather than entering the delta. Telling an injected failure from an
      // incidental one needs a field record.ts does not have.
      expect(isComparable(forced)).toBe(false)
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'raises a forced timeout as a timeout rather than a plain failure',
    async () => {
      const record = await runFor('chief_of_staff', {
        case: {
          caseId: 'judge-case',
          question: 'What are my priorities?',
          toolFailure: {
            tool: 'crud_priorities',
            mode: 'timeout',
            afterMs: 5,
          },
        },
        script: {
          steps: [
            {
              kind: 'tool',
              tool: 'crud_priorities',
              input: { action: 'list' },
            },
            { kind: 'text', text: ANSWER },
          ],
          usage: TOKENS,
        },
      })

      expect(
        record.trace.find((step) => step.tool === 'crud_priorities')?.error,
      ).toContain('TimeoutError')
    },
    TURN_TIMEOUT_MS,
  )

  // A LOUD REFUSAL, not a silently ignored directive. In the record an
  // unhonoured directive is indistinguishable from a case the agent simply
  // never needed the tool for, so the verdict would be about a condition
  // nobody applied.
  it(
    'refuses a forced failure naming a tool the turn never registered',
    async () => {
      const run = runFor('chief_of_staff', {
        case: {
          caseId: 'judge-case',
          question: 'What are my priorities?',
          toolFailure: { tool: 'query_voter_file', mode: 'error' },
        },
      })

      await expect(run).rejects.toThrow(/registered no such tool/)
      // NOT a CaseListError. That class is about a file that would not parse,
      // and this reason reaches the arm manifest and a public summary — where
      // "the case list is wrong" is the wrong thing to say about a run that
      // may also have failed to reach the app.
      await expect(run).rejects.toBeInstanceOf(ChatDirectiveError)
      await expect(run).rejects.not.toBeInstanceOf(CaseListError)
    },
    TURN_TIMEOUT_MS,
  )

  // AN ACCOUNT STATE IS VERIFIED, NOT TRUSTED. The state is seeded by the
  // runner's caller, so the runner is handed a directive and a slug and has
  // no way to know the two agree — and a caller that forgot would produce a
  // record claiming a condition the agent was never under.
  it(
    'drives a case whose declared account state the seed matches',
    async () => {
      const record = await runFor('campaign_assistant', {
        case: {
          caseId: 'judge-case',
          question: 'Am I on the ballot?',
          accountState: { pro: false },
        },
      })

      expect(record.status).toBe('produced')
      expect(record.input).toEqual({
        kind: 'transcript',
        value: {
          turns: ['Am I on the ballot?'],
          accountState: { pro: false },
        },
      })
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'refuses a case whose declared account state the seed does not match',
    async () => {
      const seeded = await seedChatOrg(
        service.prisma,
        service.user.id,
        'campaign_assistant',
        'judge-case',
      )

      await expect(
        runChatCase(
          { service },
          request({
            agentId: 'campaign_assistant',
            organizationSlug: seeded.organizationSlug,
            case: {
              caseId: 'judge-case',
              question: 'Am I on the ballot?',
              // Seeded Pro, declared not Pro.
              accountState: { pro: false },
            },
          }),
        ),
      ).rejects.toThrow(/pro is false but campaign.isPro is true/)
    },
    TURN_TIMEOUT_MS,
  )

  // MEASURED AGAINST THE DEFAULT SEED, not against a regex. configDigest is
  // a hash of the rendered prompt plus the tool names the turn offered, so
  // two digests that differ is the evidence the state reached the model —
  // `toMatch(/^sha256:/)` would have passed whatever the seed did.
  it(
    'changes what the agent was offered when Pro is taken away',
    async () => {
      const question = 'How many voters can I text?'
      const withPro = await runFor('campaign_assistant', {
        case: { caseId: 'judge-case', question },
      })
      const without = await runFor('campaign_assistant', {
        case: {
          caseId: 'judge-case-2',
          question,
          accountState: { pro: false },
        },
      })

      expect(without.status).toBe('produced')
      expect(without.variant.configDigest).not.toBe(
        withPro.variant.configDigest,
      )
    },
    TURN_TIMEOUT_MS,
  )

  // NOT ASSERTED AS A DIGEST CHANGE, and that is a property of this
  // environment rather than of the state. `districtFilters` gates only the
  // constituent-data pair, and the provider factory returns null without a
  // Databricks credential — so the pair is unregistered locally and in CI
  // WHATEVER positionId says, and the digest is identical either way. The
  // same deployment gap the case lists' notes already record.
  //
  // What IS ours, and what this asserts, is the row: the seed leaves
  // positionId null, which is the one gate in our own database, and
  // resolveByOrgSlug refuses on it before it asks election-api anything.
  it(
    'seeds no position when a case asks for no district',
    async () => {
      const record = await runFor('chief_of_staff', {
        case: {
          caseId: 'no-district',
          question: 'What can you see about my office?',
          accountState: { district: false },
        },
      })

      expect(record.status).toBe('produced')
      const organization = await service.prisma.organization.findFirst({
        where: { slug: chatOrgSlug('chief_of_staff', 'no-district') },
      })
      expect(organization?.positionId).toBeNull()
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'takes get_ballot_requirements away with the campaign details',
    async () => {
      const question = 'What does filing need?'
      const withDetails = await runFor('campaign_assistant', {
        case: { caseId: 'judge-case', question },
      })
      const without = await runFor('campaign_assistant', {
        case: {
          caseId: 'judge-case-2',
          question,
          accountState: { campaignDetails: false },
        },
      })

      expect(without.status).toBe('produced')
      expect(without.variant.configDigest).not.toBe(
        withDetails.variant.configDigest,
      )
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'refuses an ordinance step the anchor did not open on',
    async () => {
      const seeded = await seedChatOrg(
        service.prisma,
        service.user.id,
        'ordinance_flow',
        'judge-case',
      )

      await expect(
        runChatCase(
          { service },
          request({
            agentId: 'ordinance_flow',
            organizationSlug: seeded.organizationSlug,
            ...(seeded.anchor && { anchor: seeded.anchor }),
            case: {
              caseId: 'judge-case',
              question: 'Draft it.',
              accountState: { ordinanceStep: 'draft' },
            },
          }),
        ),
      ).rejects.toThrow(/ordinanceStep is "draft"/)
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'drives the ordinance step a case asked for',
    async () => {
      const record = await runFor('ordinance_flow', {
        case: {
          caseId: 'judge-case',
          question: 'Draft it.',
          accountState: { ordinanceStep: 'draft' },
        },
      })

      expect(record.status).toBe('produced')
    },
    TURN_TIMEOUT_MS,
  )
})

// BRIEFING CHAT, through the routes the webapp uses. Its conversation is
// created with its annotation by POST /v1/briefing-chats, and its turns go to
// /v1/briefing-chats/:annotationId/messages — the registry's create path
// refuses the scope. Everything below is the real app; the S3 read and the
// prompt's date are the two things the briefing seam answers.
describe('runChatCase on briefing chat', () => {
  // The system prompt each turn handed the stream. Read off the stream
  // service rather than the LLM seam, which the runner owns: this is the same
  // argument both briefing routes pass, so it is what the model would read.
  // Read before the spy is restored, which clears what it recorded.
  const capturePrompts = () => {
    const spy = vi.spyOn(service.app.get(ChatStreamService), 'stream')
    let prompts: string[] = []
    return {
      prompts: () => prompts,
      restore: () => {
        prompts = spy.mock.calls.map(
          ([args]: [StreamArgs]) => args.systemPrompt,
        )
        spy.mockRestore()
      },
    }
  }

  it(
    'opens the conversation on its annotation and records the turn',
    async () => {
      const record = await runFor('briefing_annotation')

      expect(record.status).toBe('produced')
      expect(record.output).toEqual({ kind: 'text', value: ANSWER })
      expect(record.variant.model).toBe('claude-sonnet-4-6')
      expect(record.variant.configDigest).toMatch(/^sha256:[0-9a-f]{64}$/)

      // Created by the briefing route: one conversation, scoped and owned the
      // way that route writes it, and a chat annotation on the seeded
      // briefing pointing at it.
      const conversations = await service.prisma.chatConversation.findMany()
      expect(conversations).toHaveLength(1)
      expect(conversations[0]?.scope).toBe(ChatScope.briefing_annotation)
      const annotation = await service.prisma.annotation.findFirst({
        where: { kind: AnnotationKind.chat },
      })
      expect(annotation?.chatConversationId).toBe(conversations[0]?.id)
      const briefing = await service.prisma.meetingBriefing.findFirst()
      expect(annotation?.resourceId).toBe(briefing?.id)
      expect(annotation?.jsonPath).toBeNull()
      expect(await transcriptRows()).toEqual([
        {
          role: ChatMessageRole.user,
          content: 'What are my top priorities?',
          segments: 0,
        },
        { role: ChatMessageRole.assistant, content: ANSWER, segments: 0 },
      ])
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'renders the fixture briefing on the pinned day',
    async () => {
      const capture = capturePrompts()
      try {
        await runFor('briefing_annotation')
      } finally {
        capture.restore()
      }
      const [prompt] = capture.prompts()
      expect(prompt).toContain(`Today is ${JUDGE_BRIEFING_TODAY}.`)
      // The artifact the seam served, parsed: the structured block exists
      // only when the JSON passed BriefingSchema.
      expect(prompt).toContain('Amendment to Short-Term Rental Ordinance')
      expect(prompt).toContain('Acceptance of FY2024 Annual Audit')
      expect(prompt).toContain('Meeting time: 6:30 PM')
      // The seeded meeting's own timezone, which is also the one the real
      // `today` would be computed in.
      expect(prompt).toContain('Timezone: America/New_York')
      expect(prompt).toContain('there is no specific selection')
      // The seeded note is what advertises get_my_notes.
      expect(prompt).toContain('YOUR NOTES (1 on this briefing)')
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'renders one prompt for two seeds of the same case',
    async () => {
      // Two cases seeded in one database, each with its own organization,
      // office and briefing. Nothing that differs between them may reach the
      // prompt, or two arms that changed nothing would never digest equal.
      const first = await runFor('briefing_annotation', {
        case: { caseId: 'first', question: 'q' },
      })
      const second = await runFor('briefing_annotation', {
        case: { caseId: 'second', question: 'q' },
      })
      expect(first.variant.configDigest).toBe(second.variant.configDigest)
    },
    TURN_TIMEOUT_MS,
  )

  // The route finds a briefing by meeting date and the caller's office, and
  // production has one office per user. An arm seeds one per case for one
  // user, so without the seed retiring the last case's briefing the second
  // case would be routed onto the first's and CONTINUE its conversation.
  it(
    'gives every case in one database its own conversation',
    async () => {
      await runFor('briefing_annotation', {
        case: { caseId: 'first', question: 'first question' },
      })
      await runFor('briefing_annotation', {
        case: { caseId: 'second', question: 'second question' },
      })

      const conversations = await service.prisma.chatConversation.findMany({
        include: {
          messages: { orderBy: { createdAt: Prisma.SortOrder.asc } },
        },
        orderBy: { createdAt: Prisma.SortOrder.asc },
      })
      expect(
        conversations.map((c) => c.messages.map((m) => m.content)),
      ).toEqual([
        ['first question', ANSWER],
        ['second question', ANSWER],
      ])
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'opens a highlight case on the highlighted passage',
    async () => {
      const capture = capturePrompts()
      let record: RunRecord
      try {
        record = await runFor('briefing_annotation', {
          case: {
            caseId: 'highlight',
            question: 'Why this?',
            accountState: { briefingHighlight: true },
          },
        })
      } finally {
        capture.restore()
      }

      expect(record.status).toBe('produced')
      const annotation = await service.prisma.annotation.findFirst({
        where: { kind: AnnotationKind.chat },
      })
      expect(annotation?.jsonPath).toBe(JUDGE_HIGHLIGHT_ANCHOR.jsonPath)
      expect(capture.prompts()[0]).toContain(
        'Selected text: "Approve with the sunset clause."',
      )
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'runs the seeded tools without an error',
    async () => {
      const record = await runFor('briefing_annotation', {
        script: {
          steps: [
            { kind: 'tool', tool: 'get_artifacts', input: {} },
            { kind: 'tool', tool: 'get_my_notes', input: {} },
            { kind: 'text', text: ANSWER },
          ],
          usage: TOKENS,
        },
      })

      expect(record.status).toBe('produced')
      expect(record.telemetry.toolCalls).toBe(2)
      expect(record.telemetry.toolErrors).toBe(0)
      expect(isComparable(record)).toBe(true)
    },
    TURN_TIMEOUT_MS,
  )

  // THE PIN, applied. A credentialed deployment registers district_insights,
  // so both halves it needs are supplied: the position election-api would
  // return, and a real DatabricksSqlProvider — the class the pin is installed
  // on — whose client records what would have been sent to the warehouse.
  it(
    "pins serve_agent_voters to the run's data version",
    async () => {
      const sent: string[] = []
      const provider = new DatabricksSqlProvider({
        hostname: 'host.cloud.databricks.com',
        httpPath: '/sql/1.0/warehouses/abc',
        accessToken: 'unused-in-this-test',
        logger: { warn: () => undefined },
        clientFactory: () => ({
          connect: async () => ({
            openSession: async () => ({
              executeStatement: async (statement: string) => {
                sent.push(statement)
                return {
                  fetchAll: async () => [{ n: 1 }],
                  close: async () => undefined,
                }
              },
              close: async () => undefined,
            }),
            close: async () => undefined,
          }),
        }),
      })
      const handler = service.app.get(BriefingAnnotationHandler)
      const prior = Reflect.get(handler, 'databricks')
      Object.assign(handler, { databricks: provider })
      const position = vi
        .spyOn(service.app.get(ElectionsService), 'getPositionById')
        .mockResolvedValue(JUDGE_POSITION)
      const sql =
        'SELECT COUNT(*) AS n FROM serve_agent_voters ' +
        "WHERE state_postal_code = 'WA' " +
        "AND `City Council` = 'Judge City Council District 1'"
      let record: RunRecord
      try {
        record = await runFor('briefing_annotation', {
          dataVersion: '3237',
          script: {
            steps: [
              {
                kind: 'tool',
                tool: 'district_insights',
                input: { sql, rationale: 'renters in the district' },
              },
              { kind: 'text', text: ANSWER },
            ],
            usage: TOKENS,
          },
        })
      } finally {
        position.mockResolvedValue(null)
        Object.assign(handler, { databricks: prior })
      }

      expect(record.trace).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({ error: expect.any(String) }),
        ]),
      )
      expect(record.telemetry.toolErrors).toBe(0)
      expect(record.toolQueries).toHaveLength(1)
      expect(sent).toEqual([
        expect.stringMatching(/FROM serve_agent_voters VERSION AS OF 3237\b/),
      ])
      expect(record.dataVersion).toBe('3237')
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'refuses a highlight case the seed opened on the whole briefing',
    async () => {
      const seeded = await seedChatOrg(
        service.prisma,
        service.user.id,
        'briefing_annotation',
        'mismatch',
      )
      await expect(
        runChatCase(
          { service },
          request({
            agentId: 'briefing_annotation',
            organizationSlug: seeded.organizationSlug,
            briefing: { meetingDate: '2026-05-19', anchor: TOP_LEVEL_ANCHOR },
            case: {
              caseId: 'mismatch',
              question: 'q',
              accountState: { briefingHighlight: true },
            },
          }),
        ),
      ).rejects.toThrow(/briefingHighlight is true but the briefing chat/)
      // Refused before a conversation was opened.
      expect(await service.prisma.chatConversation.count()).toBe(0)
    },
    TURN_TIMEOUT_MS,
  )

  it(
    'is an infraError, with no output, when no briefing was named',
    async () => {
      const seeded = await seedChatOrg(
        service.prisma,
        service.user.id,
        'briefing_annotation',
        'unnamed',
      )
      const record = await runChatCase(
        { service },
        request({
          agentId: 'briefing_annotation',
          organizationSlug: seeded.organizationSlug,
        }),
      )

      expect(record.status).toBe('infraError')
      expect(record.output).toBeNull()
      expect(record.trace[0]?.error).toContain('names none')
    },
    TURN_TIMEOUT_MS,
  )
})
