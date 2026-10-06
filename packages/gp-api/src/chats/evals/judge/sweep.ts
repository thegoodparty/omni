import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { hoursToMilliseconds } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { LlmService } from '@/llm/services/llm.service'
import type { JsonJudgeModel } from '../../general/ordinance-flow/evals/coldJudge'
import { overrideEnvForEvals } from '../envOverride'
import { AGENTS, type AgentEntry } from './agents'
import { armGap, windowOf } from './armGap'
import { createRng } from './bootstrap'
import {
  CaseListError,
  caseDimensionsOf,
  loadCaseList,
  type CaseDimension,
  type CaseList,
} from './cases'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig, type Rng } from './config'
import {
  allIdenticalReason,
  identicalOutputs,
  type IdenticalOutputs,
} from './identicalOutputs'
import {
  CaseDimensionCollisionError,
  judgeAll,
  RUBRIC_VERSION,
  type CaseVerdict,
} from './judge'
import {
  IdenticalConfigError,
  MismatchedInputError,
  normalizeAgent,
  type NormalizedAgent,
  type NormalizeOptions,
} from './normalize'
import { invariantViolations } from './invariants'
import type { RunRecord } from './record'
import {
  RecordStoreError,
  type AgentRulings,
  type ArmManifest,
  type RecordStore,
} from './records'
import {
  renderReport,
  unpinnedMartReads,
  type AgentIdenticalConfig,
  type Refusal,
  type SeededTranscripts,
  type StoredRulings,
  type SweepReport,
} from './report'
import { scoreAgent, type AgentScore } from './score'
import {
  parseSweepEnv,
  storeFromEnv,
  SweepEnvError,
  type SweepEnv,
} from './sweepEnv'

// STEP 3 OF THREE, and the only one that is not a vitest suite.
//
// The arms are captured by `sweep.eval.test.ts`, twice, in two worktrees —
// that suite has to be vitest because `useTestService()` registers hooks to
// stand up Postgres and the app. This step needs none of that: it reads both
// arms' stored records and runs pure functions over them, so it runs under
// `tsx` and the workflow can invoke it as a command.
//
// Which is the point. Pure functions living in a vitest file cannot be called
// from a workflow step cleanly, and a "test" that is really a program is how
// a job ends up green having done nothing.

export interface JudgingDeps {
  store: RecordStore
  llm: JsonJudgeModel
  config?: JudgeConfig
  // Seeded by default, so the X/Y assignment is reproducible from a sweep and
  // a seed rather than only from a run.
  rng?: Rng
  registry?: readonly AgentEntry[]
  // Where a case's own dimensions come from. THIS checkout's case list, not
  // either arm's records: the judging step runs at the candidate commit, the
  // arms never record the field, and so both slots of a pair are asked the
  // same questions whatever the base ref knew.
  loadCases?: (agent: AgentEntry) => CaseList
}

export interface SweepResult {
  report: SweepReport
  markdown: string
  // Non-zero when the sweep could not do what it was asked: an arm that never
  // reported, or an agent that produced nothing. NOT non-zero for a WORSE
  // verdict — the judge reports, it does not gate.
  exitCode: number
}

// Reads after "taken with it": the manifests in a mismatch all disagree the
// same way, so the first one's flag describes all of them.
//
// NOT "unset", which is what this said and could not know. The manifest
// carries a boolean, so an absent JUDGE_SPEND and a garbled one
// (JUDGE_SPEND=yes, which `spends()` reads as "do not spend") are the same
// value here. This message lands after two arms have been captured, and
// sending the reader to look for a variable nobody set — when it was set to
// the wrong thing — is the slower half of the same debugging session.
const m0 = (manifests: readonly ArmManifest[]): string =>
  manifests[0]?.spent === true
    ? "set to 'true'"
    : "set to something other than 'true', or not set at all"

const skipReasonFor = (
  manifests: readonly ArmManifest[],
  agentId: string,
): string | undefined =>
  manifests
    .flatMap((m) => m.skipped.filter((s) => s.agentId === agentId))
    .map((s) => s.reason)[0]

