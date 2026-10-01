import {
  JUDGE_RUN_ID_MAX_LENGTH,
  JudgeOverrideSchema,
} from '@goodparty_org/contracts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  substituteBackgroundCases,
  UnsubstitutedPlaceholderError,
} from '../caseParams'
import { PRICING_VERSION, priceUsd, UnpriceableRunError } from '../pricing'
import { RunRecordSchema, type Arm, type RunRecord } from '../record'
import {
  artifactKey,
  backgroundConfigDigest,
  baseArmCacheKey,
  buildDispatchMessage,
  CACHED_BASE_ARM_SCHEMA_VERSION,
  captureCostUsd,
  ciContext,
  isJudgeRunId,
  JUDGE_RUN_ID_PREFIX,
  judgeRunId,
  parseTrace,
  pollForObject,
  readCachedBaseArm,
  runBackgroundBaseArm,
  runBackgroundCase,
  stageAgentConfig,
  traceKey,
  traceTooLarge,
  type AgentConfig,
  type BackgroundRunInput,
  type BackgroundRunnerDeps,
  type Clock,
  type DispatchQueue,
  type ObjectStore,
} from './background'

// --- fakes ------------------------------------------------------------------
//
// Narrow interfaces are the whole reason these are three dozen lines rather
// than an AWS mock: nothing in the runner names a bucket client or a queue
// client, so nothing here has to pretend to be one.

interface Put {
  bucket: string
  key: string
  body: string
}

interface FakeStore extends ObjectStore {
  objects: Map<string, string>
  puts: Put[]
  gets: string[]
}

const path = (bucket: string, key: string) => `${bucket}/${key}`

const fakeStore = (
  seed: Record<string, string> = {},
  onGet?: (key: string, callNumber: number, store: FakeStore) => void,
): FakeStore => {
  const store: FakeStore = {
    objects: new Map(Object.entries(seed)),
    puts: [],
    gets: [],
    async getText(bucket, key) {
      store.gets.push(path(bucket, key))
      onGet?.(
        path(bucket, key),
        store.gets.filter((g) => g === path(bucket, key)).length,
        store,
      )
      return store.objects.get(path(bucket, key))
    },
    async putText(bucket, key, body) {
      store.puts.push({ bucket, key, body })
      store.objects.set(path(bucket, key), body)
    },
  }
  return store
}

interface FakeQueue extends DispatchQueue {
  sent: Array<{ body: string; groupId: string; deduplicationId: string }>
}

const fakeQueue = (): FakeQueue => {
  const sent: FakeQueue['sent'] = []
  return {
    sent,
    async send(message) {
      sent.push(message)
    },
  }
}

// Advances only when the runner sleeps, so a poll loop that would take twenty
// minutes in production resolves in microseconds and the elapsed figures the
// record carries are still exact.
const fakeClock = (start = '2026-01-01T00:00:00.000Z'): Clock => {
  let ms = Date.parse(start)
  return {
    now: () => new Date(ms),
    async sleep(waitMs) {
      ms += waitMs
    },
  }
}

// --- fixtures ---------------------------------------------------------------

const METADATA_BUCKET = 'agent-experiment-metadata-dev'
const ARTIFACT_BUCKET = 'gp-agent-artifacts-dev'
const AGENT = 'meeting_briefing'

// A behavior projection, which is what the consumer accepts: model, max_turns
// and output_schema are required of it, and nothing outside the five-field
// allowlist may appear. The old fixture omitted output_schema, so nothing in
// the suite stated the contract the Lambda actually enforces.
const MANIFEST = JSON.stringify({
  model: 'claude-sonnet-4-6',
  max_turns: 40,
  output_schema: {
    type: 'object',
    properties: { summary: { type: 'string' } },
  },
})

const config: AgentConfig = {
  manifest: MANIFEST,
  instruction: '# Brief the meeting\n',
}

const ARTIFACT = JSON.stringify({
  executive_summary: { items: [{ item_id: 'i1' }] },
})

const TRACE = [
  '{"type":"assistant","message":{"content":[{"type":"text"}]}}',
  '{"type":"assistant","message":{"content":[' +
    '{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}',
  '{"type":"tool_result","content":"ok","is_error":false}',
  '{"type":"result","total_cost_usd":3.25,"num_turns":31}',
].join('\n')

const runInput = (
  overrides: Partial<BackgroundRunInput> = {},
): BackgroundRunInput => ({
  sweepId: 'swp1',
  agentId: AGENT,
  arm: 'candidate',
  attempt: 1,
  agentCase: {
    caseId: 'brief-2025-11-04',
    params: { officialName: 'A Official', meetingDate: '2025-11-04' },
  },
  config,
  variant: {
    ref: 'judge-track-b',
    commit: 'b'.repeat(40),
    model: 'claude-sonnet-4-6',
  },
  organizationSlug: 'judge-fixture-org',
  metadataBucket: METADATA_BUCKET,
  artifactBucket: ARTIFACT_BUCKET,
  poll: { timeoutMs: 5_000, intervalMs: 1_000 },
  // No CI: an explicit env keeps a record's shape from depending on whether
  // the suite happens to be running inside Actions. JUDGE_SPEND is the
  // affirmative switch every dispatching path requires.
  env: { JUDGE_SPEND: 'true' },
  ...overrides,
})

const deps = (store: FakeStore, queue: FakeQueue, clock: Clock) =>
  ({ store, queue, clock }) satisfies BackgroundRunnerDeps

// A store already holding the artifact and trace this run will look for.
const completedRun = (input: BackgroundRunInput, runId: string) =>
  fakeStore({
    [path(ARTIFACT_BUCKET, artifactKey(input.agentId, runId))]: ARTIFACT,
    [path(ARTIFACT_BUCKET, traceKey(input.agentId, runId))]: TRACE,
  })

const idFor = (input: BackgroundRunInput) =>
  judgeRunId({
    sweepId: input.sweepId,
    caseId: input.agentCase.caseId,
    arm: input.arm,
    attempt: input.attempt,
  })

// A minimal record used only to prove a clamped count actually satisfies the
// frozen schema, rather than asserting the clamp against itself.
const validRecordShape = (): RunRecord => ({
  schemaVersion: 1,
  sweepId: 'swp1',
  runId: '_judge-swp1-c1-base-1',
  agentId: AGENT,
  agentShape: 'background',
  arm: 'base',
  variant: {
    ref: 'universal-judge',
    commit: 'a'.repeat(40),
    model: 'claude-sonnet-4-6',
    configDigest: 'abc123',
  },
  caseId: 'c1',
  attempt: 1,
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: '2026-01-01T00:10:00.000Z',
  input: { kind: 'params', value: { params: {}, inputFiles: [] } },
  output: { kind: 'artifact', value: {} },
  trace: [],
  telemetry: {
    latencyMs: 600_000,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: { usdAtCapture: 3.25, pricingVersion: PRICING_VERSION },
    toolCalls: 0,
    toolErrors: 0,
    retries: 0,
  },
  toolQueries: [],
  liveWeb: false,
  status: 'produced',
})

// --- staging ----------------------------------------------------------------

describe('stageAgentConfig', () => {
  it('writes both files at the contract-built override key', async () => {
    const store = fakeStore()
    const { override, digest } = await stageAgentConfig(
      store,
      METADATA_BUCKET,
      AGENT,
      config,
    )

    expect(JudgeOverrideSchema.safeParse(override).success).toBe(true)
    expect(override.manifest_key).toBe(
      `_judge/${AGENT}/${digest}/manifest.json`,
    )
    expect(store.puts).toEqual([
      {
        bucket: METADATA_BUCKET,
        key: override.manifest_key,
        body: config.manifest,
      },
      {
        bucket: METADATA_BUCKET,
        key: override.instruction_key,
        body: config.instruction,
      },
    ])
  })

  // index.json is a single global mutable switch. A per-sweep write to it
  // races every other sweep and main's CI, so the absence of that write is a
  // property worth asserting rather than trusting.
  it('writes nothing outside the reserved judge prefix', async () => {
    const store = fakeStore()
    await stageAgentConfig(store, METADATA_BUCKET, AGENT, config)

    expect(store.puts).not.toHaveLength(0)
    for (const put of store.puts) {
      expect(put.key.startsWith('_judge/')).toBe(true)
      expect(put.key).not.toContain('index.json')
    }
  })

  it('is idempotent for identical content and distinct for different', async () => {
    const a = await stageAgentConfig(
      fakeStore(),
      METADATA_BUCKET,
      AGENT,
      config,
    )
    const b = await stageAgentConfig(fakeStore(), METADATA_BUCKET, AGENT, {
      ...config,
    })
    const c = await stageAgentConfig(fakeStore(), METADATA_BUCKET, AGENT, {
      ...config,
      instruction: '# Brief the meeting differently\n',
    })

    expect(b.override).toEqual(a.override)
    expect(c.override.manifest_key).not.toBe(a.override.manifest_key)
  })

  // Concatenating the two blobs without a separator makes these two configs
  // hash alike, and two different configs sharing one content-addressed key is
  // the exact collision the scheme exists to rule out.
  it('does not confuse the manifest/instruction boundary', () => {
    expect(
      backgroundConfigDigest({ manifest: 'ab', instruction: 'c' }),
    ).not.toBe(backgroundConfigDigest({ manifest: 'a', instruction: 'bc' }))
  })

  it('refuses an agentId that could escape the reserved prefix', async () => {
    await expect(
      stageAgentConfig(fakeStore(), METADATA_BUCKET, '../compliance_setup', {
        manifest: MANIFEST,
        instruction: '',
      }),
    ).rejects.toThrow(/unsafe agentId/)
  })
})

