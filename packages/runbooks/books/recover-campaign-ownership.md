Manually move ownership of a team organization from one user to another — a
candidate who lost access, a manager who created the account and now has to hand it
to the candidate, an owner who left. Applies to both products: a Win campaign or a
Serve elected office, whichever the organization is. Team accounts (epic ENG-10816)
make this more likely: for the first time an organization has more than one person
who could plausibly be the owner. There is no in-product transfer flow. This is the
fallback, and it is a production database write — read the whole thing before
touching anything.

## Prerequisites

**Tools**: read/write access to the gp-api production Postgres (VPN + `gp-admin` AWS
profile for the DB secret — see `packages/gp-api/AGENTS.md` / the DB-access runbook
for the connection recipe). HubSpot access to correct a contact property. No admin
endpoint exists for any of this — every step here is a direct SQL statement, done by
hand.

**Model this runbook assumes**: `Organization.ownerId` (→ `User.id`),
`Campaign.userId` (→ `User.id`, one campaign per organization via
`Campaign.organizationSlug`), `ElectedOffice.userId` (→ `User.id`, one elected
office per organization via `ElectedOffice.organizationSlug` — the Serve-product
counterpart to `Campaign.userId`; an org has one or the other, not both),
`User.metaData.customerId` (Stripe customer, JSONB), `Campaign.details.subscriptionId`
(Stripe subscription, JSONB), and `OrganizationMembership` (`organizationSlug`,
`userId`, `role` — enum `OrganizationRole` = `owner` / `campaignAdmin` /
`volunteer`, unique on `(organizationSlug, userId)`). Everything but
`OrganizationMembership` exists today; verify current field names against
`packages/gp-api/prisma/schema/*.prisma` before you run anything, since this file can
drift. **`OrganizationMembership` does not exist yet in every environment** — it
ships as part of epic ENG-10816 (Team accounts and roles), as a sibling PR to this
runbook. Step 2 is split into two blocks for exactly this reason: Block A (org +
campaign/elected-office) always runs; Block B (the membership rows) is gated on the
table existing, and skipping it just means the old owner has no soft-landing role —
they lose access to the campaign until the table (and the invite/member-management
endpoints on top of it) ship.

Owners never get a membership row. `UseOrganizationGuard` and `UseCampaign` resolve
org-level ownership as `WHERE slug = X AND owner_id = userId` — a plain column match,
not a membership lookup — so their guard fallback covers the owner without one.
`UseElectedOfficeGuard` checks that same org-ownership condition too, but does **not**
stop there: it independently requires `elected_office.user_id = userId` on top of it
(`if (org && eo) { ... }`), so a Serve org needs both columns flipped in Block A, not
just `Organization.ownerId`. That is also why Block B deletes the new owner's
membership row instead of promoting it: once they're the owner, a leftover membership
row is just dead data.

## When to escalate instead of running this

Stop and hand this to a human with broader authority (eng lead, CS lead, or legal for
the first case) rather than running the runbook yourself if:

- **The campaign is contested** — two people both claim to be the rightful owner, or
  the request describes a dispute (a falling-out between a candidate and a manager,
  a campaign that split). This runbook resolves "who should own this" only when that
  is already settled; it is not the tool for settling it.
- **The requester's email owns nothing.** If the email making the request doesn't
  match the current owner, a `campaignAdmin` member of this exact organization, or a
  documented instruction from one of those people, do not proceed on their say alone.
  See Step 1 — this is the check that keeps this runbook from being an
  account-takeover tool.
- **Anything touching a paid subscription mid-cycle.** This runbook deliberately never
  writes `User.metaData.customerId` or `Campaign.details.subscriptionId` — see Step 3.
  If the request also wants a refund, an immediate cancel, or the subscription moved
  to a different Stripe customer right now, that needs someone with Stripe access
  making a deliberate billing decision, not a side effect of an ownership transfer.

## Step 1 — verify the requester is entitled to this campaign

The write in Step 2 hands control of a campaign (and, transitively, its CRM data,
voter file access, and billing actions) to a different account. Confirm identity
before you touch anything, the same discipline the
`transfer-candidate-domain` skill uses for domain transfers.

Read-only — no write access needed for this step.

```sql
\set org_slug 'example-org-slug'

-- Today's owner, and whichever product this org is: a Win campaign, a Serve
-- elected office, or (rarely) neither yet. You need to know which, because
-- Step 2's transaction updates whichever one exists.
SELECT o.slug AS organization_slug, o.owner_id AS current_owner_user_id,
       ou.email AS current_owner_email, ou.first_name, ou.last_name,
       c.id AS campaign_id, c.slug AS campaign_slug, c.user_id AS campaign_user_id,
       eo.id AS elected_office_id, eo.user_id AS elected_office_user_id
FROM organization o
JOIN "user" ou ON ou.id = o.owner_id
LEFT JOIN campaign c ON c.organization_slug = o.slug
LEFT JOIN elected_office eo ON eo.organization_slug = o.slug
WHERE o.slug = :'org_slug';

-- Everyone else with a role on this org. Once OrganizationMembership exists:
SELECT m.user_id, m.role, u.email, u.first_name, u.last_name
FROM organization_membership m
JOIN "user" u ON u.id = m.user_id
WHERE m.organization_slug = :'org_slug';
```

