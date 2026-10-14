// Where an outreach flow opens, from what its entry already settled: the
// message step when who gets it and what it says are both settled, the
// audience step when only the message (or the purpose) is, and otherwise the
// purpose. Each flow maps 'message' onto its own step (compose, script).
// Product decision: docs/decisions/2026-10-14-outreach-flow-order-and-deep-links.md
export type LandingStep = 'purpose' | 'audience' | 'message'

export const outreachLandingStep = ({
  purposeSettled,
  audienceSettled,
  messageSettled,
}: {
  purposeSettled: boolean
  audienceSettled: boolean
  messageSettled: boolean
}): LandingStep => {
  if (messageSettled && audienceSettled) return 'message'
  if (messageSettled || purposeSettled) return 'audience'
  return 'purpose'
}