// --- run ids ----------------------------------------------------------------

describe('judgeRunId', () => {
  const parts = {
    sweepId: 'swp1',
    caseId: 'brief-2025-11-04',
    arm: 'candidate' as Arm,
    attempt: 1,
  }

  it('stays readable when the ids are short enough to fit', () => {
    const runId = judgeRunId({ ...parts, sweepId: 's1', caseId: 'c1' })

    expect(runId).toBe('_judge-s1-c1-candidate-1')
    expect(isJudgeRunId(runId)).toBe(true)
  })

  // The Lambda passes the run id to ECS RunTask as startedBy, whose ceiling is
  // 36 — not the handler's own 64. A longer id makes RunTask fail, and with the
  // result callback suppressed the sweep would just wait out the poll window
  // and record an infraError with no reason.
  it('fits the 36-char ECS startedBy ceiling', () => {
    for (const p of [
      parts,
      { ...parts, sweepId: 's1', caseId: 'c1' },
      { ...parts, arm: 'base' as Arm },
      { ...parts, sweepId: 's'.repeat(80), caseId: 'c'.repeat(80) },
      { ...parts, attempt: 999 },
    ]) {
      const runId = judgeRunId(p)
      expect(runId.length).toBeLessThanOrEqual(36)
      expect(runId).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(isJudgeRunId(runId)).toBe(true)
    }
  })

  it('refuses an id with no room left for a digest', () => {
    expect(() =>
      judgeRunId({ ...parts, sweepId: 's'.repeat(40), attempt: 10 ** 12 }),
    ).toThrow(/no room for a/)
  })

  it('refuses an attempt that is not a positive integer', () => {
    expect(() => judgeRunId({ ...parts, attempt: 1.5 })).toThrow(/attempt/)
    expect(() => judgeRunId({ ...parts, attempt: 0 })).toThrow(/attempt/)
  })

  it('separates the arms and the attempts', () => {
    const ids = new Set([
      judgeRunId(parts),
      judgeRunId({ ...parts, arm: 'base' }),
      judgeRunId({ ...parts, attempt: 2 }),
    ])

    expect(ids.size).toBe(3)
  })

  // Substituting the offending characters would be worse than refusing them:
  // `a/b` and `a-b` collapse to one run id, and because the SQS deduplication
  // id IS the run id, the second case's dispatch would be swallowed while both
  // records read the same artifact key.
  it('refuses an id segment the dispatch handler would reject', () => {
    expect(() => judgeRunId({ ...parts, caseId: 'brief.2025/11 04' })).toThrow(
      /unsafe caseId/,
    )
    expect(() => judgeRunId({ ...parts, sweepId: 'swp 1' })).toThrow(
      /unsafe sweepId/,
    )
  })

  it('compresses a long id deterministically', () => {
    const long = { ...parts, sweepId: 's'.repeat(80), caseId: 'c'.repeat(80) }
    const first = judgeRunId(long)

    expect(first.startsWith(JUDGE_RUN_ID_PREFIX)).toBe(true)
    expect(first.endsWith('-candidate-1')).toBe(true)
    expect(judgeRunId(long)).toBe(first)
    expect(judgeRunId({ ...long, attempt: 2 })).not.toBe(first)
    // Distinct cases must not collapse: the SQS deduplication id is the run
    // id, so a collision would silently swallow the second dispatch.
    expect(judgeRunId({ ...long, caseId: 'd'.repeat(80) })).not.toBe(first)
  })
})

// --- dispatch ---------------------------------------------------------------

describe('buildDispatchMessage', () => {
  const override = {
    manifest_key: `_judge/${AGENT}/abc/manifest.json`,
    instruction_key: `_judge/${AGENT}/abc/instruction.md`,
  }
  const base = {
    runId: 'judge-swp1-c1-candidate-1',
    agentId: AGENT,
    organizationSlug: 'judge-fixture-org',
    override,
  }

  it('keeps the experiment id real and names the override', () => {
    const message = buildDispatchMessage({
      ...base,
      agentCase: { caseId: 'c1', params: { meetingDate: '2025-11-04' } },
    })

    expect(message.experiment_type).toBe(AGENT)
    expect(message._judge_override).toEqual(override)
    expect(message.params).toEqual({ meetingDate: '2025-11-04' })
  })

  // A judge run has no experiment_run row, so anything that makes gp-api hear
  // about it logs `Experiment run not found` once per run. Asserting the whole
  // key set rather than a few absences is what catches a field nobody thought
  // to name here.
  it('asks for no user actor and no results callback', () => {
    const message = buildDispatchMessage({
      ...base,
      agentCase: { caseId: 'c1', params: {} },
    })

    expect(Object.keys(message).sort()).toEqual([
      '_judge_override',
      'experiment_type',
      'organization_slug',
      'params',
      'priority',
      'run_id',
    ])
  })

  // Both are the silent-stall class the other ceilings in this function guard:
  // the Lambda rejects them, and with the result callback suppressed the sweep
  // would just wait out the whole poll window.
  it('refuses an agentId or slug the dispatch handler would reject', () => {
    expect(() =>
      buildDispatchMessage({
        ...base,
        agentId: 'Meeting-Briefing',
        agentCase: { caseId: 'c1', params: {} },
      }),
    ).toThrow(/experiment_type/)

    expect(() =>
      buildDispatchMessage({
        ...base,
        organizationSlug: 'judge-fixture.org',
        agentCase: { caseId: 'c1', params: {} },
      }),
    ).toThrow(/not dispatchable/)
  })

  it('carries input files inside params under the envelope key', () => {
    const message = buildDispatchMessage({
      ...base,
      agentCase: {
        caseId: 'c1',
        params: { meetingDate: '2025-11-04' },
        inputFiles: [
          {
            bucket: 'gp-agent-run-inputs-dev',
            key: '_judge/fixtures/agenda.pdf',
            dest: 'agenda.pdf',
          },
        ],
      },
    })

    expect(message.params._input_files).toEqual([
      {
        bucket: 'gp-agent-run-inputs-dev',
        key: '_judge/fixtures/agenda.pdf',
        dest: 'agenda.pdf',
      },
    ])
  })

  it('refuses a case that hand-rolls the envelope key', () => {
    expect(() =>
      buildDispatchMessage({
        ...base,
        agentCase: {
          caseId: 'c1',
          params: { _input_files: [], meetingDate: '2025-11-04' },
        },
      }),
    ).toThrow(/reserved envelope key/)
  })

  it('omits the envelope key when the case has no files', () => {
    const message = buildDispatchMessage({
      ...base,
      agentCase: { caseId: 'c1', params: { a: 1 } },
    })

    expect(message.params).not.toHaveProperty('_input_files')
  })

  // The broker writes a mutable `<experiment>/<org>/latest.json` pointer
  // beside the immutable per-run archive, and that key is scoped to the
  // organization rather than the run — so a judge run under a real slug
  // overwrites that organization's product data, which neither the run-id
  // prefix nor an artifact prefix override would prevent.
  it('refuses to dispatch under a real organization slug', () => {
    expect(() =>
      buildDispatchMessage({
        ...base,
        organizationSlug: 'city-of-spokane',
        agentCase: { caseId: 'c1', params: {} },
      }),
    ).toThrow(/organization slug/)
  })

  // With result callbacks suppressed, a dispatch the Lambda rejects is
  // invisible: the sweep waits out the whole poll timeout and records an
  // infraError with no reason. Failing here names it immediately.
  it('rejects a payload the dispatch handler would reject silently', () => {
    const tooManyFiles = Array.from({ length: 11 }, (_, i) => ({
      bucket: 'gp-agent-run-inputs-dev',
      key: `_judge/fixtures/${i}.pdf`,
      dest: `f${i}.pdf`,
    }))

    expect(() =>
      buildDispatchMessage({
        ...base,
        agentCase: { caseId: 'c1', params: {}, inputFiles: tooManyFiles },
      }),
    ).toThrow(/input files/)

    expect(() =>
      buildDispatchMessage({
        ...base,
        agentCase: { caseId: 'c1', params: { blob: 'x'.repeat(300_000) } },
      }),
    ).toThrow(/params serialize/)

    // Ten refs clear the count check and still blow the much smaller
    // INPUT_FILES_JSON container-override budget.
    expect(() =>
      buildDispatchMessage({
        ...base,
        agentCase: {
          caseId: 'c1',
          params: {},
          inputFiles: Array.from({ length: 10 }, (_, i) => ({
            bucket: 'gp-agent-run-inputs-dev',
            key: `_judge/fixtures/${'k'.repeat(900)}-${i}.pdf`,
            dest: `f${i}.pdf`,
          })),
        },
      }),
    ).toThrow(/input files serialize/)
  })

  it('refuses an input-file ref the dispatch handler would reject', () => {
    const withFile =
      (dest: string, key = '_judge/fixtures/a.pdf') =>
      () =>
        buildDispatchMessage({
          ...base,
          agentCase: {
            caseId: 'c1',
            params: {},
            inputFiles: [{ bucket: 'gp-agent-run-inputs-dev', key, dest }],
          },
        })

    expect(withFile('../escape.pdf')).toThrow(/simple filename/)
    expect(withFile('.hidden')).toThrow(/simple filename/)
    expect(withFile('a.pdf', '')).toThrow(/input file key/)
    expect(withFile('a.pdf', 'k'.repeat(1025))).toThrow(/input file key/)
    expect(withFile('agenda.pdf')).not.toThrow()
  })
})

