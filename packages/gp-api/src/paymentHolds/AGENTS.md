# Payment holds

A channel-neutral Stripe authorize-then-capture system for outreach sends: hold the card, capture only what actually sent, release on cancel (never refund). Email is the first channel; robocall is intended to move here later (it still has its own hold code). Design: "Outreach payment holds (shared)" (ClickUp doc `2ky4jq2q-20493`, page `2ky4jq2q-157473`).

Under construction: `createCardSetupIntent` still refuses until the card endpoints land, and nothing places a `scheduled` hold or recovers a stuck `placing` or `capturing` row until the crons land. Never make a call report success early. Channel endpoints aren't behind a server-side flag, so a fake hold would let a send go out unpaid. Channels test against the service with `vi.spyOn`.

Decision record: `docs/adr/2026-10-27-one-channel-neutral-outreach-payment-hold.md`.

## Key files

| Path                                                                      | Purpose                                                                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `paymentHolds.types.ts`                                                   | `PaymentHoldsApi`, the interface channels call, and `SettlementAdapter`, the one call into a channel |
| `services/paymentHolds.service.ts`                                        | The service behind the interface, the settlement-adapter registry, and `placeHold` for the crons     |
| `services/outreachOrphanedHold.service.ts`                                | Records voids for the reconcile sweep                                                                |
| `paymentHolds.constants.ts`                                               | The 3-day lead, the 24-hour settle margin, the orphaned-hold reasons                                 |
| `prisma/schema/outreachPaymentHold.prisma`, `outreachOrphanedHold.prisma` | The hold row with its `OutreachHoldState` machine, and voided-hold tracking                          |
| `src/vendors/segment/segment.types.ts` `OutreachPayment`                  | Event names HubSpot workflows key on for the payment emails                                          |

## Invariants: do not break these

- **Holds are placed 3 days before the send,** or immediately at confirm when the send is sooner. Plan every hold for Visa's off-session 4 days 18 hours, read from Stripe's `captureBefore`.
- **The idempotency key is `outreach-hold-<customerId>-<outreachId>-<holdAttempt>`.** The customer ID is there because previews share a Stripe test account. `holdAttempt` bumps only after a decline or a void, never after a timeout.
- **One capture path:** `settle`, behind the `capturing` claim. It calls the channel's `stopAndReport` first.
- **Every state move is a compare-and-set** from the expected state. Holds placed at confirm are created directly in `placing`.
- **Every void outside the normal path** is written to `OutreachOrphanedHold` for the reconcile sweep: a window-fit or lost-commit void always, a release or reschedule void only when Stripe refused the cancel.
- **A `scheduled` or `hold_failed` row's `holdAttempt` has never been sent to Stripe.** That is what lets `updateCard` change the card under the same key. A Stripe failure that might have placed the hold leaves the row in `placing`, never back in `scheduled`: a release there would skip the void a live hold needs.
- **A replay must match the attempt it replays.** Stripe refuses a reused idempotency key whose parameters differ, and on- and off-session placements differ in `off_session`. Confirm and `updateCard` place on-session; a sweep places off-session. Recovery of a stuck `placing` row has to handle an attempt placed either way.
- **A channel registers its adapter from its module's constructor** (`registerSettlementAdapter(OutreachType.x, AdapterClass)`), resolved through `ModuleRef` at settle time. `stopAndReport` must report the same amount every time once drained: the capture key is per intent (`outreach-capture-<paymentIntentId>`), so a replay with a different amount fails.
- **Payment emails come from HubSpot workflows** on the `OutreachPayment` Segment events, each with a deterministic messageId. The event strings are load-bearing.

## Reuse

The Stripe helpers in `src/vendors/stripe/services/stripe.service.ts`: `ensureCustomer`, `createSetupIntent`, `createOutreachManualCaptureHold` (with `StripeOutreachHoldDeclinedError`), `retrievePaymentIntent`, `capturePaymentIntent`, `cancelHold`. Robocall's `createManualCaptureHold` and `voidHold` stay robocall's. The design follows `outreach/services/outreachRobocallHold.service.ts` and `outreach/docs/robocall-payment.md`.
