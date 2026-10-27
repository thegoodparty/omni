# Payment holds

A channel-neutral Stripe authorize-then-capture system for outreach sends: hold the card, capture only what actually sent, release on cancel (never refund). Email is the first channel; robocall is intended to move here later (it still has its own hold code). Design: "Outreach payment holds (shared)" (ClickUp doc `2ky4jq2q-20493`, page `2ky4jq2q-157473`).

Under construction: `PaymentHoldsService` refuses every call until the hold workstream implements it. Never make it report success early. Channel endpoints aren't behind a server-side flag, so a fake hold would let a send go out unpaid. Channels test against it with `vi.spyOn`.

## Key files

| Path                                                                      | Purpose                                                                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `paymentHolds.types.ts`                                                   | `PaymentHoldsApi`, the interface channels call, and `SettlementAdapter`, the one call into a channel |
| `services/paymentHolds.service.ts`                                        | The service behind the interface                                                                     |
| `prisma/schema/outreachPaymentHold.prisma`, `outreachOrphanedHold.prisma` | The hold row with its `OutreachHoldState` machine, and voided-hold tracking                          |
| `src/vendors/segment/segment.types.ts` `OutreachPayment`                  | Event names HubSpot workflows key on for the payment emails                                          |

## Invariants: do not break these

- **Holds are placed 3 days before the send,** or immediately at confirm when the send is sooner. Plan every hold for Visa's off-session 4 days 18 hours, read from Stripe's `captureBefore`.
- **The idempotency key is `outreach-hold-<customerId>-<outreachId>-<holdAttempt>`.** The customer ID is there because previews share a Stripe test account. `holdAttempt` bumps only after a decline or a void, never after a timeout.
- **One capture path:** `settle`, behind the `capturing` claim. It calls the channel's `stopAndReport` first.
- **Every state move is a compare-and-set** from the expected state. Holds placed at confirm are created directly in `placing`.
- **Every void outside the normal path** is written to `OutreachOrphanedHold` for the reconcile sweep.
- **Payment emails come from HubSpot workflows** on the `OutreachPayment` Segment events, each with a deterministic messageId. The event strings are load-bearing.

## Reuse

The Stripe helpers in `src/vendors/stripe/services/stripe.service.ts`: `ensureCustomer`, SetupIntent creation, `createManualCaptureHold`, `capturePaymentIntent`, `voidHold`, `StripeHoldDeclinedError`. The design follows `outreach/services/outreachRobocallHold.service.ts` and `outreach/docs/robocall-payment.md`.
