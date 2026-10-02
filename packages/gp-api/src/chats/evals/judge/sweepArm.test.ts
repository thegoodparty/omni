import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEntry } from './agents'
import { ARM_KEY_ENV } from './modelKey'
import type { CaseList } from './cases'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import { CHAT_PAIR } from './fixtures/records'
import type { RunRecord } from './record'
import { createLocalRecordStore, recordKey, type RecordStore } from './records'
import {
  ArmCaptureError,
  captureArm,
  scrubReason,
  unjudgeableRecords,
  type ArmCaseRequest,
  type CaptureArmDeps,
} from './sweepArm'
import { parseArmEnv, type ArmEnv } from './sweepEnv'

// The arm walker against a fake runner and a local store. No Postgres, no
// model, no S3 — which is the point of the injected seam: everything that can
// be wrong about walking a case list is wrong here, cheaply.

const [BASE] = CHAT_PAIR
const SHA = 'a'.repeat(40)

const COS: AgentEntry = {
  agentId: 'chief_of_staff',
  shape: 'chat',
  cases: 'chief_of_staff.json',
  status: 'pending',
}

const BACKGROUND: AgentEntry = {
  agentId: 'meeting_briefing',
  shape: 'background',
  cases: 'meeting_briefing.json',
  status: 'pending',
}

const BLOCKED: AgentEntry = {
  agentId: 'briefing_annotation',
  shape: 'chat',
  cases: null,
  status: 'blocked',
  blockedReason: 'No ChatScopeHandler yet.',
}

const env = (over: Partial<ArmEnv> = {}): ArmEnv => ({
  ...parseArmEnv({
    JUDGE_ARM: 'candidate',
    JUDGE_SWEEP_ID: 'swp_1',
    JUDGE_AGENTS: 'chief_of_staff',
    JUDGE_BASE_REF: 'universal-judge',
    JUDGE_CANDIDATE_SHA: SHA,
    JUDGE_ARM_COMMIT: SHA,
    JUDGE_RECORDS_DIR: '/unused',
  }),
  ...over,
})

const caseList = (n: number, over: Partial<CaseList> = {}): CaseList => ({
  agentId: COS.agentId,
  shape: 'chat',
  placeholder: false,
  source: '/cases/chief_of_staff.json',
  cases: Array.from({ length: n }, (_, i) => ({
    caseId: `case-${i}`,
    question: `question ${i}`,
  })),
  ...over,
})

// Answers whatever it is asked, so the orchestrator's own bookkeeping is what
// is under test rather than a runner's.
const echoRunner =
  (log: ArmCaseRequest[] = []): CaptureArmDeps['runCase'] =>
  async (request) => {
    log.push(request)
    return {
      ...BASE,
      sweepId: request.sweepId,
      arm: request.arm,
      agentId: request.agent.agentId,
      caseId: request.case.caseId,
      attempt: request.attempt,
      runId: [
        request.sweepId,
        request.case.caseId,
        request.arm,
        request.attempt,
      ].join(':'),
      variant: { ...BASE.variant, ...request.variant },
    }
  }

const deps = async (
  over: Partial<CaptureArmDeps> = {},
): Promise<CaptureArmDeps & { store: RecordStore }> => ({
  store: createLocalRecordStore(
    await mkdtemp(path.join(tmpdir(), 'judge-arm-')),
  ),
  runCase: echoRunner(),
  now: () => new Date('2026-09-29T10:00:00.000Z'),
  loadCases: () => caseList(2),
  ...over,
})

const oneAttempt: JudgeConfig = {
  ...DEFAULT_JUDGE_CONFIG,
  attemptsPerCase: 1,
}

