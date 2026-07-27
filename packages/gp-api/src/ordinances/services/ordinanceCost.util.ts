// Approximate list prices (USD per 1M tokens) for the Claude models the
// ordinance flow runs on, used to derive a rough cost from stored token counts.
// We persist tokens, not dollars (prices change), and convert here at read/log
// time. Update these when Anthropic pricing changes. Matched by substring so a
// full model id (e.g. "claude-sonnet-4-6") resolves to its family.
interface ModelRate {
  inputPerM: number
  outputPerM: number
}

const MODEL_RATES: { match: string; rate: ModelRate }[] = [
  { match: 'opus', rate: { inputPerM: 15, outputPerM: 75 } },
  { match: 'sonnet', rate: { inputPerM: 3, outputPerM: 15 } },
  { match: 'haiku', rate: { inputPerM: 0.8, outputPerM: 4 } },
]

// Sonnet-class rate: the flow's primary model, so an unrecognized id bills at
// the common case rather than zero (which would hide cost).
const DEFAULT_RATE: ModelRate = { inputPerM: 3, outputPerM: 15 }

export const rateForModel = (model: string): ModelRate => {
  const lower = model.toLowerCase()
  return MODEL_RATES.find((r) => lower.includes(r.match))?.rate ?? DEFAULT_RATE
}

export const estimateCostUsd = (
  model: string,
  inputTokens: number,
  outputTokens: number,
): number => {
  const rate = rateForModel(model)
  return (
    (inputTokens / 1_000_000) * rate.inputPerM +
    (outputTokens / 1_000_000) * rate.outputPerM
  )
}

// The per-draft token columns the ordinance record carries: the interactive
// flow, the manual QC run, and the improvement loop, each split input/output.
export interface DraftTokenColumns {
  flowInputTokens: number
  flowOutputTokens: number
  qcInputTokens: number
  qcOutputTokens: number
  loopInputTokens: number
  loopOutputTokens: number
}

// The canonical per-draft token total, summed from the record's own columns
// (flow + manual QC + loop). This is the single per-draft rollup: never add
// OrdinanceQualityIteration.tokens on top — those rows hold the same loop spend
// as per-pass detail and would double-count. Pair with estimateCostUsd to
// price it (the flow's models are all sonnet-class today).
export const draftTokenTotals = (
  record: DraftTokenColumns,
): { inputTokens: number; outputTokens: number } => ({
  inputTokens:
    record.flowInputTokens + record.qcInputTokens + record.loopInputTokens,
  outputTokens:
    record.flowOutputTokens + record.qcOutputTokens + record.loopOutputTokens,
})
