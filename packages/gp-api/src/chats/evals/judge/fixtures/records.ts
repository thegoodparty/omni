import { PRICING_VERSION } from '../pricing'
import type { RunRecord } from '../record'

// Synthetic records, one pair per shape of thing the layers above a runner
// have to handle. These are the reason the normalizer, judge, scoring and
// report can all be built and tested before any runner exists: every one of
// those is a pure function over a record, so a fixture stands in for a live
// agent completely.
//
// Every pair is (base, candidate) for one case. Keep them hand-written and
// obvious rather than generated — a fixture that needs explaining has
// stopped being a fixture.

const SWEEP = 'swp_fixture'

interface Overrides {
  agentId?: string
  shape?: RunRecord['agentShape']
  digest?: string
  status?: RunRecord['status']
  output?: RunRecord['output']
  toolCalls?: number
  toolErrors?: number
  trace?: RunRecord['trace']
  toolQueries?: string[]
  dataVersion?: string
  liveWeb?: boolean
  ci?: boolean
}

// Nine build tracks import these same objects, and vitest runs suites in one
// worker per file. A test that mutated a shared fixture would corrupt another
// test's input with no obvious link between them, so mutation throws instead.
// Spreading still works, which is all the tests need.
const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

const record = (
  caseId: string,
  arm: RunRecord['arm'],
  o: Overrides = {},
): RunRecord => ({
  schemaVersion: 1,
  sweepId: SWEEP,
  runId: `run_${caseId}_${arm}`,
  agentId: o.agentId ?? 'chief_of_staff',
  agentShape: o.shape ?? 'chat',
  arm,
  variant: {
    ref: arm === 'base' ? 'main' : 'judge-demo',
    commit: arm === 'base' ? 'a'.repeat(40) : 'b'.repeat(40),
    model: 'claude-sonnet-4-6',
    configDigest: o.digest ?? (arm === 'base' ? 'digest-base' : 'digest-cand'),
  },
  caseId,
  attempt: 1,
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: '2026-01-01T00:00:12.000Z',
  input: { kind: 'question', value: 'What are my top priorities right now?' },
  output:
    o.output !== undefined
      ? o.output
      : {
          kind: 'text',
          value:
            arm === 'base'
              ? 'You have three priorities on file. Housing is the oldest.'
              : 'Three priorities are on file, and housing has been open ' +
                'longest. Two have no target date.',
        },
  trace: o.trace ?? [
    { index: 0, kind: 'text' },
    { index: 1, kind: 'tool', tool: 'crud_priorities' },
    { index: 2, kind: 'text' },
  ],
  telemetry: {
    latencyMs: 12_000,
    // The real measured shape of a Chief of Staff turn. Cache counts are
    // zero because prompt caching is not enabled, not because they are
    // unmodelled — a consumer that ignores them breaks the day it is.
    tokens: {
      input: 31_213,
      output: 227,
      cacheRead: 0,
      cacheWrite: 0,
    },
    cost: {
      usdAtCapture: 0.097,
      pricingVersion: PRICING_VERSION,
    },
    toolCalls: o.toolCalls ?? 1,
    toolErrors: o.toolErrors ?? 0,
    retries: 0,
  },
  toolQueries: o.toolQueries ?? [],
  ...(o.dataVersion === undefined ? {} : { dataVersion: o.dataVersion }),
  ...(o.ci
    ? {
        ci: {
          repo: 'thegoodparty/omni',
          prNumber: 2198,
          workflowRunId: '36592029654',
          workflowRunAttempt: 1,
          workflowRunUrl:
            'https://github.com/thegoodparty/omni/actions/runs/36592029654',
        },
      }
    : {}),
  liveWeb: o.liveWeb ?? false,
  status: o.status ?? 'produced',
})

const pair = (base: RunRecord, candidate: RunRecord): [RunRecord, RunRecord] =>
  deepFreeze([base, candidate])

// The ordinary case: a clean chat turn on both arms, different digests, the
// candidate's answer a little fuller. This is what the judge is for.
//
// Carries CI provenance, because a sweep run from a PR is the normal path and
// the report has to be able to link a verdict back to the change that caused
// it. The other pairs leave `ci` absent, which is what a local run looks like.
export const CHAT_PAIR: [RunRecord, RunRecord] = pair(
  record('cos-priorities', 'base', { ci: true }),
  record('cos-priorities', 'candidate', { ci: true }),
)

