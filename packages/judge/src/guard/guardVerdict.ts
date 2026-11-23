import {
  mapGuardOutcome,
  worstOutcome,
  type GuardCheckResult,
  type GuardOutcome,
} from './resultMapping'

export interface SuiteVerdictRow {
  readonly suite: string
  readonly label: string
}

const LABEL_TO_OUTCOME: Readonly<Record<string, GuardOutcome>> = {
  BETTER: 'BETTER',
  'NO DIFFERENCE FOUND': 'NO DIFFERENCE FOUND',
  WORSE: 'WORSE',
  "CAN'T JUDGE": "CAN'T JUDGE",
}

export interface GuardVerdict extends GuardCheckResult {
  readonly outcome: GuardOutcome
}

// `rows` is undefined when judge-eval never wrote its verdicts file. A
// requested suite with no row, or a label this map does not know, is a crash:
// reading it as a quiet pass would hide a run that judged nothing.
export const resolveGuardVerdict = (
  requested: readonly string[],
  rows: readonly SuiteVerdictRow[] | undefined,
  previewReady = true,
): GuardVerdict => {
  if (!previewReady) {
    return {
      outcome: 'preview not ready',
      ...mapGuardOutcome('preview not ready'),
    }
  }
  if (rows === undefined || rows.length === 0) {
    return { outcome: 'judge crashed', ...mapGuardOutcome('judge crashed') }
  }
  const perSuite = requested.map((suite) => {
    const row = rows.find((r) => r.suite === suite)
    return {
      suite,
      outcome: (row && LABEL_TO_OUTCOME[row.label]) ?? 'judge crashed',
    } as const
  })
  const outcome = worstOutcome(perSuite.map((s) => s.outcome))
  const mapped = mapGuardOutcome(outcome)
  const lines = perSuite.map((s) => `- \`${s.suite}\`: ${s.outcome}`)
  return {
    outcome,
    note: `${mapped.note}\n\n${lines.join('\n')}`,
  }
}
