/**
 * Render results as the PR comment.
 *
 * The comment carries a hidden marker so repeated runs update one comment instead
 * of burying the PR, matching how the preview-URL and E2E-result comments already
 * work in this repo.
 */

import { pct, signed, type Summary } from './aggregate.js'
import type { AgentResult, Variant } from './types.js'

export const COMMENT_MARKER = '<!-- universal-judge -->'

const money = (v: number | undefined) =>
  v === undefined ? '—' : `$${v.toFixed(2)}`
const secs = (v: number | undefined) =>
  v === undefined ? '—' : `${Math.round(v)}s`

const deltaCell = (
  base: number | undefined,
  cand: number | undefined,
  format: (v: number) => string,
) => {
  if (base === undefined || cand === undefined) return ''
  const delta = cand - base
  const share = base
    ? ` (${delta / base >= 0 ? '+' : ''}${Math.round((delta / base) * 100)}%)`
    : ''
  return `${delta >= 0 ? '+' : '-'}${format(Math.abs(delta))}${share}`
}

/** Markdown table cells cannot contain raw pipes or newlines. */
const cell = (text: string, limit = 240) => {
  const flat = (text ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .replace(/\|/g, '\\|')
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
}

export const renderAgentSection = (result: AgentResult, summary: Summary) => {
  const lines: string[] = [
    `### ${summary.agent} — ${summary.verdict}`,
    '',
    summary.explanation,
    '',
    '| Measure | Baseline | Candidate | Delta |',
    '| --- | --- | --- | --- |',
    `| Cases judged | ${summary.cases} | ${summary.cases} | |`,
    `| Wins | ${summary.losses} | ${summary.wins} | |`,
    `| Ties | ${summary.ties} | ${summary.ties} | |`,
    `| Mean graded preference | | | ${signed(summary.meanScore)} |`,
    `| Mean cost per run | ${money(summary.baselineCostUsd)} | ${money(summary.candidateCostUsd)} | ${deltaCell(summary.baselineCostUsd, summary.candidateCostUsd, (v) => `$${v.toFixed(2)}`)} |`,
    `| Mean duration | ${secs(summary.baselineDurationSeconds)} | ${secs(summary.candidateDurationSeconds)} | ${deltaCell(summary.baselineDurationSeconds, summary.candidateDurationSeconds, (v) => `${Math.round(v)}s`)} |`,
  ]

  if (summary.flipRate > 0) {
    lines.push(`| Order-swap flips | | | ${pct(summary.flipRate)} of cases |`)
  }

  lines.push('', '<details><summary>Per-case verdicts</summary>', '')
  lines.push('| Case | Winner | Margin | Why |', '| --- | --- | --- | --- |')
  for (const v of result.verdicts) {
    const winner = v.flipped ? 'unstable' : v.winner
    const margin = v.flipped || v.margin === 'tie' ? '—' : v.margin
    lines.push(`| ${v.caseId} | ${winner} | ${margin} | ${cell(v.rationale)} |`)
  }
  lines.push('', '</details>')

  if (summary.failures.length) {
    lines.push(
      '',
      `**${summary.failures.length} run(s) failed and were excluded:**`,
      '',
    )
    for (const f of summary.failures) {
      lines.push(
        `- \`${f.caseId}\` (${f.variant}): ${cell(f.error ?? f.status)}`,
      )
    }
  }

  for (const note of result.notes) lines.push('', `> ${note}`)

  return lines.join('\n')
}

export const renderComment = (args: {
  sections: { result: AgentResult; summary: Summary }[]
  baseline: Variant
  candidate: Variant
  judgeModel: string
  requestedBy?: string
}) => {
  const totalJudge = args.sections.reduce(
    (sum, s) => sum + s.summary.judgeCostUsd,
    0,
  )
  const agentSpend = args.sections
    .flatMap((s) => s.result.runs)
    .reduce((sum, r) => sum + (r.costUsd ?? 0), 0)

  const overview = args.sections.length
    ? [
        '| Agent | Verdict | W/T/L | Mean preference | Cost delta |',
        '| --- | --- | --- | --- | --- |',
        ...args.sections.map(({ summary }) => {
          const delta =
            summary.baselineCostUsd !== undefined &&
            summary.candidateCostUsd !== undefined
              ? `${summary.candidateCostUsd - summary.baselineCostUsd >= 0 ? '+' : ''}$${(summary.candidateCostUsd - summary.baselineCostUsd).toFixed(2)}`
              : '—'
          return `| ${summary.agent} | ${summary.verdict} | ${summary.wins}/${summary.ties}/${summary.losses} | ${signed(summary.meanScore)} | ${delta} |`
        }),
      ].join('\n')
    : '_No agents were evaluated._'

  return [
    COMMENT_MARKER,
    '## Universal judge',
    '',
    overview,
    '',
    args.sections
      .map((s) => renderAgentSection(s.result, s.summary))
      .join('\n\n'),
    '',
    '<details><summary>How this was run</summary>',
    '',
    `- Baseline: \`${args.baseline.ref}\``,
    `- Candidate: \`${args.candidate.ref}\``,
    `- Judge model: \`${args.judgeModel}\``,
    '- Every pair judged twice with the outputs swapped; a pair whose verdict reverses is reported as unstable and excluded from scoring.',
    '- The judge is not told which side is the incumbent, and does not browse or fact-check against outside knowledge.',
    `- Judge spend: $${totalJudge.toFixed(2)}. Agent spend: ${agentSpend > 0 ? `$${agentSpend.toFixed(2)}` : 'not reported by the runs'}.`,
    ...(args.requestedBy ? [`- Requested by @${args.requestedBy}.`] : []),
    '',
    '</details>',
  ].join('\n')
}