describe('artifactKey and traceKey', () => {
  it('address the run scoped archive the broker writes', () => {
    expect(artifactKey(AGENT, 'judge-x')).toBe(`${AGENT}/judge-x/artifact.json`)
    expect(traceKey(AGENT, 'judge-x')).toBe(
      `${AGENT}/judge-x/logs/workspace/conversation.jsonl`,
    )
  })

  // Exported for other tracks, so the defense cannot depend on staging having
  // validated the agentId first.
  it('refuse an agentId that would read outside the prefix', () => {
    expect(() => artifactKey('../compliance_setup', 'judge-x')).toThrow(
      /unsafe agentId/,
    )
    expect(() => traceKey('../compliance_setup', 'judge-x')).toThrow(
      /unsafe agentId/,
    )
  })
})

describe('dispatch envelope', () => {
  it('dedupes on the run id and gives each run its own FIFO group', async () => {
    const input = runInput()
    const runId = idFor(input)
    const store = completedRun(input, runId)
    const queue = fakeQueue()
    await runBackgroundCase(deps(store, queue, fakeClock()), input)

    expect(queue.sent).toHaveLength(1)
    expect(queue.sent[0]?.deduplicationId).toBe(runId)
    // A shared group id would serialize the sweep: FIFO delivers one group in
    // order, so five 20-minute runs would take an hour and a half.
    expect(queue.sent[0]?.groupId).toBe(runId)
  })
})

// --- polling ----------------------------------------------------------------

describe('pollForObject', () => {
  it('returns at once when the object is already there', async () => {
    const store = fakeStore({ [path('b', 'k')]: 'body' })

    const outcome = await pollForObject(store, fakeClock(), 'b', 'k', {
      timeoutMs: 5_000,
      intervalMs: 1_000,
    })

    expect(outcome).toEqual({ kind: 'found', body: 'body', waitedMs: 0 })
    expect(store.gets).toHaveLength(1)
  })

  it('keeps looking until the object appears', async () => {
    const store = fakeStore({}, (key, callNumber, s) => {
      if (callNumber === 3) s.objects.set(key, 'late')
    })

    const outcome = await pollForObject(store, fakeClock(), 'b', 'k', {
      timeoutMs: 60_000,
      intervalMs: 1_000,
    })

    expect(outcome.kind).toBe('found')
    expect(store.gets).toHaveLength(3)
  })

  it('refuses a poll that would spin on S3', async () => {
    await expect(
      pollForObject(fakeStore(), fakeClock(), 'b', 'k', {
        timeoutMs: 5_000,
        intervalMs: 0,
      }),
    ).rejects.toThrow(/positive timeout and interval/)
  })

  // The deadline is only checked between gets, so a longer interval overshoots
  // the window and the recorded latency becomes the interval.
  it('refuses an interval longer than the window it polls', async () => {
    await expect(
      pollForObject(fakeStore(), fakeClock(), 'b', 'k', {
        timeoutMs: 5_000,
        intervalMs: 60_000,
      }),
    ).rejects.toThrow(/exceeds the timeout/)
  })

  // Deliberate: retrying a GET belongs to the adapter. Treating a broken
  // credential as "not there yet" would burn the whole window and then report
  // a timeout, which reads as a dead task rather than a dead credential.
  it('lets a store failure abort the case instead of waiting it out', async () => {
    const store = fakeStore()
    store.getText = async () => {
      throw new Error('AccessDenied')
    }

    await expect(
      pollForObject(store, fakeClock(), 'b', 'k', {
        timeoutMs: 5_000,
        intervalMs: 1_000,
      }),
    ).rejects.toThrow(/AccessDenied/)
  })

  // The task reaper is suppressed for judge runs, so this timeout is the only
  // thing between a silently dead Fargate task and a sweep that never ends.
  it('gives up at the deadline', async () => {
    const store = fakeStore()

    const outcome = await pollForObject(store, fakeClock(), 'b', 'k', {
      timeoutMs: 5_000,
      intervalMs: 1_000,
    })

    expect(outcome).toEqual({ kind: 'timedOut', waitedMs: 5_000 })
    expect(store.gets).toHaveLength(6)
  })
})

// --- trace ------------------------------------------------------------------

