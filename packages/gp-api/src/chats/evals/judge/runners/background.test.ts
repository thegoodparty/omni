import { JudgeOverrideSchema } from '@goodparty_org/contracts'
import { describe, expect, it } from 'vitest'
import { PRICING_VERSION, priceUsd, UnpriceableRunError } from '../pricing'
import { RunRecordSchema, type Arm, type RunRecord } from '../record'
import {
  artifactKey,
  backgroundConfigDigest,
  baseArmCacheKey,
  buildDispatchMessage,
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

const config: AgentConfig = {
  manifest: '{"model":"claude-sonnet-4-6","max_turns":40}',
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
  // No CI: an explicit empty env keeps a record's shape from depending on
  // whether the suite happens to be running inside Actions.
  env: {},
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
  runId: 'judge-swp1-c1-base-1',
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
        manifest: '{}',
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

    expect(runId).toBe('judge-s1-c1-candidate-1')
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

    expect(captureCostUsd(tokens, 'claude-sonnet-4-6', 99)).toBe(
      priceUsd(tokens, 'claude-sonnet-4-6'),
    )
  })

  // Today's background trace has no token counts, so deriving would print
  // $0.00 beside a verdict as if it had been measured. The harness's own figure
  // is the honest snapshot instead.
  it('falls back to the harness figure rather than reporting nothing', () => {
    expect(captureCostUsd(zero, 'claude-sonnet-4-6', 3.25)).toBe(3.25)
    expect(captureCostUsd(zero, 'claude-sonnet-4-6', undefined)).toBe(0)
  })

  // priceUsd throws on an unlisted model, and on any cache token while the
  // listed model has no cache rate — which is the moment usage starts being
  // logged. Letting that escape would discard the whole record of a run that
  // already spent twenty minutes and a few dollars.
  it('degrades rather than discarding a run it cannot price', () => {
    expect(() => priceUsd({ ...zero, input: 1 }, 'some-new-model')).toThrow(
      UnpriceableRunError,
    )
    expect(captureCostUsd({ ...zero, input: 1 }, 'some-new-model', 4.5)).toBe(
      4.5,
    )

    const cached = { ...zero, input: 10, cacheRead: 5 }
    expect(() => priceUsd(cached, 'claude-sonnet-4-6')).toThrow(
      UnpriceableRunError,
    )
    expect(captureCostUsd(cached, 'claude-sonnet-4-6', 4.5)).toBe(4.5)
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
    expect(record.telemetry.cost.pricingVersion).toBe(PRICING_VERSION)
    expect(record.telemetry.cost.usdAtCapture).toBe(3.25)
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
    expect(record.trace.at(-1)).toMatchObject({
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
    expect(result.record.trace.at(-1)).toMatchObject({
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
    ).toBeUndefined()

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
      JSON.stringify({ capturedAt: record.startedAt, record })
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
    expect(await read()).toBeDefined()

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
      expect(await read()).toBeUndefined()
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
