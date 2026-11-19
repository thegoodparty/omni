// The seam between a labeled agent's classifier and the judge. One adapter
// per labeled agent, called once per case on each arm from that arm's own
// worktree, so the base arm runs the base ref's classifier and the candidate
// runs the branch's.

export type LabelValue = boolean | string | number

export interface LabelAnswer {
  value: LabelValue
  // Distribution over the label's options keyed by String(option)
  // ('true'/'false' for booleans). Absent for hard-label classifiers.
  probabilities?: Record<string, number>
}

export interface LabeledInput {
  text: string
  channel: 'text' | 'email' | 'door' | 'call'
}

// false: make NO paid call
export interface LabeledRunContext {
  spends: boolean
}

export interface LabeledRunResult {
  labels: Record<string, LabelAnswer>
  usage?: { inputTokens: number; costUsd: number }
  model?: string
}

export type LabeledAdapter = (
  input: LabeledInput,
  ctx: LabeledRunContext,
) => Promise<LabeledRunResult>