describe('parseTrace', () => {
  it('turns the harness dialect into trace steps and counts', () => {
    const summary = parseTrace(TRACE)

    expect(summary.trace).toEqual([
      { index: 0, kind: 'text' },
      { index: 1, kind: 'tool', tool: 'Bash' },
    ])
    expect(summary.toolCalls).toBe(1)
    expect(summary.toolErrors).toBe(0)
    expect(summary.traceCostUsd).toBe(3.25)
  })

  // The harness batches tool calls in one assistant message and results arrive
  // in call order, so the pairing is FIFO. A backward scan for the most recent
  // unfailed step marks the SECOND call here, and every attribution after that
  // is wrong too.
  it('pairs batched results with their calls in order', () => {
    const summary = parseTrace(
      [
        '{"type":"assistant","message":{"content":[' +
          '{"type":"tool_use","name":"Bash","input":{}},' +
          '{"type":"tool_use","name":"Read","input":{}}]}}',
        '{"type":"tool_result","is_error":true}',
        '{"type":"tool_result","is_error":false}',
      ].join('\n'),
    )

    expect(summary.toolErrors).toBe(1)
    expect(summary.trace[0]).toMatchObject({ tool: 'Bash' })
    expect(summary.trace[0]?.error).toBeDefined()
    expect(summary.trace[1]).toMatchObject({ tool: 'Read' })
    expect(summary.trace[1]?.error).toBeUndefined()
  })

  // The realistic dialect: the SDK reads `is_error` with `.get()`, so a
  // SUCCESSFUL tool result carries `"is_error": null` rather than false. A
  // schema that rejected null would drop that line, the success would never
  // shift the queue, and the next genuine failure would be pinned to the call
  // that actually succeeded.
  it('lets a null-flagged success consume its own call', () => {
    const summary = parseTrace(
      [
        '{"type":"assistant","message":{"content":[' +
          '{"type":"tool_use","name":"Bash","input":{}}]}}',
        '{"type":"tool_result","content":"ok","is_error":null}',
        '{"type":"assistant","message":{"content":[' +
          '{"type":"tool_use","name":"Read","input":{}}]}}',
        '{"type":"tool_result","content":"boom","is_error":true}',
      ].join('\n'),
    )

    expect(summary.toolCalls).toBe(2)
    expect(summary.toolErrors).toBe(1)
    expect(summary.trace[0]).toMatchObject({ tool: 'Bash' })
    expect(summary.trace[0]?.error).toBeUndefined()
    expect(summary.trace[1]).toMatchObject({ tool: 'Read' })
    expect(summary.trace[1]?.error).toBeDefined()
  })

  it('marks the failing tool step, not a later one', () => {
    const summary = parseTrace(
      [
        '{"type":"assistant","message":{"content":[' +
          '{"type":"tool_use","name":"Bash","input":{}}]}}',
        '{"type":"tool_result","is_error":true}',
        '{"type":"assistant","message":{"content":[' +
          '{"type":"tool_use","name":"Read","input":{}}]}}',
        '{"type":"tool_result","is_error":false}',
      ].join('\n'),
    )

    expect(summary.toolErrors).toBe(1)
    expect(summary.trace[0]?.tool).toBe('Bash')
    expect(summary.trace[0]?.error).toBeDefined()
    expect(summary.trace[1]?.error).toBeUndefined()
  })

  // The record schema refuses toolErrors > toolCalls, and a truncated write can
  // leave a failed result with no preceding call. Clamping keeps a salvageable
  // run out of the bin.
  it('never reports more tool errors than tool calls', () => {
    const summary = parseTrace('{"type":"tool_result","is_error":true}')
    const shape = validRecordShape()

    expect(summary.toolErrors).toBe(0)
    expect(summary.toolCalls).toBe(0)
    expect(
      RunRecordSchema.safeParse({
        ...shape,
        telemetry: {
          ...shape.telemetry,
          toolCalls: summary.toolCalls,
          toolErrors: summary.toolErrors,
        },
      }).success,
    ).toBe(true)
  })

  // The harness logs `json.dumps(record, default=str)` over values that are
  // `bool | None` and `dict | None`, so these lines are real. Rejecting them
  // would drop a tool call and shift every later error's attribution.
  it('tolerates the nulls the harness actually writes', () => {
    const summary = parseTrace(
      [
        '{"type":"assistant","message":{"content":[' +
          '{"type":"tool_use","name":"Bash","input":null}]}}',
        '{"type":"tool_result","content":"boom","is_error":true}',
      ].join('\n'),
    )

    expect(summary.toolCalls).toBe(1)
    expect(summary.toolErrors).toBe(1)
    expect(summary.trace[0]).toMatchObject({ tool: 'Bash' })
    expect(summary.trace[0]?.error).toBeDefined()
  })

  it('stamps liveWeb only when the turn actually searched', () => {
    const searched =
      '{"type":"assistant","message":{"content":[' +
      '{"type":"tool_use","name":"WebSearch","input":{"query":"x"}}]}}'

    expect(parseTrace(searched).liveWeb).toBe(true)
    expect(parseTrace(TRACE).liveWeb).toBe(false)
  })

  // toolQueries is meant to be the agent's SQL verbatim, so a WebSearch's
  // `query` field must never land in it.
  it('collects only structured SQL, never a search query', () => {
    const summary = parseTrace(
      [
        '{"type":"assistant","message":{"content":[' +
          '{"type":"tool_use","name":"WebSearch","input":{"query":"housing"}}]}}',
        '{"type":"assistant","message":{"content":[' +
          '{"type":"tool_use","name":"dbx","input":{"sql":"SELECT COUNT(*)"}}]}}',
      ].join('\n'),
    )

    expect(summary.toolQueries).toEqual(['SELECT COUNT(*)'])
  })

  it('reads a partial trace whose last line was cut off', () => {
    const summary = parseTrace(
      TRACE + '\n{"type":"assistant","message":{"content":[{"type":"te',
    )

    expect(summary.toolCalls).toBe(1)
    expect(summary.trace).toHaveLength(2)
  })

  // Zero today because the harness consumes the SDK's usage in-process, which
  // is why the path is kept live rather than removed.
  it('reports zero tokens when the trace carries no usage', () => {
    expect(parseTrace(TRACE).tokens).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  // Both arrays end up inside the RunRecord the base-arm cache stores and every
  // later sweep re-downloads, and the trace is whatever the agent under test
  // wrote.
  // Past the step cap a tool_use records no step, so the counts and the steps
  // stop agreeing in length. The pairing must still be FIFO across the
  // boundary: the one result belongs to the oldest unanswered call, which is
  // the first one, not the most recent.
  it('still pairs FIFO once the step cap has been hit', () => {
    const call = (name: string) =>
      '{"type":"assistant","message":{"content":[' +
      `{"type":"tool_use","name":"${name}","input":{}}]}}`
    const summary = parseTrace(
      [
        ...Array.from({ length: 5_000 }, () => call('Filler')),
        call('PastTheCap'),
        '{"type":"tool_result","is_error":true}',
      ].join('\n'),
    )

    expect(summary.trace).toHaveLength(5_000)
    expect(summary.toolCalls).toBe(5_001)
    expect(summary.toolErrors).toBe(1)
    expect(summary.trace[0]?.error).toBeDefined()
    expect(summary.trace.filter((s) => s.error !== undefined)).toHaveLength(1)
  })

  it('bounds what a chatty trace can turn into', () => {
    const many = Array.from(
      { length: 6_000 },
      () =>
        '{"type":"assistant","message":{"content":[' +
        '{"type":"tool_use","name":"dbx","input":{"sql":"' +
        'S'.repeat(30) +
        '"}}]}}',
    ).join('\n')
    const summary = parseTrace(many)

    expect(summary.toolCalls).toBe(6_000)
    expect(summary.trace.length).toBeLessThanOrEqual(5_000)
    expect(summary.toolQueries.length).toBeLessThanOrEqual(200)
    expect(summary.toolErrors).toBeLessThanOrEqual(summary.toolCalls)
  })

  it('truncates a single oversized query rather than storing it whole', () => {
    const summary = parseTrace(
      '{"type":"assistant","message":{"content":[' +
        '{"type":"tool_use","name":"dbx","input":{"sql":"' +
        'S'.repeat(30_000) +
        '"}}]}}',
    )

    expect(summary.toolQueries[0]?.length).toBe(20_000)
  })

  // The SDK hangs usage off the message, which is where the harness's own
  // _price_turn reads it, so that is where it will appear if it is ever
  // logged. A parser that only looked at the line's top level would report
  // zero tokens for every run forever and nothing would say so.
  it('sums usage from the message, where the SDK puts it', () => {
    const summary = parseTrace(
      [
        '{"type":"assistant","message":{"content":[],' +
          '"usage":{"input_tokens":100,"output_tokens":10}}}',
        '{"type":"assistant","message":{"content":[],"usage":' +
          '{"input_tokens":50,"cache_read_input_tokens":7,' +
          '"cache_creation_input_tokens":3}}}',
      ].join('\n'),
    )

    expect(summary.tokens).toEqual({
      input: 150,
      output: 10,
      cacheRead: 7,
      cacheWrite: 3,
    })
  })

  it('also accepts usage at the line top level', () => {
    expect(
      parseTrace('{"type":"assistant","usage":{"input_tokens":100}}').tokens
        .input,
    ).toBe(100)
  })
})

describe('captureCostUsd', () => {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

  it('derives from tokens when the trace has them', () => {
    const tokens = { ...zero, input: 31_213, output: 227 }

    expect(captureCostUsd(tokens, 'claude-sonnet-4-6', 99)).toEqual({
      usd: priceUsd(tokens, 'claude-sonnet-4-6'),
    })
  })

  // Today's background trace has no token counts, so deriving would print
  // $0.00 beside a verdict as if it had been measured. The harness's own figure
  // is the honest snapshot instead.
  it('falls back to the harness figure rather than reporting nothing', () => {
    expect(captureCostUsd(zero, 'claude-sonnet-4-6', 3.25)).toEqual({
      usd: 3.25,
    })
  })

  // priceUsd throws on an unlisted model, and on any cache token while the
  // listed model has no cache rate — which is the moment usage starts being
  // logged. Letting that escape would discard the whole record of a run that
  // already spent twenty minutes and a few dollars.
  it('degrades rather than discarding a run it cannot price', () => {
    expect(() => priceUsd({ ...zero, input: 1 }, 'some-new-model')).toThrow(
      UnpriceableRunError,
    )
    expect(
      captureCostUsd({ ...zero, input: 1 }, 'some-new-model', 4.5),
    ).toEqual({ usd: 4.5 })

    const cached = { ...zero, input: 10, cacheRead: 5 }
    expect(() => priceUsd(cached, 'claude-sonnet-4-6')).toThrow(
      UnpriceableRunError,
    )
    expect(captureCostUsd(cached, 'claude-sonnet-4-6', 4.5)).toEqual({
      usd: 4.5,
    })
  })
})

// --- CI provenance ----------------------------------------------------------

describe('ciContext', () => {
  it('is absent on a local run', () => {
    expect(ciContext({})).toBeUndefined()
    expect(ciContext({ GITHUB_RUN_ID: '1' })).toBeUndefined()
  })

  it('builds a followable link and defaults a missing attempt', () => {
    const ci = ciContext({
      GITHUB_REPOSITORY: 'thegoodparty/omni',
      GITHUB_RUN_ID: '36592029654',
    })

    expect(ci).toEqual({
      repo: 'thegoodparty/omni',
      workflowRunId: '36592029654',
      workflowRunAttempt: 1,
      workflowRunUrl:
        'https://github.com/thegoodparty/omni/actions/runs/36592029654',
    })
  })

  it('takes the PR number from the workflow input or a pull ref', () => {
    const shared = {
      GITHUB_REPOSITORY: 'thegoodparty/omni',
      GITHUB_RUN_ID: '1',
      GITHUB_RUN_ATTEMPT: '2',
    }

    expect(ciContext({ ...shared, JUDGE_PR_NUMBER: '2198' })?.prNumber).toBe(
      2198,
    )
    expect(
      ciContext({ ...shared, GITHUB_REF: 'refs/pull/77/merge' })?.prNumber,
    ).toBe(77)
    expect(
      ciContext({ ...shared, GITHUB_REF: 'refs/heads/main' })?.prNumber,
    ).toBeUndefined()
    expect(ciContext({ ...shared })?.workflowRunAttempt).toBe(2)
  })
})

// --- the record -------------------------------------------------------------

describe('runBackgroundCase', () => {
  it('emits a valid background record for a completed run', async () => {
    const input = runInput({ dataVersion: '3237' })
    const runId = idFor(input)
    const store = completedRun(input, runId)

    const record = await runBackgroundCase(
      deps(store, fakeQueue(), fakeClock()),
      input,
    )

    expect(RunRecordSchema.parse(record)).toEqual(record)
    expect(record.agentShape).toBe('background')
    expect(record.status).toBe('produced')
    expect(record.runId).toBe(runId)
    expect(record.input.kind).toBe('params')
    expect(record.output?.kind).toBe('artifact')
    expect(record.output?.value).toEqual(JSON.parse(ARTIFACT))
    expect(record.dataVersion).toBe('3237')
    expect(record.telemetry.cost?.pricingVersion).toBe(PRICING_VERSION)
    expect(record.telemetry.cost?.usdAtCapture).toBe(3.25)
  })

  // The digest names the bytes that ran. If the record could carry a different
  // one, a cached base arm would be keyed on content that never executed.
  it('records the digest of the bytes it staged', async () => {
    const input = runInput()
    const store = completedRun(input, idFor(input))

    const record = await runBackgroundCase(
      deps(store, fakeQueue(), fakeClock()),
      input,
    )

    expect(record.variant.configDigest).toBe(backgroundConfigDigest(config))
    expect(
      store.puts.some((p) =>
        p.key.includes(`/${record.variant.configDigest}/`),
      ),
    ).toBe(true)
  })

  // Staging is an S3 write, so a dispatch the Lambda would reject must fail
  // before it leaves bytes behind.
  it('writes nothing when a precondition would fail at the Lambda', async () => {
    const store = fakeStore()
    const queue = fakeQueue()

    await expect(
      runBackgroundCase(
        deps(store, queue, fakeClock()),
        runInput({ organizationSlug: 'city-of-spokane' }),
      ),
    ).rejects.toThrow(/organization slug/)

    expect(store.puts).toHaveLength(0)
    expect(queue.sent).toHaveLength(0)
  })

  it('records a timeout as an infra failure with no output', async () => {
    const record = await runBackgroundCase(
      deps(fakeStore(), fakeQueue(), fakeClock()),
      runInput(),
    )

    expect(record.status).toBe('infraError')
    expect(record.output).toBeNull()
    expect(record.trace).toContainEqual({
      index: expect.any(Number),
      kind: 'error',
      error: expect.stringContaining('poll timed out'),
    })
    expect(record.telemetry.latencyMs).toBe(5_000)
  })

  // The harness uploads logs on its kill paths too, so a dead run usually left
  // a partial trace — and a timeout with its tool calls visible is worth far
  // more than one without.
  it('keeps the partial trace of a run that timed out', async () => {
    const input = runInput()
    const store = fakeStore({
      [path(ARTIFACT_BUCKET, traceKey(input.agentId, idFor(input)))]: TRACE,
    })

    const record = await runBackgroundCase(
      deps(store, fakeQueue(), fakeClock()),
      input,
    )

    expect(record.status).toBe('infraError')
    expect(record.telemetry.toolCalls).toBe(1)
    expect(record.trace.map((s) => s.kind)).toEqual(['text', 'tool', 'error'])
  })

  // Quietly substituting an empty trace would report zero tool errors, which
  // makes isComparable() true, which lets the base arm be CACHED — a permanent
  // baseline for a run whose every data read may have failed, with no evidence
  // of it. An unmeasurable run is an infrastructure result instead.
  it('refuses to measure a run whose trace is over the cap', async () => {
    const input = baseInput()
    const runId = idFor(input)
    const huge = '{"type":"assistant","message":{"content":[]}}\n'.repeat(
      500_000,
    )
    expect(traceTooLarge(huge)).toBe(true)
    const store = fakeStore({
      [path(ARTIFACT_BUCKET, artifactKey(AGENT, runId))]: ARTIFACT,
      [path(ARTIFACT_BUCKET, traceKey(AGENT, runId))]: huge,
    })

    const result = await runBackgroundBaseArm(
      deps(store, fakeQueue(), fakeClock()),
      input,
      METADATA_BUCKET,
    )

    expect(result.record.status).toBe('infraError')
    expect(result.record.output).toBeNull()
    expect(result.record.trace).toContainEqual({
      index: expect.any(Number),
      kind: 'error',
      error: expect.stringContaining('cannot be measured'),
    })
    expect(result.cache).toBe('notCached')
    expect(store.puts.some((p) => p.key.includes('/base/'))).toBe(false)
  })

  it('treats an unreadable artifact as an infra failure', async () => {
    const input = runInput()
    const store = fakeStore({
      [path(ARTIFACT_BUCKET, artifactKey(input.agentId, idFor(input)))]:
        'not json',
    })

    const record = await runBackgroundCase(
      deps(store, fakeQueue(), fakeClock()),
      input,
    )

    expect(record.status).toBe('infraError')
    expect(record.output).toBeNull()
  })
})

// --- the cached base arm ----------------------------------------------------

const baseInput = (overrides: Partial<BackgroundRunInput> = {}) =>
  runInput({
    arm: 'base',
    variant: {
      ref: 'universal-judge',
      commit: 'a'.repeat(40),
      model: 'claude-sonnet-4-6',
    },
    ...overrides,
  })

describe('baseArmCacheKey', () => {
  it('sits inside the digest folder the override layout owns', () => {
    expect(baseArmCacheKey(AGENT, 'abc123', 'brief-2025-11-04')).toBe(
      `_judge/${AGENT}/abc123/base/brief-2025-11-04.json`,
    )
  })

  // The dispatch handler mints a ticket allowlisting exactly the two keys it is
  // handed. A cache key that could validate as an override would let a sweep
  // hand the broker a record file as an agent's manifest.
  it('can never be mistaken for an override key', () => {
    const key = baseArmCacheKey(AGENT, 'abc123', 'c1')

    expect(
      JudgeOverrideSchema.safeParse({
        manifest_key: key,
        instruction_key: key,
      }).success,
    ).toBe(false)
  })

  it('refuses a caseId that could escape its folder', () => {
    expect(() => baseArmCacheKey(AGENT, 'abc123', '../../etc')).toThrow(
      /unsafe caseId/,
    )
  })
})

describe('runBackgroundBaseArm', () => {
  it('runs and caches on a miss', async () => {
    const input = baseInput()
    const store = completedRun(input, idFor(input))
    const queue = fakeQueue()

    const result = await runBackgroundBaseArm(
      deps(store, queue, fakeClock()),
      input,
      METADATA_BUCKET,
    )

    expect(result.cache).toBe('miss')
    expect(queue.sent).toHaveLength(1)
    expect(store.puts.map((p) => p.key)).toContain(
      baseArmCacheKey(
        AGENT,
        backgroundConfigDigest(config),
        input.agentCase.caseId,
      ),
    )
    expect(result.capturedAt).toBe(result.record.startedAt)
  })

  // A background run is a few dollars and 15 to 20 minutes. Re-running base
  // every sweep doubles the bill on the most expensive agents we have, so the
  // hit must not dispatch at all.
  it('spends nothing on a hit and hands back the record unchanged', async () => {
    const input = baseInput()
    const first = completedRun(input, idFor(input))
    const captured = await runBackgroundBaseArm(
      deps(first, fakeQueue(), fakeClock()),
      input,
      METADATA_BUCKET,
    )

    const store = fakeStore(Object.fromEntries(first.objects))
    const queue = fakeQueue()
    const result = await runBackgroundBaseArm(
      deps(store, queue, fakeClock('2026-03-01T00:00:00.000Z')),
      baseInput({ sweepId: 'swp2' }),
      METADATA_BUCKET,
    )

    expect(result.cache).toBe('hit')
    expect(queue.sent).toHaveLength(0)
    expect(result.record).toEqual(captured.record)
    // The cached record keeps its original sweep and timestamps: rewriting
    // them to the current sweep would erase exactly the evidence the report's
    // staleness stamp is computed from.
    expect(result.record.sweepId).toBe('swp1')
    expect(result.capturedAt).toBe(captured.record.startedAt)
  })

  it('re-captures once the base config digest moves', async () => {
    const input = baseInput()
    const store = completedRun(input, idFor(input))
    await runBackgroundBaseArm(
      deps(store, fakeQueue(), fakeClock()),
      input,
      METADATA_BUCKET,
    )

    const moved = baseInput({
      config: { ...config, instruction: '# Brief it better\n' },
    })
    store.objects.set(
      path(ARTIFACT_BUCKET, artifactKey(AGENT, idFor(moved))),
      ARTIFACT,
    )
    const queue = fakeQueue()
    const result = await runBackgroundBaseArm(
      deps(store, queue, fakeClock()),
      moved,
      METADATA_BUCKET,
    )

    expect(result.cache).toBe('miss')
    expect(queue.sent).toHaveLength(1)
  })

  // A cached timeout would become a permanent baseline: every later sweep would
  // reuse a run that produced nothing, and the delta would be junk forever with
  // nothing to notice it.
  it('refuses to cache a run that cannot be compared', async () => {
    const input = baseInput()
    const store = fakeStore()

    const result = await runBackgroundBaseArm(
      deps(store, fakeQueue(), fakeClock()),
      input,
      METADATA_BUCKET,
    )

    expect(result.record.status).toBe('infraError')
    expect(result.cache).toBe('notCached')
    expect(store.puts.map((p) => p.key)).not.toContain(
      baseArmCacheKey(
        AGENT,
        backgroundConfigDigest(config),
        input.agentCase.caseId,
      ),
    )
  })

  it('refuses to cache a base arm whose tools failed', async () => {
    const input = baseInput()
    const runId = idFor(input)
    const store = fakeStore({
      [path(ARTIFACT_BUCKET, artifactKey(AGENT, runId))]: ARTIFACT,
      [path(ARTIFACT_BUCKET, traceKey(AGENT, runId))]: [
        '{"type":"assistant","message":{"content":[' +
          '{"type":"tool_use","name":"Bash","input":{}}]}}',
        '{"type":"tool_result","is_error":true}',
      ].join('\n'),
    })

    const result = await runBackgroundBaseArm(
      deps(store, fakeQueue(), fakeClock()),
      input,
      METADATA_BUCKET,
    )

    expect(result.record.status).toBe('produced')
    expect(result.record.telemetry.toolErrors).toBe(1)
    expect(result.cache).toBe('notCached')
  })

  it('treats a cache entry that no longer fits the contract as a miss', async () => {
    const input = baseInput()
    const digest = backgroundConfigDigest(config)
    const store = completedRun(input, idFor(input))
    store.objects.set(
      path(
        METADATA_BUCKET,
        baseArmCacheKey(AGENT, digest, input.agentCase.caseId),
      ),
      JSON.stringify({ capturedAt: 'not-a-date', record: {} }),
    )

    expect(
      await readCachedBaseArm(
        store,
        METADATA_BUCKET,
        AGENT,
        digest,
        input.agentCase.caseId,
      ),
    ).toEqual({ kind: 'miss', reason: 'schemaSkew' })

    const queue = fakeQueue()
    const result = await runBackgroundBaseArm(
      deps(store, queue, fakeClock()),
      input,
      METADATA_BUCKET,
    )

    expect(result.cache).toBe('miss')
    expect(queue.sent).toHaveLength(1)
  })

  // The key path asserts which agent, digest and case an entry is for; the
  // record inside only claims to. A schema-valid entry whose record disagrees
  // would otherwise become a baseline every later sweep reuses.
  it('refuses a cache entry whose record does not match its key', async () => {
    const input = baseInput()
    const digest = backgroundConfigDigest(config)
    const key = baseArmCacheKey(AGENT, digest, input.agentCase.caseId)
    const store = completedRun(input, idFor(input))

    const planted = (record: RunRecord) =>
      JSON.stringify({
        schemaVersion: CACHED_BASE_ARM_SCHEMA_VERSION,
        capturedAt: record.startedAt,
        record,
      })
    const honest: RunRecord = {
      ...validRecordShape(),
      caseId: input.agentCase.caseId,
      variant: { ...validRecordShape().variant, configDigest: digest },
    }
    const read = () =>
      readCachedBaseArm(
        store,
        METADATA_BUCKET,
        AGENT,
        digest,
        input.agentCase.caseId,
      )

    store.objects.set(path(METADATA_BUCKET, key), planted(honest))
    expect((await read()).kind).toBe('entry')

    for (const wrong of [
      { ...honest, agentId: 'top_community_issues' },
      { ...honest, caseId: 'some-other-case' },
      { ...honest, arm: 'candidate' as const },
      {
        ...honest,
        variant: { ...honest.variant, configDigest: 'a-different-digest' },
      },
      {
        ...honest,
        telemetry: { ...honest.telemetry, toolCalls: 1, toolErrors: 1 },
      },
    ]) {
      store.objects.set(path(METADATA_BUCKET, key), planted(wrong))
      expect(await read()).toEqual({ kind: 'miss', reason: 'keyMismatch' })
    }

    const queue = fakeQueue()
    const result = await runBackgroundBaseArm(
      deps(store, queue, fakeClock()),
      input,
      METADATA_BUCKET,
    )

    expect(result.cache).toBe('miss')
    expect(queue.sent).toHaveLength(1)
  })

  it('refuses to run the candidate arm through the base-arm cache', async () => {
    await expect(
      runBackgroundBaseArm(
        deps(fakeStore(), fakeQueue(), fakeClock()),
        runInput(),
        METADATA_BUCKET,
      ),
    ).rejects.toThrow(/only for the base arm/)
  })
})

// --- the cross-language run-id contract --------------------------------------
//
// This module once declared its own `JUDGE_RUN_ID_PREFIX = 'judge-'` while the
// consumer read `_judge-`, which turned off every safety the prefix gates:
// the dispatch was refused, each refusal posted to gp-api's results queue, the
// ticket lost `is_eval`, and a judge base arm of a write-action experiment was
// no longer refused at all — so it would have made real product writes on a
// real organization with every surfacing signal suppressed.
//
// The TypeScript half now lives in @goodparty_org/contracts, but contracts
// cannot be imported by Python, so the equality is asserted against the Python
// SOURCE TEXT. A drifted constant then fails in CI rather than at a refused
// dispatch twenty minutes into a sweep.
describe('the judge run-id contract shared with the dispatch Lambda', () => {
  const loaderPath = join(
    __dirname,
    '../../../../../../gp-ai/pmf_engine/control_plane/manifest_loader.py',
  )

  // Extracted with a required match, never an optional one: a rename on the
  // Python side must fail this test loudly rather than make it vacuous.
  const literalFrom = (source: string, name: string, pattern: string) => {
    const found = new RegExp(`^${name} = (${pattern})$`, 'm').exec(source)
    if (!found?.[1]) {
      throw new Error(
        `could not find ${name} in ${loaderPath}. It is half of a ` +
          'cross-language contract; if it was renamed or moved, update this ' +
          'guard in the same change rather than deleting it',
      )
    }
    return found[1]
  }

  it('agrees with the consumer on the prefix and the length cap', () => {
    const source = readFileSync(loaderPath, 'utf8')

    expect(literalFrom(source, 'JUDGE_RUN_ID_PREFIX', '"[^"]*"')).toBe(
      `"${JUDGE_RUN_ID_PREFIX}"`,
    )
    expect(literalFrom(source, 'JUDGE_RUN_ID_MAX_LENGTH', '\\d+')).toBe(
      String(JUDGE_RUN_ID_MAX_LENGTH),
    )
  })

  it('fails loudly rather than vacuously when a literal is renamed', () => {
    expect(() =>
      literalFrom(
        'JUDGE_RUN_ID_RENAMED = "_judge-"\n',
        'JUDGE_RUN_ID_PREFIX',
        '"[^"]*"',
      ),
    ).toThrow(/could not find JUDGE_RUN_ID_PREFIX/)
  })

  // The consumer fullmatches the WHOLE id, so the 29 characters the cap leaves
  // after the prefix is a ceiling this side has to fit, not a suggestion.
  it('mints ids the consumer accepts, at the tightest fit there is', () => {
    const consumer = new RegExp(
      `^${JUDGE_RUN_ID_PREFIX}[A-Za-z0-9_-]{1,` +
        `${JUDGE_RUN_ID_MAX_LENGTH - JUDGE_RUN_ID_PREFIX.length}}$`,
    )

    for (const p of [
      { sweepId: 's1', caseId: 'c1', arm: 'candidate' as Arm, attempt: 1 },
      {
        sweepId: 'sweep-2026-09-30-a',
        caseId: 'brief-2025-11-04-long-case-name',
        arm: 'candidate' as Arm,
        attempt: 12,
      },
      { sweepId: 'swp1', caseId: 'c1', arm: 'base' as Arm, attempt: 1 },
    ]) {
      const runId = judgeRunId(p)
      expect(runId).toMatch(consumer)
      expect(runId.length).toBeLessThanOrEqual(JUDGE_RUN_ID_MAX_LENGTH)
    }
  })
})

// --- the staged manifest the consumer will accept ----------------------------
//
// `_judge_override_behavior` takes only {model, max_turns, timeout_seconds,
// output_schema, runtime} and requires the first three. A refusal there is
// invisible: both arms stage, both dispatch, neither calls back, and the sweep
// records `infraError: poll timed out` — the symptom, never the cause. So this
// module refuses the same manifests the Lambda would, before it writes.
describe('stageAgentConfig manifest validation', () => {
  const stage = (manifest: string, store = fakeStore()) =>
    stageAgentConfig(store, METADATA_BUCKET, AGENT, {
      manifest,
      instruction: '# x\n',
    })

  // The most natural mistake there is: passing the PUBLISHED manifest.json,
  // whose every extra field the consumer refuses.
  it('refuses the published manifest an orchestrator would reach for', async () => {
    const published = JSON.stringify({
      $schema: 'https://json-schema.org/draft-07/schema#',
      id: AGENT,
      version: 3,
      model: 'claude-sonnet-4-6',
      max_turns: 40,
      scope: { tables: ['gp.public.x'] },
      input_schema: { type: 'object' },
      output_schema: { type: 'object', properties: {} },
    })

    await expect(stage(published)).rejects.toThrow(
      /non-behavior field\(s\) \$schema, id, input_schema, scope, version/,
    )
  })

  it('refuses a manifest missing what the Fargate runner requires', async () => {
    await expect(
      stage(JSON.stringify({ model: 'claude-sonnet-4-6', max_turns: 40 })),
    ).rejects.toThrow(/missing field\(s\) output_schema/)
  })

  it('refuses a manifest that is not a JSON object at all', async () => {
    await expect(stage('not json')).rejects.toThrow(/not a JSON object/)
    await expect(stage('[]')).rejects.toThrow(/not a JSON object/)
  })

  it('refuses a staging past the consumer read caps', async () => {
    await expect(
      stage(
        JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_turns: 40,
          output_schema: { type: 'object', pad: 'p'.repeat(300_000) },
        }),
      ),
    ).rejects.toThrow(/over the consumer's read cap/)

    await expect(
      stageAgentConfig(fakeStore(), METADATA_BUCKET, AGENT, {
        manifest: MANIFEST,
        instruction: 'i'.repeat(1024 * 1024 + 1),
      }),
    ).rejects.toThrow(/instruction is \d+ bytes, over the consumer's read cap/)
  })

  // The point of checking here rather than at the Lambda: a refusal must not
  // first leave bytes in the reserved prefix for a config nothing can run.
  it('writes nothing when the manifest would be refused', async () => {
    const store = fakeStore()
    await expect(stage('{}', store)).rejects.toThrow()

    expect(store.puts).toEqual([])
  })

  it('accepts the optional fields the consumer allows', async () => {
    const store = fakeStore()
    await stage(
      JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_turns: 40,
        timeout_seconds: 1_200,
        output_schema: { type: 'object', properties: {} },
        runtime: { max_thinking_tokens: 0 },
      }),
      store,
    )

    expect(store.puts).toHaveLength(2)
  })
})

