// Where an outreach flow opens, from what its entry already settled: the
// message step when who gets it is settled and so is what it says, written or
// to be drafted for a settled purpose (the draft generates on arrival); the
// audience step when only the message (or the purpose) is; otherwise the
// purpose. Each flow maps 'message' onto its own step (compose, script,
// talking points), and a purpose that asks something first (an event's
// details) still asks it there.
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
  if (audienceSettled && (messageSettled || purposeSettled)) return 'message'
  if (messageSettled || purposeSettled) return 'audience'
  return 'purpose'
}
