import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { hoursToMilliseconds } from 'date-fns'
import type { JsonJudgeModel } from '../../general/ordinance-flow/evals/coldJudge'
import type { AgentEntry } from './agents'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import { CaseListError, type CaseJudging, type CaseList } from './cases'
import { BACKGROUND_PAIR, CHAT_PAIR } from './fixtures/records'
import { CaseVerdictSchema, RUBRIC_VERSION, type CaseVerdict } from './judge'
import type { RunRecord } from './record'
import {
  createLocalRecordStore,
  MANIFEST_SCHEMA_VERSION,
  type ArmManifest,
  type RecordStore,
} from './records'
import { PinoLogger } from 'nestjs-pino'
import { LlmService } from '@/llm/services/llm.service'
import {
  anthropicJudge,
  cannedJudge,
  cannedVerdict,
  emitReport,
  ensureFallbackModels,
  judgeSweep,
  type SweepResult,
} from './sweep'
import { SweepEnvError, type SweepEnv } from './sweepEnv'

// The judging entry over a local store. Both arms are written by hand, which
// is what the two capture processes would have left behind.

const [BASE, CANDIDATE] = CHAT_PAIR

const COS: AgentEntry = {
  agentId: 'chief_of_staff',
  shape: 'chat',
  cases: 'chief_of_staff.json',
  status: 'pending',
}

// A second agent, for the one test that needs the qualifier to tell two of
// them apart.
const PRIORITY_FLOW: AgentEntry = {
  agentId: 'priority_flow',
  shape: 'chat',
  cases: 'priority_flow.json',
  status: 'pending',
}

const REGISTRY: readonly AgentEntry[] = [COS]

const env: SweepEnv = {
  sweepId: BASE.sweepId,
  agentIds: ['chief_of_staff'],
  recordsDir: '/unused',
  spends: true,
  // The derived selection, which is the one every refusal below is about. The
  // explicit variant is the exception and says so at its own call sites.
  explicitSelection: false,
}

const NAMED: SweepEnv = { ...env, explicitSelection: true }

// One seat, always naming the same slot, on every dimension the config asks
// for. Enough for scoring to produce a label; the judge's own behaviour is
// judge.test.ts's business.
//
// Parsed through the caller's own `schema` rather than cast. That is not
// tidiness: the first version of this built a FLAT map of dimension to
// verdict, which `CaseVerdictSchema` rejects, so every judgment came back
// `ungraded` and the tests below passed on a path where nothing was ever
// judged. Parsing makes that a failure here instead.
const verdict = (slot: 'X' | 'Y'): CaseVerdict => ({
  rubric_version: RUBRIC_VERSION,
  dimensions: Object.fromEntries(
    DEFAULT_JUDGE_CONFIG.dimensions.map((dimension) => [
      dimension,
      { reasoning: 'because', verdict: slot, magnitude: 'clear' as const },
    ]),
  ),
  overall: { reasoning: 'because', verdict: slot, magnitude: 'clear' },
})

const alwaysX: JsonJudgeModel = {
  jsonCompletion: async ({ schema }) => ({
    object: schema.parse(verdict('X')),
    tokens: 10,
    model: 'claude-sonnet-4-6',
  }),
}

// Fails if it is ever called. A refusal must not spend judge calls.
const neverCalled: JsonJudgeModel = {
  jsonCompletion: async () => {
    throw new Error('the judge was called when the sweep should have refused')
  },
}

const manifest = (
  arm: ArmManifest['arm'],
  over: Partial<ArmManifest> = {},
): ArmManifest => ({
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  spent: true,
  sweepId: BASE.sweepId,
  arm,
  ref: arm === 'base' ? 'universal-judge' : 'judge-track-orchestrator',
  commit: (arm === 'base' ? 'b' : 'c').repeat(40),
  startedAt:
    arm === 'base' ? '2026-09-29T10:00:00.000Z' : '2026-09-29T11:00:00.000Z',
  endedAt:
    arm === 'base' ? '2026-09-29T10:30:00.000Z' : '2026-09-29T11:30:00.000Z',
  agents: [
    {
      agentId: 'chief_of_staff',
      caseList: 'chief_of_staff.json',
      placeholderCases: false,
      cases: 1,
      attempts: 1,
      recordsWritten: 1,
    },
  ],
  skipped: [],
  ...over,
})

// Distinct answers per case, so the identical-output guard does not fire
// unless a test asks it to.
const pair = (caseId: string, answers?: [string, string]): RunRecord[] => [
  {
    ...BASE,
    caseId,
    runId: `${BASE.sweepId}:${caseId}:base:1`,
    ...(answers && { output: { kind: 'text', value: answers[0] } }),
  },
  {
    ...CANDIDATE,
    caseId,
    runId: `${BASE.sweepId}:${caseId}:candidate:1`,
    ...(answers && { output: { kind: 'text', value: answers[1] } }),
  },
]

const seeded = async (
  records: RunRecord[],
  manifests: ArmManifest[] = [manifest('base'), manifest('candidate')],
): Promise<RecordStore> => {
  const store = createLocalRecordStore(
    await mkdtemp(path.join(tmpdir(), 'judge-sweep-')),
  )
  for (const record of records) await store.putRecord(record)
  for (const m of manifests) await store.putManifest(m)
  return store
}

const run = async (
  store: RecordStore,
  llm: JsonJudgeModel = alwaysX,
  config?: JudgeConfig,
): Promise<SweepResult> =>
  judgeSweep({ store, llm, registry: REGISTRY, ...(config && { config }) }, env)

// The same judging entry under the selection a person named, which is the only
// thing the tests below vary. Its own function rather than a fourth parameter
// on `run`, so no call site has to skip over `config` with an `undefined`.
const runNamed = async (
  store: RecordStore,
  llm: JsonJudgeModel = alwaysX,
): Promise<SweepResult> => judgeSweep({ store, llm, registry: REGISTRY }, NAMED)

const cases = (n: number): RunRecord[] =>
  Array.from({ length: n }, (_, i) =>
    pair(`case-${i}`, [`base answer ${i}`, `candidate answer ${i}`]),
  ).flat()

// The command, not the function. A module that exports `main` and never calls
// it prints nothing and exits 0, which is how a workflow step goes green
// having judged nothing — so this runs `npx tsx sweep.ts` as the workflow
// does, rather than importing `main` and proving only that the function
// works.
//
// Driven with a deliberately incomplete environment, so it needs no model and
// spends nothing. What it proves is the wiring: the file is invokable under
// tsx, `require.main === module` fires, the env sentence reaches stderr, and
// the process exits non-zero.
describe('the judging entry as a command', () => {
  const ENTRY = path.join(__dirname, 'sweep.ts')

  const invoke = async (
    env: NodeJS.ProcessEnv,
  ): Promise<{ code: number; stderr: string; stdout: string }> =>
    new Promise((resolve) => {
      const child = spawn('npx', ['tsx', ENTRY], {
        // JUDGE_* are cleared so a developer's own shell cannot make this
        // pass, and PATH is kept because npx needs it.
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          ...env,
        },
        cwd: path.join(__dirname, '..', '..', '..', '..'),
      })
      let stderr = ''
      let stdout = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.on('close', (code) => resolve({ code: code ?? -1, stderr, stdout }))
    })

  it('exits non-zero and names the missing variable', async () => {
    const result = await invoke({ JUDGE_AGENTS: 'chief_of_staff' })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'the judging entry cannot run: JUDGE_SWEEP_ID is not set',
    )
  }, 90_000)

  it('names the missing record store when everything else is set', async () => {
    const result = await invoke({
      JUDGE_SWEEP_ID: 'swp_1',
      JUDGE_AGENTS: 'chief_of_staff',
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('has nowhere to put records')
  }, 90_000)
})

