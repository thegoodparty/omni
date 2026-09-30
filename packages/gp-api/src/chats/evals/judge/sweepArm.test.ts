import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEntry } from './agents'
import type { CaseList } from './cases'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import { CHAT_PAIR } from './fixtures/records'
import type { RunRecord } from './record'
import { createLocalRecordStore, recordKey, type RecordStore } from './records'
import {
  ArmCaptureError,
  captureArm,
  scrubReason,
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

  it('stamps the capture window the arm gap is measured from', async () => {
    const times = [
      new Date('2026-09-29T10:00:00.000Z'),
      new Date('2026-09-29T10:40:00.000Z'),
    ]
    let call = 0
    const manifest = await captureArm(
      await deps({
        now: () => times[Math.min(call++, times.length - 1)]!,
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
    const [record] = await d.store.listRecords('swp_1', 'candidate')
    expect(
      recordKey('swp_1', 'candidate', record!.caseId, record!.attempt),
    ).toBe('_judge/swp_1/records/candidate/case-0-1.json')
  })

  // Named rather than silent: an agent that quietly produced no records reads
  // downstream as a sweep that found nothing to say.
  it('skips a background agent with a reason instead of failing', async () => {
    const manifest = await captureArm(
      await deps({ config: oneAttempt }),
      env({ agentIds: ['chief_of_staff', 'meeting_briefing'] }),
      [COS, BACKGROUND],
    )
    expect(manifest.agents.map((a) => a.agentId)).toEqual(['chief_of_staff'])
    expect(manifest.skipped).toEqual([
      {
        agentId: 'meeting_briefing',
        reason: expect.stringContaining('background runner has not landed'),
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
      await expect(captureArm(d, env(), [COS])).rejects.toThrow(ArmCaptureError)
    },
  )

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