// --- the affirmative spend switch -------------------------------------------
describe('the spend switch', () => {
  const run = (spend?: string) => {
    const input = runInput({
      env: spend === undefined ? {} : { JUDGE_SPEND: spend },
    })
    const store = completedRun(input, idFor(input))
    const queue = fakeQueue()
    return {
      input,
      store,
      queue,
      go: () => runBackgroundCase(deps(store, queue, fakeClock()), input),
    }
  }

  // Only the exact string. A shell that expanded an unset variable, a `1`, a
  // `yes` and a capitalised `TRUE` all fail closed rather than spending.
  it('refuses anything but the exact string, and stages nothing', async () => {
    for (const value of [undefined, '', '1', 'yes', 'TRUE', 'True', ' true']) {
      const { store, queue, go } = run(value)

      await expect(go()).rejects.toThrow(/needs JUDGE_SPEND=true exactly/)
      expect(store.puts).toEqual([])
      expect(queue.sent).toEqual([])
    }
  })

  // A named throw rather than a synthetic record: a misconfigured sweep that
  // reported outcomes it never ran would be worse than one that did not run.
  it('never invents a record for a run it did not dispatch', async () => {
    const { go } = run('1')

    await expect(go()).rejects.toThrow(Error)
  })

  it('dispatches once the switch is on', async () => {
    const { queue, go } = run('true')

    await expect(go()).resolves.toMatchObject({ status: 'produced' })
    expect(queue.sent).toHaveLength(1)
  })
})

