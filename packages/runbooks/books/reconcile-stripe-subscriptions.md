Find the people Stripe is billing that our database cannot account for, and the
people getting Pro without paying for it. This is a read-only audit: it produces
a report, and a human decides what to refund, cancel, or repair. Run it when
somebody reports a charge we cannot explain, after any incident that touched
`campaign.details.subscriptionId`, and on a schedule if nothing else is watching.

## Why this exists

A campaign's Stripe subscription id lives in exactly one place — the JSONB key
`campaign.details->'subscriptionId'`. There is no subscription table, no foreign
key, and no uniqueness constraint. `CampaignsService.findBySubscriptionId` is the
only lookup, and it is a JSON path match. When that one string is lost, the
subscription keeps billing and nothing in the product knows it exists.

Three known defects lose it:

1. **`patchCampaignDetails` reads, modifies, and writes outside its
   transaction.** Two concurrent writers to the same campaign row clobber each
   other's keys. Prod logged 25 Prisma P2034 write conflicts in 30 days with
   stack traces landing on the `subscriptionId` write paths during Pro upgrades.
2. **`UsersService.deleteUser` cancels Stripe AFTER cascade-deleting the
   campaign, and only ever looks at `user.campaigns[0]`.** A user with more than
   one campaign can have a subscription left billing after their account is
   gone, with the row that held its id already deleted.
3. **The subscription webhooks answer 502 when the lookup misses.** The
   condition was surfaced as an upstream error rather than recorded as data
   drift, so nobody was counting.

A fourth defect does not lose the linkage but doubles the charge: before
ENG-11084, checkout identified a buyer by email alone and minted a new Stripe
customer for every completed session. One person completing checkout twice
became two customer records, each billing them separately, with no shared
identifier for anything to notice. The worst confirmed case ran 14 months.

Loki keeps 30 days. Anything older than that leaves no log evidence at all, and
the confirmed victims are older than that. A direct Stripe↔database walk is the
only way to find them.

## Prerequisites

**Tools**: the gp-api production database (VPN + `gp-admin` AWS profile for the
secret) and the live Stripe key. Both are in the `GP_API_PROD` AWS secret
(`DB_PASSWORD`, `STRIPE_SECRET_KEY`).

**Use read-only credentials even though the script cannot write.** Prefer the
`readonly_user` Postgres role (`packages/gp-api/scripts/setup-readonly-role.sh`)
and a Stripe restricted key with read-only permissions. The script refuses to
issue anything but a GET to Stripe and only ever runs SELECTs, but credentials
that cannot write are the layer that does not depend on anyone reading the code.

**Cost**: the run walks every subscription on the Stripe account, plus one
customer read per customer holding a non-canceled Pro subscription (that lookup
is what detects duplicates split across customer records) and one invoice list
per refund-candidate finding. On the current account that is a few minutes. It
is safe to run repeatedly — nothing it does has an effect.

## Step 1 — run the report

```bash
cd packages/gp-api

export STRIPE_SECRET_KEY='sk_live_...'   # from the GP_API_PROD secret
export DATABASE_URL='postgresql://readonly_user:<pw>@<prod-host>:5432/gpdb'

npx tsx scripts/stripe-campaign-reconcile.ts
```

For a machine-readable copy, or to hand the findings to somebody else:

```bash
npx tsx scripts/stripe-campaign-reconcile.ts --json > drift-$(date +%F).json
```

Progress goes to stderr and the report to stdout, so the redirect above captures
only the JSON. `--skip-invoice-totals` drops the per-subscription paid-invoice
sums; it is faster, and it costs you the ability to size a refund, so use it
only for a quick count.

The script reads the same `STRIPE_SECRET_KEY` the API does and branches on
`includes('live')` exactly the way `StripeService` does, so a test key audits
the test product and a live key audits the live one. There is no environment
flag to get wrong.

## Step 2 — read the drift classes

Findings are sorted by refund urgency, not by the order the checks run.

A subscription appears in exactly one finding. The duplicate classes are
computed first and claim theirs, so a person billed twice is a single row
carrying their combined total rather than two rows you have to notice belong
together and add up.

### DUPLICATE_BY_EMAIL — one human, two customer records, treat as urgent

Two or more Stripe customer records sharing one email address, holding more than
one non-canceled Pro subscription between them. Nothing else finds this. Opening
either customer in the Stripe dashboard shows one perfectly ordinary
subscription; the duplication is only visible by comparing customers, which is
what this class does.

The cause is the pre-ENG-11084 email-only checkout: each completed session
minted a fresh Stripe customer, so one person checking out twice ends up as two
customer records holding one subscription each.

The row gives you the shared email, every customer id, every subscription id,
the combined per-period price, and the combined paid-invoice total across all of
them — the exposure for that person, not for one of their subscriptions.

