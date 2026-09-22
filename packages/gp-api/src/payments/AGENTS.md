# Payments Module

Stripe-backed payments. Two controllers, both mounted under `/payments`:

- `payments.controller.ts` — `POST /payments/events` (Stripe webhook receiver) and `PATCH /payments/fix-missing-customer-id` (admin maintenance).
- `purchase.controller.ts` — checkout flows under `/payments/purchase/*`: create/complete Stripe Custom Checkout sessions, billing-portal redirects, and free-purchase fast paths. This is the entry point external callers (websites, outreach, polls) use.
  One-time custom sessions pin `payment_method_types` to card / Amazon Pay — Stripe's automatic set would add BNPL options (Klarna, Affirm) that are off-brand for campaign charges (product call, Aug 2026), and US bank debit was dropped 2026-09-22 because it settles days after checkout (see "Draft-first outreach fulfillment").

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
| `purchase.types.ts`                | `PurchaseType` enum (`DOMAIN_REGISTRATION`, `TEXT`, `SERVE_TEXT`, `POLL`) and per-type DTOs                                                    |

Filename note: `paymentEventsService.ts` intentionally lacks the `.service` suffix — historical, leave it.

## Patterns

- **Stripe webhook events flow through `PaymentEventsService`**, not the controllers. To react to a new event type, add the handler there — that's where business effects fire.
- **`PurchaseType` is the typed extension point.** Adding a new purchase kind: add to the enum, add a metadata type, register a `PurchaseHandler<Metadata>` (`validatePurchase` / `calculateAmount` / optional `getProductName` / `getProductDescription`) in `PurchaseService`. Don't add ad-hoc payment paths outside this module.
- **External calls are wrapped in try/catch and throw `BadGatewayException`** (`.cursor/rules/rules.mdc` Rule 3). DB writes are not wrapped — let `PrismaExceptionFilter` handle them.
- `forwardRef(() => CampaignsModule)` because purchase fulfillment touches campaign state.
- **The owner line (ENG-10819): subscription billing is personally scoped,
  one-time purchases are manager-allowed.** `checkout-session` and
  `portal-session` carry no `@UseOrganization`/`@UseCampaign` — they resolve
  the campaign/customer off the caller's own `userId`/`metaData`, so a
  `campaignAdmin` member can never reach another user's subscription or
  billing portal through them, regardless of the `X-Organization-Slug`
  header. `create-checkout-session` and `complete-free-purchase` DO carry
  that scoping, so `OrganizationRoleGuard`'s default (owner or
  `campaignAdmin`) applies — a manager paying for a one-time purchase
  (texts, domains, polls) with their own card is intentional (product
  decision, 2026-07-28), not a gap. Neither route carries `@OwnerOnly()`.

## Pro subscription lifecycle

Where Pro state lives (all of it — there is no subscription table):

- `campaign.details.subscriptionId` / `subscriptionCanceledAt` — set by the
  `checkout.session.completed` / `customer.subscription.*` webhooks in
  `paymentEventsService.ts`. All of these go through
  `CampaignsService.patchCampaignDetails`, which merges the key server-side in
  one `UPDATE ... details || $1::jsonb`. That is not a style preference: these
  handlers patch DIFFERENT keys of the SAME blob milliseconds apart (Stripe
  delivers `customer.subscription.created` and `checkout.session.completed`
  together), and the read-modify-write this replaced dropped whichever key lost
  the race. `details.subscriptionId` is the only mapping from a live
  subscription back to an account, so a dropped key is a customer who keeps
  being billed while every renewal webhook 502s.
- `isPro` flips here too, through `CampaignsService.setIsPro`, which commits
  the flip and the `details.isProUpdatedAt` stamp together and blocks on the
  campaign row lock instead of failing a concurrent delivery with P2034. The
  same at-least-once delivery matters here for a second reason: `becamePro` is
  derived from the **prior** `isPro`, so a flip that commits without its stamp
  cannot be repaired by a redelivery — the redelivery sees `isPro=true` and
  skips it. See `src/campaigns/AGENTS.md` § Patterns before touching either
  write path.