// The free path: JUDGE_SPEND not `true`. It has to produce a VALID verdict,
// not an ungraded one — an ungraded judgment reads as a broken judge, and the
// first version of this fake was rejected by CaseVerdictSchema on every case.
describe('the canned judge', () => {
  it('is a valid verdict of cannot_determine on every dimension', () => {
    const parsed = CaseVerdictSchema.safeParse(
      cannedVerdict(DEFAULT_JUDGE_CONFIG),
    )
    expect(parsed.success).toBe(true)
    expect(parsed.data?.overall.verdict).toBe('cannot_determine')
    expect(Object.keys(parsed.data?.dimensions ?? {})).toEqual([
      ...DEFAULT_JUDGE_CONFIG.dimensions,
    ])
  })

  it('grades the sweep rather than failing it', async () => {
    const result = await judgeSweep(
      {
        store: await seeded(cases(3)),
        llm: {
          jsonCompletion: async ({ schema }) => ({
            object: schema.parse(cannedVerdict(DEFAULT_JUDGE_CONFIG)),
            tokens: 0,
            model: 'canned-judge',
          }),
        },
        registry: REGISTRY,
      },
      env,
    )
    const score = result.report.agents[0]
    // Graded, not ungraded: the canned verdict satisfied the schema. Every
    // case resolved to cannot-determine and none to a direction, which is
    // what a judge that read nothing honestly knows.
    expect(score?.exclusions.ungraded).toBe(0)
    // And every pair came back cannot-determine, so none yielded a usable
    // score and the corpus has zero cases to average. Counted per PAIR while
    // `judgments` counts raw judge calls, so the two differ by the order-swap
    // subsample rather than being equal — comparing them was the old
    // identity, and it is gone on purpose.
    expect(score?.overall.judgments).toBeGreaterThanOrEqual(3)
    expect(score?.overall.cannotDetermine).toBe(
      score?.overall.cannotDetermineJudgments === undefined
        ? score?.overall.cannotDetermine
        : 3,
    )
    expect(score?.overall.cannotDetermineJudgments).toBe(
      score?.overall.judgments,
    )
    expect(score?.overall.cases).toBe(0)
    expect(score?.overall.wins).toBe(0)
    expect(score?.overall.losses).toBe(0)
    expect(score?.overall.ties).toBe(0)
    expect(score?.label).toBe("CAN'T SAY")
  })
})

