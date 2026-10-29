# Payment holds

A channel-neutral Stripe authorize-then-capture system for outreach sends: hold the card, capture only what actually sent, release on cancel (never refund). Email is the first channel; robocall is intended to move here later (it still has its own hold code). Design: "Outreach payment holds (shared)" (ClickUp doc `2ky4jq2q-20493`, page `2ky4jq2q-157473`).

Never make a call report success early. Channel endpoints aren't behind a server-side flag, so a fake hold would let a send go out unpaid. Channels test against the service with `vi.spyOn`.

Decision record: `docs/adr/2026-10-27-one-channel-neutral-outreach-payment-hold.md`.

## Key files

| Path                                                                      | Purpose                                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `paymentHolds.types.ts`                                                   | `PaymentHoldsApi`, the interface channels call, and `SettlementAdapter`, the one call into a channel                |
| `services/paymentHolds.service.ts`                                        | The service behind the interface, the settlement-adapter registry, and `placeHold` for the crons                    |
| `services/paymentHoldsSweep.service.ts`                                   | The crons (below)                                                                                                   |
| `paymentHolds.controller.ts`, `paymentHoldsServe.controller.ts`           | `POST outreach/holds/card-intent` and `POST outreach/holds/:outreachId/card`, mirrored under `outreach/serve/holds` |
| `services/paymentHoldsCard.service.ts`                                    | Scopes the send to the caller (a send outside it is a 404), then calls `updateCard`                                 |
| `services/paymentHoldEvents.service.ts`                                   | Fires the four `OutreachPayment` Segment events, best-effort, from the winning transition only                      |
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
- **Recovery reads Stripe; it never replays a placement.** Stripe refuses a reused idempotency key whose parameters differ, and on- and off-session placements differ in `off_session` (confirm and the card endpoint place on-session; the placement sweep and the attach webhook place off-session, the latter through `updateCard`'s `offSession` option), which the row doesn't record. So a stale `placing` row is resolved from `findOutreachHolds` (customer, `outreachId`, `holdAttempt`): a live intent is adopted, or voided if a release arrived; a declined one is recorded as a decline; none means a fresh attempt. `findOutreachHolds` lists the customer's last 8 days of intents rather than using Stripe search: search is eventually consistent, and a false empty answer would stack a second hold.
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
| `paymentHoldUnpaidSweep`    | `:05` every 10m | Releases `scheduled` and `hold_failed` holds whose send time has passed, and emits `Canceled`                 |
| `paymentHoldReminderSweep`  | 10:18 ET daily  | Emits `Reminder` for `hold_failed` holds with the send still ahead, 20+ hours after the decline               |

A stale `capturing` row whose intent Stripe shows `canceled` becomes `uncollectable` with a CRITICAL log; there is no automatic recharge.

## Payment events

`PaymentHoldEventsService.emit` fires the `OutreachPayment` events through `AnalyticsService.track`, only from the transition that won, never throwing. HubSpot sends the emails (Win and Serve versions), so the names, the `messageId`s and the property keys are load-bearing.

| Event        | Fires from                                                                                                                                                                                                                                                                                                                                        | messageId                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `HoldFailed` | An off-session decline in `recordDecline` (placement sweep, recovery), and a detached card on a `scheduled` hold. A decline at confirm or on the card endpoint is shown to the user and never emails, and neither does the attach webhook's retry (it races the user's own card save; the reminder covers it). A window-fit release sends nothing | `<outreachId>:hold_failed`           |
| `Reminder`   | `paymentHoldReminderSweep`                                                                                                                                                                                                                                                                                                                        | `<outreachId>:reminder:<yyyy-mm-dd>` |
| `Canceled`   | `releaseUnpaid`, when the unpaid sweep releases a hold at its send time                                                                                                                                                                                                                                                                           | `<outreachId>:canceled`              |
| `Receipt`    | The `capturing` to `captured` commit in `completeSettle` and in recovery's already-succeeded branch. A $0 settle releases and sends no receipt                                                                                                                                                                                                    | `<outreachId>:receipt`               |

Every event carries `outreachId`, `channel`, `mode` (`win` when the send has a campaign, else `serve`), `sendName`, `sendDate`, `estimateCents`, `estimateDollars` and `link` (the Win or Serve outreach hub). `HoldFailed` adds `declineCode`; `Receipt` adds `capturedCents`, `capturedDollars` and `recipientsSent`. The event goes to the organization's owner. The channel must treat a hold that is `released` at send time as a failed send; the hold system only releases the hold.

## Stripe webhooks

`PaymentEventsService` resolves `PaymentHoldsService` through `ModuleRef` and calls it after robocall's handler, which is unchanged. `payment_method.attached` retries the customer's `hold_failed` holds whose send is still ahead, through `updateCard`, one row at a time with errors isolated. The retry places off-session. `payment_method.detached` moves a `scheduled` hold on that card to `hold_failed` (`declineCode: payment_method_detached`, same `holdAttempt`), because Stripe errors without creating an intent and the placement would otherwise cycle. `charge.dispute.created` moves a `captured` hold to `disputed`, found by the unique `paymentIntentId`; a `capturing` row answers 503 so Stripe redelivers.

## Card endpoints

`card-intent` returns a SetupIntent client secret; `:outreachId/card` changes the card on an existing hold and returns the `saveCardAndPlan` outcome (`held`, `scheduled`, `declined`). It never creates a hold: a first card goes through the channel's own confirm call. The webapp side is `packages/gp-webapp/app/dashboard/shared/payment-hold/PaymentHoldCard.tsx`, which takes a `savePaymentMethod` override for that first card. A 409 with "still being placed" means a placement is being resolved and the component says to wait; any other 409 means the hold is final and no card can change it.

## Reuse

Outreach holds turn off redirect-based payment methods (`automatic_payment_methods.allow_redirects: 'never'`). Without it Stripe refuses every on-session confirm, which has no `return_url`. A card that needs 3-D Secure comes back `requires_action` and is recorded as a decline.

The Stripe helpers in `src/vendors/stripe/services/stripe.service.ts`: `ensureCustomer`, `createSetupIntent`, `createOutreachManualCaptureHold` (with `StripeOutreachHoldDeclinedError`), `findOutreachHolds`, `retrievePaymentIntent`, `capturePaymentIntent`, `cancelHold`. Robocall's `createManualCaptureHold` and `voidHold` stay robocall's. The design follows `outreach/services/outreachRobocallHold.service.ts` and `outreach/docs/robocall-payment.md`.