- `user.metaData.customerId` — Stripe customer id (backfilled on boot, or
  on first Manage Subscription click via
  `PurchaseController.recoverCustomerIdFromSubscription` when the boot-time
  backfill missed the user because they had no stored `checkoutSessionId`).
- `user.metaData.checkoutSessionId` — the ONE open Pro checkout session per
  user. Written only by `createProCheckoutSession`, cleared by the completion
  and expiry webhooks.

**Account deletion stops billing before it deletes anything.**
`UsersService.deleteUser` cancels the subscription on EVERY campaign the user
owns, from inside the deletion transaction and before it commits. `Campaign`
cascade-deletes with the user and `details.subscriptionId` is the only record
we keep of the subscription, so a cancel attempted after the commit has no row
left to retry from and no row for the resulting
`customer.subscription.deleted` webhook to resolve. A cancel that fails aborts
the deletion with a 502 rather than leave a subscription billing an account
that no longer exists — the outcomes that prove cancellation moot
(`resource_missing`, canceled out of band) are already reported as success by
`StripeService.cancelSubscription`, so only a genuine "may still be billable"
reaches the abort. Deleting a user therefore has two possible outcomes,
billing stopped or nothing happened, never data gone with billing live.

`POST /payments/purchase/checkout-session` is guarded (ENG-10771, PR #992 —
each guard exists because a customer was double-billed without it):

1. 400 `NO_ACTIVE_CAMPAIGN` — no campaign passes `isActiveCampaign`
   (`campaigns/util/eligibility.util.ts`). Fulfillment webhooks resolve the
   campaign via `findActiveByUserId` and skip with a 2xx when nothing
   qualifies, so selling here = charged with no Pro and no cancel path.
2. 409 `ALREADY_PRO` — Stripe allows multiple subscriptions per customer,
   so this guard is what refuses a second sale. Pro sessions pin the stored
   customer via `StripeService.ensureCustomer` (ENG-11084), so any duplicate
   that does slip through lands visibly on the SAME Stripe customer instead
   of minting an invisible second one.
3. 409 `CHECKOUT_ALREADY_COMPLETED` — previous stored session already paid,
   isPro flip still in flight.
4. 409 `CHECKOUT_IN_PROGRESS` — lost the `compareAndSwapCheckoutSessionId`
   CAS (atomic conditional `jsonb_set` in `UsersService`). All
   `checkoutSessionId` writes go through that CAS; don't add a plain write.

### Unmatched subscription events

`customer.subscription.updated` and `customer.subscription.deleted` resolve
their campaign through `details.subscriptionId`. That is the only link back
from Stripe: a Pro checkout writes `userId` onto the checkout session, never
onto the subscription, and the session is long gone by the time a cancellation
arrives. When the lookup misses, the handler acknowledges the event and
classifies it instead of throwing — a missing local row is not a third-party
failure, and Stripe's 7 retries over ~68h re-run the same query against the
same rows, raising one alert per attempt.

`PaymentEventsService.reportUnmatchedSubscription` owns the classification.
Five conditions hide behind one lookup miss; only one is harmless, and only one
is worth retrying:

| Subscription status | Account resolution | Log | Why |
| --- | --- | --- | --- |
| any, **created < 10 min ago** | not attempted | `warn` + **503** | The only miss redelivery can fix. `checkout.session.completed` / `customer.subscription.created` write `details.subscriptionId`, and Stripe delivers a subscription's sibling events concurrently with that write, so a fresh subscription may be unlinked rather than orphaned. The window closes on its own — a genuine orphan falls through to the rows below on a later attempt. |
| billable — `active`, `trialing`, `past_due`, `unpaid`, `incomplete`, `paused` | not attempted | `error` — "still billable" | Someone is being charged with no campaign carrying their sub id. `UsersService.deleteUser` cancels before deleting, so this can never be deletion residue. Repair as ENG-10771. |
| `canceled` / `incomplete_expired` | `meta_data.customerId` hits a live user | `error` — "cancellation was never applied" | The de-Pro never ran, so the campaign may still be Pro — or its sub id was orphaned by a duplicate checkout (ENG-11084). Money stopped, fulfillment did not follow. |
| `canceled` / `incomplete_expired` | stored id misses, but the **email on the billing Stripe customer** hits a live user | `error` — "by the email on its Stripe customer", with `matchedBy` and the disagreeing `storedCustomerId` | Same cost as the row above, reached by weaker evidence. A stored customer id that disagrees with the one billing is itself the ENG-11084 signature. |
| `canceled` / `incomplete_expired` | neither resolves, or the user is `metaData.isDeleted` | `warn` — "consistent with account deletion" | Account deletion removes campaign and user together and cancels Stripe afterwards, so the event lands with nothing left to un-Pro. No redelivery and no human can act. |