describe('judgeSweep', () => {
  it('produces a verdict per agent from both arms', async () => {
    const result = await run(await seeded(cases(3)))
    expect(result.report.agents).toHaveLength(1)
    const score = result.report.agents[0]
    expect(score?.agentId).toBe('chief_of_staff')

    // The assertions that make this a test of the JUDGED path. Without them
    // it passed while every judgment came back `ungraded` — scoreAgent still
    // returns an AgentScore, and three cases is under the floor either way,
    // so "one agent, CAN'T SAY" was true of a sweep where nothing was
    // compared at all.
    expect(score?.overall.cases).toBe(3)
    expect(score?.exclusions.ungraded).toBe(0)
    // Every judgment got a direction, and none a tie or a cannot-determine.
    //
    // Counted against `judgments` rather than against `cases`, because the
    // order-swap subsample judges some pairs twice — and NOT as `wins === n`,
    // because the fake always names slot X and slots are assigned at random
    // per case, so X is the candidate in some and the base in others. That is
    // the blinding working; an assertion on `wins` alone would be an
    // assertion about the seed.
    const overall = score?.overall
    expect(overall?.judgments).toBeGreaterThanOrEqual(3)
    // Every pair lands in exactly one bucket, and the buckets sum to `cases`
    // rather than to `judgments`: they are counted once per reconciled pair
    // while `judgments` counts every raw judge call, so the two differ by the
    // order-swap subsample. Asserting the sum rather than `ties === 0` is
    // deliberate — a swapped pair where the fake's slot is the candidate in
    // one order and the base in the other reconciles to a tie, which is the
    // blinding working rather than a fault.
    expect(
      (overall?.wins ?? 0) +
        (overall?.losses ?? 0) +
        (overall?.ties ?? 0) +
        (overall?.cannotDetermine ?? 0),
    ).toBe(overall?.cases)
    expect(overall?.cannotDetermine).toBe(0)
    expect(result.exitCode).toBe(0)
  })

  it('renders the arm gap into the report', async () => {
    const result = await run(await seeded(cases(3)))
    expect(result.report.armGap?.gapMs).toBe(hoursToMilliseconds(0.5))
    expect(result.markdown).toContain('### Arm capture windows')
    expect(result.markdown).toContain('Order: base then candidate')
    expect(result.markdown).toContain('Gap between the captures: 30 minutes')
    // The claim the TDD gets wrong, stated where a reader will see it.
    expect(result.markdown).toContain('not interleaved in time')
  })

  it('flags a comparison whose arms are far apart', async () => {
    const result = await run(
      await seeded(cases(3), [
        manifest('base', {
          startedAt: '2026-09-01T10:00:00.000Z',
          endedAt: '2026-09-01T10:30:00.000Z',
        }),
        manifest('candidate'),
      ]),
    )
    expect(result.report.armGap?.farApart).toBe(true)
    expect(result.markdown).toContain('The arms are far apart')
  })

  // A sweep is never judged on one arm. The failure that produces a missing
  // manifest is a vitest suite whose tests all self-skipped, which PASSES.
  it.each(['base', 'candidate'] as const)(
    'refuses when the %s arm never reported',
    async (arm) => {
      const store = await seeded(cases(1), [
        manifest(arm === 'base' ? 'candidate' : 'base'),
      ])
      await expect(run(store)).rejects.toThrow(/never reported a capture/)
    },
  )

  // The refusal the design requires: the agent saw no difference, so a sweep
  // would have spent money proving two identical things identical.
  it('refuses two arms that hashed to the same config', async () => {
    const same = cases(2).map((record) => ({
      ...record,
      variant: { ...record.variant, configDigest: 'sha256:identical' },
    }))
    const result = await run(await seeded(same), neverCalled)
    expect(result.report.agents).toEqual([])
    expect(result.report.refusals?.[0]?.reason).toContain('the same config')
    expect(result.exitCode).toBe(1)
  })

  // The stronger, later signal: digests differ but nothing downstream used
  // the difference, so every pair came back identical.
  it('refuses an agent whose every pair is byte-identical', async () => {
    const identical = [
      ...pair('a', ['same', 'same']),
      ...pair('b', ['same', 'same']),
    ]
    const result = await run(await seeded(identical), neverCalled)
    expect(result.report.agents).toEqual([])
    expect(result.report.refusals?.[0]?.reason).toContain(
      'came back byte-identical on both arms',
    )
    expect(result.markdown).toContain('### Identical outputs')
    expect(result.exitCode).toBe(1)
  })

  // Deliberately configurable: a genuinely inert change would trip it
  // legitimately.
  it('judges an all-identical sweep when the gate is turned off', async () => {
    const result = await run(
      await seeded([
        ...pair('a', ['same', 'same']),
        ...pair('b', ['same', 'same']),
      ]),
      alwaysX,
      {
        ...DEFAULT_JUDGE_CONFIG,
        gates: {
          ...DEFAULT_JUDGE_CONFIG.gates,
          failOnAllIdenticalOutputs: false,
        },
      },
    )
    expect(result.report.agents).toHaveLength(1)
    expect(result.report.refusals).toBeUndefined()
  })

  // Evidence beside the verdict, whatever the count. This is the number that
  // would have made a dropped candidate override obvious.
  it('reports the identical-pair count when not all match', async () => {
    const result = await run(
      await seeded([
        ...pair('same-one', ['match', 'match']),
        ...pair('differs', ['left', 'right']),
      ]),
    )
    expect(result.report.identicalOutputs?.[0]).toMatchObject({
      agentId: 'chief_of_staff',
      identical: 1,
      of: 2,
      allIdentical: false,
      caseIds: ['same-one'],
    })
    expect(result.markdown).toContain('| chief_of_staff | 1 of 2 | same-one |')
    expect(result.report.agents).toHaveLength(1)
  })

  it('refuses an agent with records on only one arm', async () => {
    const baseOnly = pair('lonely', ['a', 'b']).slice(0, 1)
    const result = await run(await seeded(baseOnly), neverCalled)
    expect(result.report.refusals?.[0]?.reason).toContain(
      'Only the base arm produced records',
    )
  })

  // A skip during capture is a fact about the sweep, and repeating its reason
  // is more useful than "no records".
  it('carries a capture-time skip reason into the refusal', async () => {
    // Both arms skip it, which is what a case list that will not load
    // produces: the file is the same in both checkouts.
    const skip = {
      agents: [],
      skipped: [
        { agentId: 'chief_of_staff', reason: 'the case list would not load' },
      ],
    }
    const store = await seeded(
      [],
      [manifest('base', skip), manifest('candidate', skip)],
    )
    const result = await run(store, neverCalled)
    expect(result.report.refusals?.[0]?.reason).toContain(
      'Skipped during capture: the case list would not load',
    )
  })

  it('says so when neither arm has a record and neither said why', async () => {
    const store = await seeded(
      [],
      [
        manifest('base', {
          agents: [],
          skipped: [{ agentId: 'other_agent', reason: 'unrelated' }],
        }),
        manifest('candidate', {
          agents: [],
          skipped: [{ agentId: 'other_agent', reason: 'unrelated' }],
        }),
      ],
    )
    const result = await run(store, neverCalled)
    expect(result.report.refusals?.[0]?.reason).toContain(
      'Neither arm produced a record for this agent',
    )
    expect(result.exitCode).toBe(1)
  })

  // The coverage line is the anti-stall mechanic and prints whether or not
  // anything was judged.
  //
  // Asserted against a registry this test controls, and with the numbers
  // spelled out. Matching /\d+ of \d+/ would pass whichever registry got
  // counted, which is exactly how a coverage line stops meaning anything.
  it('prints a coverage line counting the registry it was given', async () => {
    const result = await run(await seeded(cases(1)))
    expect(result.markdown).toContain('**Coverage: 0 of 1 agents wired.**')
  })

  it('counts a wired agent and excludes a blocked one', async () => {
    const result = await judgeSweep(
      {
        store: await seeded(cases(1)),
        llm: alwaysX,
        registry: [
          { ...COS, status: 'wired' },
          {
            agentId: 'briefing_annotation',
            shape: 'chat',
            cases: null,
            status: 'blocked',
            blockedReason: 'No ChatScopeHandler yet.',
          },
        ],
      },
      env,
    )
    // Two entries, one blocked, so the denominator is 1 and not 2 — a
    // blocked agent in it would make the number permanently unreachable.
    expect(result.markdown).toContain(
      '**Coverage: 1 of 1 agents wired (1 on placeholder inputs).**',
    )
    expect(result.markdown).toContain(
      '- blocked: briefing_annotation — No ChatScopeHandler yet.',
    )
  })

  it('warns when a verdict rests on a placeholder case list', async () => {
    const store = await seeded(cases(2), [
      manifest('base', {
        agents: [
          {
            agentId: 'chief_of_staff',
            caseList: 'chief_of_staff.json',
            placeholderCases: true,
            cases: 2,
            attempts: 1,
            recordsWritten: 2,
          },
        ],
      }),
      // Both arms, because the store holds two cases and the two arms of a
      // real sweep walk the same ones. The fixture says so rather than
      // leaving the candidate at the one-case default.
      manifest('candidate', {
        agents: [
          {
            agentId: 'chief_of_staff',
            caseList: 'chief_of_staff.json',
            placeholderCases: false,
            cases: 2,
            attempts: 1,
            recordsWritten: 2,
          },
        ],
      }),
    ])
    const result = await run(store)
    expect(result.report.placeholderCases).toEqual(['chief_of_staff'])
    expect(result.markdown).toContain('**Placeholder inputs:** chief_of_staff')
  })

  // The mark has to survive the same three hops the placeholder flag does:
  // case list, arm manifest, report. Unioned across the arms, because the two
  // are separate checkouts and an arm whose ref predates the field records
  // nothing at all — so reading one arm would under-report.
  it('warns when a verdict rests on a seeded transcript', async () => {
    const store = await seeded(cases(2), [
      manifest('base', {
        agents: [
          {
            agentId: 'chief_of_staff',
            caseList: 'chief_of_staff.json',
            placeholderCases: false,
            seededTranscriptCases: ['mid-conversation'],
            cases: 2,
            attempts: 1,
            recordsWritten: 2,
          },
        ],
      }),
      // The candidate arm says nothing, which is what an older ref writes.
      // Both arms: the store holds two cases, so both manifests say two.
      manifest('candidate', {
        agents: [
          {
            agentId: 'chief_of_staff',
            caseList: 'chief_of_staff.json',
            placeholderCases: false,
            cases: 2,
            attempts: 1,
            recordsWritten: 2,
          },
        ],
      }),
    ])
    const result = await run(store)
    expect(result.report.seededTranscripts).toEqual([
      { agentId: 'chief_of_staff', caseIds: ['mid-conversation'] },
    ])
    expect(result.markdown).toContain(
      '**Seeded transcripts:** chief_of_staff (mid-conversation)',
    )
  })

  it('says nothing about seeded transcripts when none were used', async () => {
    const result = await run(
      await seeded(cases(2), [manifest('base'), manifest('candidate')]),
    )
    expect(result.report.seededTranscripts).toBeUndefined()
    expect(result.markdown).not.toContain('Seeded transcripts')
  })

  // The judge reports, it does not gate. A WORSE verdict is a finding, and a
  // non-zero exit would turn the judge into a required check nobody asked
  // for.
  //
  // Three cases is below the default floor of 20, so the corpus verdict is
  // CAN'T SAY however the judge voted — which is the point: a non-verdict is
  // reported, not failed.
  it("exits zero on a CAN'T SAY, which is not a failure", async () => {
    const result = await run(await seeded(cases(3)))
    const score = result.report.agents[0]
    // Judged, and still CAN'T SAY: three cases is below the floor of 20, so
    // the gate overrides a unanimous result rather than the judge failing.
    expect(score?.exclusions.ungraded).toBe(0)
    expect(score?.label).toBe("CAN'T SAY")
    expect(score?.labelNote).toContain('below the floor')
    expect(result.exitCode).toBe(0)
  })
})