// A chat turn that queried the voter mart. Carries the generated SQL and the
// pinned Delta version, so the two arms' queries can be diffed and neither
// verdict can be an artifact of the data moving.
export const VOTER_QUERY_PAIR: [RunRecord, RunRecord] = pair(
  record('cos-housing-support', 'base', {
    toolCalls: 2,
    trace: [
      { index: 0, kind: 'text' },
      { index: 1, kind: 'tool', tool: 'describe_constituent_data' },
      { index: 2, kind: 'tool', tool: 'query_constituent_data' },
      { index: 3, kind: 'text' },
    ],
    dataVersion: '3237',
    toolQueries: [
      'SELECT COUNT(*) AS count FROM serve_agent_voters ' +
        "WHERE state_postal_code = 'WA' AND City = 'SPOKANE'",
    ],
  }),
  record('cos-housing-support', 'candidate', {
    toolCalls: 2,
    trace: [
      { index: 0, kind: 'text' },
      { index: 1, kind: 'tool', tool: 'describe_constituent_data' },
      { index: 2, kind: 'tool', tool: 'query_constituent_data' },
      { index: 3, kind: 'text' },
    ],
    dataVersion: '3237',
    toolQueries: [
      'SELECT hs_affordable_housing_support, COUNT(*) AS count ' +
        'FROM serve_agent_voters ' +
        "WHERE state_postal_code = 'WA' AND City = 'SPOKANE' " +
        'GROUP BY hs_affordable_housing_support',
    ],
  }),
)

// A background run. Input is a params fixture and output is an artifact
// object, both opaque above the runner — the same record schema carries them
// with no special case anywhere downstream.
export const BACKGROUND_PAIR: [RunRecord, RunRecord] = pair(
  record('brief-2025-11-04', 'base', {
    agentId: 'meeting_briefing',
    shape: 'background',
    output: {
      kind: 'artifact',
      value: {
        executive_summary: { items: [{ item_id: 'i1', tier: 'featured' }] },
      },
    },
  }),
  record('brief-2025-11-04', 'candidate', {
    agentId: 'meeting_briefing',
    shape: 'background',
    output: {
      kind: 'artifact',
      value: {
        executive_summary: {
          items: [
            { item_id: 'i1', tier: 'featured' },
            { item_id: 'i2', tier: 'featured' },
          ],
        },
      },
    },
  }),
)

// The candidate's voter tool failed. Both arms still answered, so nothing
// looks broken — the candidate just answered with less information. Scoring
// must resolve this to CAN'T SAY rather than letting a dead credential read
// as a code regression.
export const TOOL_ERROR_PAIR: [RunRecord, RunRecord] = pair(
  record('cos-constituents', 'base', { toolCalls: 1 }),
  record('cos-constituents', 'candidate', {
    toolCalls: 1,
    toolErrors: 1,
    trace: [
      { index: 0, kind: 'text' },
      {
        index: 1,
        kind: 'tool',
        tool: 'query_constituent_data',
        error: 'PeopleDbxUnavailableError: credential not configured',
      },
    ],
    output: {
      kind: 'text',
      value:
        "I could not reach the constituent data just now, so here's " +
        'what I can say from your CRM alone.',
    },
  }),
)

// The candidate declined. A refusal is an agent result, not a failure, so it
// keeps an output and stays judgeable — whether declining was right is
// exactly the kind of thing a verdict should capture.
export const BLOCKED_PAIR: [RunRecord, RunRecord] = pair(
  record('cos-partisan-ask', 'base'),
  record('cos-partisan-ask', 'candidate', {
    status: 'blocked',
    output: {
      kind: 'text',
      value: 'I cannot break constituents down by political party.',
    },
  }),
)

// The run died before producing anything. The only case with a null output,
// and the reason the schema ties that to infraError exactly.
export const INFRA_ERROR_PAIR: [RunRecord, RunRecord] = pair(
  record('brief-timeout', 'base', {
    agentId: 'meeting_briefing',
    shape: 'background',
    output: { kind: 'artifact', value: { executive_summary: { items: [] } } },
  }),
  record('brief-timeout', 'candidate', {
    agentId: 'meeting_briefing',
    shape: 'background',
    status: 'infraError',
    output: null,
    trace: [{ index: 0, kind: 'error', error: 'poll timed out' }],
    toolCalls: 0,
  }),
)

// Both arms hash to the same config, so the agent could not have seen any
// difference. The orchestrator refuses to run this rather than spending on a
// comparison whose answer is already known.
export const IDENTICAL_DIGEST_PAIR: [RunRecord, RunRecord] = pair(
  record('cos-noop', 'base', { digest: 'same-digest' }),
  record('cos-noop', 'candidate', { digest: 'same-digest' }),
)

// `satisfies` rather than an annotation, so a named lookup keeps its exact
// tuple type instead of widening to `| undefined` under
// noUncheckedIndexedAccess.
export const ALL_PAIRS = {
  CHAT_PAIR,
  VOTER_QUERY_PAIR,
  BACKGROUND_PAIR,
  TOOL_ERROR_PAIR,
  BLOCKED_PAIR,
  INFRA_ERROR_PAIR,
  IDENTICAL_DIGEST_PAIR,
} satisfies Record<string, [RunRecord, RunRecord]>