Status is the discriminator that carries the most weight: a subscription that
can still bill is never the residue of an account deletion.

**The email fallback is not optional and not redundant.** Reconciling every
unmatched production subscription on 2026-09-17 resolved `meta_data.customerId`
on **1 of 20**, and on **none of the 6 canceled ones** — pre-ENG-11084
email-only checkout minted a fresh Stripe customer per session, so the customer
that ends up billing is routinely not the one stored on the user. Without the
fallback both confirmed lost cancellations classify as account deletions. The
match is case-insensitive against the unique index on `LOWER(email)`.

It stays a fallback, and nothing acts on it automatically: candidates enter
arbitrary addresses at checkout (§ Debugging Pro billing issues), so an email
hit is grounds for a human to go look, never for code to re-link a
subscription. A deleted Stripe customer carries no email, and a failed Stripe
read degrades to the `warn` rather than failing an event that was already
classifiable — the fallback can only raise a `warn` to an `error`, so losing it
must cost the enrichment and nothing else.

Both `error` lines carry `subscriptionId`, `customerId`, `status`, `cancelAt` /
`canceledAt` and `cancellationReason`, which is enough to find the customer in
Stripe without a DB query — search Loki for `"Unmatched"`. The `error` lines are
what the alert pipeline keys on; the `warn` sits deliberately below it.

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

**Start with the reconciliation report when the question is "who else?".**
Every recipe below starts from one reported account. `scripts/stripe-campaign-reconcile.ts`
starts from Stripe and walks every Pro subscription against the campaign rows,
which is the only way to find the cases nobody reported — Loki holds 30 days,
and `campaign.details.subscriptionId` has no constraint, no history, and no
second copy, so a linkage lost before that window leaves no trace anywhere but
the divergence itself. It is strictly read-only (GETs and SELECTs; it refuses to
put any other verb on the wire) and reports six drift classes that map onto the
recipes here:

| Class                | Shape                                                   | Recipe                                       |
| -------------------- | ------------------------------------------------------- | -------------------------------------------- |
| `DUPLICATE_BY_EMAIL` | >1 customer record under one email, >1 sub between them | "Charged twice", below, plus a customer merge |
| `ORPHANED_ACTIVE`    | Billing at Stripe, no campaign holds the id             | Re-link by `metadata.userId`, else refund    |
| `DUPLICATE`          | One customer, >1 non-canceled Pro sub                   | "Charged twice", below                       |
| `MISMATCH`           | Stored `subscriptionId` belongs to another customer     | Fix `customerId`; subs can't be reparented   |
| `STALE_PRO`          | `isPro` with no live subscription behind it             | "Cancelled Pro but Stripe kept billing"      |
| `ORPHANED_CANCELED`  | Not collecting, no campaign — usually account deletion  | None; read `cancellation_details.reason`     |

`npx tsx scripts/stripe-campaign-reconcile.ts` (add `--json` to pipe it). Full
operator procedure, including which credentials to use and what remediation each
class implies: `packages/runbooks/books/reconcile-stripe-subscriptions.md`.

**The data half of those recipes is scripted.**
`scripts/repair-orphaned-pro-subscriptions.ts` takes that report's `--json` (or
explicit `--subscription` ids) and performs the three repairs below that are
pure Postgres corrections: re-linking a live orphan to its campaign (writing
`details.subscriptionId`, `is_pro`, and `metaData.customerId` when the stored
one disagrees), repointing a `MISMATCH`, and normalising
`details.subscriptionCanceledAt` to milliseconds. Dry-run by default; `--apply`
writes, one transaction per subscription, appending an audit line per field.

