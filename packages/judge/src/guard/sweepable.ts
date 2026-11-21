export type UnsweepableReason = 'missing_at_head' | 'not_pairwise'

export interface UnsweepableSuite {
  readonly suite: string
  readonly reason: UnsweepableReason
}

export interface SweepableSplit {
  readonly sweepable: readonly string[]
  readonly unsweepable: readonly UnsweepableSuite[]
}

export const unsweepableReasonFor =
  (readEvalAtHead: (suite: string) => string | undefined) =>
  (suite: string): UnsweepableReason | undefined => {
    const source = readEvalAtHead(suite)
    if (source === undefined) return 'missing_at_head'
    return source.includes('definePairwiseAgentEvalSuite')
      ? undefined
      : 'not_pairwise'
  }

export const splitSweepable = (
  suites: readonly string[],
  reasonFor: (suite: string) => UnsweepableReason | undefined,
): SweepableSplit => {
  const sweepable: string[] = []
  const unsweepable: UnsweepableSuite[] = []
  for (const suite of suites) {
    const reason = reasonFor(suite)
    if (reason === undefined) sweepable.push(suite)
    else unsweepable.push({ suite, reason })
  }
  return { sweepable, unsweepable }
}

const REASON_TEXT: Readonly<Record<UnsweepableReason, string>> = {
  missing_at_head: 'no eval file at the PR head',
  not_pairwise: 'not a pairwise suite',
}

export const unsweepableNote = (
  unsweepable: readonly UnsweepableSuite[],
): string =>
  unsweepable.length === 0
    ? ''
    : ` Not run, because judge-eval cannot run them: ${unsweepable
        .map((s) => `\`${s.suite}\` (${REASON_TEXT[s.reason]})`)
        .join(', ')}.`