const refusalFor = (
  agentId: string,
  records: readonly RunRecord[],
  manifests: readonly ArmManifest[],
): Refusal | null => {
  const named = skipReasonFor(manifests, agentId)
  if (named !== undefined) {
    return { agentId, reason: `Skipped during capture: ${named}` }
  }
  const arms = new Set(records.map((r) => r.arm))
  if (records.length === 0) {
    return {
      agentId,
      reason:
        'Neither arm produced a record for this agent, and neither ' +
        'capture said why it was skipped. That is a gap in the sweep ' +
        'rather than a finding about the branch.',
    }
  }
  if (arms.size < 2) {
    const only = [...arms][0]
    return {
      agentId,
      reason:
        `Only the ${only} arm produced records, so there is nothing to ` +
        'compare against. A comparison needs both sides.',
    }
  }
  return null
}

// A failed write costs the per-case record, not the verdict: the judgments
// are already paid for and scored in memory, so the sweep reports and says
// the rulings were lost rather than throwing the verdict away with them.
const storeRulings = async (
  store: RecordStore,
  rulings: AgentRulings,
): Promise<string | null> => {
  try {
    return await store.putRulings(rulings)
  } catch (err) {
    console.error(
      `rulings for ${rulings.agentId} were not stored: ` +
        (err instanceof Error ? err.name : 'unknown error'),
    )
    return null
  }
}

// Background agents only: a chat case has no dimensions of its own yet.
const caseDimensionsByCase = (
  agent: AgentEntry | undefined,
  load: (agent: AgentEntry) => CaseList,
): ReadonlyMap<string, readonly CaseDimension[]> => {
  if (agent === undefined || agent.shape !== 'background') return new Map()
  return new Map(
    load(agent)
      .cases.map((one) => [one.caseId, caseDimensionsOf(one)] as const)
      .filter(([, dimensions]) => dimensions.length > 0),
  )
}

const withCaseDimensions = (
  normalized: NormalizedAgent,
  byCase: ReadonlyMap<string, readonly CaseDimension[]>,
): NormalizedAgent =>
  byCase.size === 0
    ? normalized
    : {
        ...normalized,
        judgeable: normalized.judgeable.map((c) => {
          const caseDimensions = byCase.get(c.caseId)
          return caseDimensions === undefined
            ? c
            : { ...c, payload: { ...c.payload, caseDimensions } }
        }),
      }

