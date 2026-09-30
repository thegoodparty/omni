import { describe, expect, it } from 'vitest'
import { differenceInMilliseconds, parseISO } from 'date-fns'
import type {
  DatabricksProvider,
  DatabricksRowSet,
} from '@/llm/tools/queryDatabricks.tool'
import { useTestService } from '@/test-service'
import { PRICING_VERSION } from '../pricing'
import { isComparable, type RunRecord } from '../record'
import { instrumentDatabricksProvider, type ChatTurnScript } from './chatSeam'
import {
  TOOL_BUDGET_FALLBACK_REPLY,
  runChatCase,
  type ChatRunRequest,
} from './chat'
import { seedChatOrg } from './seedChatOrg'

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
  ports: { constituentProvider?: DatabricksProvider } = {},
): Promise<RunRecord> => {
  const seeded = await seedChatOrg(
    service.prisma,
    service.user.id,
    agentId,
    'judge-case',
  )
  return runChatCase(
    { service, ...ports },
    request({
      agentId,
      organizationSlug: seeded.organizationSlug,
      ...(seeded.anchor && { anchor: seeded.anchor }),
      ...overrides,
    }),
  )
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
      // constituent tool never registers and nothing reaches the provider.
      // Recording the version anyway would claim a pin that never happened,
      // which is the one failure the field exists to prevent.
      const provider: DatabricksProvider = {
        query: (): Promise<DatabricksRowSet> =>
          Promise.resolve({ columns: [], rows: [] }),
      }
      const record = await runFor(
        'chief_of_staff',
        { dataVersion: '3237' },
        { constituentProvider: provider },
      )

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
      const provider: DatabricksProvider = {
        query: (): Promise<DatabricksRowSet> =>
          Promise.resolve({ columns: [], rows: [] }),
      }

      await expect(
        runChatCase(
          { service, constituentProvider: provider },
          request({
            agentId: 'chief_of_staff',
            organizationSlug: 'judge-unused',
            script: undefined,
          }),
        ),
      ).rejects.toThrow('was given no script')

      // Claimable again, which it would not be if the refusal had left the
      // first install recorded.
      instrumentDatabricksProvider(provider).restore()
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
            agentId: 'briefing_annotation',
            organizationSlug: 'judge-unused',
          }),
        ),
      ).rejects.toThrow('not a chat scope the runner can drive')
    },
    TURN_TIMEOUT_MS,
  )
})
