/** Shared shapes. Kept in one place so adapters and the judge never import each other. */

/** One fixed input, run against every variant. */
export type Case = {
  id: string
  label: string
  params: Record<string, unknown>
}

/** Which side of the comparison a run belongs to. */
export type VariantRole = 'baseline' | 'candidate'

export type Variant = {
  role: VariantRole
  /** Git ref this variant's behaviour comes from. */
  ref: string
  /** Short sanitised tag derived from the ref, safe for ids and slugs. */
  tag: string
}

export type RunStatus = 'ok' | 'rejected' | 'timeout' | 'error'

/** The result of producing one output, for one case, under one variant. */
export type RunOutcome = {
  caseId: string
  variant: VariantRole
  status: RunStatus
  output?: unknown
  costUsd?: number
  durationSeconds?: number
  error?: string
  runId?: string
}

export type Margin = 'much_better' | 'better' | 'tie'

/** A reconciled verdict for one case. `winner` is a role or 'tie'. */
export type CaseVerdict = {
  caseId: string
  winner: VariantRole | 'tie'
  margin: Margin
  decidingCriterion: string
  rationale: string
  /** True when the judge reversed itself once the two outputs were swapped. */
  flipped: boolean
  judgeCostUsd: number
}

/** Everything one agent's comparison produced. */
export type AgentResult = {
  agent: string
  verdicts: CaseVerdict[]
  runs: RunOutcome[]
  notes: string[]
}