export const judgeSweep = async (
  deps: JudgingDeps,
  env: SweepEnv,
): Promise<SweepResult> => {
  const config = deps.config ?? DEFAULT_JUDGE_CONFIG
  const rng = deps.rng ?? createRng(1)
  const registry = deps.registry ?? AGENTS
  const loadCases = deps.loadCases ?? loadCaseList

  // Both manifests, first and fatally. An arm with no manifest never reported
  // a capture, and the failure that produces it is a vitest suite whose tests
  // all self-skipped — which passes, and which would otherwise be judged as
  // an agent that had nothing to say.
  const baseManifest = await deps.store.getManifest(env.sweepId, 'base')
  const candidateManifest = await deps.store.getManifest(
    env.sweepId,
    'candidate',
  )
  const manifests = [baseManifest, candidateManifest]

  // The arms and this step read JUDGE_SPEND from two different workflow
  // steps, so one can be set and the other not — and the first version of
  // this workflow shipped exactly that way round, paying for both captures
  // and then grading them with the canned panel. Neither direction may go
  // green: a paid capture graded by a canned panel reports CAN'T SAY on every
  // case, and a paid panel grading canned replies reports a confident verdict
  // about two stub strings.
  const disagreeing = manifests.filter((m) => m.spent !== env.spends)
  if (disagreeing.length > 0) {
    const arms = disagreeing.map((m) => m.arm).join(' and ')
    throw new SweepEnvError(
      `JUDGE_SPEND is ${env.spends ? '' : 'not '}'true' on this step but ` +
        `the ${arms} capture ${disagreeing.length > 1 ? 'were' : 'was'} ` +
        `taken with it ${m0(disagreeing)}. Set it the same way on every ` +
        'step of the sweep — the arms have already run, and a verdict ' +
        'graded on a different setting than the captures says nothing ' +
        'about the branch.',
    )
  }

  const records = [
    ...(await deps.store.listRecords(env.sweepId, 'base')),
    ...(await deps.store.listRecords(env.sweepId, 'candidate')),
  ]

  const scores: AgentScore[] = []
  const refusals: Refusal[] = []
  const placeholderCases: string[] = []
  const seededTranscripts: SeededTranscripts[] = []
  const identical: IdenticalOutputs[] = []
  const identicalConfigs: AgentIdenticalConfig[] = []
  const identicalOutputsReported: string[] = []
  const rulings: StoredRulings[] = []

  // A REQUEST THAT NAMED ITS AGENTS DISARMS BOTH SAMENESS REFUSALS. Not the
  // other guards: a missing manifest, one arm's records, a spend switch the
  // arms disagree with are all still fatal, because none of them is a verdict
  // anybody could read. These two are — an explicit model swap hashes
  // identically by construction, and an inert change really does produce the
  // same bytes — so they are reported with a qualifier that says what the
  // verdict can and cannot mean. See NormalizeOptions and report.ts.
  const options: NormalizeOptions = {
    explicitSelection: env.explicitSelection,
  }

  for (const agentId of env.agentIds) {
    const forAgent = records.filter((r) => r.agentId === agentId)
    const refusal = refusalFor(agentId, forAgent, manifests)
    if (refusal !== null) {
      refusals.push(refusal)
      continue
    }

    if (
      manifests.some((m) =>
        m.agents.some((a) => a.agentId === agentId && a.placeholderCases),
      )
    ) {
      placeholderCases.push(agentId)
    }

    // Unioned across the arms rather than read off one of them: the two are
    // separate checkouts, and an arm whose ref predates the field records
    // nothing at all. Marking the union means a case either arm seeded is
    // reported, which is the safe direction — the risk being warned about is
    // reading a seeded verdict as an unseeded one.
    const seededCaseIds = [
      ...new Set(
        manifests.flatMap((m) =>
          m.agents
            .filter((a) => a.agentId === agentId)
            .flatMap((a) => a.seededTranscriptCases ?? []),
        ),
      ),
    ].sort()
    if (seededCaseIds.length > 0) {
      seededTranscripts.push({ agentId, caseIds: seededCaseIds })
    }

    try {
      // Refuses two arms that hashed to the same config unless the request
      // named them: on `auto` the agent saw no difference, so there is
      // nothing to compare and a sweep would have spent money proving two
      // identical things identical.
      const normalized = withCaseDimensions(
        normalizeAgent(forAgent, rng, config, options),
        caseDimensionsByCase(
          registry.find((a) => a.agentId === agentId),
          loadCases,
        ),
      )
      if (normalized.identicalConfig !== null) {
        identicalConfigs.push({ agentId, ...normalized.identicalConfig })
      }

      // Before any judge call, because a sweep whose arms produced the same
      // bytes has nothing for a judge to read and the calls would be paid
      // for either way.
      const sameness = identicalOutputs(agentId, normalized.judgeable)
      identical.push(sameness)
      if (sameness.allIdentical && config.gates.failOnAllIdenticalOutputs) {
        if (!env.explicitSelection) {
          refusals.push({ agentId, reason: allIdenticalReason(sameness) })
          continue
        }
        identicalOutputsReported.push(agentId)
      }

      const judgments = await judgeAll(deps.llm, normalized.judgeable, config)
      scores.push(scoreAgent({ normalized, judgments }, config))
      rulings.push({
        agentId,
        location: await storeRulings(deps.store, {
          sweepId: env.sweepId,
          agentId,
          rubricVersion: RUBRIC_VERSION,
          judgments,
        }),
      })
    } catch (err) {
      if (
        !(err instanceof IdenticalConfigError) &&
        !(err instanceof MismatchedInputError) &&
        !(err instanceof CaseListError) &&
        !(err instanceof CaseDimensionCollisionError)
      ) {
        throw err
      }
      refusals.push({ agentId, reason: err.message })
    }
  }

  const unpinned = unpinnedMartReads(records)
  // Over every record for the same reason the mart check is: a run excluded
  // from the comparison still produced an answer, and an answer that broke a
  // rule is a fact about the branch whether or not it was judgeable.
  const broken = invariantViolations(records)

  const report: SweepReport = {
    agents: scores,
    ...(refusals.length > 0 && { refusals }),
    registry,
    armGap: armGap(
      windowOf(baseManifest),
      windowOf(candidateManifest),
      hoursToMilliseconds(config.armGap.maxHours),
    ),
    ...(placeholderCases.length > 0 && { placeholderCases }),
    ...(seededTranscripts.length > 0 && { seededTranscripts }),
    // Reported whatever the count, because "4 of 22 pairs matched" is
    // evidence beside a verdict and it is the number that makes a dropped
    // candidate obvious.
    ...(identical.length > 0 && { identicalOutputs: identical }),
    // Both absent unless something matched AND the selection was explicit, so
    // the ordinary sweep's report carries neither qualifier.
    ...(identicalConfigs.length > 0 && { identicalConfigs }),
    ...(identicalOutputsReported.length > 0 && { identicalOutputsReported }),
    // Over EVERY record, not only the judgeable pairs. A run that was
    // excluded still read the live mart, and the point of the warning is to
    // say which reads the missing pin was free to move.
    ...(unpinned.length > 0 && { unpinnedMart: unpinned }),
    ...(broken.length > 0 && { invariantViolations: broken }),
    ...(rulings.length > 0 && { rulings }),
  }

  return {
    report,
    markdown: renderReport(report, config),
    // A sweep that produced no verdict at all did not do its job, whatever
    // the refusals say. A sweep with some verdicts and some refusals did:
    // the refusals are in the report and one agent's gap does not invalidate
    // another's comparison.
    //
    // A QUALIFIED VERDICT IS STILL A VERDICT, so an explicit sweep whose arms
    // hashed alike, or whose every pair matched, ends green where it used to
    // end red. That is the change, not an oversight: exiting non-zero on a
    // verdict this report carries and explains would make "report rather than
    // refuse" a distinction with no difference, and this exit code means "the
    // sweep could not do what it was asked", never "the answer was SAME".
    exitCode: scores.length === 0 ? 1 : 0,
  }
}