Four things about it are load-bearing rather than incidental. It takes a
**reviewed input list** and never derives its own population, because the
classifications have been wrong once already. It **re-verifies every row**
against Stripe and the database at plan time and re-asserts each precondition in
the statement's own `WHERE`, so a stale file refuses rather than writes. It
**never overwrites a non-null `subscriptionId`** — doing so orphans whatever it
pointed at, which is the ENG-11084 mechanism reproduced by the repair meant to
fix it. And it **refuses to de-Pro anything at all**, plus it cannot put
anything but a GET on the wire to Stripe, so cancels and refunds stay human.
Procedure: `packages/runbooks/books/repair-orphaned-pro-subscriptions.md`
§ "The repair script".

**"Charged twice" (ENG-10771 shape; recurred as ENG-11083).** First check
for TWO Stripe customers under one email (pre-ENG-11084 checkouts minted one
per completed session — the reconciliation report finds these by itself and
calls them `DUPLICATE_BY_EMAIL`, with the combined total across both records;
that shape also needs the customer records merged, not just a sub cancelled),
then list subs per customer. Known chain: duplicate
checkout → second sub; `checkout.session.completed` overwrites
`campaign.details.subscriptionId` (error-logged since ENG-11084 when the
stored id differs — search Loki for "possible duplicate Pro subscription"),
orphaning (not cancelling) the first sub, which keeps billing (its renewal
`customer.subscription.updated` now error-logs "still billable" with both ids
— see § Unmatched subscription events); CS cancelling
the SECOND sub then fires `customer.subscription.deleted` and un-Pros the
campaign while the FIRST sub still bills — paying-but-not-Pro. Repair = pick
the sub to keep, fix `subscriptionId`/`customerId` by SQL, cancel/refund the
other in Stripe. Refunds can be blocked on insufficient Stripe available
balance — retry later.

**Before repairing one of these, look for the sibling subscription.** The
orphan is usually *not* the one the campaign carries: the duplicate checkout
mints a second Stripe customer, the campaign ends up correctly linked to one of
the pair, and the other bills invisibly. So cancelling the subscription a
campaign *does* carry de-Pros a paying customer, which is the ENG-10771
incident itself. Establish which is which first —
`SELECT id, is_pro, details->>'subscriptionId' FROM campaign WHERE
details->>'subscriptionId' = '<sub_id>'`; an empty result is what makes it an
orphan. Current reconciled population, per-subscription exposure and per-case
recommendations: `packages/runbooks/books/repair-orphaned-pro-subscriptions.md`.

**A campaign that is `isPro` with no subscription behind it is a different
class** from an orphaned subscription, and needs no Stripe key to find:
`scripts/pro-without-subscription-drift.ts` reports it from `DATABASE_URL`
alone. That matters because `GP_API_PROD` — which holds both the live Stripe
key and the prod DB password — is NOT readable by the default `EngineerAccess`
SSO role (`secretsmanager:GetSecretValue` is denied), so anything requiring it
is an access request rather than a self-serve step. The sharpest signal is
`details.subscriptionCanceledAt` later than `details.isProUpdatedAt` while
`is_pro` is still true: the row contradicts itself, because
`customerSubscriptionDeletedHandler` both stamps `subscriptionCanceledAt` (via
its own `patchCampaignDetails` call) and sets `isPro = false` (via
`persistCampaignProCancellation`, which does *not* write the stamp itself). It
cannot distinguish a comped campaign — nothing in the schema records a comp —
so treat the output as triage input, never as an input to a write.

**`details.subscriptionCanceledAt` is not in a consistent unit.**
`customerSubscriptionDeletedHandler` writes `Date.now()` (milliseconds);
`customerSubscriptionUpdatedHandler` writes Stripe's `canceled_at` verbatim,
which is Unix **seconds**. Both are in the column. Any query or script
comparing that key to a date must normalise first — reading a seconds value as
milliseconds silently lands in January 1970 and the comparison quietly fails
rather than erroring. **Milliseconds is the canonical unit** (the key is typed
`number` and the web app hands it to `new Date(...)`), and
`repair-orphaned-pro-subscriptions.ts --normalize-canceled-at` rewrites the
seconds-stamped rows. It is safe to re-run: the `< 1e11` predicate that selects
a seconds value no longer matches the millisecond value it wrote, so nothing
scales twice. Until the write side is fixed, the updated handler keeps creating
them.