Matching normalizes case and trims whitespace, because Stripe stores whatever
was typed at checkout. A customer with **no** email is never grouped: a deleted
Stripe customer reports no email at all, and joining on absence would collapse
every deleted customer on the account into one fabricated person.

Worked example — the worst confirmed case, and the one this class was added for.
Customer `cus_ShNc4uj9XoiTfs` was created 2025-07-17 20:57:05Z and holds
`sub_1RlyrV1taBPnTqn4LMHR0MNj`. Customer `cus_ShNjwVcfKwOcjl` was created six and
a half minutes later at 21:03:41Z and holds `sub_1Rlyxu1taBPnTqn4xgXemRA5`. Same
email, both subscriptions `active` and `charge_automatically` at $10/month, both
still billing, neither linked to any campaign, 14 paid invoices each. That is
**$280 taken from one person over 14 months** for nothing. Before this class
existed the report emitted it as two unrelated $140 ORPHANED_ACTIVE rows with
nothing tying them together, which is exactly how it survived that long.

**Remediation**: this one needs more than cancelling a subscription. Merge the
duplicate customer records in Stripe so the person has one billing identity —
otherwise the next audit finds them again and the customer still sees two
entries in their own billing history. Then pick the subscription to keep
(re-link it to a campaign if one exists, per ORPHANED_ACTIVE), cancel the rest,
and refund against the combined `chargedToDate`. Refunds are per-charge and each
subscription's charges sit on its own customer, so expect to refund from both
records even after the merge.

### ORPHANED_ACTIVE — someone is paying for nothing

`active`, `trialing`, or `past_due` at Stripe, and no campaign in the database
carries the subscription id. There is no product access behind this charge and
no cancel path the customer can reach: Manage Subscription resolves off their
own campaign, and their campaign does not know about this subscription.

The report gives you amount, currency, start date, current period end, the
Stripe customer, the customer's email, and the total of every PAID invoice on
the subscription, which is the refund ceiling.

Worked example — the case that prompted this tool. Subscription
`sub_1TAcBr1taBPnTqn4UgzocpUD`, customer `cus_U8tz6wNnRMcgun`: `active`, no
`cancel_at`, $10/month, started 2026-03-13, most recently renewed 2026-09-13,
and no campaign anywhere carries the id. Six months of charges with nothing
behind them.

**Remediation**: first try to re-link. Read the subscription's
`metadata.userId`, or the checkout session that created it, and see whether that
user still has a campaign — trust the metadata over the email on the Stripe
customer, since people enter arbitrary addresses at checkout. If a campaign
exists, set `details.subscriptionId` back onto it by SQL and you have a live Pro
subscriber again. If the campaign was hard-deleted, there is nothing to re-link
to: cancel the subscription in Stripe and refund what the finding's
`totalChargedCents` says, subject to whatever the team decides about how far
back to go. Refunds can be blocked on insufficient Stripe available balance —
retry later.

### DUPLICATE — the same-customer double-billing shape, treat as urgent

One Stripe customer holding more than one non-canceled Pro subscription. This is
ENG-10771, which recurred as ENG-11083. The chain is in
`packages/gp-api/src/payments/AGENTS.md`: a duplicate checkout creates a second
subscription, `checkout.session.completed` overwrites
`campaign.details.subscriptionId`, the first subscription is orphaned rather
than cancelled and keeps billing, and cancelling the _second_ one later fires
`customer.subscription.deleted` and un-Pros the campaign while the first still
charges.

Each subscription is reported once. If neither of a customer's two live
subscriptions is linked to a campaign, that is one billing incident and you get
one DUPLICATE row naming both, not two ORPHANED_ACTIVE rows and a third — the
detail line says how many of them no campaign carries, and `chargedToDate` is
the combined total. A canceled third subscription on the same customer is not
part of the duplicate and still gets its own ORPHANED_CANCELED row.

This class is the clean case: one billing identity, one extra subscription. If
the same person's subscriptions landed on two customer records instead, the
report says DUPLICATE_BY_EMAIL and the remediation is different — you do not
need to check for that by hand, and a customer that is part of an email group is
reported there rather than here, so one human is never split across both
classes.

**Remediation**: pick the subscription to keep, fix `subscriptionId` and the
owner's `customerId` by SQL, cancel and refund the other in Stripe. No customer
merge is needed here; that is what separates this class from DUPLICATE_BY_EMAIL.

### MISMATCH — the two pointers disagree

The campaign's stored `details.subscriptionId` resolves to a Stripe subscription
whose customer is not the `metaData.customerId` stored on the campaign's owner.
One of the two is wrong, and the billing portal opens the stored one — so the
customer clicks Manage Subscription and lands on a Stripe customer that does not
hold their subscription.