Bind the org slug to a psql variable and reference it with `:'org_slug'` rather than
interpolating a string from a ticket — same reasoning as the domain runbook.

**The requester must be the current owner, a `campaignAdmin` on this exact org, or
acting on explicit written instruction from one of those two.** A support ticket
forwarded from some other address is not that — candidates routinely email from an
address that doesn't match their account, and the two can look identical (a dot, a
plus-tag). If the request email doesn't exactly match `current_owner_email` or a
`campaignAdmin` row's email, either confirm through the account email on file or
don't proceed.

Also confirm the intended new owner is a real, known account:

```sql
\set candidate_email 'jane@example.com'

SELECT id, email, first_name, last_name FROM "user"
WHERE lower(email) = lower(:'candidate_email');
```

If that account doesn't exist yet, this isn't the runbook for it — get them signed
up and invited onto the org through the normal invite flow first, then come back
here once they have a real `userId` on this organization.

## Step 2 — the ownership transaction

Two blocks, not one — deliberately, so this stays copy-paste-safe whether or not
`OrganizationMembership` has shipped yet.

**Block A is the transfer.** One transaction over `Organization.ownerId` and
whichever of `Campaign.userId` / `ElectedOffice.userId` applies to this org. All of
it or none — a partial write leaves a campaign whose org owner and campaign (or
elected office) user disagree, and every guard that resolves ownership
(`UseOrganizationGuard`, `UseCampaign`, `UseElectedOffice`, the CRM's
`UseEngagementContext`, `CanDownloadVoterFile`) reads that disagreement differently.
Always exists, always runs.

**Serve orgs need the elected-office row too, not just the org.**
`UseElectedOfficeGuard` does not fall back to org ownership the way the others do —
it independently requires `elected_office.user_id = callerId` on top of
`organization.owner_id = callerId` (`if (org && eo) { ... }`; either alone 404s). If
you skip that update on a Serve org, the new owner passes `UseOrganizationGuard` but
404s on every elected-official/serve-hub endpoint gated by `UseElectedOffice`.

```sql
\set org_slug 'example-org-slug'
\set old_owner_id 1001
\set new_owner_id 2002

BEGIN;

-- 1. Flip the org owner. Must affect exactly one row — 0 means old_owner_id is
-- stale (re-check Step 1); more than 1 is impossible given the PK on slug.
-- Set updated_at explicitly: @updatedAt is Prisma-client-only, a raw SQL write
-- doesn't bump it on its own, and Step 3 depends on this row looking "current".
UPDATE organization
SET owner_id = :new_owner_id, updated_at = now()
WHERE slug = :'org_slug'
  AND owner_id = :old_owner_id;

-- 2a. Win org: flip the campaign user. Run this OR 2b, whichever Step 1 showed
-- this org has — not both. Must affect exactly one row.
UPDATE campaign
SET user_id = :new_owner_id, updated_at = now()
WHERE organization_slug = :'org_slug'
  AND user_id = :old_owner_id;

-- 2b. Serve org: flip the elected office's user instead. UseElectedOfficeGuard
-- checks this column independently of organization.owner_id (see above) — skip
-- it and the new owner is locked out of serve-hub endpoints despite owning the org.
-- UPDATE elected_office
-- SET user_id = :new_owner_id, updated_at = now()
-- WHERE organization_slug = :'org_slug'
--   AND user_id = :old_owner_id;

COMMIT;
```

Read the row count psql prints after each `UPDATE` before you type `COMMIT`. The
`organization` update and whichever of `campaign` / `elected_office` applies must
both say `UPDATE 1`. If either says `UPDATE 0`, stop and `ROLLBACK` — you are looking
at a stale `old_owner_id` or the wrong `org_slug`, not a transient error. Don't
loosen the `WHERE` clause to force a match, and don't run both 2a and 2b — an org
has one or the other, per Step 1's read.

**Block B is the old owner's soft landing, and only runs if the table exists.**
`OrganizationMembership` ships as part of this same epic (ENG-10816) but as a
sibling PR — it may not have landed in this environment yet. Unlike Block A, Block
B is never load-bearing for a guard: no guard requires the old owner to have any
particular membership state, so if this block doesn't run at all, the only
consequence is the one already called out in Prerequisites — the old owner loses
access outright instead of landing as `campaignAdmin`. That also makes Block B safe
to treat as a separate transaction: if it fails after Block A has already
committed, the ownership transfer itself still stands, and Block B is trivially
re-runnable (or skippable) on its own, unlike Block A.