// --- what a run that cannot be measured must not become ----------------------
describe('runBackgroundCase telemetry integrity', () => {
  // The base-arm cache is the reason this matters. An absent trace used to
  // yield status 'produced' with toolCalls 0 and toolErrors 0, which makes
  // isComparable() true, which writes it to the cache — so a base arm whose
  // every Databricks read failed becomes the permanent baseline for that
  // digest, and the evidence was in the trace that never arrived.
  it('refuses to measure a run whose trace never arrived', async () => {
    const input = baseInput()
    const runId = idFor(input)
    const store = fakeStore({
      [path(ARTIFACT_BUCKET, artifactKey(AGENT, runId))]: ARTIFACT,
    })

    const result = await runBackgroundBaseArm(
      deps(store, fakeQueue(), fakeClock()),
      input,
      METADATA_BUCKET,
    )

    expect(result.record.status).toBe('infraError')
    expect(result.record.output).toBeNull()
    expect(result.record.trace).toContainEqual({
      index: expect.any(Number),
      kind: 'error',
      error: expect.stringContaining('no trace'),
    })
    expect(result.cache).toBe('notCached')
    expect(store.puts.some((p) => p.key.includes('/base/'))).toBe(false)
  })

  // A rejection on the trace GET is a real store error, not "not there yet":
  // getText resolves undefined for a missing key. The artifact, the output,
  // the latency and the run identity are all already in memory by then, so a
  // throttle or an expired credential on a decoration-only read must not
  // discard a completed, fully paid run.
  it('keeps a completed run whose best-effort trace read threw', async () => {
    const input = runInput()
    const runId = idFor(input)
    const traceAt = path(ARTIFACT_BUCKET, traceKey(AGENT, runId))
    const store = fakeStore(
      { [path(ARTIFACT_BUCKET, artifactKey(AGENT, runId))]: ARTIFACT },
      (key) => {
        if (key === traceAt)
          throw new Error('SlowDown: please reduce your rate')
      },
    )

    const record = await runBackgroundCase(
      deps(store, fakeQueue(), fakeClock()),
      input,
    )

    expect(record.runId).toBe(runId)
    expect(record.status).toBe('infraError')
    expect(record.trace).toContainEqual({
      index: expect.any(Number),
      kind: 'error',
      error: expect.stringContaining('SlowDown'),
    })
  })

  // Same rule as the token path, and the fourth instance of it in this
  // feature: the harness writes total_cost_usd only in its ResultMessage
  // branch, and its own timeout cancels the loop first — so the expensive
  // failure is exactly the one with no figure. usdAtCapture is required and
  // non-nullable, so the zero stays; the trace is what stops it reading as a
  // measurement.
  it('says a cost is unmeasured rather than printing it as zero', async () => {
    const input = runInput()
    const runId = idFor(input)
    const store = fakeStore({
      [path(ARTIFACT_BUCKET, artifactKey(AGENT, runId))]: ARTIFACT,
      // A real timed-out trace: turns happened, no `result` line ever landed.
      [path(ARTIFACT_BUCKET, traceKey(AGENT, runId))]:
        '{"type":"assistant","message":{"content":[{"type":"text"}]}}',
    })

    const record = await runBackgroundCase(
      deps(store, fakeQueue(), fakeClock()),
      input,
    )

    expect(record.telemetry.cost?.usdAtCapture).toBe(0)
    expect(record.trace).toContainEqual({
      index: expect.any(Number),
      kind: 'error',
      error: expect.stringContaining('cost is unmeasured'),
    })
    // Not a reason to discard the run: the agent produced an artifact and the
    // missing figure is only the bill.
    expect(record.status).toBe('produced')
  })

  it('leaves a measured cost unannotated', async () => {
    const input = runInput()
    const store = completedRun(input, idFor(input))

    const record = await runBackgroundCase(
      deps(store, fakeQueue(), fakeClock()),
      input,
    )

    expect(record.telemetry.cost?.usdAtCapture).toBe(3.25)
    expect(record.trace).not.toContainEqual(
      expect.objectContaining({
        error: expect.stringContaining('cost is unmeasured'),
      }),
    )
  })

  // The module's own rule is that every precondition is settled before
  // anything is written or sent. `variant` arrives as
  // Omit<Variant, 'configDigest'>, whose fields are all `.min(1)`, so an
  // orchestrator that resolved a base commit to '' typechecks, spends the
  // twenty minutes, and only then throws inside RunRecordSchema.parse —
  // discarding the run it just paid for.
  it('validates the record it will build before it spends', async () => {
    for (const variant of [
      { ref: '', commit: 'b'.repeat(40), model: 'claude-sonnet-4-6' },
      { ref: 'judge-track-b', commit: '', model: 'claude-sonnet-4-6' },
      { ref: 'judge-track-b', commit: 'b'.repeat(40), model: '' },
    ]) {
      const input = runInput({ variant })
      const store = completedRun(input, idFor(input))
      const queue = fakeQueue()

      await expect(
        runBackgroundCase(deps(store, queue, fakeClock()), input),
      ).rejects.toThrow()
      expect(store.puts).toEqual([])
      expect(queue.sent).toEqual([])
    }
  })
})