// Written to stdout for the run log and appended to the job summary when
// GitHub gives us one. The PR comment itself belongs to whoever posts it; this
// step's job is to produce the text.
//
// Bracketed with `::stop-commands::` on the way to stdout, because stdout is
// the channel the Actions runner parses for workflow commands. A refusal
// reason is arbitrary error text (see ArmSkip.reason), so a line starting
// `::error::` or `::add-mask::` in it would be executed as a command rather
// than printed. The token is random per run so nothing in the report can
// close the guard it is inside. judge.yml takes the same care with the PR
// comment; stdout had none.
export const emitReport = (
  markdown: string,
  env: NodeJS.ProcessEnv = process.env,
): void => {
  const token = randomUUID()
  console.log(`::stop-commands::${token}`)
  console.log(markdown)
  console.log(`::${token}::`)

  const summary = env.GITHUB_STEP_SUMMARY
  if (summary !== undefined && summary !== '') {
    appendFileSync(summary, `${markdown}\n`, 'utf8')
  }
}

// Built only when `main` runs, never on import, because `overrideEnvForEvals`
// rewrites the process environment from `.env` — which a test that imported
// this module must not have happen to it. The panel's seats are pinned in
// config, so which model answers is the seat's business, not this function's.
//
// Skipped under CI: the file is a local-developer convenience, and letting a
// committed `.env` in a branch override the credentials the workflow supplied
// is not something this job should allow.
//
// LlmService is constructed directly rather than pulled out of the Nest app:
// this entry point is pure functions over stored records, and booting the app
// graph to make a model call would drag in Postgres and the queue for
// nothing. Its only required dependency is a logger.
// LlmService refuses to construct without AI_MODELS, and AI_MODELS is its
// DEFAULT fallback chain — the one thing this judge never reaches, because
// every seat in config.panel pins its own model. The list is in `.env.test`,
// in `.env.example` and in the deploy config; the judging step runs under
// tsx, which loads none of them, so the first live sweep died here with
// "Please set AI_MODELS in your .env" after both arms had been paid for.
//
// Derived from the seats rather than written out as a fourth copy: a second
// seat then lands in the fallback list on its own, and the value is at least
// true to what the panel actually calls.
export const ensureFallbackModels = (
  config: JudgeConfig,
  env: NodeJS.ProcessEnv = process.env,
): void => {
  const existing = env.AI_MODELS
  if (existing !== undefined && existing.trim() !== '') return
  // Derived AND checked, because an empty seat list joins to the empty
  // string — the exact value the guard above reads as unset. Assigning it
  // would leave this function having "filled" the variable and LlmService
  // throwing the same message, after both arms were billed.
  const seats = config.panel.seats.filter((seat) => seat.trim() !== '')
  if (seats.length === 0) {
    throw new Error(
      'The judge panel has no seats, so there is no model to name in ' +
        'AI_MODELS and no seat to ask for a verdict. Fix panel.seats in ' +
        'config.ts before running a sweep.',
    )
  }
  env.AI_MODELS = seats.join(',')
}

