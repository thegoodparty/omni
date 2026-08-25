# Payments Module

Stripe-backed payments. Two controllers, both mounted under `/payments`:

- `payments.controller.ts` — `POST /payments/events` (Stripe webhook receiver) and `PATCH /payments/fix-missing-customer-id` (admin maintenance).
- `purchase.controller.ts` — checkout flows under `/payments/purchase/*`: create/complete Stripe Custom Checkout sessions, billing-portal redirects, and free-purchase fast paths. This is the entry point external callers (websites, outreach, polls) use.

`PurchaseService` orchestrates a typed purchase → checkout session → fulfillment flow. `PaymentsService` is a thinner Stripe wrapper used internally; rarely the right place to start.

## Key files

| Path                               | Purpose                                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `payments.module.ts`               | Wires controllers + services; `forwardRef(() => CampaignsModule)`, depends on `StripeModule`, `UsersModule`                                    |
| `payments.controller.ts`           | Stripe webhook + admin `fix-missing-customer-id` endpoint                                                                                      |
| `purchase.controller.ts`           | `POST /payments/purchase/checkout-session`, `portal-session`, `create-checkout-session`, `complete-checkout-session`, `complete-free-purchase` |
| `services/payments.service.ts`     | `createPayment`/`retrievePayment` over Stripe PaymentIntents; customer-id backfill (`@Timeout(0)` on boot + admin endpoint)                    |
| `services/purchase.service.ts`     | Per-`PurchaseType` validation, amount calc, post-purchase handlers                                                                             |
| `services/paymentEventsService.ts` | Stripe webhook event dispatcher (subscriptions, invoices, charges)                                                                             |
| `payments.types.ts`                | `PaymentType`, `PaymentIntentPayload<T>`                                                                                                       |
| `purchase.types.ts`                | `PurchaseType` enum (`DOMAIN_REGISTRATION`, `TEXT`, `POLL`) and per-type DTOs                                                                  |

Filename note: `paymentEventsService.ts` intentionally lacks the `.service` suffix — historical, leave it.

## Patterns

- **Stripe webhook events flow through `PaymentEventsService`**, not the controllers. To react to a new event type, add the handler there — that's where business effects fire.
- **`PurchaseType` is the typed extension point.** Adding a new purchase kind: add to the enum, add a metadata type, register a `PurchaseHandler<Metadata>` (`validatePurchase` / `calculateAmount` / optional `getProductName` / `getProductDescription`) in `PurchaseService`. Don't add ad-hoc payment paths outside this module.
- **External calls are wrapped in try/catch and throw `BadGatewayException`** (`.cursor/rules/rules.mdc` Rule 3). DB writes are not wrapped — let `PrismaExceptionFilter` handle them.
- `forwardRef(() => CampaignsModule)` because purchase fulfillment touches campaign state.

## Pro subscription lifecycle

Where Pro state lives (all of it — there is no subscription table):

- `campaign.details.subscriptionId` / `subscriptionCanceledAt` — set by the
  `checkout.session.completed` / `customer.subscription.*` webhooks in
  `paymentEventsService.ts`. `isPro` flips here too.
- `user.metaData.customerId` — Stripe customer id (backfilled on boot, or
  on first Manage Subscription click via
  `PurchaseController.recoverCustomerIdFromSubscription` when the boot-time
  backfill missed the user because they had no stored `checkoutSessionId`).
- `user.metaData.checkoutSessionId` — the ONE open Pro checkout session per
  user. Written only by `createProCheckoutSession`, cleared by the completion
  and expiry webhooks.

`POST /payments/purchase/checkout-session` is guarded (ENG-10771, PR #992 —
each guard exists because a customer was double-billed without it):

1. 400 `NO_ACTIVE_CAMPAIGN` — no campaign passes `isActiveCampaign`
   (`campaigns/util/eligibility.util.ts`). Fulfillment webhooks resolve the
   campaign via `findActiveByUserId` and skip with a 2xx when nothing
   qualifies, so selling here = charged with no Pro and no cancel path.
2. 409 `ALREADY_PRO` — a second completed checkout mints a SECOND Stripe
   customer (Pro sessions carry only `customer_email`, never the stored
   `customerId`, so Stripe cannot dedupe subscriptions itself).
3. 409 `CHECKOUT_ALREADY_COMPLETED` — previous stored session already paid,
   isPro flip still in flight.
4. 409 `CHECKOUT_IN_PROGRESS` — lost the `compareAndSwapCheckoutSessionId`
   CAS (atomic conditional `jsonb_set` in `UsersService`). All
   `checkoutSessionId` writes go through that CAS; don't add a plain write.

## Debugging Pro billing issues (recipes from real incidents)

Tools: prod DB creds in the `GP_API_PROD` AWS secret (`DB_PASSWORD`,
VPN-only); the Stripe live key is `STRIPE_SECRET_KEY` in the same secret —
fine for read-only GETs (`/v1/customers/search?query=email:'...'`,
subscriptions, checkout sessions). Loki:
`{service_name="gp-api", deployment_environment_name="prod"} |= "checkout-session"`
reconstructs the session-creation timeline; add `|= "user_<clerkId>"` for one
user's navigation. A checkout session's `metadata.userId` is the fastest way
to find which app user actually paid — trust it over the email on the Stripe
customer (users enter arbitrary emails/names at checkout, which also creates
cross-account confusion when one person has two app users).