// A skip reason reaches $GITHUB_STEP_SUMMARY, which is public because omni
// is. It is arbitrary error text from whatever failed, so a client library
// that puts a credential in an exception message would put it there too.
describe('scrubReason', () => {
  it.each([
    ['ANTHROPIC_API_KEY=sk-ant-api03-AbCdEf123456 rejected', 'sk-ant'],
    ['token dapi0123456789abcdef expired', 'dapi0'],
    ['connect postgres://user:pa55w0rd@db.internal:5432/x failed', 'pa55w0rd'],
  ])('redacts a secret shape in %o', (reason, leaked) => {
    expect(scrubReason(reason)).not.toContain(leaked)
  })

  it('leaves an ordinary reason alone', () => {
    const reason = 'chief_of_staff.json: cannot be read'
    expect(scrubReason(reason)).toBe(reason)
  })

  // The surrounding sentence is what makes the reason useful; redaction must
  // not eat it.
  it('keeps the rest of the sentence', () => {
    expect(scrubReason('key sk-ant-abcdefgh rejected by the provider')).toBe(
      'key [redacted key] rejected by the provider',
    )
  })

  // DATABRICKS_CLIENT_SECRET is an opaque OAuth secret with no shape to match
  // on, and it is in the arm step's environment. A shape list alone would
  // write it into the manifest file and from there into a public job summary.
  // EVERY NAME THE LIST CLAIMS TO COVER, because a reason travels through a
  // file into another process and from there into a job summary and S3 — so
  // a name missing from SECRET_VARS is a plaintext credential in a public
  // log, not a cosmetic gap. ARM_KEY_ENV is the one that matters most: on a
  // dry run the direct name still holds the stub, so redacting that alone
  // would redact the stub and leave the real value in the clear.
  it.each([
    'ANTHROPIC_API_KEY',
    ARM_KEY_ENV,
    'DATABRICKS_CLIENT_SECRET',
    'DATABRICKS_CLIENT_ID',
    'DATABASE_URL',
  ])('redacts %s by its value', (name) => {
    const value = 'Zk3rQv8pLm2wXt6bNc1yEa'
    const scrubbed = scrubReason(
      `the warehouse rejected ${value} for the judge principal`,
      { [name]: value },
    )
    expect(scrubbed).not.toContain(value)
    expect(scrubbed).toContain(`[redacted ${name}]`)
    expect(scrubbed).toContain('for the judge principal')
  })

  it('redacts every occurrence, not just the first', () => {
    const value = 'sekrit-value-0123'
    expect(
      scrubReason(`${value} is not ${value}`, { ANTHROPIC_API_KEY: value }),
    ).toBe('[redacted ANTHROPIC_API_KEY] is not [redacted ANTHROPIC_API_KEY]')
  })

  // A one-character or empty value would otherwise replace every character of
  // the sentence, which loses the reason entirely for no security gain.
  it.each([['a'], [''], ['short']])(
    'ignores a value too short to be a secret (%o)',
    (value) => {
      const reason = 'chief_of_staff.json: cannot be read'
      expect(scrubReason(reason, { DATABRICKS_CLIENT_ID: value })).toBe(reason)
    },
  )

  it('still applies the shape list after a value match', () => {
    const scrubbed = scrubReason('token dapi0123456789abcdef expired', {
      DATABASE_URL: 'postgres://nobody:nothing@db.internal:5432/x',
    })
    expect(scrubbed).toBe('token [redacted token] expired')
  })
})

