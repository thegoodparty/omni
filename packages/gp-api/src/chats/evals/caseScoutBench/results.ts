import { z } from 'zod'
import { DraftOutcome } from '@/caseScout/schemas/caseScoutBucket.schema'
import { DraftedCaseSchema } from '@/caseScout/schemas/draftedCase.schema'
import { estimateAfter, type CostAfter } from './cost'
import { BenchFixtureSchema } from './fixtures'
import { FAIL, type BenchRun, type FixtureResult } from './runner'

export type BenchMode = 'live' | 'stub'

export type GradeSummary = {
  drafts: number
  graded: number
  allThrees: number
  allThreesShare: number | null
}

export type BenchResults = {
  runId: string
  createdAt: string
  mode: BenchMode
  outDir: string
  cost: CostAfter
  summary: {
    fixtures: number
    fixturesPassed: number
    drafts: number
    byCategory: Record<string, { fixtures: number; passed: number }>
    checkFailures: Record<string, number>
  }
  scoringErrors: string[]
  fixtures: FixtureResult[]
  gradeSummary?: GradeSummary
}

export const buildResults = (
  run: BenchRun,
  mode: BenchMode,
  outDir: string,
  createdAt: Date,
): BenchResults => {
  const byCategory: BenchResults['summary']['byCategory'] = {}
  const checkFailures: Record<string, number> = {}
  for (const result of run.results) {
    const bucket = (byCategory[result.category] ??= { fixtures: 0, passed: 0 })
    bucket.fixtures += 1
    bucket.passed += result.passed ? 1 : 0
    for (const [name, check] of Object.entries(result.checks)) {
      if (check.status === FAIL) {
        checkFailures[name] = (checkFailures[name] ?? 0) + 1
      }
    }
  }
  const cost = estimateAfter(run.calls)
  return {
    runId: run.runId,
    createdAt: createdAt.toISOString(),
    mode,
    outDir,
    cost:
      mode === 'stub'
        ? { ...cost, estimatedUsd: 0, estimatedUsdByStage: {} }
        : cost,
    summary: {
      fixtures: run.results.length,
      fixturesPassed: run.results.filter((r) => r.passed).length,
      drafts: run.results.filter((r) => r.case).length,
      byCategory,
      checkFailures,
    },
    scoringErrors: run.scoringErrors,
    fixtures: run.results,
  }
}

const GradeValueSchema = z.union([z.literal(1), z.literal(2), z.literal(3)])

export const GradesFileSchema = z.strictObject({
  runId: z.string(),
  grades: z.record(
    z.string(),
    z.strictObject({
      faithful: GradeValueSchema.nullable().default(null),
      gradeable: GradeValueSchema.nullable().default(null),
      fictional: GradeValueSchema.nullable().default(null),
      note: z.string().default(''),
    }),
  ),
})
export type GradesFile = z.infer<typeof GradesFileSchema>

const DIMENSIONS = ['faithful', 'gradeable', 'fictional'] as const

export const mergeGrades = (
  results: BenchResults,
  grades: GradesFile,
): BenchResults => {
  if (grades.runId !== results.runId) {
    throw new Error(
      `grades are for run ${grades.runId}, results are for run ` +
        results.runId,
    )
  }
  const ids = new Set(results.fixtures.map((f) => f.id))
  const unknown = Object.keys(grades.grades)
    .filter((id) => !ids.has(id))
    .sort()
  if (unknown.length > 0) {
    throw new Error(
      `grades name fixtures this run does not have: ${unknown.join(', ')}`,
    )
  }
  const fixtures = results.fixtures.map((fixture) => {
    const entry = grades.grades[fixture.id]
    return entry ? { ...fixture, grades: entry } : fixture
  })
  const drafted = fixtures.filter((f) => f.case)
  const complete = drafted.filter((f) =>
    DIMENSIONS.every((dim) => f.grades[dim] !== null),
  )
  const perfect = complete.filter((f) =>
    DIMENSIONS.every((dim) => f.grades[dim] === 3),
  )
  return {
    ...results,
    fixtures,
    gradeSummary: {
      drafts: drafted.length,
      graded: complete.length,
      allThrees: perfect.length,
      allThreesShare:
        complete.length > 0
          ? Number((perfect.length / complete.length).toFixed(3))
          : null,
    },
  }
}

const StageCountsSchema = z.strictObject({
  score: z.number(),
  draft: z.number(),
  gate: z.number(),
})

const CheckSchema = z.strictObject({
  status: z.enum(['pass', 'fail', 'n/a']),
  detail: z.string(),
})

const FixtureResultSchema = z.strictObject({
  id: z.string(),
  agent: z.string(),
  category: BenchFixtureSchema.shape.category,
  summary: z.string(),
  notes: z.string(),
  expect: BenchFixtureSchema.shape.expect,
  sessionIds: z.array(z.string()),
  score: z
    .strictObject({
      severity: z.number(),
      requests: z.array(
        z.strictObject({
          severity: z.number(),
          knownPattern: z.string(),
          majorFailureType: z.string(),
          overallRating: z.string(),
          summary: z.string(),
          reason: z.string(),
        }),
      ),
    })
    .nullable(),
  scoringError: z.string().nullable(),
  outcome: z.enum(Object.values(DraftOutcome)).nullable(),
  coveredBy: z.string().nullable(),
  needsSetup: z.string().nullable(),
  draftResponse: z
    .strictObject({
      outcome: z.enum(['newCase', 'coveredBy', 'needsSetup']),
      failureSummary: z.string(),
      case: z
        .strictObject({
          caseId: z.string(),
          question: z.string().optional(),
          turns: z.array(z.string()).optional(),
          condition: z.string(),
          handledWhen: z.string(),
        })
        .nullable(),
      coveredBy: z.string().nullable(),
      needsSetup: z.string().nullable(),
    })
    .nullable(),
  gate: z
    .strictObject({
      passed: z.boolean(),
      rule: z
        .enum([
          'denylist',
          'copiedText',
          'contactPattern',
          'secondRead',
          'schema',
        ])
        .nullable(),
      reason: z.string().nullable(),
      flagged: z.array(z.string()).nullable().optional(),
    })
    .nullable(),
  case: DraftedCaseSchema.nullable(),
  checks: z.record(z.string(), CheckSchema),
  passed: z.boolean(),
  grades: GradesFileSchema.shape.grades.valueType,
})

// What --grade reads back from disk, checked rather than trusted.
export const BenchResultsSchema: z.ZodType<BenchResults> = z.strictObject({
  runId: z.string(),
  createdAt: z.string(),
  mode: z.enum(['live', 'stub']),
  outDir: z.string(),
  cost: z.strictObject({
    model: z.string(),
    calls: StageCountsSchema,
    estimatedUsd: z.number(),
    estimatedUsdByStage: StageCountsSchema.partial(),
  }),
  summary: z.strictObject({
    fixtures: z.number(),
    fixturesPassed: z.number(),
    drafts: z.number(),
    byCategory: z.record(
      z.string(),
      z.strictObject({ fixtures: z.number(), passed: z.number() }),
    ),
    checkFailures: z.record(z.string(), z.number()),
  }),
  scoringErrors: z.array(z.string()),
  fixtures: z.array(FixtureResultSchema),
  gradeSummary: z
    .strictObject({
      drafts: z.number(),
      graded: z.number(),
      allThrees: z.number(),
      allThreesShare: z.number().nullable(),
    })
    .optional(),
})