**"Charged twice" (ENG-10771 shape).** First check for TWO Stripe customers
under one email, then list subs per customer. Known chain: duplicate checkout
→ second customer + second sub; `checkout.session.completed` blindly
overwrites `campaign.details.subscriptionId`, orphaning (not cancelling) the
first sub, which keeps billing; CS cancelling the SECOND sub then fires
`customer.subscription.deleted` and un-Pros the campaign while the FIRST sub
still bills — paying-but-not-Pro. Repair = pick the sub to keep, fix
`subscriptionId`/`customerId` by SQL, cancel/refund the other in Stripe.
Refunds can be blocked on insufficient Stripe available balance — retry later.

**Purchase error 400 `NO_ACTIVE_CAMPAIGN`.** `isActiveCampaign` requires: not
demo, `primaryResult !== 'lost'`, `didWin === null`, valid future
`details.electionDate` — across ALL the user's campaigns. Diagnose (read
replica): `SELECT id, slug, primary_result, did_win, is_demo,
details->>'electionDate', details->>'wonGeneral' FROM campaign WHERE
user_id = <id>`. Known traps:

1. **Re-running candidate reuses the old campaign** — `didWin=false` from
   the prior loss survived onto the new race. Fixed in ENG-10954: a
   user-driven update (`PUT /campaigns/mine`) that moves `electionDate` to a
   new upcoming date now clears `didWin`/`primaryResult` and strips the stale
   `wonGeneral`/`primaryElectionDate` details keys. Rows stranded before the
   fix (or written through other paths) still need the manual repair:
   `UPDATE campaign SET did_win = NULL WHERE id = <id> AND did_win = false;`
   and strip the stale prior-race keys so the result modals can't re-trap:
   `UPDATE campaign SET details = details - 'primaryElectionDate' -
   'wonGeneral' WHERE id = <id>;`
2. **PrimaryResultModal trap** — a campaign whose BallotReady-sourced
   `details.primaryElectionDate` has passed re-opens the primary-result modal
   each session; independents with no primary answer "did not win" →
   `primary_result='lost'`. Repair needs BOTH writes or the modal re-traps on
   next dashboard load:
   `UPDATE campaign SET primary_result = NULL WHERE id = <id> AND
   primary_result = 'lost';` and
   `UPDATE campaign SET details = details - 'primaryElectionDate' WHERE id = <id>;`
3. **`did_win=false` with `details.wonGeneral` null** — nothing user-facing
   writes the `didWin` column (the election-result page writes
   `details.wonGeneral`); this shape means a gp-admin campaign edit set it.
   Before ENG-10892 the admin form coerced a never-set `didWin` to `false` on
   ANY save, so a staff member merely opening + saving a campaign killed its
   Pro eligibility. Repair as in trap 1.

**"Cancelled Pro but Stripe kept billing" (ENG-10657 shape).** The
portal-cancel → `customer.subscription.deleted` → de-Pro path works; suspect
(a) two app users for one person with the sub on the other account, or
(b) admin console `isPro: false` (adminCampaigns.service), which does NOT
cancel the Stripe subscription (open gap, 86ajenb0v). Also: a passed election
with `wonGeneral` null force-redirects every dashboard route to
`/dashboard/election-result`, hiding Profile → Manage Subscription;
`ActiveProSubscriptionAlert` on the election-result pages (PR #677) is the
escape hatch.

Open follow-ups (not ticketed): pass `customer` (stored customerId) on Pro
checkout sessions instead of `customer_email`; alert on the webhook seeing a
subscriptionId overwrite.

## Draft-first outreach fulfillment (TEXT)

P2P outreach is persisted as an `Outreach` row with `status: pending_payment`
BEFORE checkout; the session metadata carries `outreachId`. The TEXT
post-purchase handler (`outreach/services/outreachPurchase.service.ts`)
finalizes it: an atomic status claim (`updateMany` on
`pending_payment → pending`, scoped to the paying campaign) is the DB lock
that makes the client-vs-webhook completion race harmless, then Peerly
submission, Slack, attribution, and free-texts redemption. On Peerly failure
the row reverts to `pending_payment` and the handler THROWS on purpose —
`completeCheckoutSession` only stamps its `postPurchaseCompletedAt`
idempotency marker after handler success, so the throw makes Stripe's webhook
retry re-attempt the finalize. Losing the claim proves nothing: the loser
polls for the winner's `projectId` and throws unless fulfillment is confirmed,
so a loser's success can never stamp the marker while the winner fails.
Sessions without `outreachId` (pre-draft-first clients) fall back to
free-texts redemption only.

## Gotchas

- Stripe webhooks must be idempotent — events can replay. Preserve dedupe in `PaymentEventsService` when adding handlers.
- The webhook route is `@PublicAccess()` and verifies the `stripe-signature` header — never bypass that check.
- `PaymentsService.backfillMissingCustomerIdsOnBoot` runs at startup via `@Timeout(0)`. Be mindful of side effects when adding work to `PaymentsService` constructor or boot path.
- Test fixtures use Stripe test-mode IDs prefixed `pi_test_…`. Don't compare against literal IDs in assertions; assert on side effects (DB row, user metadata) instead.