Only reported while the subscription is still collecting. A de-Pro'd campaign
routinely keeps a stale `subscriptionId` pointing at a long-dead subscription,
and a disagreement about a customer nobody is billing is the ordinary residue of
a cancellation rather than a finding. The campaign's `isPro` is a column in the
output, not a filter on it: a campaign that is _not_ Pro while a live
subscription bills under a third customer is worse, not better.

Most often this is an ownership transfer (see `recover-campaign-ownership.md`
Step 3, which explains why `recoverCustomerIdFromSubscription` can backfill the
wrong customer) or a duplicate-checkout repair that fixed one pointer and not
the other.

**Remediation**: decide which is authoritative — the subscription's actual
customer almost always is, because that is what Stripe bills — and correct
`user.metaData.customerId`. A subscription cannot be reparented between Stripe
customers, so the database is what moves.

### STALE_PRO — Pro for free

`campaign.is_pro = true` while the subscription behind it is missing, canceled,
or not at Stripe at all. The finding's detail says which of the three. Demo
campaigns are excluded; they are seeded Pro deliberately.

Worked examples: `sub_1TnLmw1taBPnTqn4vQERKKXD` / `cus_Umvew4wWrtcSi5`
(cancelled 2026-09-08, reason `cancellation_requested`) and
`sub_1TlI0T1taBPnTqn4wXcOjDJQ` / `cus_Ukna4d5HsEPEVJ` (cancelled 2026-09-06,
reason `payment_failed`) — both cancelled at Stripe, both still Pro in the
product.

**Remediation**: this class has the highest false-positive rate of the six, so
check before acting. A comped campaign is intentionally Pro with no
subscription, and looks identical. `did_win` / election-result state can also
leave a legitimately-finished campaign Pro. When it is genuine drift, de-Pro
through the admin console rather than by SQL, so the CRM sync runs — and note
that admin de-Pro now also cancels the Stripe subscription (PR #1905), which is
a no-op here since there is nothing live to cancel.

### ORPHANED_CANCELED — usually harmless, list it anyway

Not collecting at Stripe, and no campaign carries the id. The overwhelmingly
common cause is account deletion: the campaign row is gone, so of course nothing
carries the id.

The reason is what makes these separable. `cancellation_details.reason` of
`cancellation_requested` means the customer asked, which is a clean ending.
`payment_failed` means Stripe gave up collecting. An empty reason on a
subscription that ended around the time of an account deletion is the deletion
path. Nothing to do unless a reason surprises you.

## Step 3 — decide, then act by hand

The script issues no refunds and cancels nothing, on purpose. Sizing a refund is
a judgement call about how far back to go, whether the customer got any value,
and what we tell them, and that is not a decision a cron job should be making.

Take the findings to whoever owns the billing decision with the amounts from the
report, then do the Stripe work in the dashboard and the SQL repairs by hand.
The repair recipes live in `packages/gp-api/src/payments/AGENTS.md` §
"Debugging Pro billing issues".

Re-run the report afterwards. It is the verification step: a repaired row drops
out of the findings.

## Known gaps

- **A hard-deleted campaign cannot be recovered.** `deleteUser` cascades, and
  nothing archives the row first. For those, re-linking is not an option and
  refund-and-cancel is the only remedy. This is the strongest argument for
  fixing the delete path rather than running this report forever.
- **Loki's 30-day retention is why this exists, and it does not come back.**
  Anything this report finds from before the window has no log trail to
  reconstruct. The Stripe and database state is all the evidence there is.
- **Email is the only link between two customer records, and it is not a
  reliable one.** DUPLICATE_BY_EMAIL finds the pre-ENG-11084 duplicates, but
  only when both records carry the same address. Someone who used two different
  addresses, or whose Stripe customer has since been deleted (deleted customers
  report no email and are deliberately never grouped), still reads as two
  unrelated ORPHANED_ACTIVE rows. Payment method or name would catch some of
  those; neither is fetched today.
- **`totalChargedCents` counts paid invoices and does not subtract refunds.** It
  is a ceiling for the refund conversation, not a balance.
- **STALE_PRO cannot tell a comped campaign from a genuine one.** Nothing in the
  schema records that a campaign was comped, so the class reports both.
- **Nothing runs this automatically.** It is an operator tool. If the drift rate
  justifies it, the next step is a scheduled job that alerts on
  ORPHANED_ACTIVE — but that job should still not be allowed to refund.

## Related

- `packages/gp-api/scripts/stripe-campaign-reconcile.ts` — the script, and the
  fullest description of each drift class in its header.
- `packages/gp-api/src/payments/AGENTS.md` — the Pro subscription lifecycle, the
  checkout guards, and the manual repair recipes each class points at.
- `books/recover-campaign-ownership.md` — Step 3 covers what Stripe cannot do
  across an ownership change, which is where many MISMATCH rows come from.
- `packages/gp-api/scripts/setup-readonly-role.sh` — creates the `readonly_user`
  Postgres role this runbook asks you to use.