// --- a measurement must survive a failure to save it -------------------------
describe('runBackgroundBaseArm cache failures', () => {
  // The base arm has run to completion — twenty minutes and a few dollars —
  // and the record is in hand. An AccessDenied on `_judge/*` (a role with read
  // but not write) or a 503 on the PutObject used to throw out of here, so the
  // caller lost the base record and the paired candidate had nothing to
  // compare against.
  it('keeps the base record when caching it fails', async () => {
    const input = baseInput()
    const store = completedRun(input, idFor(input))
    const failing: ObjectStore = {
      getText: store.getText,
      putText: async (bucket, key, body) => {
        if (key.includes('/base/')) {
          throw new Error(
            'AccessDenied: not authorized to perform s3:PutObject',
          )
        }
        return store.putText(bucket, key, body)
      },
    }

    const result = await runBackgroundBaseArm(
      { store: failing, queue: fakeQueue(), clock: fakeClock() },
      input,
      METADATA_BUCKET,
    )

    expect(result.record.status).toBe('produced')
    expect(result.record.arm).toBe('base')
    // Re-captured next sweep, which is the documented cost of a miss, rather
    // than losing this sweep as well.
    expect(result.cache).toBe('notCached')
  })
})

// --- why the cache missed ----------------------------------------------------
//
// Treating a stale entry as a miss is right; discarding WHY is not. 'absent'
// is a first capture and costs one run once. 'schemaSkew' costs one run per
// case per sweep until someone changes the writer, and `cache: 'miss'` alone
// reads as the first one.
describe('cache miss reasons', () => {
  const digest = () => backgroundConfigDigest(config)
  const read = (store: FakeStore, input: BackgroundRunInput) =>
    readCachedBaseArm(
      store,
      METADATA_BUCKET,
      AGENT,
      digest(),
      input.agentCase.caseId,
    )
  const plant = (store: FakeStore, input: BackgroundRunInput, body: string) =>
    store.objects.set(
      path(
        METADATA_BUCKET,
        baseArmCacheKey(AGENT, digest(), input.agentCase.caseId),
      ),
      body,
    )

  it('tells a first capture apart from a cache nothing can read', async () => {
    const input = baseInput()
    const store = completedRun(input, idFor(input))

    expect(await read(store, input)).toEqual({
      kind: 'miss',
      reason: 'absent',
    })

    plant(store, input, '{ truncated')
    expect(await read(store, input)).toEqual({
      kind: 'miss',
      reason: 'unparseable',
    })
  })

  // CachedBaseArm leaned on RunRecordSchema's `schemaVersion: z.literal(1)`
  // and carried no version of its own, so the day that literal moves every
  // sweep would pay per case forever while reporting a first capture.
  it('names skew on an envelope from a version that no longer fits', async () => {
    const input = baseInput()
    const store = completedRun(input, idFor(input))
    const record: RunRecord = {
      ...validRecordShape(),
      caseId: input.agentCase.caseId,
      variant: { ...validRecordShape().variant, configDigest: digest() },
    }

    plant(
      store,
      input,
      JSON.stringify({
        schemaVersion: CACHED_BASE_ARM_SCHEMA_VERSION + 1,
        capturedAt: record.startedAt,
        record,
      }),
    )
    expect(await read(store, input)).toEqual({
      kind: 'miss',
      reason: 'schemaSkew',
    })

    plant(
      store,
      input,
      JSON.stringify({
        schemaVersion: CACHED_BASE_ARM_SCHEMA_VERSION,
        capturedAt: record.startedAt,
        record,
      }),
    )
    expect(await read(store, input)).toEqual({
      kind: 'entry',
      entry: expect.objectContaining({
        schemaVersion: CACHED_BASE_ARM_SCHEMA_VERSION,
      }),
    })
  })

  it('reports the reason beside the run it had to re-capture', async () => {
    const input = baseInput()
    const store = completedRun(input, idFor(input))
    plant(store, input, '{ truncated')

    const result = await runBackgroundBaseArm(
      deps(store, fakeQueue(), fakeClock()),
      input,
      METADATA_BUCKET,
    )

    expect(result.cache).toBe('miss')
    expect(result.cacheMissReason).toBe('unparseable')
  })

  it('writes an entry a later sweep can actually read back', async () => {
    const input = baseInput()
    const store = completedRun(input, idFor(input))

    await runBackgroundBaseArm(
      deps(store, fakeQueue(), fakeClock()),
      input,
      METADATA_BUCKET,
    )

    expect(await read(store, input)).toMatchObject({ kind: 'entry' })
  })
})