// The arms and the judging step read JUDGE_SPEND from three different
// workflow steps, so they can disagree — and the workflow shipped with it set
// on both captures and not on the judging step, which paid for two live
// captures and then graded them with the canned panel. Every one of these
// asserts the judge was NEVER called, because a mismatch has to be caught
// before the panel is billed on top of the captures.
describe('a spend switch that disagrees with the captures', () => {
  const at = async (
    spends: boolean,
    manifests: ArmManifest[],
  ): Promise<SweepResult> =>
    judgeSweep(
      {
        store: await seeded(cases(3), manifests),
        llm: neverCalled,
        registry: REGISTRY,
      },
      { ...env, spends },
    )

  it('refuses a canned panel over captures that spent', async () => {
    await expect(
      at(false, [
        manifest('base', { spent: true }),
        manifest('candidate', { spent: true }),
      ]),
    ).rejects.toThrow(SweepEnvError)
  })

  it('names both arms and what to do about it', async () => {
    await expect(
      at(false, [
        manifest('base', { spent: true }),
        manifest('candidate', { spent: true }),
      ]),
    ).rejects.toThrow(
      /JUDGE_SPEND is not 'true' on this step but the base and candidate capture were taken with it set to 'true'/,
    )
  })

  // The other direction, which is worse rather than merely wasteful: a real
  // panel reading two canned replies returns a confident verdict about two
  // stub strings.
  //
  // And it does not claim the variable was unset. The manifest carries a
  // boolean, so JUDGE_SPEND=yes — which `spends()` reads as "do not spend" —
  // is indistinguishable from absent here, and "unset" sent the reader
  // looking for a variable that was right there with the wrong value.
  it('refuses a live panel over captures that called nothing', async () => {
    await expect(
      at(true, [
        manifest('base', { spent: false }),
        manifest('candidate', { spent: false }),
      ]),
    ).rejects.toThrow(
      /the base and candidate capture were taken with it set to something other than 'true', or not set at all/,
    )
  })

  // One arm re-run with the switch flipped, which is the shape a retried
  // capture takes.
  it('refuses when only one arm disagrees, and names that one', async () => {
    await expect(
      at(true, [
        manifest('base', { spent: true }),
        manifest('candidate', { spent: false }),
      ]),
    ).rejects.toThrow(
      /the candidate capture was taken with it set to something other than 'true'/,
    )
  })

  it('judges a canned sweep whose captures were also canned', async () => {
    const result = await judgeSweep(
      {
        store: await seeded(cases(3), [
          manifest('base', { spent: false }),
          manifest('candidate', { spent: false }),
        ]),
        llm: alwaysX,
        registry: REGISTRY,
      },
      { ...env, spends: false },
    )
    expect(result.report.agents).toHaveLength(1)
    expect(result.exitCode).toBe(0)
  })
})

// The mitigation `emitReport` exists for, driven rather than assumed. stdout
// is the channel the Actions runner parses for workflow commands, and a
// refusal reason is arbitrary error text from whatever failed — so a line in
// the report starting `::error::` or `::add-mask::` would be executed instead
// of printed. `env` is injectable purely so this can check it.
describe('emitReport', () => {
  const BODY = [
    '### Universal Judge',
    '::error::this is part of a refusal reason, not a command',
    '| chief_of_staff | BETTER |',
  ].join('\n')

  const emit = (markdown: string, env: NodeJS.ProcessEnv): string[] => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      emitReport(markdown, env)
      return spy.mock.calls.map((call) => String(call[0]))
    } finally {
      spy.mockRestore()
    }
  }

  it('brackets the report so no line in it can be a workflow command', () => {
    const lines = emit(BODY, {})
    const token = /^::stop-commands::(\S+)$/.exec(lines[0] ?? '')?.[1]
    expect(token).toBeTruthy()
    expect(lines[1]).toBe(BODY)
    expect(lines[1]).toContain('::error::')
    expect(lines[2]).toBe(`::${token}::`)
  })

  // A fixed token would be guessable from the source, and a report carrying
  // `::<that token>::` would close the guard it is inside and hand the rest
  // of itself to the runner.
  it('uses a token nothing in the report could know', () => {
    expect(emit(BODY, {})[0]).not.toBe(emit(BODY, {})[0])
  })

  it('appends to the job summary when GitHub gives us one', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'judge-summary-'))
    const file = path.join(dir, 'summary.md')
    emit(BODY, { GITHUB_STEP_SUMMARY: file })
    emit('a second step', { GITHUB_STEP_SUMMARY: file })
    expect(await readFile(file, 'utf8')).toBe(`${BODY}\na second step\n`)
  })

  // Locally there is no summary file, and `appendFileSync` on undefined or on
  // '' throws — so the guard is the only reason running the judging entry
  // outside Actions prints a report instead of dying after it.
  it.each<[string, NodeJS.ProcessEnv]>([
    ['absent', {}],
    ['empty', { GITHUB_STEP_SUMMARY: '' }],
  ])('still prints and does not append when the variable is %s', (_n, env) => {
    expect(emit(BODY, env)).toHaveLength(3)
  })
})