**`details.isProUpdatedAt` is not in a consistent shape either.** `setIsPro`
writes `formatISO(new Date())` — an ISO string — but only since #1682; before
that it wrote `Date.now()`, and no migration ever backfilled those rows, which
is why `campaign.jsonTypes.d.ts` types the key `string | number`. `->>` returns
the legacy rows as digits, so a reader that treats the key as a date gets `NaN`
in JS and, in SQL, either `invalid input syntax for type timestamp with time
zone` (`'1751328000000'`) or a valid-but-unrelated date (`'20260701'`). Read
digits as an epoch and never as a date. This matters most where an absent
upgrade stamp is itself a signal: in the `subscriptionCanceledAt`-later-than-
`isProUpdatedAt` comparison above, a legacy stamp read as absent turns a
healthy cancel-then-resubscribe into a false "still Pro after cancellation".

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
retry re-attempt the finalize. One exception: a `BadRequestException` (a
permanent Peerly content rejection, e.g. a banned link in the script) is
ACKED by the webhook handler instead of rethrown — redelivery can never
succeed, and the client-facing complete call still returns the 400 with the
vendor message. Losing the claim proves nothing: the loser
polls for the winner's `projectId` and throws unless fulfillment is confirmed,
so a loser's success can never stamp the marker while the winner fails.
Sessions without `outreachId` (pre-draft-first clients) fall back to
free-texts redemption only.

A delayed-notification payment (ACH bank debit) completes checkout with
`payment_status: unpaid`. `completeCheckoutSession` then returns
`{ deferred: true }` and fulfills nothing;
`checkout.session.async_payment_succeeded` re-enters the same path with `paid`
days later, and `checkout.session.async_payment_failed` routes to the purchase
type's registered payment-failed handler
(`registerCheckoutSessionPaymentFailedHandler`; TEXT unwinds the draft to
`failed` and notifies CAS + the candidate). Neither async event is subscribed
by code: the Stripe dashboard's webhook endpoint must list them, and nothing in
CI checks that it does. Before 2026-09-21 it did not, so every ACH text
purchase since the `paid` gate landed (2026-06-11) sat deferred forever. Since
2026-09-22 one-time sessions no longer offer `us_bank_account` at all, so this
path is a safety net for sessions minted before then, not a product feature.

## Serve SMS fulfillment (SERVE_TEXT)

`SERVE_TEXT` is the Serve twin of the TEXT flow above, for an elected official
texting constituents. It exists as its own type because the TEXT handler
returns early unless a `campaignId` is present and `outreachType === 'p2p'`,
and then finalizes to Peerly — a Serve row has no campaign and no Peerly
identity. `create-checkout-session` already accepts a campaign OR an
organization, so no route change was needed.

The handler is `outreach/services/outreachServeSmsPurchase.service.ts`. It
prices off `Outreach.textCount` (server-written at draft, never a client
count), refuses a row that is not `pending_payment` so a paid send cannot be
checked out twice, and its post-purchase step is the same
`pending_payment → pending` CAS claim the TEXT path uses, followed by an
`outreachTextSend` queue message rather than a Peerly submission. Full
invariants: `outreach/AGENTS.md`, "Serve SMS purchase".

## Gotchas

- Stripe webhooks must be idempotent — events can replay. Preserve dedupe in `PaymentEventsService` when adding handlers.
- The webhook route is `@PublicAccess()` and verifies the `stripe-signature` header — never bypass that check.
- `PaymentsService.backfillMissingCustomerIdsOnBoot` runs at startup via `@Timeout(0)`. Be mindful of side effects when adding work to `PaymentsService` constructor or boot path.
- Test fixtures use Stripe test-mode IDs prefixed `pi_test_…`. Don't compare against literal IDs in assertions; assert on side effects (DB row, user metadata) instead.