// The assertion that gates the capture step, and therefore gates whether a
// paid sweep gets judged at all. A strict "no record may be an infraError"
// was right for the canned script and wrong for a live one: turn 17 of 18
// getting a 429 would fail the step, skip the judging, and bill both arms for
// nothing.
describe('unjudgeableRecords', () => {
  const ok = (runId: string): RunRecord => ({ ...BASE, runId })
  const dead = (runId: string): RunRecord => ({
    ...BASE,
    runId,
    status: 'infraError',
    output: null,
  })

  it('names every infraError under the canned script', () => {
    expect(unjudgeableRecords([ok('a'), dead('b'), ok('c')], false)).toEqual([
      'b',
    ])
  })

  it('tolerates one flaky turn under real spend', () => {
    expect(unjudgeableRecords([ok('a'), dead('b'), ok('c')], true)).toEqual([])
  })

  it('still names an arm that produced nothing judgeable', () => {
    expect(unjudgeableRecords([dead('a'), dead('b')], true)).toEqual(['a', 'b'])
  })

  // An arm that captured nothing is the manifest's and the skip list's
  // problem, not this one's — and `some()` over an empty list would report a
  // gap that the surrounding assertions already cover better.
  it('says nothing about an arm with no records', () => {
    expect(unjudgeableRecords([], true)).toEqual([])
    expect(unjudgeableRecords([], false)).toEqual([])
  })

  // A record that somehow carried no output is unjudgeable whatever its
  // status says, which is the pairing normalize would drop.
  it('counts a record with no output, whatever its status', () => {
    const noOutput: RunRecord = { ...BASE, runId: 'x', output: null }
    expect(unjudgeableRecords([noOutput], false)).toEqual(['x'])
  })
})