// --- a cache we could not read is not a cache that was empty -----------------
//
// The third instance of one class of bug: an unguarded store call whose
// rejection destroys work that is already paid for, or aborts a case before it
// needed to. The trace read and the cache write were guarded last round; this
// GET was not, so a `SlowDown` on the cache bucket threw a case away before a
// single run was dispatched.
//
// It is reported apart from the four miss reasons on purpose. A miss describes
// the cache's contents; this describes our own read, and calling it 'absent'
// would print "no entry, capture one" when nothing is known either way.
describe('an unreadable base-arm cache', () => {
  const digest = () => backgroundConfigDigest(config)

  // The whole cache lives in METADATA_BUCKET, so failing only that bucket's
  // gets leaves the artifact and trace reads working — which is what a
  // transient per-object error actually looks like.
  const cacheUnreadable = (
    input: BackgroundRunInput,
    message = 'SlowDown: please reduce your rate',
  ) => {
    const store = completedRun(input, idFor(input))
    const cacheAt = path(
      METADATA_BUCKET,
      baseArmCacheKey(AGENT, digest(), input.agentCase.caseId),
    )
    const inner = store.getText
    store.getText = async (bucket, key) => {
      if (path(bucket, key) === cacheAt) throw new Error(message)
      return inner(bucket, key)
    }
    return store
  }

  it('reports the read failure instead of rejecting', async () => {
    const input = baseInput()

    const result = await readCachedBaseArm(
      cacheUnreadable(input),
      METADATA_BUCKET,
      AGENT,
      digest(),
      input.agentCase.caseId,
    )

    expect(result).toEqual({
      kind: 'unreadable',
      error: expect.stringContaining('SlowDown'),
    })
  })

  // Spending here is defensible — the entry may not exist, and staging writes
  // to this same bucket next, so a genuinely broken bucket still aborts with
  // nothing spent. Reporting it as a miss is not.
  it('captures the base arm rather than abandoning the case', async () => {
    const input = baseInput()
    const store = cacheUnreadable(input)
    const queue = fakeQueue()

    const result = await runBackgroundBaseArm(
      deps(store, queue, fakeClock()),
      input,
      METADATA_BUCKET,
    )

    expect(result.record.status).toBe('produced')
    expect(result.record.arm).toBe('base')
    expect(queue.sent).toHaveLength(1)
    // Stored, so the next sweep is a hit rather than another ~$13.
    expect(store.puts.map((p) => p.key)).toContain(
      baseArmCacheKey(AGENT, digest(), input.agentCase.caseId),
    )
  })

  it('never calls an unreadable cache a miss', async () => {
    const input = baseInput()

    const result = await runBackgroundBaseArm(
      deps(cacheUnreadable(input), fakeQueue(), fakeClock()),
      input,
      METADATA_BUCKET,
    )

    expect(result.cache).toBe('unknown')
    expect(result.cacheReadError).toContain('SlowDown')
    // 'absent' would read as a first capture, which is a claim about the
    // cache that a failed read does not support.
    expect(result.cacheMissReason).toBeUndefined()
  })

  // The guard is around the GET alone. baseArmCacheKey throws on a caseId that
  // could escape the reserved prefix, and that is a refusal to be honoured,
  // not a store error to be recovered from.
  it('still refuses an unsafe case id outright', async () => {
    await expect(
      readCachedBaseArm(fakeStore(), METADATA_BUCKET, AGENT, digest(), 'a/b'),
    ).rejects.toThrow(/unsafe caseId/)
  })
})

// --- the pre-dispatch placeholder guard -------------------------------------
//
// The sweep-wide check in substituteBackgroundCases is what a sweep is meant
// to hit. This asserts the backstop: a caller that skipped it cannot get a
// literal token past the runner.
//
// The refusal has to happen before the first write and the first send,
// because the Lambda would NOT refuse it. `organization_slug` is a plain
// string with `minLength: 1` in every manifest that declares it, so
// `{judgeOrgSlug}` validates, the task launches, and the sweep pays for two
// arms run against an organization that does not exist.
describe('an unsubstituted placeholder in a case', () => {
  const withPlaceholder = () =>
    runInput({
      agentCase: {
        caseId: 'baseline-city-council',
        params: { organization_slug: '{judgeOrgSlug}', state: 'MN' },
      },
    })

  it('is refused by buildDispatchMessage', () => {
    const input = withPlaceholder()
    expect(() =>
      buildDispatchMessage({
        runId: idFor(input),
        agentId: input.agentId,
        organizationSlug: input.organizationSlug,
        agentCase: input.agentCase,
        override: JudgeOverrideSchema.parse({
          manifest_key: '_judge/x/d/manifest.json',
          instruction_key: '_judge/x/d/instruction.md',
        }),
      }),
    ).toThrow(UnsubstitutedPlaceholderError)
  })

  it('stages nothing and sends nothing', async () => {
    const store = fakeStore()
    const queue = fakeQueue()
    await expect(
      runBackgroundCase(deps(store, queue, fakeClock()), withPlaceholder()),
    ).rejects.toThrow(UnsubstitutedPlaceholderError)
    expect(store.puts).toEqual([])
    expect(queue.sent).toEqual([])
  })

  it('is not refused once the sweep has substituted it', async () => {
    const input = withPlaceholder()
    const substituted = substituteBackgroundCases([input.agentCase], {
      orgSlug: 'eo-0192e4a0-1f00-7000-8000-0000000c0de1',
    })
    const ready = runInput({ agentCase: substituted[0] })
    const store = completedRun(ready, idFor(ready))
    const record = await runBackgroundCase(
      deps(store, fakeQueue(), fakeClock()),
      ready,
    )
    expect(record.status).toBe('produced')
  })
})