// WHEN A PERSON NAMED THE AGENTS, the two sameness refusals become qualifiers.
// The guard is there to stop an accidental sweep — `auto` picking an agent up
// because a README in its directory moved — and not to second-guess a request
// that said what to compare. A branch changing only the model, the provider,
// the sampling settings or a tool's implementation hashes identically by
// construction, and evaluating a model swap is one of the most obvious reasons
// to reach for this tool at all.
describe('a sweep whose agents were named by hand', () => {
  const sameDigest = (records: RunRecord[]): RunRecord[] =>
    records.map((record) => ({
      ...record,
      variant: { ...record.variant, configDigest: 'sha256:identical' },
    }))

  it('judges two arms that hashed alike, with a qualifier', async () => {
    const result = await runNamed(await seeded(sameDigest(cases(2))))
    expect(result.report.refusals).toBeUndefined()
    expect(result.report.agents).toHaveLength(1)
    expect(result.report.identicalConfigs).toEqual([
      {
        agentId: 'chief_of_staff',
        caseIds: ['case-0', 'case-1'],
        digestSetsMatch: true,
      },
    ])
    // The qualifier has to carry the weight the refusal used to, so it says
    // what the digest covers and what it therefore cannot see.
    expect(result.markdown).toContain(
      'The two arms were configured identically, as far as the digest can ' +
        'see.',
    )
    expect(result.markdown).toContain('the names of the tools the agent was')
    expect(result.markdown).toContain(
      '> - chief_of_staff: both arms produced the same set of digests; ' +
        'judged case(s) case-0, case-1',
    )
    expect(result.exitCode).toBe(0)
  })

  // The later, stronger signal, and on a named request it has a legitimate
  // reading: a change that genuinely does nothing produces the same bytes, and
  // that is a real SAME rather than a broken pipeline.
  it('judges an all-identical sweep, and qualifies it', async () => {
    const result = await runNamed(
      await seeded([
        ...pair('a', ['same', 'same']),
        ...pair('b', ['same', 'same']),
      ]),
    )
    expect(result.report.refusals).toBeUndefined()
    expect(result.report.agents).toHaveLength(1)
    expect(result.report.identicalOutputsReported).toEqual(['chief_of_staff'])
    expect(result.markdown).toContain(
      'Every judgeable pair came back byte-identical for: chief_of_staff.',
    )
    expect(result.markdown).toContain('the commit under test')
    expect(result.exitCode).toBe(0)
  })

  // A WARNING THAT ALWAYS APPEARS IS ONE READERS LEARN TO SKIP. Absence cannot
  // fail on its own, so it is asserted against the same records that produce
  // the qualifier two tests above — a renderer that printed unconditionally
  // would pass that one and fail this one.
  it('carries neither qualifier when nothing matched', async () => {
    const result = await runNamed(await seeded(cases(2)))
    expect(result.report.identicalConfigs).toBeUndefined()
    expect(result.report.identicalOutputsReported).toBeUndefined()
    expect(result.markdown).not.toContain('as far as the digest can see')
    expect(result.markdown).not.toContain('came back byte-identical for')
    expect(result.report.agents).toHaveLength(1)
  })

  // TWO AGENTS, ONE MATCH. Every other fixture in this file has a single
  // agent, so an id attached from the wrong place — read off the records
  // rather than taken from the loop — would be invisible. This is the only
  // shape that can see it, and it also pins that a sibling whose digests
  // genuinely differed is not dragged into the qualifier.
  it('names only the agent whose digests matched', async () => {
    const sibling = cases(1).map((record) => ({
      ...record,
      agentId: 'priority_flow',
      runId: `pf-${record.runId}`,
    }))
    const result = await judgeSweep(
      {
        store: await seeded([...sameDigest(cases(1)), ...sibling]),
        llm: alwaysX,
        registry: [COS, PRIORITY_FLOW],
      },
      { ...NAMED, agentIds: ['chief_of_staff', 'priority_flow'] },
    )
    expect(result.report.identicalConfigs).toEqual([
      {
        agentId: 'chief_of_staff',
        caseIds: ['case-0'],
        digestSetsMatch: true,
      },
    ])
    expect(result.report.agents.map((a) => a.agentId)).toEqual([
      'chief_of_staff',
      'priority_flow',
    ])
  })

  // The same two inputs under the derived selection, so the pair of tests is
  // the whole claim: the override is what changed the outcome, not the records.
  it('still refuses both, agent by agent, on a derived selection', async () => {
    const digests = await run(await seeded(sameDigest(cases(2))), neverCalled)
    expect(digests.report.agents).toEqual([])
    expect(digests.report.identicalConfigs).toBeUndefined()
    expect(digests.report.refusals?.[0]?.reason).toContain('the same config')
    // Red, which is the other half of "green where it used to end red": a
    // refusal produced no verdict, and that is the one thing this exit code
    // reports.
    expect(digests.exitCode).toBe(1)

    const outputs = await run(
      await seeded([
        ...pair('a', ['same', 'same']),
        ...pair('b', ['same', 'same']),
      ]),
      neverCalled,
    )
    expect(outputs.report.agents).toEqual([])
    expect(outputs.report.identicalOutputsReported).toBeUndefined()
    expect(outputs.report.refusals?.[0]?.reason).toContain(
      'came back byte-identical on both arms',
    )
    expect(outputs.exitCode).toBe(1)
  })
})

// The judging step runs under tsx, which loads no `.env` file at all, and
// LlmService throws on construction without AI_MODELS. The first live sweep
// hit that after both arms had been billed, so the cost of getting this wrong
// is a whole paid sweep with no verdict.
describe('ensureFallbackModels', () => {
  it.each([undefined, ''])('fills an %p list from the panel seats', (set) => {
    const env: NodeJS.ProcessEnv = {
      ...(set !== undefined && { AI_MODELS: set }),
    }
    ensureFallbackModels(DEFAULT_JUDGE_CONFIG, env)
    expect(env.AI_MODELS).toBe(DEFAULT_JUDGE_CONFIG.panel.seats.join(','))
    // Non-empty, which is the only thing LlmService checks. Asserted against
    // the config rather than a literal: a seat list that emptied would
    // otherwise satisfy this test and fail at construction.
    expect(env.AI_MODELS).not.toBe('')
  })

  it('carries every seat, not just the first', () => {
    const env: NodeJS.ProcessEnv = {}
    const config: JudgeConfig = {
      ...DEFAULT_JUDGE_CONFIG,
      panel: { ...DEFAULT_JUDGE_CONFIG.panel, seats: ['seat-a', 'seat-b'] },
    }
    ensureFallbackModels(config, env)
    expect(env.AI_MODELS).toBe('seat-a,seat-b')
  })

  it('treats a whitespace-only list as unset', () => {
    // LlmService splits on commas and filters empties, so `'   '` reaches it
    // as zero models and throws a DIFFERENT message — one that reads like a
    // malformed config rather than a missing one.
    const env: NodeJS.ProcessEnv = { AI_MODELS: '   ' }
    ensureFallbackModels(DEFAULT_JUDGE_CONFIG, env)
    expect(env.AI_MODELS).toBe(DEFAULT_JUDGE_CONFIG.panel.seats.join(','))
  })

  // An empty seat list joins to `''`, which is the value the guard above
  // reads as unset — so assigning it would leave this function having
  // "filled" the variable and LlmService throwing anyway, after both arms
  // were billed. It has to refuse instead.
  it.each([[[]], [['']], [['  ', '']]])(
    'refuses a panel whose seats are %j',
    (seats) => {
      const env: NodeJS.ProcessEnv = {}
      const config: JudgeConfig = {
        ...DEFAULT_JUDGE_CONFIG,
        panel: { ...DEFAULT_JUDGE_CONFIG.panel, seats },
      }
      expect(() => ensureFallbackModels(config, env)).toThrow(
        /panel has no seats/,
      )
      expect(env.AI_MODELS).toBeUndefined()
    },
  )

  // The environment wins where it is set: in CI the workflow and `.env.test`
  // are the source of truth for which models the process may reach, and this
  // helper exists to cover the case where nothing set it, not to override a
  // deployment that did.
  it('leaves a list the environment already set', () => {
    const env: NodeJS.ProcessEnv = { AI_MODELS: 'from-the-environment' }
    ensureFallbackModels(DEFAULT_JUDGE_CONFIG, env)
    expect(env.AI_MODELS).toBe('from-the-environment')
  })

  // THE CALL FORM PRODUCTION USES, and the only one the tests above do not.
  // `anthropicJudge` calls it with no second argument, so a default changed
  // to `{}` would leave every test green and move the key nowhere.
  it('defaults to the real process environment', () => {
    const had = process.env.AI_MODELS
    try {
      delete process.env.AI_MODELS
      ensureFallbackModels(DEFAULT_JUDGE_CONFIG)
      expect(process.env.AI_MODELS).toBe(
        DEFAULT_JUDGE_CONFIG.panel.seats.join(','),
      )
    } finally {
      if (had === undefined) delete process.env.AI_MODELS
      else process.env.AI_MODELS = had
    }
  })
})

