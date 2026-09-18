# Repair orphaned Pro subscriptions

Operator checklist for Pro subscriptions that Stripe is billing (or has billed)
while no campaign row carries their id, and for campaigns left Pro with nothing
behind them.

**Nothing in this runbook is automated, and nothing in the accompanying PR
cancels or refunds anything.** Every money decision below is a human's. The
purpose of this document is to make each one decidable in one sitting instead of
requiring fresh archaeology.

Companion documents:

- `reconcile-stripe-subscriptions.md` — the Stripe↔database walk
  (`scripts/stripe-campaign-reconcile.ts`). The authority on divergence, but it
  needs a live Stripe key.
- `packages/gp-api/src/payments/AGENTS.md` § "Charged twice" — the manual SQL
  repair recipe this checklist follows.

---

## Access you need, and what you can do without it

| Capability | How | Needed for |
|---|---|---|
| Prod Loki | Grafana Cloud, `grafanacloud-logs` datasource | Everything in the "Population" section below — it was all derived this way |
| Prod database | `DB_PASSWORD` in the `GP_API_PROD` AWS secret, VPN-only | The confirming queries; the `isPro` decision |
| Live Stripe read | `STRIPE_SECRET_KEY` in the `GP_API_PROD` AWS secret | Paid-invoice totals (exact refund sizing), current status, customer emails |
| DB-only drift scan | `DATABASE_URL` only | `scripts/pro-without-subscription-drift.ts` |

> **`GP_API_PROD` is not readable by the default `EngineerAccess` SSO role.**
> `aws secretsmanager get-secret-value --secret-id GP_API_PROD` returns
> `AccessDeniedException: not authorized to perform: secretsmanager:GetSecretValue`.
> Getting the live Stripe key or the prod DB password is an access request, not
> a self-serve step. Budget for it before planning a session.
>
> This is why `pro-without-subscription-drift.ts` exists: the two classes it
> reports need `DATABASE_URL` and nothing else.

---

## Population, as of 2026-09-17T22:52Z

Established entirely from prod Loki. Every subscription below appeared in a
`customer.subscription.*` webhook whose `findBySubscriptionId` lookup came back
empty, which is direct proof from the running code that **no campaign row
carried that id** at the moment of the event.

### How it was established

The `customer.subscription.updated` handler's error line carries no ids — this
is the gap #1943 records as "the updated handler's volume has never been
attributable to specific subscriptions because the id was never logged". It is
nonetheless recoverable today: the error line and the full-payload
`processing event.type => …` line share a `requestId`.

```logql
# 1. request ids of every unmatched-subscription error (113 lines over 30d)
sum by (rid) (count_over_time(
  {service_name="gp-api", deployment_environment_name="prod"}
  |= "No campaign found with given subscription" != "subscriptionId"
  | regexp "\"requestId\":\"(?P<rid>[0-9a-f-]+)\"" [30d]))

# 2. the subscription, customer and status behind those request ids
#    (run in two halves; 113 ids in one `|~` alternation exceeds no limit,
#     but grouping by (rid, sub) over 30d exceeds Loki's 500-series cap)
sum by (sub, status, cust) (count_over_time(
  {service_name="gp-api", deployment_environment_name="prod"}
  |= "processing event.type => customer.subscription.updated"
  |~ "<half of the request ids, | separated>"
  | regexp "\"data\":\\{\"object\":\\{\"id\":\"(?P<sub>sub_[A-Za-z0-9]+)\".*?\"customer\":\"(?P<cust>cus_[A-Za-z0-9]+)\".*?\"status\":\"(?P<status>[a-z_]+)\"" [30d]))

# 3. the cancellation handler's misses, which do log the id
sum by (sub) (count_over_time(
  {service_name="gp-api", deployment_environment_name="prod"}
  |= "No campaign found with given subscriptionId"
  | regexp "subscriptionId => (?P<sub>sub_[A-Za-z0-9]+)" [30d]))
```

