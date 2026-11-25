import { appendFileSync, writeFileSync } from 'node:fs'
import type { Reporter, TestCase, TestModule } from 'vitest/node'
import type { suiteVerdictAnnotation } from './annotation'
import type { HandledValue, MaterialChange, OrientedChange } from './grade'
import type { NotJudgedAttempt } from './pairwise'
import type { SuiteVerdict } from './stats'

// A cell's text is run- or model-derived, and the table is rendered as markdown
// in a job summary and in a PR comment. Escaping the HTML entities alone leaves
// `@`, `#` and link syntax live, so an error message could notify a person or
// post a link under the bot's name. One pass over the characters, so an entity's
// own `#` is never escaped again.
const CELL_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '|': '&#124;',
  '`': '&#96;',
  '[': '&#91;',
  ']': '&#93;',
  '#': '&#35;',
  '@': '&#64;',
  '\n': ' ',
  '\r': '',
}

const escapeCell = (value: string) =>
  [...value]
    .map((char) => CELL_ENTITIES[char] ?? char)
    .join('')
    // Schemes and bare `www.` hosts are autolinked without any markdown, so
    // break both. No entity contains a slash or a dot, so this is safe.
    .replaceAll('//', '&#47;&#47;')
    .replace(/www\./gi, (match) => `${match.slice(0, 3)}&#46;`)

const shorten = (value: string, limit = 300) =>
  value.length > limit ? `${value.slice(0, limit)}…` : value

export const renderPairwiseVerdicts = (
  modules: ReadonlyArray<TestModule>,
): string => {
  const rows: string[] = []
  const changeRows: string[] = []
  const caseRows: string[] = []
  const notJudgedRows: string[] = []
  for (const module of modules) {
    for (const suite of module.children.allSuites()) {
      const { pairwiseVerdict, pairwiseNotJudged } = suite.meta() as {
        pairwiseVerdict?: ReturnType<typeof suiteVerdictAnnotation>
        pairwiseNotJudged?: ReturnType<typeof suiteVerdictAnnotation>
      }
      if (pairwiseNotJudged) {
        let attempts: NotJudgedAttempt[] = []
        try {
          attempts = JSON.parse(pairwiseNotJudged.message)
        } catch (error) {
          notJudgedRows.push(
            `${escapeCell(suite.fullName)} | | | | | unreadable: ${escapeCell(String(error))}`,
          )
        }
        for (const { caseId, attempt, side, runs, error } of attempts)
          notJudgedRows.push(
            [
              escapeCell(suite.fullName),
              escapeCell(caseId),
              attempt,
              side,
              runs.length
                ? escapeCell(
                    runs
                      .map(({ runId, status }) => `${runId} (${status})`)
                      .join(', '),
                  )
                : 'none',
              escapeCell(shorten(error)),
            ].join(' | '),
          )
      }
      if (!pairwiseVerdict) continue
      const verdict = JSON.parse(pairwiseVerdict.message) as SuiteVerdict
      const { label, confirmed, cases, judged, notJudged } = verdict
      const regressions = confirmed.filter(
        ({ direction }) => direction === 'worse',
      ).length
      const improvements = confirmed.length - regressions
      const ties = cases.reduce((total, tally) => total + tally.ties, 0)
      const disagreements = cases.reduce(
        (total, tally) => total + tally.disagreements.length,
        0,
      )
      rows.push(
        [
          escapeCell(suite.fullName),
          label,
          judged,
          notJudged,
          regressions,
          improvements,
          ties,
          disagreements,
        ].join(' | '),
      )
      for (const change of confirmed)
        changeRows.push(
          [
            escapeCell(suite.fullName),
            escapeCell(change.caseId),
            escapeCell(change.criterion),
            change.direction === 'worse' ? 'regression' : 'improvement',
            change.attempts.length,
            escapeCell(
              shorten(
                change.attempts
                  .flatMap(({ evidence }) =>
                    evidence.filter((line) => line.length > 0),
                  )
                  .join(' / '),
              ),
            ),
          ].join(' | '),
        )
      for (const tally of cases)
        caseRows.push(
          [
            escapeCell(suite.fullName),
            escapeCell(tally.caseId),
            tally.verdict,
            tally.judged,
            tally.notJudged,
            tally.ties,
            tally.disagreements.length,
            tally.confirmed.length
              ? escapeCell(
                  tally.confirmed
                    .map(
                      ({ criterion, direction }) =>
                        `${direction === 'worse' ? '−' : '+'}${criterion}`,
                    )
                    .join(', '),
                )
              : 'none',
          ].join(' | '),
        )
    }
  }
  if (!rows.length) return ''
  return [
    '',
    '## Pairwise eval verdicts',
    '',
    '| Suite | Verdict | Judged pairs | Not judged | Confirmed regressions | Confirmed improvements | Ties | Disagreements |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.sort().map((row) => `| ${row} |`),
    '',
    ...(changeRows.length
      ? [
          '### Confirmed changes',
          '',
          'A change is confirmed when both grading orders read the same criterion in the same direction in at least two attempts of one case.',
          '',
          '| Suite | Case | Criterion | Direction | Attempts | Evidence |',
          '| --- | --- | --- | --- | ---: | --- |',
          ...changeRows.map((row) => `| ${row} |`),
          '',
        ]
      : []),
    ...(caseRows.length
      ? [
          '### Cases',
          '',
          '| Suite | Case | Verdict | Judged | Not judged | Ties | Disagreements | Confirmed |',
          '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
          ...caseRows.map((row) => `| ${row} |`),
          '',
        ]
      : []),
    ...(notJudgedRows.length
      ? [
          '## Not judged attempts',
          '',
          '| Suite | Case | Attempt | Failed at | Runs | Error |',
          '| --- | --- | ---: | --- | --- | --- |',
          ...notJudgedRows.map((row) => `| ${row} |`),
          '',
        ]
      : []),
  ].join('\n')
}

