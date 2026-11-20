import { appendFileSync } from 'node:fs'
import type { Reporter, TestModule } from 'vitest/node'
import type { suiteVerdictAnnotation } from './annotation'
import type { SuiteVerdict } from './stats'

const escapeCell = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replace(/\r?\n/g, ' ')

const formatP = (p: number) => (p < 0.001 ? '&lt;0.001' : p.toFixed(3))

export const renderPairwiseVerdicts = (
  modules: ReadonlyArray<TestModule>,
): string => {
  const rows: string[] = []
  for (const module of modules) {
    for (const suite of module.children.allSuites()) {
      const { pairwiseVerdict } = suite.meta() as {
        pairwiseVerdict?: ReturnType<typeof suiteVerdictAnnotation>
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
  ].join('\n')
}

export default class PairwiseReporter implements Reporter {
  onTestRunEnd: NonNullable<Reporter['onTestRunEnd']> = (modules) => {
    const table = renderPairwiseVerdicts(modules)
    if (!table) return
    const summary = process.env.GITHUB_STEP_SUMMARY
    if (summary) appendFileSync(summary, table)
    else process.stdout.write(table)
  }
}