The per-subscription event counts from the two halves of query 2 sum to exactly
113, which is the row count of query 1 — so the list below is the **complete**
population of the updated handler's misses for the window, not a sample.

### Still collecting — 14 subscriptions

All `$10.00/month`, `price_1PLrj81taBPnTqn4HsKs7DKX`, `prod_QCGFVVUhD6q2Jo`,
`charge_automatically`. `status` is the value carried on the last observed
webhook. No campaign carries any of these ids.

| Subscription | Customer | Created (UTC) | Periods elapsed | Max exposure |
|---|---|---|---|---|
| `sub_1ReIva1taBPnTqn4W2xgk6Iv` | `cus_SZRpSIFXJX1qur` | 2025-06-26 | 15 | $150 |
| `sub_1RlyrV1taBPnTqn4LMHR0MNj` | `cus_ShNc4uj9XoiTfs` | 2025-07-17 20:57:05 | 15 | $150 |
| `sub_1Rlyxu1taBPnTqn4xgXemRA5` | `cus_ShNjwVcfKwOcjl` | 2025-07-17 21:03:42 | 15 | $150 |
| `sub_1SL6s91taBPnTqn4Y1IGlfJa` | `cus_THgEDxYUiuHhUi` | 2025-10-22 | 11 | $110 |
| `sub_1SUyek1taBPnTqn4xnG7dgm1` | `cus_TRsPk3EWmDeKlV` | 2025-11-18 | 10 | $100 |
| `sub_1TAcBr1taBPnTqn4UgzocpUD` | `cus_U8tz6wNnRMcgun` | 2026-03-13 | 7 | $70 |
| `sub_1TEF9Q1taBPnTqn4WR2tfUoY` | `cus_UCeRJJ6UIZ26HZ` | 2026-03-23 | 6 | $60 |
| `sub_1TIY9G1taBPnTqn4RjSVuFEa` | `cus_UH6LV3pHzVsr3F` | 2026-04-04 | 6 | $60 |
| `sub_1TPn7n1taBPnTqn4qESixCdl` | `cus_UOaGvhlYjtMr2i` | 2026-04-24 | 5 | $50 |
| `sub_1TkzHb1taBPnTqn46W8NEBDD` | `cus_UkUGSp2bEhe0jm` | 2026-06-22 | 3 | $30 |
| `sub_1Tl6pX1taBPnTqn43xxFT2jX` | `cus_Ukc3p1y5JhQrHl` | 2026-06-22 | 3 | $30 |
| `sub_1Tp9cX1taBPnTqn45PwQLiO2` | `cus_UonCkbQ8Msgygq` | 2026-07-03 | 3 | $30 |
| `sub_1TqgsR1taBPnTqn4ho5d4ixo` | `cus_UqNdBJ1tMEDHjK` | 2026-07-07 | 3 | $30 |
| `sub_1Ttdab1taBPnTqn4wa2ELrzg` | `cus_UtQQDx487CyFxa` | 2026-07-16 | 3 | $30 |

**Total maximum exposure: $900**, plus $60 on the two terminated ones below —
**$960**.

> "Max exposure" is `elapsed monthly periods × $10`, computed from the
> subscription's `created` timestamp in its own webhook payload. It is an
> **upper bound, not a balance**: it assumes every period was invoiced and paid
> and subtracts no refunds. The method reproduces the two figures that were
> independently confirmed against live Stripe in #1945 — `$70` for
> `sub_1TAcBr1taBPnTqn4UgzocpUD`, and `$140 + $140 = $280` for the
> `cus_ShNc4uj9XoiTfs` / `cus_ShNjwVcfKwOcjl` pair (where #1945 counted 14 paid
> invoices each and this method counts 15 periods, i.e. it is one period high
> where the newest invoice is not yet paid). **Size every refund from Stripe's
> paid-invoice list, not from this table.**

### Terminated, money already stopped — 2 subscriptions