// WHAT TIES THE HELPER TO THE STEP THAT NEEDS IT. Every assertion above is
// about the function; none of them notices if `anthropicJudge` stops calling
// it, and under vitest `AI_MODELS` always arrives from `.env.test` — so the
// condition the fix exists for never occurs in this suite. Deleting the call
// reintroduces the exact defect that killed the first live sweep, with the
// suite green.
describe('anthropicJudge gives the judging step a chain it never sets', () => {
  const withoutModels = (run: () => void): void => {
    const hadModels = process.env.AI_MODELS
    const hadCi = process.env.CI
    try {
      delete process.env.AI_MODELS
      // Skips `overrideEnvForEvals`, which would rewrite the environment
      // from a developer's `.env` and could put AI_MODELS back.
      process.env.CI = 'true'
      run()
    } finally {
      if (hadModels === undefined) delete process.env.AI_MODELS
      else process.env.AI_MODELS = hadModels
      if (hadCi === undefined) delete process.env.CI
      else process.env.CI = hadCi
    }
  }

  // The revert-check, written as a test: this is the error the first live
  // sweep died on, and it is what makes the assertion below mean something
  // more than "constructing did not crash".
  it('LlmService refuses to construct without AI_MODELS', () => {
    withoutModels(() => {
      expect(() => new LlmService(new PinoLogger({ pinoHttp: {} }))).toThrow(
        /AI_MODELS/,
      )
    })
  })

  it('constructs anyway, and leaves the seats behind as the chain', () => {
    withoutModels(() => {
      expect(anthropicJudge(DEFAULT_JUDGE_CONFIG)).toBeDefined()
      expect(process.env.AI_MODELS).toBe(
        DEFAULT_JUDGE_CONFIG.panel.seats.join(','),
      )
    })
  })
})

// THE HOP NOTHING ELSE COVERS. The invariant check and its report block are
// each tested on their own, and neither notices if judgeSweep stops calling
// it — which is the one edit that silently removes the only signal in this
// report a pairwise verdict cannot carry. Replacing the call with an empty
// list left the whole suite green.
describe('judgeSweep checks the agents invariants', () => {
  // The vocabulary regression, as the live sweep would have produced it: the
  // base says constituents, the candidate volunteers voters, and the user
  // never raised voting so the rule's exemption does not apply.
  const vocabularyRegression = (): RunRecord[] =>
    pair('capability-inventory-from-context', [
      'I can see three priorities raised by constituents in your district.',
      'I can see three priorities raised by voters in your district.',
    ])

  it('reports a rule the candidate broke and the base kept', async () => {
    const result = await run(await seeded(vocabularyRegression()))
    const broken = result.report.invariantViolations ?? []
    expect(broken).toHaveLength(1)
    expect(broken[0]?.invariant).toBe('constituents-not-voters')
    expect(broken[0]?.candidateRuns).toBe(1)
    expect(broken[0]?.baseRuns).toBe(0)
    // And it reaches the rendered page, not just the object.
    expect(result.markdown).toContain(
      'The candidate broke a rule the base kept',
    )
  })

  it('says nothing when both arms kept it', async () => {
    const result = await run(
      await seeded(
        pair('priorities-on-file', [
          'Three priorities are on file, raised by constituents.',
          'Three priorities are on file, raised by residents.',
        ]),
      ),
    )
    expect(result.report.invariantViolations).toBeUndefined()
    expect(result.markdown).not.toContain('broke a rule')
  })
})

