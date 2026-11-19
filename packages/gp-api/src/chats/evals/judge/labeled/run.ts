import { createHash } from 'node:crypto'
import { differenceInMilliseconds } from 'date-fns'
import { z } from 'zod'
import { isLabeledCase, LabelValueSchema } from '../cases'
import { PRICING_VERSION } from '../pricing'
import {
  isoUtc,
  RunRecordSchema,
  type CiContext,
  type JsonValue,
  type RunRecord,
} from '../record'
import { scrubReason, type ArmCaseRequest } from '../sweepArm'
import { LABELED_ADAPTERS } from './adapters'
import type { LabeledAdapter, LabelAnswer } from './types'

// What a record holds when the adapter never said which model answered.
const UNRECORDED_MODEL = 'unrecorded'

// The trace carries the error for a person reading the stored record, so it
// is bounded like a tool error and scrubbed like a skip reason.
const MAX_ERROR_CHARS = 300

const ProbabilitiesSchema = z.record(z.string(), z.number().min(0).max(1))

export const LabelAnswerSchema = z.object({
  value: LabelValueSchema,
  probabilities: ProbabilitiesSchema.optional(),
})

// What a labeled record's output value is, read back by the scorer. Checked
// on the way in too, so an adapter that returns something else is an
// infraError here rather than an unreadable record there.
export const LabeledOutputSchema = z.record(z.string(), LabelAnswerSchema)

const LabeledRunResultSchema = z.object({
  labels: LabeledOutputSchema,
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      costUsd: z.number().nonnegative(),
    })
    .optional(),
  model: z.string().min(1).optional(),
})

const answerJson = (answer: LabelAnswer): JsonValue =>
  answer.probabilities === undefined
    ? { value: answer.value }
    : { value: answer.value, probabilities: answer.probabilities }

const digestOf = (agentId: string, model: string): string =>
  `labeled:${createHash('sha256').update(`${agentId}\n${model}`).digest('hex')}`

export interface LabeledRunDeps {
  adapters?: Readonly<Record<string, LabeledAdapter>>
  now?: () => Date
  ci?: CiContext
}

export const runLabeledCase = async (
  request: ArmCaseRequest,
  deps: LabeledRunDeps = {},
): Promise<RunRecord> => {
  const { agent } = request
  if (!isLabeledCase(request.case)) {
    throw new Error(
      `${request.case.caseId} has no expected labels, so it is not a ` +
        'labeled case',
    )
  }
  // Thrown rather than recorded: a registry entry with no adapter is a wiring
  // fault on this ref, and captureArm skips the agent by name for it.
  const adapter = (deps.adapters ?? LABELED_ADAPTERS)[agent.agentId]
  if (adapter === undefined) {
    throw new Error(
      `${agent.agentId} is a labeled agent with no adapter in ` +
        'labeled/adapters.ts',
    )
  }
  const now = deps.now ?? (() => new Date())
  const startedAt = now()
  // THREE OUTCOMES, and the middle one is the classifier's own answer. An
  // adapter that returns something that is not labels ran and said nothing
  // usable, which is a wrong answer on every label (and a missed floor
  // wherever the base caught one), so it is `blocked` with no labels. Only
  // an adapter that throws is an infraError, the harness or vendor fault
  // every other shape excludes.
  let outcome:
    | { kind: 'answered'; result: z.infer<typeof LabeledRunResultSchema> }
    | { kind: 'unreadable' | 'failed'; error: string }
  try {
    const parsed = LabeledRunResultSchema.safeParse(
      await adapter(request.case.input, { spends: request.spends }),
    )
    outcome = parsed.success
      ? { kind: 'answered', result: parsed.data }
      : {
          kind: 'unreadable',
          error: `the adapter returned no readable labels: ${parsed.error.issues
            .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('; ')}`,
        }
  } catch (err) {
    outcome = {
      kind: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }
  }
  const endedAt = now()
  const answered = outcome.kind === 'answered' ? outcome.result : undefined
  const model = answered?.model ?? UNRECORDED_MODEL
  const usage = answered?.usage

  return RunRecordSchema.parse({
    schemaVersion: 1,
    sweepId: request.sweepId,
    runId:
      `${request.sweepId}:${agent.agentId}:${request.case.caseId}:` +
      `${request.arm}:${request.attempt}`,
    agentId: agent.agentId,
    agentShape: 'labeled',
    arm: request.arm,
    variant: {
      ref: request.variant.ref,
      commit: request.variant.commit,
      model,
      configDigest: digestOf(agent.agentId, model),
    },
    caseId: request.case.caseId,
    attempt: request.attempt,
    startedAt: isoUtc(startedAt),
    endedAt: isoUtc(endedAt),
    input: { kind: 'labeled', value: { ...request.case.input } },
    output:
      outcome.kind === 'failed'
        ? null
        : {
            kind: 'labels',
            value: Object.fromEntries(
              Object.entries(answered?.labels ?? {}).map(([name, answer]) => [
                name,
                answerJson(answer),
              ]),
            ),
          },
    trace:
      outcome.kind === 'answered'
        ? []
        : [
            {
              index: 0,
              kind: 'error',
              error:
                scrubReason(outcome.error).slice(0, MAX_ERROR_CHARS) ||
                'the adapter failed with no message',
            },
          ],
    telemetry: {
      latencyMs: Math.max(0, differenceInMilliseconds(endedAt, startedAt)),
      tokens: {
        input: usage?.inputTokens ?? 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      // A STORED ZERO IS A PRICE HERE, unlike every other shape: a regex arm
      // costs nothing, and a decision model bills per call rather than per
      // token, so the adapter's figure is the only one there is. See
      // runCostUsd in actualCost.ts.
      ...(answered !== undefined && {
        cost: {
          usdAtCapture: usage?.costUsd ?? 0,
          pricingVersion: PRICING_VERSION,
        },
      }),
      toolCalls: 0,
      toolErrors: 0,
      retries: 0,
    },
    toolQueries: [],
    liveWeb: false,
    status:
      outcome.kind === 'answered'
        ? 'produced'
        : outcome.kind === 'unreadable'
          ? 'blocked'
          : 'infraError',
    ...(deps.ci && { ci: deps.ci }),
  })
}
