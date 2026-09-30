import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { hoursToMilliseconds } from 'date-fns'
import type { JsonJudgeModel } from '../../general/ordinance-flow/evals/coldJudge'
import type { AgentEntry } from './agents'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import { CHAT_PAIR } from './fixtures/records'
import { CaseVerdictSchema, RUBRIC_VERSION, type CaseVerdict } from './judge'
import type { RunRecord } from './record'
import {
  createLocalRecordStore,
  MANIFEST_SCHEMA_VERSION,
  type ArmManifest,
  type RecordStore,
} from './records'
import {
  cannedVerdict,
  emitReport,
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

const REGISTRY: readonly AgentEntry[] = [COS]

const env: SweepEnv = {
  sweepId: BASE.sweepId,
  agentIds: ['chief_of_staff'],
  recordsDir: '/unused',
  spends: true,
}

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
    // And every judgment came back cannot-determine, so no pair yielded a
    // usable score and the corpus has zero cases to average.
    expect(score?.overall.judgments).toBeGreaterThanOrEqual(3)
    expect(score?.overall.cannotDetermine).toBe(score?.overall.judgments)
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
    expect((overall?.wins ?? 0) + (overall?.losses ?? 0)).toBe(
      overall?.judgments,
    )
    expect(overall?.ties).toBe(0)
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
    expect(result.markdown).toContain('**Coverage: 1 of 1 agents wired.**')
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
      manifest('candidate'),
    ])
    const result = await run(store)
    expect(result.report.placeholderCases).toEqual(['chief_of_staff'])
    expect(result.markdown).toContain('**Placeholder inputs:** chief_of_staff')
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
