# Payment holds

A channel-neutral Stripe authorize-then-capture system for outreach sends: hold the card, capture only what actually sent, release on cancel (never refund). Email is the first channel; robocall is intended to move here later (it still has its own hold code). Design: "Outreach payment holds (shared)" (ClickUp doc `2ky4jq2q-20493`, page `2ky4jq2q-157473`).

Under construction: nothing yet releases a hold still unresolved at its send time. Never make a call report success early. Channel endpoints aren't behind a server-side flag, so a fake hold would let a send go out unpaid. Channels test against the service with `vi.spyOn`.

Decision record: `docs/adr/2026-10-27-one-channel-neutral-outreach-payment-hold.md`.

## Key files

| Path                                                                      | Purpose                                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `paymentHolds.types.ts`                                                   | `PaymentHoldsApi`, the interface channels call, and `SettlementAdapter`, the one call into a channel                |
| `services/paymentHolds.service.ts`                                        | The service behind the interface, the settlement-adapter registry, and `placeHold` for the crons                    |
| `services/paymentHoldsSweep.service.ts`                                   | The four crons (below)                                                                                              |
| `paymentHolds.controller.ts`, `paymentHoldsServe.controller.ts`           | `POST outreach/holds/card-intent` and `POST outreach/holds/:outreachId/card`, mirrored under `outreach/serve/holds` |
| `services/paymentHoldsCard.service.ts`                                    | Scopes the send to the caller (a send outside it is a 404), then calls `updateCard`                                 |
| `services/outreachOrphanedHold.service.ts`                                | Records voids for the reconcile sweep                                                                               |
| `paymentHolds.constants.ts`                                               | The 3-day lead, the 24-hour settle margin, the orphaned-hold reasons                                                |
| `prisma/schema/outreachPaymentHold.prisma`, `outreachOrphanedHold.prisma` | The hold row with its `OutreachHoldState` machine, and voided-hold tracking                                         |
| `src/vendors/segment/segment.types.ts` `OutreachPayment`                  | Event names HubSpot workflows key on for the payment emails                                                         |

## Invariants: do not break these

- **Holds are placed 3 days before the send,** or immediately at confirm when the send is sooner. Plan every hold for Visa's off-session 4 days 18 hours, read from Stripe's `captureBefore`.
- **The idempotency key is `outreach-hold-<customerId>-<outreachId>-<holdAttempt>`.** The customer ID is there because previews share a Stripe test account. `holdAttempt` bumps only after a decline, a void, or recovery finding no intent at Stripe under it; never after a timeout.
- **One capture path:** `settle`, behind the `capturing` claim. It calls the channel's `stopAndReport` first.
- **Every state move is a compare-and-set** from the expected state. Holds placed at confirm are created directly in `placing`.
- **Every void outside the normal path** is written to `OutreachOrphanedHold` for the reconcile sweep: a window-fit or lost-commit void always, a release or reschedule void only when Stripe refused the cancel.
- **A `scheduled` or `hold_failed` row's `holdAttempt` has never been sent to Stripe.** That is what lets `updateCard` change the card under the same key. A Stripe failure that might have placed the hold leaves the row in `placing`, never back in `scheduled`: a release there would skip the void a live hold needs.
- **Recovery reads Stripe; it never replays a placement.** Stripe refuses a reused idempotency key whose parameters differ, and on- and off-session placements differ in `off_session` (confirm and `updateCard` place on-session, the placement sweep off-session), which the row doesn't record. So a stale `placing` row is resolved from `findOutreachHolds` (customer, `outreachId`, `holdAttempt`): a live intent is adopted, or voided if a release arrived; a declined one is recorded as a decline; none means a fresh attempt. `findOutreachHolds` lists the customer's last 8 days of intents rather than using Stripe search: search is eventually consistent, and a false empty answer would stack a second hold.
- **A channel registers its adapter from its module's constructor** (`registerSettlementAdapter(OutreachType.x, AdapterClass)`), resolved through `ModuleRef` at settle time. `stopAndReport` must report the same amount every time once drained: the capture key is per intent (`outreach-capture-<paymentIntentId>`), so a replay with a different amount fails.
- **Payment emails come from HubSpot workflows** on the `OutreachPayment` Segment events, each with a deterministic messageId. The event strings are load-bearing.

## Crons

All in `PaymentHoldsSweepService`, gated on `VENDOR_CRONS_ENABLED`, with no `CronLockService`: every unit of work is a per-row compare-and-set, so a second replica claims nothing.

| Job                         | When            | Does                                                                                                          |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------- |
| `paymentHoldPlacementSweep` | `:01` every 10m | Places `scheduled` holds within 3 days of the send, off-session; alerts on a failure within a day of the send |
| `paymentHoldRecoverySweep`  | `:06` every 10m | Takes over `placing` and `capturing` claims older than 10 minutes and resolves them from Stripe               |
| `paymentHoldExpiryGuard`    | `:38` hourly    | Settles `held` holds within 12 hours of `captureBefore`                                                       |
| `paymentHoldReconcileSweep` | `:24` hourly    | Re-voids `OutreachOrphanedHold` rows Stripe still shows as live                                               |

A stale `capturing` row whose intent Stripe shows `canceled` becomes `uncollectable` with a CRITICAL log; there is no automatic recharge.

## Stripe webhooks

`PaymentEventsService` resolves `PaymentHoldsService` through `ModuleRef` and calls it after robocall's handler, which is unchanged. `payment_method.attached` retries the customer's `hold_failed` holds whose send is still ahead, through `updateCard`, one row at a time with errors isolated. `payment_method.detached` only logs a `scheduled` hold's lost card: its placement declines and becomes `hold_failed`. `charge.dispute.created` moves a `captured` hold to `disputed`, found by the unique `paymentIntentId`; a `capturing` row answers 503 so Stripe redelivers.

## Card endpoints

`card-intent` returns a SetupIntent client secret; `:outreachId/card` changes the card on an existing hold and returns the `saveCardAndPlan` outcome (`held`, `scheduled`, `declined`). It never creates a hold: a first card goes through the channel's own confirm call. The webapp side is `packages/gp-webapp/app/dashboard/shared/payment-hold/PaymentHoldCard.tsx`, which takes a `savePaymentMethod` override for that first card. A 409 with "still being placed" means a placement is being resolved and the component says to wait; any other 409 means the hold is final and no card can change it.

## Reuse

The Stripe helpers in `src/vendors/stripe/services/stripe.service.ts`: `ensureCustomer`, `createSetupIntent`, `createOutreachManualCaptureHold` (with `StripeOutreachHoldDeclinedError`), `findOutreachHolds`, `retrievePaymentIntent`, `capturePaymentIntent`, `cancelHold`. Robocall's `createManualCaptureHold` and `voidHold` stay robocall's. The design follows `outreach/services/outreachRobocallHold.service.ts` and `outreach/docs/robocall-payment.md`.