describe('captureArm', () => {
  it('drives every case at every attempt, one record each', async () => {
    const log: ArmCaseRequest[] = []
    const d = await deps({
      runCase: echoRunner(log),
      loadCases: () => caseList(3),
      config: { ...DEFAULT_JUDGE_CONFIG, attemptsPerCase: 2 },
    })
    const manifest = await captureArm(d, env(), [COS])

    expect(log).toHaveLength(6)
    expect(log.map((r) => `${r.case.caseId}:${r.attempt}`)).toEqual([
      'case-0:1',
      'case-0:2',
      'case-1:1',
      'case-1:2',
      'case-2:1',
      'case-2:2',
    ])
    expect(manifest.agents).toEqual([
      {
        agentId: 'chief_of_staff',
        // The basename, so the manifest does not carry the runner's
        // directory layout into a public summary.
        caseList: 'chief_of_staff.json',
        placeholderCases: false,
        cases: 3,
        attempts: 2,
        recordsWritten: 6,
      },
    ])
    expect(await d.store.listRecords('swp_1', 'candidate')).toHaveLength(6)
  })

  // THE SHAPE DECIDES THE ATTEMPTS, and this is the only test that can see
  // it. Every other captureArm test runs on a config whose two attempt
  // numbers are equal, so reverting captureArm to the chat number left the
  // whole suite green — the manifest's `attempts` would then claim 3 for an
  // agent walked once, which is only noticed beside a bill.
  it('gives each shape its own attempt count, and records which', async () => {
    // NON-DEFAULT numbers on both sides. Read off DEFAULT_JUDGE_CONFIG, this
    // only told the shapes apart because the defaults happen to be 3 and 1.
    const config = {
      ...DEFAULT_JUDGE_CONFIG,
      attemptsPerCase: 2,
      background: { attemptsPerCase: 5, maxInFlight: 12 },
    }
    const d = await deps({
      runCase: echoRunner([]),
      loadCases: () => caseList(1),
      config,
    })
    const manifest = await captureArm(
      d,
      env({ agentIds: ['chief_of_staff', 'meeting_briefing'] }),
      [COS, BACKGROUND],
    )
    expect(JSON.stringify(manifest.skipped)).toBe('[]')
    expect(manifest.agents.map((a) => [a.agentId, a.attempts])).toEqual([
      ['chief_of_staff', 2],
      ['meeting_briefing', 5],
    ])
  })

  it('stamps the capture window the arm gap is measured from', async () => {
    // `captureArm` reads the clock once at the start and once at the end, so
    // the first call is the window's open and every later one its close.
    const opened = new Date('2026-09-29T10:00:00.000Z')
    const closed = new Date('2026-09-29T10:40:00.000Z')
    let call = 0
    const manifest = await captureArm(
      await deps({
        now: () => (call++ === 0 ? opened : closed),
        config: oneAttempt,
      }),
      env(),
      [COS],
    )
    expect(manifest.startedAt).toBe('2026-09-29T10:00:00.000Z')
    expect(manifest.endedAt).toBe('2026-09-29T10:40:00.000Z')
  })

  it('records which arm, ref and commit produced the capture', async () => {
    const manifest = await captureArm(
      await deps({ config: oneAttempt }),
      env({ arm: 'base', armCommit: 'b'.repeat(40) }),
      [COS],
    )
    expect(manifest.arm).toBe('base')
    expect(manifest.ref).toBe('universal-judge')
    expect(manifest.commit).toBe('b'.repeat(40))
  })

  it('writes every record at the key the store layout names', async () => {
    const d = await deps({ config: oneAttempt, loadCases: () => caseList(1) })
    await captureArm(d, env(), [COS])
    const written = await d.store.listRecords('swp_1', 'candidate')
    expect(
      written.map((r) =>
        recordKey('swp_1', 'candidate', r.agentId, r.caseId, r.attempt),
      ),
    ).toEqual(['_judge/swp_1/records/candidate/chief_of_staff/case-0-1.json'])
  })

  // CAPTURED, NOT SKIPPED. `captureArm` used to drop every background agent
  // with a hardcoded reason, which meant 15 of the 19 judgeable agents could
  // never be swept whatever their case list said. The walk is shape-agnostic —
  // `walkCases` validates whatever the runner returns against the same record
  // schema either way — so the shape decides which runner drives a case and
  // nothing else.
  it('captures a background agent rather than skipping it', async () => {
    const manifest = await captureArm(
      await deps({ config: oneAttempt }),
      env({ agentIds: ['chief_of_staff', 'meeting_briefing'] }),
      [COS, BACKGROUND],
    )
    expect(manifest.agents.map((a) => a.agentId).sort()).toEqual([
      'chief_of_staff',
      'meeting_briefing',
    ])
    expect(manifest.skipped).toEqual([])
  })

  // The reason the skip existed is still a real failure mode, it just is not
  // a shape any more: a runner that cannot drive THIS agent fails that agent
  // by name and leaves the rest of the sweep usable.
  it('names the agent when its runner refuses', async () => {
    const refusing = await deps({ config: oneAttempt })
    const manifest = await captureArm(
      {
        ...refusing,
        runCase: async (request) => {
          if (request.agent.shape === 'background') {
            throw new Error('no dispatch destination configured')
          }
          return refusing.runCase(request)
        },
      },
      env({ agentIds: ['chief_of_staff', 'meeting_briefing'] }),
      [COS, BACKGROUND],
    )
    expect(manifest.agents.map((a) => a.agentId)).toEqual(['chief_of_staff'])
    expect(manifest.skipped).toEqual([
      {
        agentId: 'meeting_briefing',
        reason: expect.stringContaining('no dispatch destination configured'),
      },
    ])
  })

  it('skips a blocked agent, carrying its registry reason', async () => {
    const manifest = await captureArm(
      await deps({ config: oneAttempt }),
      env({ agentIds: ['briefing_annotation'] }),
      [BLOCKED],
    )
    expect(manifest.agents).toEqual([])
    expect(manifest.skipped).toEqual([
      { agentId: 'briefing_annotation', reason: 'No ChatScopeHandler yet.' },
    ])
  })

  // The design asks for this explicitly: one agent's runner failing leaves
  // the others usable.
  it('keeps going when one agent fails, and says which and why', async () => {
    const manifest = await captureArm(
      await deps({
        config: oneAttempt,
        loadCases: (agent) => {
          if (agent.agentId === 'priority_flow') {
            throw new Error('priority_flow.json: cannot be read')
          }
          return caseList(1)
        },
      }),
      env({ agentIds: ['priority_flow', 'chief_of_staff'] }),
      [{ ...COS, agentId: 'priority_flow', cases: 'priority_flow.json' }, COS],
    )
    expect(manifest.agents.map((a) => a.agentId)).toEqual(['chief_of_staff'])
    expect(manifest.skipped).toEqual([
      {
        agentId: 'priority_flow',
        reason: 'priority_flow.json: cannot be read',
      },
    ])
  })

  // A capture that dies partway has left paid-for records in the store. If
  // the skip reported none, the manifest would contradict the store — and the
  // manifest is what the judging entry trusts. Found by running the suite for
  // real: the third case threw and the manifest claimed zero records while
  // one was on disk.
  it('says how many records a failed agent had already written', async () => {
    let calls = 0
    const d = await deps({
      config: oneAttempt,
      loadCases: () => caseList(3),
      runCase: async (request) => {
        calls += 1
        if (calls === 3) throw new Error('the seed collided')
        return echoRunner()(request)
      },
    })
    const manifest = await captureArm(d, env(), [COS])

    expect(manifest.agents).toEqual([])
    expect(manifest.skipped[0]?.reason).toContain('the seed collided')
    expect(manifest.skipped[0]?.reason).toContain(
      'had written 2 record(s) before it failed',
    )
    // And the count is true: two records really are there.
    expect(await d.store.listRecords('swp_1', 'candidate')).toHaveLength(2)
  })

  // Fatal, not skipped. The trigger validates ids against the registry, so an
  // unknown id reaching a process about to spend means the two disagree about
  // what an agent is — and sweeping the rest would bill a narrower run than
  // the plan priced.
  it('refuses an agent id that is not in the registry', async () => {
    await expect(
      captureArm(await deps(), env({ agentIds: ['not_an_agent'] }), [COS]),
    ).rejects.toThrow(/not agents in the registry: not_an_agent/)
    // ArmCaptureError specifically, because that is what aborts the arm
    // rather than skipping the agent: the trigger and the registry
    // disagreeing about what an agent is cannot be swept around.
    await expect(
      captureArm(await deps(), env({ agentIds: ['not_an_agent'] }), [COS]),
    ).rejects.toThrow(ArmCaptureError)
  })

  // A record for a different run would be written under THIS case's key,
  // silently replacing a real result with an unrelated one — and both look
  // like valid records, so nothing downstream could notice.
  it.each([
    ['caseId', { caseId: 'someone-else' }],
    ['attempt', { attempt: 9 }],
    ['agentId', { agentId: 'priority_flow' }],
    ['arm', { arm: 'base' as const }],
    ['sweepId', { sweepId: 'swp_other' }],
  ])(
    'refuses a record whose %s is not the one asked for',
    async (_n, drift) => {
      const d = await deps({
        config: oneAttempt,
        loadCases: () => caseList(1),
        runCase: async (request) => ({
          ...(await echoRunner()(request)),
          ...drift,
        }),
      })
      const manifest = await captureArm(d, env(), [COS])

      expect(manifest.agents).toEqual([])
      expect(manifest.skipped[0]?.agentId).toBe('chief_of_staff')
      expect(manifest.skipped[0]?.reason).toContain(
        'returned a record for a different run',
      )
      expect(await d.store.listRecords('swp_1', 'candidate')).toEqual([])
    },
  )

  // Two agents, because a single-agent test cannot tell "skipped this agent"
  // from "aborted the arm" — both leave one agent unreported. The mismatched
  // runner is second on purpose: an abort would throw away the first agent's
  // records AND its manifest entry after that capture had been paid for.
  it('skips the agent with the stray record, not the whole arm', async () => {
    const other: AgentEntry = {
      ...COS,
      agentId: 'priority_flow',
      cases: 'priority_flow.json',
    }
    const d = await deps({
      config: oneAttempt,
      loadCases: () => caseList(1),
      runCase: async (request) => {
        const record = await echoRunner()(request)
        return request.agent.agentId === other.agentId
          ? { ...record, caseId: 'someone-else' }
          : record
      },
    })
    const manifest = await captureArm(
      d,
      env({ agentIds: ['chief_of_staff', 'priority_flow'] }),
      [COS, other],
    )

    expect(manifest.agents.map((a) => a.agentId)).toEqual(['chief_of_staff'])
    expect(manifest.agents[0]?.recordsWritten).toBe(1)
    expect(manifest.skipped).toHaveLength(1)
    expect(manifest.skipped[0]?.agentId).toBe(other.agentId)
    expect(manifest.skipped[0]?.reason).toContain(
      'returned a record for a different run',
    )
    const written = await d.store.listRecords('swp_1', 'candidate')
    expect(written.map((r) => r.agentId)).toEqual(['chief_of_staff'])
  })

  // `runCase` is injected, so whatever satisfies the seam has to produce a
  // record the store will accept. Finding that out at write time would leave
  // a half-captured arm behind a schema error — and the reason has to be a
  // sentence, not a serialized ZodError, because it is what the report
  // prints.
  it('skips an agent whose runner produced an invalid record', async () => {
    const d = await deps({
      config: oneAttempt,
      loadCases: () => caseList(1),
      runCase: async (request) => {
        const record = await echoRunner()(request)
        // Non-null output on an infraError, which the schema forbids.
        return { ...record, status: 'infraError' } as RunRecord
      },
    })
    const manifest = await captureArm(d, env(), [COS])

    expect(manifest.agents).toEqual([])
    expect(manifest.skipped[0]?.agentId).toBe('chief_of_staff')
    expect(manifest.skipped[0]?.reason).toContain(
      'the runner produced an invalid record for case-0 attempt 1',
    )
    expect(manifest.skipped[0]?.reason).toContain('output must be null')
    // Nothing was written, so the other arm finds no half-pair to compare.
    expect(await d.store.listRecords('swp_1', 'candidate')).toEqual([])
  })

  it('carries the placeholder flag into the manifest', async () => {
    const manifest = await captureArm(
      await deps({
        config: oneAttempt,
        loadCases: () => caseList(1, { placeholder: true }),
      }),
      env(),
      [COS],
    )
    expect(manifest.agents[0]?.placeholderCases).toBe(true)
  })

  // The same road the placeholder flag travels, and for the same reason: a
  // verdict where the harness wrote half the conversation is not the same
  // claim as one where the routes wrote all of it.
  it('names the cases that seeded a prior transcript', async () => {
    const manifest = await captureArm(
      await deps({
        config: oneAttempt,
        loadCases: () => ({
          ...caseList(3),
          cases: [
            { caseId: 'plain', question: 'q0' },
            {
              caseId: 'mid-conversation',
              question: 'q1',
              priorTranscript: [{ role: 'user' as const, content: 'earlier' }],
            },
            { caseId: 'also-plain', question: 'q2' },
          ],
        }),
      }),
      env(),
      [COS],
    )
    expect(manifest.agents[0]?.seededTranscriptCases).toEqual([
      'mid-conversation',
    ])
  })

  // ABSENT, not an empty list. The field is optional so a base ref predating
  // it can still write a manifest this build parses, and "absent" has to mean
  // the same thing on both roads into it.
  it('leaves the field off a list that seeded nothing', async () => {
    const manifest = await captureArm(
      await deps({ config: oneAttempt, loadCases: () => caseList(2) }),
      env(),
      [COS],
    )
    expect(manifest.agents[0]?.seededTranscriptCases).toBeUndefined()
    expect('seededTranscriptCases' in (manifest.agents[0] ?? {})).toBe(false)
  })

  // The runner needs to know whether to call a real model, and the default has
  // to be "no".
  it('tells the runner whether the sweep is spending', async () => {
    const log: ArmCaseRequest[] = []
    await captureArm(
      await deps({
        config: oneAttempt,
        loadCases: () => caseList(1),
        runCase: echoRunner(log),
      }),
      env(),
      [COS],
    )
    expect(log[0]?.spends).toBe(false)
  })

  // And records it, because the judging step reads its own copy of
  // JUDGE_SPEND from a different workflow step and has to be able to tell
  // that the two disagree before it bills a panel on top of these captures.
  it.each([true, false])('records that it spent: %s', async (spends) => {
    const manifest = await captureArm(
      await deps({ config: oneAttempt, loadCases: () => caseList(1) }),
      env({ spends }),
      [COS],
    )
    expect(manifest.spent).toBe(spends)
  })
})

