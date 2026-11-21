import { appendFileSync, writeFileSync } from 'node:fs'
import type { Reporter, TestCase, TestModule } from 'vitest/node'
import type { suiteVerdictAnnotation } from './annotation'
import type { HandledValue } from './grade'
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
    // A bare URL is autolinked without `[`, so break the `//` too. No entity
    // contains a slash, so this cannot damage one.
    .replaceAll('//', '&#47;&#47;')

const formatP = (p: number) => (p < 0.001 ? '&lt;0.001' : p.toFixed(3))

export const renderPairwiseVerdicts = (
  modules: ReadonlyArray<TestModule>,
): string => {
  const rows: string[] = []
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
              escapeCell(
                error.length > 300 ? `${error.slice(0, 300)}…` : error,
              ),
            ].join(' | '),
          )
      }
      if (!pairwiseVerdict) continue
      const { label, sign, handled, notJudged } = JSON.parse(
        pairwiseVerdict.message,
      ) as SuiteVerdict
      rows.push(
        [
          escapeCell(suite.fullName),
          label,
          sign.forBase,
          sign.forCandidate,
          sign.ties,
          notJudged,
          formatP(sign.pBetter),
          formatP(sign.pWorse),
          `${handled.basePass}/${handled.baseTotal}`,
          `${handled.candidatePass}/${handled.candidateTotal}`,
          formatP(handled.pWorse),
        ].join(' | '),
      )
    }
  }
  if (!rows.length) return ''
  return [
    '',
    '## Pairwise eval verdicts',
    '',
    '| Suite | Verdict | Base wins | Candidate wins | Ties | Not judged | p better | p worse | Base handled | Candidate handled | p handled regression |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.sort().map((row) => `| ${row} |`),
    '',
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
type Winner = Arm | 'tie'

export type PairwiseOrderResult = {
  // Which arm this grading call saw as A; the pair's other order swaps them.
  aArm: Arm
  winner: Winner
  reasoning: string
  handledWhen: { base: HandledValue; candidate: HandledValue } | null
}

export type PairwiseAttemptResult = {
  attempt: number
  winner: Winner
  ordersAgree: boolean
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
  const decisions = new Map<number, Omit<PairwiseAttemptResult, 'attempt'>>()
  const orders = new Map<number, PairwiseOrderResult[]>()
  for (const { type, message } of test.annotations()) {
    if (type !== 'pairwise-decision' && type !== 'pairwise-order') continue
    const parsed = parseJson(message) as
      | {
          attempt: number
          aArm: Arm
          winner: Winner
          ordersAgree: boolean
          reasoning: string
          handledWhen: PairwiseOrderResult['handledWhen']
        }
      | undefined
    if (!parsed) continue
    if (type === 'pairwise-decision')
      decisions.set(parsed.attempt, {
        winner: parsed.winner,
        ordersAgree: parsed.ordersAgree,
        orders: [],
      })
    else
      orders.set(parsed.attempt, [
        ...(orders.get(parsed.attempt) ?? []),
        {
          aArm: parsed.aArm,
          winner: parsed.winner,
          reasoning: parsed.reasoning,
          handledWhen: parsed.handledWhen,
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