export const anthropicJudge = (config: JudgeConfig): JsonJudgeModel => {
  if (process.env.CI !== 'true') overrideEnvForEvals()
  ensureFallbackModels(config)
  return new LlmService(new PinoLogger({ pinoHttp: {} }))
}

// Answers `cannot_determine` on every dimension, which is what a judge that
// never read anything honestly knows. Scoring then reports CAN'T SAY with the
// cannot-determine rate that says why.
//
// This is what makes `JUDGE_SPEND` mean something here. The judging step
// spends one panel call per judgeable pair per seat, so a switch that gated
// only the arms left the "exercise the pipeline for nothing" path paying for
// the whole panel — and it did, before this existed.
export const CANNED_JUDGE_NOTE =
  '> **No model was called.** `JUDGE_SPEND` was not `true`, so the panel is ' +
  'canned and answered `cannot_determine` on every dimension. The verdict ' +
  'below says the pipeline ran; it says nothing about the branch.'

const CANNED_REASONING =
  'No model was called: JUDGE_SPEND was not true, so nothing read these two ' +
  'outputs and nothing can be told apart.'

export const cannedVerdict = (
  config: JudgeConfig,
  dimensions: readonly string[] = config.dimensions,
): CaseVerdict => ({
  rubric_version: RUBRIC_VERSION,
  dimensions: Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      { reasoning: CANNED_REASONING, verdict: 'cannot_determine' as const },
    ]),
  ),
  overall: { reasoning: CANNED_REASONING, verdict: 'cannot_determine' },
})

// The dimension keys a panel schema requires, read off the schema itself: the
// canned judge is handed nothing else, and a case with its own dimensions
// requires keys the config does not name.
const requiredDimensions = (
  schema: z.ZodType,
  config: JudgeConfig,
): string[] =>
  schema instanceof z.ZodObject &&
  schema.shape.dimensions instanceof z.ZodObject
    ? Object.keys(schema.shape.dimensions.shape)
    : [...config.dimensions]

export const cannedJudge = (config: JudgeConfig): JsonJudgeModel => ({
  // Parsed through the caller's own schema, so a canned verdict that no
  // longer satisfies it fails here rather than arriving as an "ungraded"
  // judgment — which reads as a broken judge and is how the first version of
  // this got every case wrong while still printing a report.
  jsonCompletion: async ({ schema }) => ({
    object: schema.parse(
      cannedVerdict(config, requiredDimensions(schema, config)),
    ),
    tokens: 0,
    model: 'canned-judge',
  }),
})

export const main = async (): Promise<number> => {
  const env = parseSweepEnv()
  const config = DEFAULT_JUDGE_CONFIG
  const result = await judgeSweep(
    {
      store: storeFromEnv(env),
      llm: env.spends ? anthropicJudge(config) : cannedJudge(config),
      config,
    },
    env,
  )
  emitReport(
    env.spends ? result.markdown : `${CANNED_JUDGE_NOTE}\n\n${result.markdown}`,
  )
  return result.exitCode
}

// Entry point, and it has to be here: a module that exports `main` and never
// calls it prints nothing and exits 0, which is exactly how a workflow step
// goes green having judged nothing. gp-api is CommonJS, so `require.main` is
// the house pattern rather than import.meta.
if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((err: Error) => {
      // A SweepEnvError or a RecordStoreError IS its message — printing the
      // stack of one would bury the sentence it exists to deliver. Anything
      // else is unexpected on a job that has already spent real money, so it
      // gets the whole error.
      if (err instanceof SweepEnvError || err instanceof RecordStoreError) {
        console.error(err.message)
      } else {
        console.error(err)
      }
      process.exitCode = 1
    })
}
