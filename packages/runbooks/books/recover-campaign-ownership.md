Manually move ownership of a team campaign from one user to another — a candidate
who lost access, a manager who created the account and now has to hand it to the
candidate, an owner who left the campaign. Team accounts (epic ENG-10816) make this
more likely: for the first time a campaign has more than one person who could
plausibly be the owner. There is no in-product transfer flow. This is the fallback,
and it is a production database write — read the whole thing before touching
anything.

## Prerequisites

**Tools**: read/write access to the gp-api production Postgres (VPN + `gp-admin` AWS
profile for the DB secret — see `packages/gp-api/AGENTS.md` / the DB-access runbook
for the connection recipe). HubSpot access to correct a contact property. No admin
endpoint exists for any of this — every step here is a direct SQL statement, done by
hand.

**Model this runbook assumes**: `Organization.ownerId` (→ `User.id`),
`Campaign.userId` (→ `User.id`, one campaign per organization via
`Campaign.organizationSlug`), `User.metaData.customerId` (Stripe customer, JSONB),
`Campaign.details.subscriptionId` (Stripe subscription, JSONB), and
`OrganizationMembership` (`organizationSlug`, `userId`, `role` — enum
`OrganizationRole` = `owner` / `campaignAdmin` / `volunteer`, unique on
`(organizationSlug, userId)`). The first four exist today; verify current field names
against `packages/gp-api/prisma/schema/*.prisma` before you run anything, since this
file can drift. **`OrganizationMembership` does not exist yet** — it ships as part of
epic ENG-10816 (Team accounts and roles). If it hasn't landed yet, skip the membership
statements in Step 2 and know that the old owner has no soft-landing role: they
simply lose access to the campaign until the table (and the invite/member-management
endpoints on top of it) ship.

Owners never get a membership row. `UseOrganizationGuard` (and its campaign/elected-
office siblings) resolve ownership as `WHERE slug = X AND owner_id = userId` — a plain
column match, not a membership lookup — so the guard fallback covers the owner without
one. That is why the transaction in Step 2 deletes the new owner's row instead of
promoting it: once they're the owner, a leftover membership row is just dead data.

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

-- Today's owner and the campaign under this org.
SELECT o.slug AS organization_slug, o.owner_id AS current_owner_user_id,
       ou.email AS current_owner_email, ou.first_name, ou.last_name,
       c.id AS campaign_id, c.slug AS campaign_slug, c.user_id AS campaign_user_id
FROM organization o
JOIN "user" ou ON ou.id = o.owner_id
LEFT JOIN campaign c ON c.organization_slug = o.slug
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

One transaction over exactly three things: `Organization.ownerId`, `Campaign.userId`,
and the membership rows. All three or none — a partial write leaves a campaign whose
org owner and campaign user disagree, and every guard that resolves ownership
(`UseOrganizationGuard`, `UseCampaign`, `UseElectedOffice`, the CRM's
`UseEngagementContext`, `CanDownloadVoterFile`) reads that disagreement differently.
Never run these as separate statements outside a transaction.

```sql
\set org_slug 'example-org-slug'
\set old_owner_id 1001
\set new_owner_id 2002

BEGIN;

-- 1. Flip the org owner. Must affect exactly one row — 0 means old_owner_id is
-- stale (re-check Step 1); more than 1 is impossible given the PK on slug.
UPDATE organization
SET owner_id = :new_owner_id
WHERE slug = :'org_slug'
  AND owner_id = :old_owner_id;

-- 2. Flip the campaign user. Must also affect exactly one row.
UPDATE campaign
SET user_id = :new_owner_id
WHERE organization_slug = :'org_slug'
  AND user_id = :old_owner_id;

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

Read the row count psql prints after each `UPDATE` before you type `COMMIT`. Both
`UPDATE`s must say `UPDATE 1`. If either says `UPDATE 0`, stop and `ROLLBACK` — you
are looking at a stale `old_owner_id` or the wrong `org_slug`, not a transient error.
Don't loosen the `WHERE` clause to force a match.

If `OrganizationMembership` hasn't shipped yet (see Prerequisites), drop statements 3
and 4 entirely and only run the two `UPDATE`s. The old owner then has no fallback role
— they lose access to the campaign outright until team accounts ships.

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

**This only works if the new owner has never had a `customerId` of their own.** If
they previously ran their own paid campaign, `user.metaData.customerId` is already
set to a different (their own) Stripe customer, the `??` fallback never runs, and
Manage Subscription opens the wrong customer — one with no relationship to this
campaign's subscription. If that's the case here, don't paste the message above;
escalate to someone with direct Stripe access to move the payment method by hand.

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

-- 2. Campaign agrees with the org.
SELECT id, slug, user_id FROM campaign
WHERE organization_slug = :'org_slug' AND user_id = :new_owner_id;
-- expect 1 row, same campaign as before the transfer.

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
  `user.prisma` — source of truth for the field names this runbook depends on.
- `packages/gp-api/src/organizations/guards/UseOrganization.guard.ts` — the
  owner-fallback resolution the transaction in Step 2 has to keep consistent.
- `packages/gp-api/src/payments/purchase.controller.ts` — `createPortalSession` and
  `recoverCustomerIdFromSubscription`, referenced in Step 3.
- `.claude/skills/transfer-candidate-domain/SKILL.md` — the identity-verification
  precedent this runbook's Step 1 mirrors, for a different kind of transfer.
- ClickUp doc `2ky4jq2q-20493` (page `2ky4jq2q-104653`) — the "Team accounts and
  roles" TDD, which names manual admin recovery as the fallback this runbook fills in.