Check the table exists before running Block B at all:

```sql
SELECT to_regclass('organization_membership');
-- NULL → skip Block B entirely. The transfer is already complete from Block A;
-- the old owner simply has no membership row until this table ships.
-- non-NULL → the table exists, continue.
```

```sql
\set org_slug 'example-org-slug'
\set old_owner_id 1001
\set new_owner_id 2002

BEGIN;

-- 3. The new owner never keeps a membership row — the guard fallback in
-- UseOrganizationGuard covers owners without one. Remove theirs if the invite
-- flow left one (0 rows here is fine and expected for a brand-new owner).
DELETE FROM organization_membership
WHERE organization_slug = :'org_slug'
  AND user_id = :new_owner_id;

-- 4. Old owner. Run ONE of the next two, not both.

-- 4a. Staying on the team as a manager:
INSERT INTO organization_membership
  (organization_slug, user_id, role, invited_by_user_id, created_at, updated_at)
VALUES
  (:'org_slug', :old_owner_id, 'campaignAdmin', :new_owner_id, now(), now())
ON CONFLICT (organization_slug, user_id)
DO UPDATE SET role = 'campaignAdmin', updated_at = now();

-- 4b. Leaving the campaign entirely — use this instead of 4a:
-- DELETE FROM organization_membership
-- WHERE organization_slug = :'org_slug' AND user_id = :old_owner_id;

COMMIT;
```

## Step 3 — what Stripe cannot do

**A Stripe subscription cannot be reparented between customers.** The Stripe
customer of record lives on `User.metaData.customerId`; the subscription id lives on
`Campaign.details.subscriptionId`. The transaction above never touches either field —
on purpose, per the escalation rule above — so after the transfer the subscription is
unchanged and still billed to the **old owner's** Stripe customer and card.

Tell whoever is relaying this to the candidate, in words you can paste directly:

> Your campaign's Pro subscription is still billed to [old owner]'s card. Nothing
> changes automatically. To move billing to your own card, go to **Manage
> Subscription** in your account settings — the first time you do this, we'll look up
> the subscription attached to your campaign and open Stripe's billing portal for it,
> where you can add your own payment method. Until you do that, [old owner]'s card
> keeps being charged.

That "first time" behavior is real, not aspirational: `POST /v1/payments/portal-session`
(`purchase.controller.ts`) opens the portal for `@ReqUser()`'s own `customerId`. If the
new owner has none yet, `recoverCustomerIdFromSubscription` looks up campaigns by
`userId` (now the new owner, post-transfer), reads `campaign.details.subscriptionId`,
asks Stripe who that subscription's customer actually is (the old owner's), and
backfills that customer id onto the **new owner's** `User.metaData.customerId` before
opening the portal. So their first "Manage Subscription" click does land them on the
right Stripe customer, where they can swap the payment method.

This recovery has two silent-failure paths — both leave the new owner's
`customerId` pointed at the wrong Stripe customer with no error anywhere:

1. **The new owner already has their own `customerId`.** If they previously ran
   their own paid campaign, `user.metaData.customerId` is already set, the `??`
   fallback never runs, and Manage Subscription opens their own unrelated customer.
2. **The new owner owns more than one campaign with a subscription.**
   `recoverCustomerIdFromSubscription` doesn't look up the campaign that was just
   transferred specifically — it loads *every* campaign owned by `userId`, sorted
   `updatedAt` desc, and takes the first one with a `details.subscriptionId`. If the
   new owner owns another campaign (their own, from before this transfer) that also
   carries a `subscriptionId` and was touched more recently, that other campaign's
   subscription — and its Stripe customer — wins the lookup instead of the one you
   just transferred. The backfill still "succeeds": it writes *a* customerId, just
   not the right one.

Either way, verify rather than assume: after Step 2, check `user.metaData.customerId`
for the new owner.

```sql
\set new_owner_id 2002
SELECT id, email, meta_data->>'customerId' AS customer_id FROM "user"
WHERE id = :new_owner_id;
```

- **`customer_id` is `null` and the new owner owns no other subscribed campaign** —
  the common case. Paste the message above; their first Manage Subscription click
  will resolve correctly.
