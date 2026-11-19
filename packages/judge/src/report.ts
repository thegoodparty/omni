import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CaseResult, SuiteResult } from './execute'
import { outputOrFailure } from './execute'
import { handledRegressionP, readVerdict, type SuiteVerdict } from './stats'

// The two artifacts a run leaves behind: results.json, which holds every output,
// every judgment and every token count, and results.md, which is what a person
// reads.

export type SuiteOutcome = {
  result: SuiteResult
  verdict: SuiteVerdict
}

export type RunSummary = {
  baseUrl: string
  candidateUrl: string
  judgeModel: string
  startedAt: string
  finishedAt: string
  attemptsPerSide: number
  suites: SuiteOutcome[]
}

// The per-attempt pass counts the handledWhen test needs. A pair with no
// handled reading (no `handledWhen` on the case, or an order that omitted it)
// is not counted at all.
export const countHandling = (theCase: CaseResult) => {
  let basePass = 0
  let candidatePass = 0
  let baseTotal = 0
  let candidateTotal = 0
  for (const pair of theCase.pairs) {
    if (!pair.handled) continue
    baseTotal += 1
    candidateTotal += 1
    if (pair.handled.base) basePass += 1
    if (pair.handled.candidate) candidatePass += 1
  }
  return { basePass, candidatePass, baseTotal, candidateTotal }
}

export const verdictFor = (result: SuiteResult): SuiteVerdict => {
  const votes = result.cases.flatMap((theCase) =>
    theCase.pairs.map((pair) => pair.winner),
  )
  const counts = result.cases.map(countHandling).reduce(
    (total, entry) => ({
      basePass: total.basePass + entry.basePass,
      baseTotal: total.baseTotal + entry.baseTotal,
      candidatePass: total.candidatePass + entry.candidatePass,
      candidateTotal: total.candidateTotal + entry.candidateTotal,
    }),
    { basePass: 0, baseTotal: 0, candidatePass: 0, candidateTotal: 0 },
  )
  return readVerdict({
    votes,
    handled: {
      ...counts,
      pWorse: handledRegressionP(
        counts.candidatePass,
        counts.candidateTotal - counts.candidatePass,
        counts.basePass,
        counts.baseTotal - counts.basePass,
      ),
    },
  })
}

const percent = (pass: number, total: number): string =>
  total === 0 ? 'n/a' : `${Math.round((pass / total) * 100)}%`

const formatP = (p: number): string => (p < 0.001 ? '<0.001' : p.toFixed(3))

// A pair's reasoning, preferring the order that decided it. A tie whose two
// orders disagreed is labelled as such, because "the judge saw it both ways" is
// a different fact from "the judge saw no difference".
const pairReasoning = (pair: CaseResult['pairs'][number]): string => {
  const [first, second] = pair.orders
  if (!first) return 'not judged'
  if (!second) return first.reasoning
  if (first.winner !== second.winner) {
    return `orders disagreed (${first.winner} then ${second.winner}): ${first.reasoning} / ${second.reasoning}`
  }
  return first.reasoning
}

