// ENG-11592 (M2 of the Judge Case Iteration TDD): the guard's $50-per-PR
// spend cap (TDD "Shadow only"; Implementation Notes 6 "The spend cap").
//
// PER PR, NOT PER SWEEP. Every push to a PR starts a new guard run, so a
// per-sweep cap lets a PR pushed four times spend about $200 (ticket, Daniel
// 2026-11-05). The caller passes this PR's spend so far — today always 0,
// since the guard ledger that tracks it lands in the next story (S14) — and
// this function's own job is only the three-way rule over
// (spent, full estimate, floor estimate).
export const SPEND_CAP_CENTS = 5000

export interface SpendCapInput {
  // The PR's spend so far, before this run. 0 until the ledger story (S14)
  // supplies the real number.
  readonly spentCents: number
  readonly floorAgents: readonly string[]
  readonly floorEstimateCents: number
  // The floor plus whatever the picker added. Always a superset of
  // floorAgents, per picker.ts's finalAgentSet.
  readonly fullAgents: readonly string[]
  readonly fullEstimateCents: number
}

export type SpendCapScope = 'full' | 'floor' | 'none'

export interface SpendCapDecision {
  readonly scope: SpendCapScope
  // The agents the sweep actually runs. Empty when `scope` is 'none'.
  readonly agentsToRun: readonly string[]
  // The agents the cap dropped, named on the check so a human can run them by
  // hand (ticket "Implementation Details": "list the skipped agents ... on
  // the check").
  readonly skippedAgents: readonly string[]
  // `undefined` only when nothing was skipped (the full set ran within cap).
  readonly judgeCommand: string | undefined
  readonly note: string
}

const dollars = (cents: number): string =>
  `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`

const judgeLiveCommand = (agents: readonly string[]): string =>
  `/judge ${agents.join(',')} --live`

// The three-way rule, in the order the ticket states it:
//   spent + full estimate <= cap: run the full set.
//   else spent + floor estimate <= cap: run the floor only, name what the
//     cap dropped.
//   else: run nothing, say the PR hit its cap, name the full set to run by
//     hand.
export const decideSpendCap = (
  input: SpendCapInput,
  capCents: number = SPEND_CAP_CENTS,
): SpendCapDecision => {
  const {
    spentCents,
    floorAgents,
    floorEstimateCents,
    fullAgents,
    fullEstimateCents,
  } = input

  if (spentCents + fullEstimateCents <= capCents) {
    return {
      scope: 'full',
      agentsToRun: fullAgents,
      skippedAgents: [],
      judgeCommand: undefined,
      note:
        `Pricing: ${dollars(spentCents)} spent on this PR so far + ` +
        `${dollars(fullEstimateCents)} for \`${fullAgents.join(', ')}\` is ` +
        `within the ${dollars(capCents)} guard cap. Running the full set.`,
    }
  }

  if (spentCents + floorEstimateCents <= capCents) {
    const skipped = fullAgents.filter((a) => !floorAgents.includes(a))
    return {
      scope: 'floor',
      agentsToRun: floorAgents,
      skippedAgents: skipped,
      judgeCommand: judgeLiveCommand(skipped),
      note:
        `Pricing: ${dollars(spentCents)} spent so far + ` +
        `${dollars(fullEstimateCents)} for the full set \`${fullAgents.join(', ')}\` ` +
        `would pass the ${dollars(capCents)} guard cap, so only the ` +
        `path-matched floor \`${floorAgents.join(', ') || '(none)'}\` ran. ` +
        `Skipped: \`${skipped.join(', ')}\`. Run them yourself with ` +
        `\`${judgeLiveCommand(skipped)}\`.`,
    }
  }

  return {
    scope: 'none',
    agentsToRun: [],
    skippedAgents: fullAgents,
    judgeCommand: judgeLiveCommand(fullAgents),
    note:
      `This PR reached its ${dollars(capCents)} guard cap: ` +
      `${dollars(spentCents)} spent so far, and even the path-matched floor ` +
      `alone would cost ${dollars(floorEstimateCents)} more. No sweep ran. ` +
      `Run one yourself with \`${judgeLiveCommand(fullAgents)}\`.`,
  }
}