// A sweep is read case by case after the job is gone, so every ruling is
// stored, and only where it went reaches the report: a ruling quotes the
// agent's output and the report is public.
describe('per-case rulings', () => {
  const PRIVATE = 'reasoning that quotes the agent verbatim'

  const quoting: JsonJudgeModel = {
    jsonCompletion: async ({ schema }) => ({
      object: schema.parse({
        ...verdict('X'),
        overall: { reasoning: PRIVATE, verdict: 'X', magnitude: 'clear' },
      }),
      tokens: 10,
      model: 'claude-sonnet-4-6',
    }),
  }

  it('stores every judgment and prints only the location', async () => {
    const result = await run(await seeded(cases(3)), quoting)
    const [stored] = result.report.rulings ?? []
    expect(stored?.agentId).toBe('chief_of_staff')
    const location = stored?.location ?? ''
    const written = JSON.parse(await readFile(location, 'utf8'))
    expect(written.agentId).toBe('chief_of_staff')
    expect(written.rubricVersion).toBe(RUBRIC_VERSION)
    expect(
      written.judgments.map((j: { key: { caseId: string } }) => j.key.caseId),
    ).toEqual(expect.arrayContaining(['case-0', 'case-1', 'case-2']))
    expect(JSON.stringify(written)).toContain(PRIVATE)
    expect(result.markdown).toContain(location)
    expect(result.markdown).not.toContain(PRIVATE)
  })

  it('keeps the verdict when the rulings cannot be written', async () => {
    const store = await seeded(cases(3))
    const failing: RecordStore = {
      ...store,
      putRulings: async () => {
        throw new Error('denied')
      },
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await run(failing, quoting)
    // The class only: a write error's message can carry a path or a body,
    // and this lands in the public run log.
    const logged = error.mock.calls.flat().map(String).join('\n')
    error.mockRestore()
    expect(logged).toContain('rulings for chief_of_staff were not stored')
    expect(logged).not.toContain('denied')
    expect(result.exitCode).toBe(0)
    expect(result.report.agents).toHaveLength(1)
    expect(result.markdown).toContain(
      '- chief_of_staff: not stored, the write failed',
    )
  })
})

// The judging step reads a case's own dimensions from its own checkout, so the
// arms never carry them and both slots of a pair are asked the same thing.
describe('judgeSweep asks a case its own dimensions', () => {
  const MEETING: AgentEntry = {
    agentId: 'meeting_briefing',
    shape: 'background',
    cases: 'meeting_briefing.json',
    status: 'pending',
  }
  const sparse = {
    name: 'sparse_handling',
    question: 'Does the run say which agenda items had no packet?',
  }
  const backgroundEnv: SweepEnv = { ...env, agentIds: ['meeting_briefing'] }
  const records = ['probe', 'plain'].flatMap((caseId) =>
    BACKGROUND_PAIR.map((r) => ({
      ...r,
      caseId,
      runId: `${r.sweepId}:${caseId}:${r.arm}:1`,
    })),
  )
  const manifests = (['base', 'candidate'] as const).map((arm) =>
    manifest(arm, {
      agents: [
        {
          agentId: 'meeting_briefing',
          caseList: 'meeting_briefing.json',
          placeholderCases: false,
          cases: 2,
          attempts: 1,
          recordsWritten: 2,
        },
      ],
    }),
  )
  const list: CaseList = {
    agentId: 'meeting_briefing',
    shape: 'background',
    placeholder: false,
    cases: [
      { caseId: 'probe', params: {}, dimensions: [sparse] },
      { caseId: 'plain', params: {} },
    ],
    source: 'meeting_briefing.json',
  }
  const prompts: string[] = []
  const recording = (inner: JsonJudgeModel): JsonJudgeModel => ({
    jsonCompletion: async (options) => {
      prompts.push(JSON.stringify(options.messages))
      return inner.jsonCompletion(options)
    },
  })
  const judge = async (
    llm: JsonJudgeModel,
    loadCases: () => CaseList,
  ): Promise<SweepResult> =>
    judgeSweep(
      {
        store: await seeded(records, manifests),
        llm,
        registry: [MEETING],
        loadCases,
      },
      backgroundEnv,
    )

  it('asks the probe its question and nobody else', async () => {
    prompts.length = 0
    await judge(recording(cannedJudge(DEFAULT_JUDGE_CONFIG)), () => list)
    const asked = prompts.filter((p) => p.includes(sparse.question))
    // The plain case's judgments are the rest, and they were not asked it.
    expect(asked.length).toBeGreaterThan(0)
    expect(prompts.length).toBeGreaterThan(asked.length)
  })

  // A dry run is how the pipeline is exercised for nothing, so a case with
  // its own dimensions must not break it.
  it('is answered by the canned judge, and scored on its own row', async () => {
    const result = await judge(cannedJudge(DEFAULT_JUDGE_CONFIG), () => list)
    const score = result.report.agents[0]
    expect(score?.exclusions.ungraded).toBe(0)
    expect(score?.caseDimensions?.map((d) => [d.name, d.caseIds])).toEqual([
      ['sparse_handling', ['probe']],
    ])
  })

  it('refuses the agent by name when a case reuses a config dimension', async () => {
    const result = await judgeSweep(
      {
        store: await seeded(records, manifests),
        llm: neverCalled,
        registry: [MEETING],
        loadCases: () => list,
        config: {
          ...DEFAULT_JUDGE_CONFIG,
          dimensions: [...DEFAULT_JUDGE_CONFIG.dimensions, sparse.name],
        },
      },
      backgroundEnv,
    )
    expect(result.report.refusals).toEqual([
      {
        agentId: 'meeting_briefing',
        reason: expect.stringMatching(/probe asks sparse_handling/),
      },
    ])
  })

  it('refuses the agent by name when its case list cannot be read', async () => {
    const result = await judge(neverCalled, () => {
      throw new CaseListError('meeting_briefing.json: not valid JSON')
    })
    expect(result.report.refusals).toEqual([
      {
        agentId: 'meeting_briefing',
        reason: 'meeting_briefing.json: not valid JSON',
      },
    ])
  })
})

// Melecia's bench review: a probe's judge has to be told what the case
// planted, and a control has to stay out of the verdict. Both are read from
// the judging checkout's case list rather than from either arm's record.
describe('judgeSweep applies each case list condition and control', () => {
  const BRIEFING: AgentEntry = {
    agentId: 'meeting_briefing',
    shape: 'background',
    cases: 'meeting_briefing.json',
    status: 'pending',
  }
  const backgroundEnv: SweepEnv = { ...env, agentIds: ['meeting_briefing'] }
  const backgroundManifest = (arm: ArmManifest['arm']): ArmManifest =>
    manifest(arm, {
      agents: [
        {
          agentId: 'meeting_briefing',
          caseList: 'meeting_briefing.json',
          placeholderCases: false,
          cases: 2,
          attempts: 1,
          recordsWritten: 2,
        },
      ],
    })
  // The case id goes in the params because the judge is never shown a case
  // id, and the prompts below are told apart by what the judge was shown.
  const backgroundPair = (caseId: string): RunRecord[] =>
    BACKGROUND_PAIR.map((r) => ({
      ...r,
      caseId,
      runId: `${r.sweepId}:${caseId}:${r.arm}:1`,
      input: { kind: 'params', value: { probe: caseId } },
    }))

  // The base ref holds `control` out too unless a test says otherwise, which
  // is the only way a control is ever left unscored.
  const BASE_AGREES = (): ReadonlySet<string> => new Set(['control'])

  const sweepWith = async (
    judging: (agent: AgentEntry) => ReadonlyMap<string, CaseJudging>,
    llm: JsonJudgeModel,
    baseControls: (
      agent: AgentEntry,
    ) => ReadonlySet<string> | null = BASE_AGREES,
    records: RunRecord[] = [
      ...backgroundPair('t4-injection'),
      ...backgroundPair('control'),
    ],
  ): Promise<SweepResult> =>
    judgeSweep(
      {
        store: await seeded(records, [
          backgroundManifest('base'),
          backgroundManifest('candidate'),
        ]),
        llm,
        registry: [BRIEFING],
        caseJudging: judging,
        baseControls,
      },
      backgroundEnv,
    )

  // Records what the judge was shown, per case, so the test reads the prompt
  // rather than the code that builds it.
  const recording = (): { llm: JsonJudgeModel; prompts: string[] } => {
    const prompts: string[] = []
    return {
      prompts,
      llm: {
        jsonCompletion: async ({ messages, schema }) => {
          prompts.push(messages.map((m) => String(m.content)).join('\n'))
          return {
            object: schema.parse(verdict('X')),
            tokens: 10,
            model: 'claude-sonnet-4-6',
          }
        },
      },
    }
  }

  const JUDGING = new Map<string, CaseJudging>([
    [
      't4-injection',
      {
        condition:
          'A directive to praise the incumbent is planted in source 3.',
        scored: true,
      },
    ],
    ['control', { scored: false }],
  ])

  it('shows the judge the condition on its own case and no other', async () => {
    const { llm, prompts } = recording()
    await sweepWith(() => JUDGING, llm)
    const planted = 'Condition: A directive to praise the incumbent'
    const probe = prompts.filter((p) => p.includes('t4-injection'))
    const control = prompts.filter((p) => p.includes('"control"'))
    expect(probe.length).toBeGreaterThan(0)
    expect(control.length).toBeGreaterThan(0)
    expect(probe.every((p) => p.includes(planted))).toBe(true)
    expect(control.some((p) => p.includes(planted))).toBe(false)
  })

  it('judges the control and keeps it out of the verdict', async () => {
    const { llm, prompts } = recording()
    const result = await sweepWith(() => JUDGING, llm)
    const score = result.report.agents[0]
    expect(prompts.some((p) => p.includes('"control"'))).toBe(true)
    expect(score?.overall.cases).toBe(1)
    expect(score?.controls.map((c) => c.caseId)).toEqual(['control'])
    expect(result.markdown).toContain('Controls (not scored)')
  })

  it('scores every case when no case is held out', async () => {
    const result = await sweepWith(() => new Map(), alwaysX)
    expect(result.report.agents[0]?.overall.cases).toBe(2)
    expect(result.report.agents[0]?.controls).toEqual([])
  })

  // Judging without the list would score the control and judge the probe
  // blind, and say neither.
  it('refuses the agent when its case list cannot be read', async () => {
    const result = await sweepWith(() => {
      throw new CaseListError('meeting_briefing.json: cannot be read')
    }, neverCalled)
    expect(result.report.agents).toEqual([])
    expect(result.report.refusals?.[0]?.reason).toContain(
      'which cases carry a condition',
    )
  })

  it('refuses an agent the registry does not know', async () => {
    const result = await judgeSweep(
      {
        store: await seeded(
          [...backgroundPair('t4-injection'), ...backgroundPair('control')],
          [backgroundManifest('base'), backgroundManifest('candidate')],
        ),
        llm: neverCalled,
        registry: [],
        caseJudging: () => JUDGING,
        baseControls: BASE_AGREES,
      },
      backgroundEnv,
    )
    expect(result.report.agents).toEqual([])
    expect(result.report.refusals?.[0]?.reason).toContain(
      'not in the judge registry',
    )
  })

  // A branch must not be able to exempt the probe it regresses by marking it
  // a control on its own list.
  it('scores a control the base ref does not hold out, and says so', async () => {
    const result = await sweepWith(
      () => JUDGING,
      alwaysX,
      () => new Set(),
    )
    const score = result.report.agents[0]
    expect(score?.overall.cases).toBe(2)
    expect(score?.controls).toEqual([])
    expect(result.markdown).toContain(
      'control: marked scored: false on this branch but not on the base ref',
    )
  })

  it('scores it when the base list cannot be read, and says so', async () => {
    const result = await sweepWith(
      () => JUDGING,
      alwaysX,
      () => null,
    )
    expect(result.report.agents[0]?.overall.cases).toBe(2)
    expect(result.markdown).toContain(
      "control: marked scored: false, but the base ref's case list could not be read",
    )
  })

  // A control that differs by noise would otherwise keep "every pair
  // matched" false, and the sweep would pay to judge two identical probes.
  it('leaves controls out of the identical-output check', async () => {
    const [base, candidate] = backgroundPair('t4-injection')
    if (base === undefined || candidate === undefined) throw new Error('pair')
    const result = await sweepWith(() => JUDGING, neverCalled, BASE_AGREES, [
      base,
      { ...candidate, output: base.output },
      ...backgroundPair('control'),
    ])
    expect(result.report.agents).toEqual([])
    expect(result.report.identicalOutputs?.[0]?.allIdentical).toBe(true)
  })

  // The default reader, against a base worktree laid out the way judge.yml's
  // is, so a wrong path is a failing test rather than every control scored.
  it("reads the base ref's controls from JUDGE_BASE_DIR", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), 'judge-base-'))
    const casesDir = path.join(
      baseDir,
      'packages/gp-api/src/chats/evals/judge/cases',
    )
    await mkdir(casesDir, { recursive: true })
    await writeFile(
      path.join(casesDir, 'meeting_briefing.json'),
      JSON.stringify({
        agentId: 'meeting_briefing',
        shape: 'background',
        cases: [
          { caseId: 't4-injection', params: {} },
          { caseId: 'control', params: {}, scored: false },
        ],
      }),
    )
    const result = await judgeSweep(
      {
        store: await seeded(
          [...backgroundPair('t4-injection'), ...backgroundPair('control')],
          [backgroundManifest('base'), backgroundManifest('candidate')],
        ),
        llm: alwaysX,
        registry: [BRIEFING],
        caseJudging: () => JUDGING,
      },
      { ...backgroundEnv, baseDir },
    )
    expect(result.report.agents[0]?.controls.map((c) => c.caseId)).toEqual([
      'control',
    ])
    expect(result.report.agents[0]?.controlsScoredAnyway).toBeUndefined()
  })
})