type Arm = 'base' | 'candidate'

export type PairwiseOrderResult = {
  // Which arm this grading call saw as A; the pair's other order swaps them.
  aArm: Arm
  reasoning: string
  handledWhen: { base: HandledValue; candidate: HandledValue } | null
  changes: OrientedChange[]
}

export type PairwiseAttemptResult = {
  attempt: number
  // Criteria both orders read as the same material change, oriented to the
  // arms. Empty when nothing changed, or when the orders disagreed.
  changes: MaterialChange[]
  // Criteria the orders read in opposite directions, or only one read at all.
  disagreements: string[]
  orders: PairwiseOrderResult[]
}

export type PairwiseCaseResult = {
  case: string
  attempts: PairwiseAttemptResult[]
}

export type PairwiseSuiteResult = {
  suite: string
  verdict: SuiteVerdict
  cases: PairwiseCaseResult[]
  notJudged: NotJudgedAttempt[]
}

// An annotation is JSON that already went through `redactSecrets`, so one can
// come back unreadable; a report that threw would lose the whole run's results.
const parseJson = (message: string): unknown => {
  try {
    return JSON.parse(message)
  } catch {
    return undefined
  }
}

// The default reporter is what prints the per-attempt readings, and only on a
// local run: under `--reporter=github-actions` nothing does, so this file is
// where CI keeps them.
const readAttempts = (test: TestCase): PairwiseAttemptResult[] => {
  const decisions = new Map<
    number,
    Omit<PairwiseAttemptResult, 'attempt' | 'orders'>
  >()
  const orders = new Map<number, PairwiseOrderResult[]>()
  for (const { type, message } of test.annotations()) {
    if (type !== 'pairwise-decision' && type !== 'pairwise-order') continue
    const parsed = parseJson(message) as
      | {
          attempt: number
          aArm: Arm
          reasoning: string
          handledWhen: PairwiseOrderResult['handledWhen']
          changes: unknown
          disagreements: string[]
        }
      | undefined
    if (!parsed) continue
    if (type === 'pairwise-decision')
      decisions.set(parsed.attempt, {
        changes: (parsed.changes ?? []) as MaterialChange[],
        disagreements: parsed.disagreements ?? [],
      })
    else
      orders.set(parsed.attempt, [
        ...(orders.get(parsed.attempt) ?? []),
        {
          aArm: parsed.aArm,
          reasoning: parsed.reasoning,
          handledWhen: parsed.handledWhen,
          changes: (parsed.changes ?? []) as PairwiseOrderResult['changes'],
        },
      ])
  }
  return [...decisions.entries()]
    .sort(([left], [right]) => left - right)
    .map(([attempt, decision]) => ({
      attempt,
      ...decision,
      orders: orders.get(attempt) ?? [],
    }))
}

export const collectPairwiseResults = (
  modules: ReadonlyArray<TestModule>,
): PairwiseSuiteResult[] => {
  const results: PairwiseSuiteResult[] = []
  for (const module of modules)
    for (const suite of module.children.allSuites()) {
      const { pairwiseVerdict, pairwiseNotJudged } = suite.meta() as {
        pairwiseVerdict?: ReturnType<typeof suiteVerdictAnnotation>
        pairwiseNotJudged?: ReturnType<typeof suiteVerdictAnnotation>
      }
      if (!pairwiseVerdict) continue
      const verdict = parseJson(pairwiseVerdict.message) as
        | SuiteVerdict
        | undefined
      if (!verdict) continue
      results.push({
        suite: suite.fullName,
        verdict,
        cases: [...suite.children.allTests()].map((test) => ({
          case: test.name,
          attempts: readAttempts(test),
        })),
        notJudged:
          ((pairwiseNotJudged
            ? parseJson(pairwiseNotJudged.message)
            : undefined) as NotJudgedAttempt[] | undefined) ?? [],
      })
    }
  return results.sort((left, right) => left.suite.localeCompare(right.suite))
}

export default class PairwiseReporter implements Reporter {
  onTestRunEnd: NonNullable<Reporter['onTestRunEnd']> = (modules) => {
    const results = collectPairwiseResults(modules)
    const verdictsFile = process.env.JUDGE_VERDICTS_FILE
    if (verdictsFile) {
      // The guard reads only `{ suite, label }`; nothing about the evidence
      // belongs in a file whose one consumer is a switch.
      const verdicts = results.map(({ suite, verdict }) => ({
        suite,
        label: verdict.label,
      }))
      writeFileSync(verdictsFile, JSON.stringify(verdicts))
    }
    const resultsFile = process.env.JUDGE_RESULTS_FILE
    if (resultsFile)
      writeFileSync(resultsFile, `${JSON.stringify(results, null, 2)}\n`)
    const table = renderPairwiseVerdicts(modules)
    if (!table) return
    process.stdout.write(table)
    const summary = process.env.GITHUB_STEP_SUMMARY
    if (summary) appendFileSync(summary, table)
    const tableFile = process.env.JUDGE_TABLE_FILE
    if (tableFile) writeFileSync(tableFile, table)
  }
}
