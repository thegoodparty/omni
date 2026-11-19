import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArmRun, CaseResult, SuiteResult } from './execute'
import { handledRegressionP, readVerdict, type SuiteVerdict } from './stats'
import type { ArmName } from './arm'

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
  const notJudged = result.cases.reduce(
    (total, theCase) => total + theCase.notJudged.length,
    0,
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
    notJudged,
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

// How many failed runs each arm left behind, which is what makes a suite
// unjudgeable and says whose deploy to look at.
const failuresByArm = (result: SuiteResult): Record<ArmName, number> => {
  const failed = result.cases.flatMap((theCase) =>
    theCase.runs.filter((run) => run.error !== null),
  )
  return {
    base: failed.filter((run) => run.arm === 'base').length,
    candidate: failed.filter((run) => run.arm === 'candidate').length,
  }
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

// A run of one arm that failed the same way every time is one broken deploy,
// not a set of unrelated failures: nothing on that arm ever reached the agent,
// so no pair involving it means anything. Named once, at the top of the report,
// where the reader who sees CAN'T JUDGE looks first.
export const armWideFailures = (
  summary: RunSummary,
): { arm: ArmName; status: number }[] => {
  const runs: ArmRun[] = summary.suites.flatMap((outcome) =>
    outcome.result.cases.flatMap((theCase) => theCase.runs),
  )
  const lines: { arm: ArmName; status: number }[] = []
  for (const arm of ['base', 'candidate'] as const) {
    const onArm = runs.filter((run) => run.arm === arm)
    if (onArm.length === 0) continue
    if (onArm.some((run) => run.error === null)) continue
    const statuses = new Set(onArm.map((run) => run.httpStatus))
    const status = [...statuses][0]
    if (statuses.size !== 1 || status === null || status === undefined) {
      continue
    }
    lines.push({ arm, status })
  }
  return lines
}

export const renderMarkdown = (summary: RunSummary): string => {
  const title = `# Judge: ${summary.suites.map((outcome) => outcome.result.suite).join(', ')}`
  const armWide = armWideFailures(summary).map(
    ({ arm, status }) =>
      `Every ${arm} run failed with ${status}: the ${arm} gp-api may not have the run routes deployed.`,
  )
  const lines: string[] = [
    title,
    ...(armWide.length > 0
      ? [``, ...armWide.flatMap((line) => [line, ``])]
      : []),
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
    const failed = failuresByArm(result)
    lines.push(
      ``,
      `## ${result.suite}: ${verdict.label}`,
      ``,
      `| | Value |`,
      `| --- | --- |`,
      `| Pairs for candidate | ${verdict.sign.forCandidate} |`,
      `| Pairs for base | ${verdict.sign.forBase} |`,
      `| Tied pairs | ${verdict.sign.ties} |`,
      `| Pairs not judged | ${verdict.notJudged} |`,
      `| Failed runs, base / candidate | ${failed.base} / ${failed.candidate} |`,
      `| p (candidate better) | ${formatP(verdict.sign.pBetter)} |`,
      `| p (base better) | ${formatP(verdict.sign.pWorse)} |`,
      `| handledWhen pass, base | ${verdict.handled.basePass}/${verdict.handled.baseTotal} (${percent(verdict.handled.basePass, verdict.handled.baseTotal)}) |`,
      `| handledWhen pass, candidate | ${verdict.handled.candidatePass}/${verdict.handled.candidateTotal} (${percent(verdict.handled.candidatePass, verdict.handled.candidateTotal)}) |`,
      `| p (handling regressed) | ${formatP(verdict.handled.pWorse)} |`,
      `| Judge tokens (in/out) | ${result.usage.inputTokens}/${result.usage.outputTokens} |`,
      ``,
      `### Per case`,
      ``,
      `| Case | Candidate | Base | Tied | Not judged | Verdict |`,
      `| --- | --- | --- | --- | --- | --- |`,
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
        theCase.pairs.length === 0
          ? 'not judged'
          : forCandidate > forBase
            ? 'candidate'
            : forBase > forCandidate
              ? 'base'
              : 'tie'
      lines.push(
        `| \`${theCase.caseId}\` | ${forCandidate} | ${forBase} | ${tied} | ${theCase.notJudged.length} | ${caseVerdict} |`,
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

// results.json is the run, with every output and every judgment. A run that
// threw kept no output, and no pair holds it: `notJudged` is where it shows.
export const buildResultsJson = (summary: RunSummary) => ({
  ...summary,
  suites: summary.suites.map(({ result, verdict }) => ({
    ...result,
    verdict,
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