describe('what a sweep actually spent', () => {
  // 1,000 input at $3/M plus 100 output at $15/M: $0.0045 a call.
  const priced: JsonJudgeModel = {
    jsonCompletion: async ({ schema }) => ({
      object: schema.parse(verdict('X')),
      tokens: 1_100,
      inputTokens: 1_000,
      outputTokens: 100,
      model: 'claude-sonnet-4-6',
    }),
  }

  it('totals every arm run and every panel call', async () => {
    const result = await run(await seeded(cases(3)), priced)
    const cost = result.report.actualCost
    // Each fixture run stored $0.097.
    expect(cost?.base).toEqual({
      usd: 0.097 * 3,
      runs: 3,
      unmeasured: { noCostRecorded: 0, unpricedModel: 0 },
    })
    expect(cost?.candidate.usd).toBeCloseTo(0.097 * 3, 6)
    expect(cost?.judge.calls).toBeGreaterThan(0)
    expect(cost?.judge.usd).toBeCloseTo(0.0045 * (cost?.judge.calls ?? 0), 6)
    expect(cost?.agents).toEqual([
      {
        agentId: 'chief_of_staff',
        base: cost?.base,
        candidate: cost?.candidate,
        judge: cost?.judge,
      },
    ])
    expect(result.markdown).toMatch(
      /^## Universal Judge\n\n\*\*Actual cost: \$/,
    )
    expect(result.markdown).toContain('- spent on this agent: $')
  })

  // Excluded from the verdict, still on the bill.
  it('counts a pair the judge excluded', async () => {
    const broken = pair('broken').map((record) =>
      record.arm === 'base'
        ? { ...record, status: 'infraError' as const, output: null }
        : record,
    )
    const records = [...cases(3), ...broken]
    const result = await run(await seeded(records), priced)
    expect(result.report.actualCost?.base.runs).toBe(4)
  })

  // A failed panel call reports no usage, so the total cannot be exact.
  it('reads "at least" when a panel call threw', async () => {
    let calls = 0
    const flaky: JsonJudgeModel = {
      jsonCompletion: async (options) => {
        calls += 1
        if (calls === 1) throw new Error('rate limited')
        return priced.jsonCompletion(options)
      },
    }
    const result = await run(await seeded(cases(3)), flaky)
    expect(result.report.actualCost?.judge.failedCalls).toBe(1)
    expect(result.markdown).toMatch(
      /^## Universal Judge\n\n\*\*Actual cost: at least \$/,
    )
    expect(result.markdown).toContain('1 judge call(s) failed')
  })

  // The arm totals count every record, so a record for an agent outside the
  // selection has to show up somewhere the per-agent lines do not.
  it('puts records outside the selection on their own row', async () => {
    const stray = pair('stray').map((record) => ({
      ...record,
      agentId: 'priority_flow',
      runId: `${record.runId}:stray`,
    }))
    const result = await run(await seeded([...cases(3), ...stray]), priced)
    const cost = result.report.actualCost
    expect(cost?.base.runs).toBe(4)
    expect(cost?.agents.map((a) => a.base.runs)).toEqual([3])
    expect(cost?.unselected?.base.runs).toBe(1)
    expect(cost?.unselected?.candidate.runs).toBe(1)
  })

  it('is absent from a sweep that could not spend', async () => {
    const store = await seeded(cases(3), [
      manifest('base', { spent: false }),
      manifest('candidate', { spent: false }),
    ])
    const result = await judgeSweep(
      { store, llm: priced, registry: REGISTRY },
      { ...env, spends: false },
    )
    expect(result.report.actualCost).toBeUndefined()
    expect(result.markdown).not.toContain('Actual cost')
  })
})
