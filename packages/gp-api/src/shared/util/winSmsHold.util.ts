// Kill switch for Win p2p SMS hold-billing (slice B1+): the checkout places a
// manual-capture authorization HOLD instead of an immediate charge, recorded on
// the OutreachP2pSms satellite. Read live, never cached at module load, so a
// test can `vi.stubEnv` it and so a prod cutover needs no redeploy. Defaults
// OFF: the immediate-charge checkout is unchanged until someone flips it, and
// the whole chain (through capture + release) ships inert behind this flag
// until it is built and validated.
export const isWinSmsHoldBillingEnabled = (): boolean =>
  process.env.WIN_SMS_HOLD_BILLING === 'true'

// Stripe refuses an authorization under 50 cents, so an undiscounted hold below
// this floor is forgiven (treated as covered, no hold placed) rather than
// blocking checkout — mirrors the robocall ROBOCALL_MIN_HOLD_CENTS rule.
export const WIN_SMS_HOLD_MIN_CENTS = 50

// Fallback hold lifetime when Stripe omits capture_before on the authorization.
// A card authorization is valid ~7 days; the real deadline is read off the PI
// when present (see the hold service).
export const WIN_SMS_HOLD_WINDOW_DAYS = 7