| Subscription | Customer | Canceled (UTC) | Reason | Periods | Max exposure |
|---|---|---|---|---|---|
| `sub_1TlI0T1taBPnTqn4wXcOjDJQ` | `cus_Ukna4d5HsEPEVJ` | 2026-09-06 01:20:44 | `payment_failed` | 3 | $30 |
| `sub_1TnLmw1taBPnTqn4vQERKKXD` | `cus_Umvew4wWrtcSi5` | 2026-09-08 17:20:38 | `cancellation_requested` | 3 | $30 |

### Terminated and belonging to deleted accounts — 4 subscriptions

`sub_1S5V3F1taBPnTqn4bMhuZapY`, `sub_1TUIfI1taBPnTqn4Bm3WbcPX`,
`sub_1Tls3R1taBPnTqn4MkUBNBug`, `sub_1UFboh1taBPnTqn4vZi98WgD`.

These are the cancellation-handler misses whose accounts were already gone
(#1943 condition (a); 4 of its 6 correlate to an account deletion within ~60s).
Money has stopped and there is no row to repair. No action.

---

## Correction to the diagnosis in #1943 and #1945

Both PRs describe `sub_1TlI0T1taBPnTqn4wXcOjDJQ` and
`sub_1TnLmw1taBPnTqn4vQERKKXD` as `STALE_PRO` — "both cancelled at Stripe, both
still Pro in the product". **That is not what the logs show, and the difference
changes what an operator should do.**

Each of those two subscriptions has a **sibling** on a *different* Stripe
customer, and it is the sibling that the campaign actually carried:

| Human | Orphaned subscription (no campaign) | Sibling subscription (campaign carried it) | Campaign | Both canceled |
|---|---|---|---|---|
| A | `sub_1TlI0T1taBPnTqn4wXcOjDJQ` / `cus_Ukna4d5HsEPEVJ`, created 2026-06-23 00:15:55 | `sub_1TlI1R1taBPnTqn4oS420TSf` / `cus_UknccQ7rRAO1U5`, created 2026-06-23 00:16:56 | **325506** | 2026-09-06, `payment_failed` |
| B | `sub_1TnLmw1taBPnTqn4vQERKKXD` / `cus_Umvew4wWrtcSi5`, created 2026-06-28 16:42:32 | `sub_1ToOMk1taBPnTqn4SAevoyMn` / `cus_Uo0NK36w9bTvdr`, created 2026-07-01 13:39:48 | **325636** | 2026-09-08, `cancellation_requested` |

Human A's two subscriptions were created **61 seconds apart on two different
Stripe customers** — the textbook pre-ENG-11084 email-only checkout double-mint
described in `AGENTS.md` § "Charged twice".

Which of each pair the campaign carried is corroborated independently by
`pro_upgrade_date` (i.e. `details.isProUpdatedAt`) in the campaigns' CRM syncs,
which lands on the day the *sibling* was created:

| Campaign | `pro_upgrade_date` | Sibling created | Orphan created |
|---|---|---|---|
| 325506 | `1782172800000` = 2026-06-23 | 2026-06-23 00:16:56 | 2026-06-23 00:15:55 |
| 325636 | `1782864000000` = 2026-07-01 | 2026-07-01 13:39:48 | 2026-06-28 16:42:32 |

For 325636 the two are three days apart, so the match is decisive: the campaign
became Pro on the day `sub_1ToOMk1taBPnTqn4SAevoyMn` was created, not on the day
the orphan was. For 325506 both were created the same day, so this corroborates
rather than distinguishes — the cancellation log line is what settles that one.

The sibling cancellations **succeeded**. Both returned HTTP 200 and ran
`persistCampaignProCancellation`:

```logql
{service_name="gp-api", deployment_environment_name="prod"}
  |~ "291d3e6a-ca58-4ea0-b08b-0e9465bb3a49|46da1ae4-4eff-4ba5-a21e-b1345dbfa991"
```

- `requestId 46da1ae4…`, 2026-09-06 01:19:34Z —
  `Updating campaign json fields  id:325506  {"details":{"subscriptionId":null}}`,
  then a CRM sync carrying `pro_candidate: "No"`, `pro_subscription_status: "Inactive"`.
- `requestId 291d3e6a…`, 2026-09-08 17:20:59Z — the same two lines for
  **325636**.

`pro_candidate` is `isPro ? YES : NO` in `crmCampaigns.service.ts`, so those
lines are direct evidence that `isPro` was `false` immediately after each
cancellation. **Neither campaign was left Pro by the cancellation.** The de-Pro
ran; it just ran off the sibling subscription rather than the orphan.

So these two are not a `STALE_PRO` repair. They are **duplicate-billing refund
cases**, and the orphan is the subscription to refund.

### But campaign 325636 is Pro again, with nothing behind it

```logql
{service_name="gp-api", deployment_environment_name="prod"}
  |= "CRM Company Properties" |= "<campaign 325636 candidate email>"
```

Three syncs in the window:

| When | Endpoint | `pro_candidate` | `pro_upgrade_date` |
|---|---|---|---|
| 2026-09-08 17:20:59Z | `POST /v1/payments/events` (the cancellation) | `No` | `1782864000000` |
| 2026-09-14 16:59:46Z | `PUT /v1/campaigns/325636` | **`Yes`** | `1782864000000` |
| 2026-09-16 14:42:03Z | `POST /v1/payments/purchase/complete-checkout-session` | **`Yes`** | `1782864000000` |

`pro_upgrade_date` is `details.isProUpdatedAt`, which `setIsPro` stamps **only**
on a genuine non-Pro → Pro transition. It never moved off its original
2026-07-01 value, so **no new Pro upgrade happened**. Confirmed independently:
no `checkout.session.completed`, no `customer.subscription.created`, and no Pro
checkout for that campaign, user or either customer after 2026-09-08. The
2026-09-16 `complete-checkout-session` was a **P2P texting purchase**
(`purchaseType: TEXT`), not Pro.

Campaign 325636 is therefore Pro with no subscription behind it, as of
2026-09-16 14:42:03Z.

**What flipped it back is not established, and it is not any application code
path.** Every writer of `isPro = true` in the codebase, and why each is
excluded:

| Writer | Calls `crm.trackCampaign`? | Excluded because |
|---|---|---|
| `paymentEventsService` × 2 (`setIsPro(id)`, default `true`) | yes | would have left a CRM sync; also needs a Pro checkout or subscription event, and there is none after 2026-09-08 |
| `adminCampaigns.update` (`isPro: true`) | yes — unconditionally, line 166 | would have left a fourth CRM sync. It did not |
| `campaigns.controller` `POST mine/test-set-pro` | no (`trackCampaign: false`) | hard-guarded on `IS_NON_PROD_DEPLOY` **and** `isTestUser`; cannot run in prod |
| `testFixtures.service` | no (`trackCampaign: false`) | test-fixtures module, not reachable in prod |
| `updateJsonFields` (the 2026-09-14 `PUT`) | yes | builds its update from the validated body only, and `updateCampaignBodySchema` is `.strict()` with no `isPro` key, so the route cannot set it |

The three CRM syncs in the window are accounted for, and none of them is the
write that flipped the flag. So the flip came from **outside the application** —
a direct database write, which is exactly what a manual comp looks like. That
is an argument for asking, not for de-Proing. Campaign 325506 shows no
`pro_candidate: Yes` sync at all and is not affected.

**This is why the PR does not de-Pro it.** `AGENTS.md` and #1945 both warn that
a comped campaign is indistinguishable from a stale one, the mechanism here is
unattributed, and a Prisma migration is checksummed and cannot be amended once
applied. The downside is asymmetric: wrongly leaving it Pro costs $10/month of
product, while wrongly de-Proing it strips paid features from a live campaign
weeks before its 2026-11-03 election. It goes on the checklist below instead.

---

## Confirming queries (prod read replica)

Run these before acting. They are the ground truth this runbook could not
reach.

```sql
-- 1. Does ANY campaign carry one of the orphaned subscription ids?
--    Expect zero rows. A non-empty result means the population above is stale
--    and the re-link question reopens for that row.
SELECT id, slug, user_id, is_pro, details->>'subscriptionId' AS subscription_id
FROM campaign
WHERE details->>'subscriptionId' IN (
  'sub_1ReIva1taBPnTqn4W2xgk6Iv','sub_1RlyrV1taBPnTqn4LMHR0MNj',
  'sub_1Rlyxu1taBPnTqn4xgXemRA5','sub_1SL6s91taBPnTqn4Y1IGlfJa',
  'sub_1SUyek1taBPnTqn4xnG7dgm1','sub_1TAcBr1taBPnTqn4UgzocpUD',
  'sub_1TEF9Q1taBPnTqn4WR2tfUoY','sub_1TIY9G1taBPnTqn4RjSVuFEa',
  'sub_1TPn7n1taBPnTqn4qESixCdl','sub_1TkzHb1taBPnTqn46W8NEBDD',
  'sub_1Tl6pX1taBPnTqn43xxFT2jX','sub_1Tp9cX1taBPnTqn45PwQLiO2',
  'sub_1TqgsR1taBPnTqn4ho5d4ixo','sub_1Ttdab1taBPnTqn4wa2ELrzg',
  'sub_1TlI0T1taBPnTqn4wXcOjDJQ','sub_1TnLmw1taBPnTqn4vQERKKXD'
);

-- 2. Is a user's stored customer id one of the orphaned billing customers?
--    A hit is a PROVABLE owner for that subscription and re-link becomes
--    available. Zero hits means every re-link would be a guess.
SELECT id, email, meta_data->>'customerId' AS customer_id
FROM "user"
WHERE meta_data->>'customerId' IN (
  'cus_SZRpSIFXJX1qur','cus_ShNc4uj9XoiTfs','cus_ShNjwVcfKwOcjl',
  'cus_THgEDxYUiuHhUi','cus_TRsPk3EWmDeKlV','cus_U8tz6wNnRMcgun',
  'cus_UCeRJJ6UIZ26HZ','cus_UH6LV3pHzVsr3F','cus_UOaGvhlYjtMr2i',
  'cus_UkUGSp2bEhe0jm','cus_Ukc3p1y5JhQrHl','cus_UonCkbQ8Msgygq',
  'cus_UqNdBJ1tMEDHjK','cus_UtQQDx487CyFxa',
  'cus_Ukna4d5HsEPEVJ','cus_Umvew4wWrtcSi5'
);

-- 3. The isPro question for the two duplicate-billing campaigns.
SELECT id, slug, is_pro, is_demo,
       details->>'subscriptionId'          AS subscription_id,
       details->>'isProUpdatedAt'          AS is_pro_updated_at,
       details->>'subscriptionCanceledAt'  AS subscription_canceled_at
FROM campaign
WHERE id IN (325506, 325636);
-- Expected from the logs: both subscription_id NULL; 325636 is_pro = true with
-- is_pro_updated_at still 2026-07-01; 325506 is_pro = false.

-- 4. The whole class, not just the known ids.
--    Same logic as scripts/pro-without-subscription-drift.ts.
--
--    subscriptionCanceledAt is NOT in a consistent unit: the deleted handler
--    writes Date.now() (ms), the updated handler writes Stripe's canceled_at
--    verbatim (SECONDS). Normalise, or every seconds-stamped row reads as
--    1970 and silently fails the comparison. 1e11 as ms is 1973 and as
--    seconds is the year 5138, so nothing real is ambiguous.
SELECT id, slug, user_id,
       details->>'isProUpdatedAt'         AS is_pro_updated_at,
       details->>'subscriptionCanceledAt' AS subscription_canceled_at
FROM campaign
WHERE is_pro = true
  AND COALESCE(is_demo, false) = false
  AND jsonb_typeof(details) = 'object'
  AND details->>'subscriptionCanceledAt' IS NOT NULL
  AND (
    details->>'isProUpdatedAt' IS NULL
    OR to_timestamp(
         CASE WHEN abs((details->>'subscriptionCanceledAt')::bigint) < 1e11
              THEN (details->>'subscriptionCanceledAt')::bigint
              ELSE (details->>'subscriptionCanceledAt')::bigint / 1000
         END
       ) > (details->>'isProUpdatedAt')::timestamptz
  );
```

Or, equivalently and without hand-editing SQL:

```bash
cd packages/gp-api
DATABASE_URL='postgresql://readonly_user:<pw>@<prod-host>:5432/gpdb' \
  npx tsx scripts/pro-without-subscription-drift.ts
```

With a live Stripe key, also run the full walk, which covers the classes this
one cannot see (`ORPHANED_ACTIVE`, `DUPLICATE_BY_EMAIL`, `MISMATCH`):

```bash
npx tsx scripts/stripe-campaign-reconcile.ts    # from #1945
```

---

## The checklist

Work top to bottom; the ordering is by money still moving.

### A. 14 subscriptions still billing with no campaign — cancel/refund decision

**Recommendation: cancel all 14, and refund from the point each stopped
delivering Pro.** Evidence: each one's `findBySubscriptionId` lookup came back
empty in a live webhook, so no campaign has carried the id — nobody has had
Pro features from these charges, and there is no in-product path
(Profile → Manage Subscription resolves the *stored* customer) by which the
payer could stop them. The two independently Stripe-confirmed cases
(`sub_1TAcBr1taBPnTqn4UgzocpUD`, and the `cus_ShNc4uj9XoiTfs` /
`cus_ShNjwVcfKwOcjl` pair) are already established in #1945 as real money taken
for nothing.

Before cancelling each one:

1. Run confirming query 1. If a campaign now carries the id, stop — that one is
   a live subscriber and cancelling it de-Pros a paying customer. This is the
   ENG-10771 failure mode: CS cancelled the *second* subscription, de-Pro'd the
   campaign, and the *first* kept billing.
2. Run confirming query 2. A hit gives a provable owner; prefer **re-linking**
   over cancelling, and re-link only if the campaign does not already carry a
   different live subscription.
3. Size the refund from Stripe's paid invoices for that subscription, not from
   the "max exposure" column.

**Two of the 14 are one person, not two.** `sub_1RlyrV1taBPnTqn4LMHR0MNj`
(`cus_ShNc4uj9XoiTfs`, created 2025-07-17 20:57:05) and
`sub_1Rlyxu1taBPnTqn4xgXemRA5` (`cus_ShNjwVcfKwOcjl`, created 2025-07-17
21:03:42) are the same email six and a half minutes apart — #1945 confirmed
both `active` with 14 paid invoices each against live Stripe. **$280 from one
person over 14 months.** Treat as a single refund conversation for the combined
total, and merge the two Stripe customer records.

### B. 2 terminated duplicate-billing subscriptions — refund decision

| Refund the orphan | Campaign that was billed correctly | Sibling kept | Period |
|---|---|---|---|
| `sub_1TlI0T1taBPnTqn4wXcOjDJQ` (`cus_Ukna4d5HsEPEVJ`) | 325506 | `sub_1TlI1R1taBPnTqn4oS420TSf` | 2026-06-23 → 2026-09-06 |
| `sub_1TnLmw1taBPnTqn4vQERKKXD` (`cus_Umvew4wWrtcSi5`) | 325636 | `sub_1ToOMk1taBPnTqn4SAevoyMn` | 2026-06-28 → 2026-09-08 |

**Recommendation: refund the orphan in full for both; cancel nothing** (both
sides are already `canceled`). Evidence: each campaign carried its sibling and
was correctly Pro from it, so the orphan bought that person nothing. For human
A the two were minted 61 seconds apart, which is the duplicate-checkout race,
not two deliberate purchases. Approximately **$30 each, ~$60 total** — confirm
against paid invoices.

Also **merge the duplicate Stripe customer records** in each pair
(`cus_Ukna4d5HsEPEVJ` + `cus_UknccQ7rRAO1U5`; `cus_Umvew4wWrtcSi5` +
`cus_Uo0NK36w9bTvdr`), so a future report sees one human.

### C. Campaign 325636 is Pro with no subscription — product decision

**Recommendation: confirm whether it was comped, then de-Pro only if it was
not.** The one question to answer: *did anyone deliberately grant this campaign
Pro after 2026-09-08?* A goodwill comp is entirely plausible here — this is one
of the two people in section B who was double-billed and then asked to cancel.

The flag was set from outside the application (see the table above), so the
only people who can answer are the people with prod write access.

Check, in order:

1. Ask whoever has prod database write access whether they set
   `is_pro = true` on campaign 325636 between 2026-09-08 and 2026-09-14. This
   is the highest-yield question: the enumeration above shows no code path
   could have done it.
2. Ask CS whether a comp was promised as remediation for the double billing.
   This campaign is human B in section B — double-billed, then cancelled — so
   a goodwill comp is a very plausible reason for a manual write.
3. HubSpot company for campaign 325636 — an `admin`-sourced
   `Pro Subscription Confirmed` event (`price: 0, paymentMethod: 'admin'`) is
   written by `adminCampaigns.update` whenever an admin sets `isPro: true`.
   Its **absence** is already established from the logs, so this only
   corroborates; it does not rule a comp out, because a direct SQL write
   bypasses that event entirely.
4. Confirming query 3.

If it was **not** comped, de-Pro it. Prefer the admin console
(`isPro: false`), which is the documented path and, since #1905, also cancels
Stripe — here a no-op, since `details.subscriptionId` is already `NULL`. The
SQL equivalent, if the console is unavailable:

```sql
UPDATE campaign
SET is_pro = false, updated_at = NOW()
WHERE id = 325636
  AND is_pro = true
  AND jsonb_typeof(details) = 'object'
  AND details->>'subscriptionId' IS NULL;   -- refuse if a live sub reappeared
```

If it **was** comped, leave it, and record the comp somewhere the schema can
see. Nothing today distinguishes a comped campaign from a stale one, which is
the root of this whole question — see "what this does not fix".

### D. 4 subscriptions on deleted accounts

No action. Money stopped, and the rows that held their ids are gone.

---

## After acting

Re-run both reports and expect them empty:

```bash
cd packages/gp-api
npx tsx scripts/pro-without-subscription-drift.ts
npx tsx scripts/stripe-campaign-reconcile.ts     # needs the live key
```

And confirm the webhook noise has stopped — this should trend to zero once the
14 are cancelled or re-linked:

```logql
sum(count_over_time(
  {service_name="gp-api", deployment_environment_name="prod"}
  |= "No campaign found with given subscription" [7d]))
```

Baseline for that query over the 30 days to 2026-09-17: **226 lines** from the
updated handler (113 events, double-logged) and **84** from the cancellation
handler (42 events).

---

## What this runbook cannot tell you

- **Exact paid totals.** Every dollar figure here is an upper bound from
  elapsed monthly periods. Only Stripe's paid-invoice list is a balance.
- **Current Stripe status.** The `status` for each of the 14 is the value on its
  most recent webhook, not a live read. One may have lapsed since.
- **Who the 14 are.** Loki holds 30 days. The oldest of these has been billing
  since 2025-06-26, so its checkout session — the one place `metadata.userId`
  is written — is long gone. `subscription.metadata` is `{}` on every one of
  them (verified in the payloads), so the subscription itself carries no link
  back to an account. Confirming query 2 against the stored `customerId` is the
  only provable link left, and #1943's reconciliation found it matching for
  **1 of 20** unmatched subscriptions and **0 of 6** canceled ones.
- **Whether anyone else is affected outside the 30-day window.** A subscription
  that bills monthly emits a webhook monthly, so a 30-day window should catch
  every live one; a subscription paused, on a longer interval, or whose renewal
  fell outside the window would be missed. Only the Stripe walk settles that.