- **`customer_id` is already set, or the new owner owns another campaign with its
  own `subscriptionId`** — don't paste the message above. The automatic recovery
  will point at the wrong Stripe customer (theirs, or another campaign's) rather
  than the one for the campaign you just transferred. Escalate to someone with
  direct Stripe access to set the payment method deliberately instead of letting
  the recovery guess.

## Step 4 — the HubSpot correction

The old and new owner's contact roles on the campaign's HubSpot company record go
stale — nothing in this runbook's transaction touches HubSpot, and there's no sync
trigger for a manual DB write. Correct it by hand:

1. Find the company record for the campaign (associated via the existing
   campaign-to-company sync).
2. On the old owner's contact, update the `team_role` property to whatever reflects
   their new status (`campaignAdmin` if they stayed on the team per Step 2, or clear
   it if they left).
3. On the new owner's contact, set `team_role` to `owner`.

`team_role` is a new contact property landing with epic ENG-10816's HubSpot ticket
(ENG-10829) — confirm it exists and get its exact internal name from whoever built
that ticket before you edit it. HubSpot silently no-ops a write to a property whose
internal name doesn't match exactly; it won't error, it just won't stick.

## Step 5 — verify the transfer landed

Read-only checks, in order:

```sql
\set org_slug 'example-org-slug'
\set old_owner_id 1001
\set new_owner_id 2002

-- 1. New owner resolves as owner exactly the way UseOrganizationGuard does.
SELECT slug, owner_id FROM organization
WHERE slug = :'org_slug' AND owner_id = :new_owner_id;
-- expect 1 row.

-- 2. Campaign (Win) or elected office (Serve) agrees with the org — run
-- whichever matches this org's product, per Step 1.
SELECT id, slug, user_id FROM campaign
WHERE organization_slug = :'org_slug' AND user_id = :new_owner_id;
-- expect 1 row, same campaign as before the transfer.

SELECT id, user_id FROM elected_office
WHERE organization_slug = :'org_slug' AND user_id = :new_owner_id;
-- expect 1 row for a Serve org. A 0-row result here on a Serve org means
-- UseElectedOfficeGuard will 404 the new owner on every serve-hub endpoint
-- even though they now own the org — re-check Step 2's 2b.

-- 3. New owner carries no leftover membership row.
SELECT user_id, role FROM organization_membership
WHERE organization_slug = :'org_slug' AND user_id = :new_owner_id;
-- expect 0 rows.

-- 4. Old owner resolves to whatever Step 2 intended.
SELECT user_id, role FROM organization_membership
WHERE organization_slug = :'org_slug' AND user_id = :old_owner_id;
-- expect 1 row with role = 'campaignAdmin' if they stayed, 0 rows if they left.

-- 5. Billing state is unchanged by this runbook.
SELECT details->>'subscriptionId' AS subscription_id FROM campaign
WHERE organization_slug = :'org_slug';
-- same subscriptionId as before the transaction.
```

Then confirm client-side: have both accounts (or impersonate them) load the org
picker. The campaign should now appear for the new owner and disappear from the old
owner's list unless they stayed on as `campaignAdmin`, in which case it stays but
without owner-only actions (billing, member removal, role changes — see the
`@OwnerOnly()` inventory in the team-accounts TDD's implementation notes).

## Known gaps

- **No admin endpoint or admin UI does any of this.** Every write is a hand-run SQL
  transaction with no audit trail beyond the rows' `updated_at`. If this runbook gets
  used often, that's the signal to build the real in-product transfer flow the model
  already permits — not a reason to keep hand-rolling it.
- **The Stripe recovery in Step 3 is a side effect of an unrelated bug fix
  (`recoverCustomerIdFromSubscription`, added to backfill a different class of
  stranded users), not a feature built for ownership transfer.** It happens to make
  "replace the card via the billing portal" true for the common case. Don't assume it
  generalizes to every billing edge case — verify the new owner's `customerId` was
  actually null before the transfer if the outcome matters.
- **`team_role` in HubSpot doesn't exist yet as of this writing.** Coordinate with
  ENG-10829 before Step 4 is actionable.

## Related

- `packages/gp-api/prisma/schema/organization.prisma`, `campaign.prisma`,
  `electedOffice.prisma`, `user.prisma` — source of truth for the field names this
  runbook depends on.
- `packages/gp-api/src/organizations/guards/UseOrganization.guard.ts` and
  `packages/gp-api/src/electedOffice/guards/UseElectedOffice.guard.ts` — the
  owner-fallback (and, for Serve, the independent `elected_office.user_id` check)
  the transaction in Step 2 has to keep consistent.
- `packages/gp-api/src/payments/purchase.controller.ts` — `createPortalSession` and
  `recoverCustomerIdFromSubscription`, referenced in Step 3.
- `.claude/skills/transfer-candidate-domain/SKILL.md` — the identity-verification
  precedent this runbook's Step 1 mirrors, for a different kind of transfer.
- ClickUp doc `2ky4jq2q-20493` (page `2ky4jq2q-104653`) — the "Team accounts and
  roles" TDD, which names manual admin recovery as the fallback this runbook fills in.
