import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { formatInTimeZone } from 'date-fns-tz'
import { CaseScoutModelService } from '@/caseScout/services/caseScoutModel.service'
import { CASES_DIR } from '../judge/cases'
import { estimateBefore } from './cost'
import { FIXTURES_DIR, loadFixtures } from './fixtures'
import { renderReport } from './report'
import {
  BenchResultsSchema,
  buildResults,
  GradesFileSchema,
  mergeGrades,
  type BenchResults,
} from './results'
import { runBench, type BenchModel } from './runner'
import { labelEchoModel } from './stubs'

// `npm run case-scout:bench -w packages/gp-api`: see README.md beside this
// file.

export const LIVE_COMMAND =
  'npm run case-scout:bench -w packages/gp-api -- --live'

export type CliIo = {
  out: (line: string) => void
  err: (line: string) => void
  // The live model, built only once a live run is approved, so a refused or
  // stub run never constructs it.
  liveModel: () => BenchModel
  now: () => Date
}

const defaultIo: CliIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  liveModel: () => new CaseScoutModelService(),
  now: () => new Date(),
}

const writeOutputs = (results: BenchResults, outDir: string): void => {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    path.join(outDir, 'results.json'),
    `${JSON.stringify(results, null, 2)}\n`,
  )
  writeFileSync(path.join(outDir, 'report.html'), renderReport(results))
}

const grade = (runDir: string, gradesPath: string, io: CliIo): number => {
  const resultsPath = path.join(runDir, 'results.json')
  let merged: BenchResults
  try {
    merged = mergeGrades(
      BenchResultsSchema.parse(JSON.parse(readFileSync(resultsPath, 'utf8'))),
      GradesFileSchema.parse(JSON.parse(readFileSync(gradesPath, 'utf8'))),
    )
  } catch (err) {
    io.err(`could not merge grades: ${String(err)}`)
    return 1
  }
  writeOutputs(merged, runDir)
  const summary = merged.gradeSummary
  io.out(
    `merged grades into ${resultsPath}: ${summary?.graded} of ` +
      `${summary?.drafts} drafts graded, ${summary?.allThrees} at 3/3/3`,
  )
  return 0
}

export const main = async (
  argv: string[],
  io: CliIo = defaultIo,
): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      live: { type: 'boolean', default: false },
      stub: { type: 'boolean', default: false },
      'out-dir': { type: 'string', default: 'bench-out' },
      fixtures: { type: 'string', default: FIXTURES_DIR },
      'cases-dir': { type: 'string', default: CASES_DIR },
      grade: { type: 'boolean', default: false },
    },
  })

  if (values.grade) {
    const [runDir, gradesPath] = positionals
    if (!runDir || !gradesPath || positionals.length !== 2) {
      io.err('usage: --grade <run dir> <grades json>')
      return 2
    }
    return grade(runDir, gradesPath, io)
  }

  const fixtures = loadFixtures(values.fixtures)
  const casesDir = values['cases-dir']
  const estimate = estimateBefore(fixtures, casesDir)
  io.out(`${fixtures.length} fixtures, model ${estimate.model}`)
  io.out(
    'estimated cost of a live run: about ' +
      `$${estimate.expectedUsd.toFixed(2)} ` +
      `(${estimate.expectedCalls.score} score, ` +
      `${estimate.expectedCalls.draft} draft, ` +
      `${estimate.expectedCalls.gate} gate calls), at most ` +
      `$${estimate.worstUsd.toFixed(2)} if every covered fixture is ` +
      'drafted and every call retries once',
  )

  if (values.live && values.stub) {
    io.err('pass --live or --stub, not both')
    return 2
  }
  if (!values.live && !values.stub) {
    io.err(
      'refusing to run: a bench run makes real, paid Anthropic calls. ' +
        'Get approval for the cost above, then run:\n' +
        `  ${LIVE_COMMAND}\n` +
        'or preview the report for free with --stub.',
    )
    return 2
  }
  if (values.live && !process.env.ANTHROPIC_API_KEY) {
    io.err('--live needs ANTHROPIC_API_KEY set in this shell')
    return 2
  }

  const createdAt = io.now()
  const runId = formatInTimeZone(createdAt, 'UTC', "yyyyMMdd'T'HHmmss'Z'")
  const outDir = path.resolve(values['out-dir'], runId)
  const mode = values.live ? 'live' : 'stub'
  const run = await runBench({
    fixtures,
    model: values.live ? io.liveModel() : labelEchoModel(fixtures),
    now: createdAt,
    runId,
    casesDir,
  })
  const results = buildResults(run, mode, outDir, createdAt)
  writeOutputs(results, outDir)

  const { summary } = results
  io.out(
    `${summary.fixturesPassed} of ${summary.fixtures} fixtures passed every ` +
      `automatic check, ${summary.drafts} drafts`,
  )
  const failures = Object.entries(summary.checkFailures)
  if (failures.length > 0) {
    io.out(`failed checks: ${failures.map(([k, v]) => `${k} ${v}`).join(', ')}`)
  }
  io.out(
    values.live
      ? `estimated spend: $${results.cost.estimatedUsd.toFixed(2)}`
      : 'stub run: nothing spent, and the results say nothing about ' +
          "the scout's quality",
  )
  io.out(
    `wrote ${path.join(outDir, 'results.json')} and ` +
      path.join(outDir, 'report.html'),
  )
  return 0
}

// `require.main === module` is the house pattern (see judge/cli.ts): gp-api
// is CommonJS, so import.meta is not available.
if (require.main === module) {
  void main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((err: Error) => {
      console.error(err.message)
      process.exitCode = 1
    })
}