export const renderMarkdown = (summary: RunSummary): string => {
  const lines: string[] = [
    `# Judge: ${summary.suites.map((outcome) => outcome.result.suite).join(', ')}`,
    ``,
    `| | |`,
    `| --- | --- |`,
    `| Base | \`${summary.baseUrl}\` |`,
    `| Candidate | \`${summary.candidateUrl}\` |`,
    `| Judge model | \`${summary.judgeModel}\` |`,
    `| Attempts per side | ${summary.attemptsPerSide} |`,
    `| Started | ${summary.startedAt} |`,
    `| Finished | ${summary.finishedAt} |`,
  ]

  for (const outcome of summary.suites) {
    const { result, verdict } = outcome
    lines.push(
      ``,
      `## ${result.suite}: ${verdict.label}`,
      ``,
      `| | Value |`,
      `| --- | --- |`,
      `| Pairs for candidate | ${verdict.sign.forCandidate} |`,
      `| Pairs for base | ${verdict.sign.forBase} |`,
      `| Tied pairs | ${verdict.sign.ties} |`,
      `| p (candidate better) | ${formatP(verdict.sign.pBetter)} |`,
      `| p (base better) | ${formatP(verdict.sign.pWorse)} |`,
      `| handledWhen pass, base | ${verdict.handled.basePass}/${verdict.handled.baseTotal} (${percent(verdict.handled.basePass, verdict.handled.baseTotal)}) |`,
      `| handledWhen pass, candidate | ${verdict.handled.candidatePass}/${verdict.handled.candidateTotal} (${percent(verdict.handled.candidatePass, verdict.handled.candidateTotal)}) |`,
      `| p (handling regressed) | ${formatP(verdict.handled.pWorse)} |`,
      `| Judge tokens (in/out) | ${result.usage.inputTokens}/${result.usage.outputTokens} |`,
      ``,
      `### Per case`,
      ``,
      `| Case | Candidate | Base | Tied | Verdict |`,
      `| --- | --- | --- | --- | --- |`,
    )
    for (const theCase of result.cases) {
      const forCandidate = theCase.pairs.filter(
        (pair) => pair.winner === 'candidate',
      ).length
      const forBase = theCase.pairs.filter(
        (pair) => pair.winner === 'base',
      ).length
      const tied = theCase.pairs.filter((pair) => pair.winner === 'tie').length
      const caseVerdict =
        forCandidate > forBase
          ? 'candidate'
          : forBase > forCandidate
            ? 'base'
            : 'tie'
      lines.push(
        `| \`${theCase.caseId}\` | ${forCandidate} | ${forBase} | ${tied} | ${caseVerdict} |`,
      )
    }

    const losses = result.cases.flatMap((theCase) =>
      theCase.pairs
        .filter((pair) => pair.winner === 'base')
        .map((pair) => ({ theCase, pair })),
    )
    lines.push(``, `### Reasoning for every loss`, ``)
    if (losses.length === 0) {
      lines.push(`No pair lost.`)
    } else {
      for (const { theCase, pair } of losses) {
        lines.push(
          `- **\`${theCase.caseId}\` attempt ${pair.attempt}**: ${pairReasoning(pair)}`,
        )
      }
    }

    const failedRuns = result.cases.flatMap((theCase) =>
      theCase.runs.filter((run) => run.error !== null),
    )
    if (failedRuns.length > 0) {
      lines.push(``, `### Runs that failed`, ``)
      for (const run of failedRuns) {
        lines.push(
          `- **\`${run.caseId}\` attempt ${run.attempt} (${run.arm})**: ${run.error}`,
        )
      }
    }
  }

  return `${lines.join('\n')}\n`
}

// results.json is the run, plus each run's judged text: the exact string the
// judge read, which for a failed run is the marker rather than its output.
export const buildResultsJson = (summary: RunSummary) => ({
  ...summary,
  suites: summary.suites.map(({ result, verdict }) => ({
    ...result,
    verdict,
    cases: result.cases.map((theCase) => ({
      ...theCase,
      runs: theCase.runs.map((run) => ({
        ...run,
        judgedOutput: outputOrFailure(run),
      })),
    })),
  })),
})

export const writeResults = async (
  outDir: string,
  summary: RunSummary,
): Promise<{ jsonPath: string; markdownPath: string }> => {
  await mkdir(outDir, { recursive: true })
  const jsonPath = join(outDir, 'results.json')
  const markdownPath = join(outDir, 'results.md')
  await writeFile(
    jsonPath,
    `${JSON.stringify(buildResultsJson(summary), null, 2)}\n`,
  )
  await writeFile(markdownPath, renderMarkdown(summary))
  return { jsonPath, markdownPath }
}