// HOW THE ARM SPENDS ITS WALL CLOCK. Admission is sized to one wave: every
// background run starts at once and the arm is done when the slowest is. An
// arm that walked them one after another would take several times what was
// admitted, and be killed with no manifest written. These hold the walk to
// the promise armBudget.ts makes on its behalf.
describe('captureArm, walking background agents', () => {
  const SECOND: AgentEntry = { ...BACKGROUND, agentId: 'self_research' }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

  // A runner that counts how many runs are out at once, per shape.
  const counting = () => {
    const inFlight = { background: 0, chat: 0 }
    const most = { background: 0, chat: 0 }
    const runCase: CaptureArmDeps['runCase'] = async (request) => {
      const shape = request.agent.shape
      inFlight[shape] += 1
      most[shape] = Math.max(most[shape], inFlight[shape])
      await tick()
      inFlight[shape] -= 1
      return echoRunner()(request)
    }
    return { runCase, most }
  }

  it('starts every run of every background agent at once', async () => {
    const { runCase, most } = counting()
    const manifest = await captureArm(
      await deps({ config: oneAttempt, runCase, loadCases: () => caseList(3) }),
      env({ agentIds: ['meeting_briefing', 'self_research'] }),
      [BACKGROUND, SECOND],
    )
    // Two agents of three cases at one attempt: six runs, all out together.
    expect(most.background).toBe(6)
    expect(manifest.agents.map((a) => a.recordsWritten)).toEqual([3, 3])
  })

  // A chat case runs inside this process against one test database, and a
  // seeded transcript belongs to one case, so chat stays one at a time.
  it('still walks chat cases one at a time', async () => {
    const { runCase, most } = counting()
    await captureArm(
      await deps({ config: oneAttempt, runCase, loadCases: () => caseList(3) }),
      env({ agentIds: ['chief_of_staff'] }),
      [COS],
    )
    expect(most.chat).toBe(1)
  })

  // THE CHAT AGENTS USE THE WAIT. A background run cannot finish until a chat
  // case has run, so an arm that waited out its background agents before
  // walking chat would never finish — the race below fails it instead.
  it('walks chat agents while background runs are still out', async () => {
    let chatRan: () => void = () => undefined
    const chatHasRun = new Promise<void>((resolve) => {
      chatRan = resolve
    })
    const runCase: CaptureArmDeps['runCase'] = async (request) => {
      if (request.agent.shape === 'background') await chatHasRun
      else chatRan()
      return echoRunner()(request)
    }
    const capture = captureArm(
      await deps({ config: oneAttempt, runCase, loadCases: () => caseList(1) }),
      env({ agentIds: ['meeting_briefing', 'chief_of_staff'] }),
      [BACKGROUND, COS],
    )
    const manifest = await Promise.race([
      capture,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('the arm waited for background')),
          1000,
        ),
      ),
    ])
    expect(manifest.agents.map((a) => a.agentId)).toEqual([
      'meeting_briefing',
      'chief_of_staff',
    ])
  })

  // ONE FAILED RUN DOES NOT ABANDON THE REST. Each is already dispatched and
  // billing, so the arm waits every one out and keeps what they wrote; the
  // skip still says how many records the agent left in the store.
  it('waits out the other runs of an agent when one fails', async () => {
    let finished = 0
    const d = await deps({
      config: oneAttempt,
      loadCases: () => caseList(3),
      runCase: async (request) => {
        if (request.case.caseId === 'case-0') throw new Error('task died')
        await tick()
        finished += 1
        return echoRunner()(request)
      },
    })
    const manifest = await captureArm(
      d,
      env({ agentIds: ['meeting_briefing'] }),
      [BACKGROUND],
    )
    expect(finished).toBe(2)
    expect(manifest.skipped[0]?.reason).toContain('task died')
    expect(manifest.skipped[0]?.reason).toContain(
      'had written 2 record(s) before it failed',
    )
    expect(await d.store.listRecords('swp_1', 'candidate')).toHaveLength(2)
  })

  // A FATAL ERROR STILL WAITS. Thrown with polls open, the process exits under
  // Fargate tasks that keep running and billing, and their records are lost.
  it('waits for in-flight background runs before an arm-fatal throw', async () => {
    let finished = 0
    const d = await deps({
      config: oneAttempt,
      loadCases: (agent) => {
        if (agent.agentId === 'chief_of_staff') {
          throw new ArmCaptureError('the store is unreachable')
        }
        return caseList(3)
      },
      runCase: async (request) => {
        await tick()
        finished += 1
        return echoRunner()(request)
      },
    })
    const outcome = await captureArm(
      d,
      env({ agentIds: ['meeting_briefing', 'chief_of_staff'] }),
      [BACKGROUND, COS],
    ).then(
      () => 'resolved',
      (err: Error) => `${err.constructor.name}: ${err.message}; ${finished}`,
    )
    expect(outcome).toBe('ArmCaptureError: the store is unreachable; 3')
  })

  // AND STARTS NOTHING AFTER IT. An agent after the fatal one would dispatch
  // paid runs on an arm that is about to throw.
  it('dispatches no agent after an arm-fatal error', async () => {
    const asked: string[] = []
    const d = await deps({
      config: oneAttempt,
      loadCases: (agent) => {
        if (agent.agentId === 'chief_of_staff') {
          throw new ArmCaptureError('the store is unreachable')
        }
        return caseList(1)
      },
      runCase: async (request) => {
        asked.push(request.agent.agentId)
        return echoRunner()(request)
      },
    })
    await expect(
      captureArm(
        d,
        env({
          agentIds: ['meeting_briefing', 'chief_of_staff', 'self_research'],
        }),
        [BACKGROUND, COS, SECOND],
      ),
    ).rejects.toThrow(ArmCaptureError)
    expect(asked).toEqual(['meeting_briefing'])
  })

  // Every ATTEMPT is a run in the wave too. Admission counts cases times
  // attempts as slots, so a walk that ran a case's attempts one after another
  // would take that many runs' worth of wall clock.
  it('starts every attempt of every case at once', async () => {
    const { runCase, most } = counting()
    await captureArm(
      await deps({
        config: {
          ...DEFAULT_JUDGE_CONFIG,
          background: { attemptsPerCase: 2, maxInFlight: 12 },
        },
        runCase,
        loadCases: () => caseList(3),
      }),
      env({ agentIds: ['meeting_briefing'] }),
      [BACKGROUND],
    )
    expect(most.background).toBe(6)
  })

  // In walk order whatever finished first, so a manifest does not depend on
  // which Fargate task happened to be quicker.
  it('lists agents in walk order, not finishing order', async () => {
    const manifest = await captureArm(
      await deps({
        config: oneAttempt,
        loadCases: () => caseList(1),
        runCase: async (request) => {
          if (request.agent.agentId === 'meeting_briefing') {
            await new Promise((resolve) => setTimeout(resolve, 30))
          }
          return echoRunner()(request)
        },
      }),
      env({ agentIds: ['meeting_briefing', 'self_research'] }),
      [BACKGROUND, SECOND],
    )
    expect(manifest.agents.map((a) => a.agentId)).toEqual([
      'meeting_briefing',
      'self_research',
    ])
  })
})
