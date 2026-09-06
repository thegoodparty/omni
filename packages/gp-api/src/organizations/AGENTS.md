# Organizations Module

`Organization` is the shared authorization root across Win (campaign) and
Serve (elected office) — every org-scoped route resolves via the
`X-Organization-Slug` header, never a campaign/electedOffice id directly.

This module is also the server home of **Team accounts** (feature brief
ClickUp 86ajk6225; TDD doc `2ky4jq2q-104653`, implementation notes
`2ky4jq2q-104673`): Phase 1 (ENG-10816) shipped owner + campaignAdmin,
Phase 1.5 (ENG-11044) the volunteer role and outreach assignments — both
behind the single `win-team-accounts` flag (no separate volunteer flag;
ramping it is a deliberate product act, never implied by a merge). Webapp
counterparts: `app/dashboard/team/` (team page — has its own `AGENTS.md`),
`app/team-invite/` (acceptance screen), `app/volunteer/` (the reductive
volunteer shell), `app/dashboard/outreach/` (assign UI).

## Roles and membership

`OrganizationRole` (Prisma enum): `owner | campaignAdmin | volunteer`. The
owner is `Organization.ownerId` — it never gets an `OrganizationMembership`
row, only a fallback. Everyone else's role lives in
`OrganizationMembership` (`@@unique([organizationSlug, userId])`).
`OrganizationMembershipService.resolveRole(slug, userId)` is the one place
that knows both shapes: owner match first, else a membership lookup.

Guards (in `guards/` + `decorators/`), chained in this order by
`@UseOrganization()`:

1. `UseOrganizationGuard` — reads the header, resolves a role via
   `resolveRole`, attaches `request.organization` / `request.organizationRole`
   for any resolved membership (owner, `campaignAdmin`, or `volunteer`), and
   404s only when no org/role resolves at all. It doesn't gate on role —
   that's the next guard's job.
2. `OrganizationRoleGuard` — reads `request.organizationRole` and enforces
   the team-role line: default posture is owner-or-campaignAdmin;
   `@OwnerOnly()` restricts to the owner; `@AllowVolunteer()` admits any
   resolved role, including volunteer.

`UseCampaignGuard` (chained by `@UseCampaign()`) follows the same division:
it resolves and attaches, `OrganizationRoleGuard` enforces. Two other
guards behind `X-Organization-Slug` — `UseEngagementContextGuard` (CRM) and
`CanDownloadVoterFileGuard` — keep their own permanent volunteer denial
instead of deferring to `OrganizationRoleGuard`; see their own comments.

`@ReqOrganization()` / `@ReqOrganizationRole()` inject what the guard
attached. Read `@UseOrganization()`'s JSDoc before changing the chain order —
`OrganizationRoleGuard` only means anything after the scoping guard runs.

**Role vocabulary is locked.** UI labels for the enum keys are `owner` →
"Owner", `campaignAdmin` → "Campaign Manager", `volunteer` → "Volunteer"
(the webapp's `app/dashboard/team/team.util.ts` `ROLE_LABELS` is the one
source). Never "Admin" (reserved for the internal super-admin
`UserRole.admin` — the collision confuses support conversations) and never
"Candidate" (the account creator isn't always the candidate); the
deprecated `UserRole.campaignManager` is never reused for any of this.
User-facing strings gp-api itself emits (the member-added email) follow the
same labels.

## Team endpoints (`team.controller.ts` + `services/organizationTeam.service.ts`)

Membership rows are created in exactly two places: the invite endpoint (for
an email with an existing account) and the accept endpoint (everyone else,
via a Clerk invitation). No other code path may create one.

| Method | Path                   | Auth                                  |
| ------ | ---------------------- | ------------------------------------- |
| GET    | `team`                 | `@UseOrganization()`                  |
| POST   | `team/invites`         | `@UseOrganization()` + flag gate      |
| DELETE | `team/invites/:id`     | `@UseOrganization()`                  |
| GET    | `team/invites/mine`    | session only, NOT org-scoped          |
| POST   | `team/invites/accept`  | session only, NOT org-scoped          |
| PATCH  | `team/members/:userId` | `@UseOrganization()` + `@OwnerOnly()` |
| DELETE | `team/members/:userId` | `@UseOrganization()` + `@OwnerOnly()` |

**Flag gate is scoped to one route.** `win-team-accounts` (via
`FeaturesService.isFeatureEnabled`) gates only `POST team/invites` — the
only route that can create a membership row for a brand-new team. Every
other route is left ungated on purpose: without any membership rows the
flag being off makes them inert, and gating `accept` would strand an
in-flight invitee if the flag ramps back down after an invite went out.

**Team accounts are Win-only in Phase 1.** Serve staff accounts are an
explicit non-goal — every elected-office surface stays owner-only via
`UseElectedOfficeGuard`. `createInvite` rejects an `eo-` organization slug
with a 400 before the flag check, since a membership row on an eo- org
would half-work (org-scoped routes would admit the member, but no Serve
surface actually checks for anything but ownership). This is the only
enforcement point because invite is the only route that can create a
membership row.

**Invite and revoke are manager+, not owner-only.** "A manager can invite
other managers" is a stated ENG-10816 goal, so neither `createInvite` nor
`revokeInvite` carries `@OwnerOnly()` — any resolved role (owner or
`campaignAdmin`) may invite or revoke a pending invite. Only member
management (`PATCH`/`DELETE team/members/:userId`) is owner-only.

**A volunteer invite's `outreachId` is optional (ENG-11058).** The team
page's Invite drawer sends a general volunteer invite with no `outreachId` —
legal since the ticket dropped the DTO refine that used to require one; the
invite still forbids one on a `campaignAdmin` invite. The outreach drawer's
per-list entry point (ENG-11049, ENG-11056) is a second, still-live way to
invite a volunteer, and _its_ invites still carry an `outreachId`; when
present, `inviteMember` validates it belongs to the inviting org via
`OutreachAssignmentService.assertOutreachInOrg` _before_ anything is written
or a Clerk invitation is sent. When an `outreachId` is present, the invite
and the eventual `OutreachAssignment` are created in the same act: the
direct-add branch creates the membership + assignment in one transaction;
the Clerk-invitation branch carries `outreachId` in `TeamInviteMetadata`
(optional — absent for both `campaignAdmin` and a general volunteer invite)
and `acceptInvite` creates the assignment inside the same transaction as the
membership, threading `tx` into `OutreachAssignmentService.assign`. A
general volunteer invite (no `outreachId`) skips this entirely — the
volunteer lands on `/volunteer`'s empty state until a manager assigns them
work. If a list-scoped outreach was deleted between invite and accept, the
membership still commits and the assignment is skipped (logged, not
thrown) — only a genuine unexpected error rolls the transaction back.
`AcceptInviteResponse.assignment` carries a lightweight pointer (outreach
id/type + channel pointer) when one was created, so the webapp can route the
volunteer straight to their work; null for a `campaignAdmin` accept, a
general volunteer accept, or a skipped assignment. `PendingInvite.outreachId`
exposes the same field on the pending-list response — the team page's own
table renders a general volunteer invite (`outreachId: null`) as a normal
pending invite with Revoke, and a list-scoped one (ENG-11056) with a
"Managed in outreach" label instead. `Team - Member Invited` fires
`listScoped: true` for a volunteer invite that carries an `outreachId`.
`PATCH team/members/:userId` also carries the same two-value role enum, so
the owner can move an existing member between `campaignAdmin` and
`volunteer` — a role change never creates or touches an
`OutreachAssignment`; volunteers get their list only through an invite (or
never, for a general one, until a manager assigns them one).

**An invite's optional `phone` only ever backfills a blank profile
(ENG-11058).** `InviteTeamMemberDto.phone` (validated via contracts'
`PhoneSchema`) rides in `TeamInviteMetadata` for the Clerk-invitation branch
and is written straight through for a direct-add — in both cases the
condition is `!User.phone` on the target account, checked immediately before
the write, so an invite can never clobber a number the person already saved
to their own profile. Accept writes it (alongside the existing name backfill)
inside the same transaction as the membership row.

**Invite branches on whether the email has a local account** (never a
Clerk-only check): a known email gets added directly + emailed
(`EmailService.sendTeamMemberAddedEmail`); an unknown email gets a Clerk
invitation (`ClerkInvitationsService.createTeamInvitation`) carrying
`TeamInviteMetadata` as `publicMetadata` — Clerk copies that onto the user
at sign-up, which is the entire persistence mechanism for a pending invite
(nothing is written to Postgres until accept). `GET team` merges Postgres
membership rows with `listPendingTeamInvitations(slug)`, which pages through
Clerk's _entire instance-wide_ pending-invitation list (it has no
server-side org filter) before filtering to this org — a single page would
silently drop this org's invites once the instance-wide pending count
exceeds the page size. Each page uses `CLERK_LIST_TIMEOUT_MS` (10s), not the
`SessionGuard`-tuned `CLERK_API_TIMEOUT_MS` (2s) — this loop is a heavy,
non-hot-path list op, and a page merely running slow under normal Clerk
latency shouldn't 502 the whole team read. A page that times out or hits a
Clerk 429 gets up to 2 retries (honoring `retryAfter` on a 429) before the
error propagates to `BadGatewayException`.

**Revoke clears the invitee's own metadata too, not just the invitation.**
An invitee who already signed up via the invite link carries the same
`publicMetadata` on their own Clerk user, and accept reads only that (never
the invitation object) — so revoking the invitation alone would leave a
signed-up-but-revoked invitee still able to accept. `revokeInvite` looks up
any Clerk user by the invitation's email and clears their invite metadata
too, best-effort (a failure there must not undo the revoke, which already
succeeded).

**Accept never trusts the request.** It reads `request.user` (never
`effectiveUser` — that resolves to an impersonating admin under
impersonation, the wrong Clerk record) and fetches that user's own Clerk
`publicMetadata` server-side. When that metadata is absent — an invitee who
signed up organically instead of through the ticket never receives Clerk's
copy (ENG-11027) — both accept and `GET team/invites/mine` fall back to the
pending invitation addressed to one of the user's Clerk-**verified** emails
(matches that all point to one org redeem; matches spanning several orgs
resolve to none). A
fallback-accept also revokes the invitation object after the DB commit,
best-effort, so it can't be re-consumed or linger as pending.
`@@unique([organizationSlug, userId])` makes a double-accept a Prisma unique-constraint conflict; that's caught and turned
into a 200 with the _persisted_ row, never the request body — response
source is always the DB, not request input. The Clerk metadata clear runs
_after_ the DB commit; a failed clear just means the next accept retries it.

**Owner has no membership row**, so `:userId === Organization.ownerId` is a
400 on both member-management routes (ownership transfer is out of scope).

**Removal deletes the member's outreach assignments in the same transaction**
(ENG-11048): assignments are access grants, not attribution — attribution
lives on the interaction rows' `actorUserId` — so a removed member keeps no
lingering access. `OrganizationTeamService.removeMember` resolves
`OutreachAssignmentService` lazily via `ModuleRef` rather than injecting it:
`OutreachModule` imports this module for `@UseOrganization()`, and its own
import graph closes a multi-module cycle a single `forwardRef` can't break
(same reasoning as `RaceOpponentService` in `campaignIdeology.service.ts`).

## The owner line and billing

`@OwnerOnly()` draws the explicit line at member management (role change,
removal). Subscription billing is owner-only by existing scoping rather
than by decorator: subscription checkout/portal are personally scoped
(`findActiveByUserId`, the user's own Stripe `customerId`), so a manager
can't touch the owner's plan — that line is pinned by regression tests
(ENG-10819), not a guard. One-time purchases (create-checkout-session,
complete-free-purchase — texts, polls) are deliberately manager-allowed:
the manager pays on their own card (decision 2026-07-28). Ownership
transfer is out of scope in-product; recovery is a manual admin runbook
(ENG-11026). Detail: `src/payments/AGENTS.md`.

## Volunteer surface map (Phase 1.5)

A volunteer's entire read surface is "assignments where assignee = me"
(`OutreachAssignment` — an ACCESS GRANT, never attribution; attribution is
the interaction rows' `actorUserId`). The `@AllowVolunteer()` allowlist is
fail-closed and opened route by route:

- `GET /outreach/assignments/mine` — the whole volunteer read surface
  (`src/outreach/AGENTS.md`, which also covers assignment mechanics:
  idempotent assign, assignee-must-already-be-a-member 422, the org
  invariant, removal cascade).
- The phone-banking caller (`PhoneBankingAccessService`) and the
  door-knocking walk (`utils/doorKnockingAccess.util.ts`) — a volunteer is
  admitted only when `OutreachAssignmentService.existsFor` finds an
  assignment on the target's outreach envelope; an unassigned volunteer
  gets **404, not 403** (don't leak existence — ENG-11050 precedent).
  Never the district voter pack, turf CRUD, or list deletion.
- Contact-notes CRUD — the one CRM carve-out (ENG-11057):
  `ContactNoteVolunteerAccessService` (`src/contactNote/services/`) scopes
  by `existsForPerson` (assigned to any outreach whose list/route reaches
  that person), same 404-not-403 posture.
- `GET /onboarding/contacts/stats` — only because that route is
  `@PublicAccess`; a volunteer sending the org header must not be 403'd on
  an endpoint anonymous callers can reach.

Everything else fails closed. The CRM (`UseEngagementContext`) and voter
file (`CanDownloadVoterFile`) deny volunteers permanently by design — the
PRD's data-protection guarantee is that volunteers log results but never
read or export the underlying voter file — and `UseElectedOffice` stays
owner-only (Serve staff is a named follow-on), all asserted by test.

## Analytics

Server events use the PRD vocabulary (`EVENTS.Team` in
`src/vendors/segment/segment.types.ts`): `Team - Member Invited` (`role`,
`invitedByRole`, `listScoped`), `Team - Invite Accepted`,
`Team - Role Changed` (`fromRole`, `toRole`), `Team - Member Removed`,
`Team - Outreach Assigned` / `Team - Outreach Assignment Removed`.
`Team - Campaign Switched` fires client-side in the webapp. Every event
additionally carries `actorUserId`/`actorRole`, enriched centrally by
`AnalyticsService` from request context (`src/analytics/`) — never add
per-event actor props.

## HubSpot contact sync (ENG-10826, ENG-11030)

Direct-add, accept, role-change, and removal each fire-and-forget a call
into `CrmTeamMembersService` (`src/crm/crmTeamMembers.service.ts`) after
the Postgres write — a HubSpot outage must never fail or slow the
response, so the call is `void`-invoked and its own errors are caught and
logged, never surfaced.

The role lives on the Contact-Company association as a user-defined
**label** (Candidate / Campaign Manager / Volunteer), not on an unlabeled
association — the relationship is many-to-many (one person can manage one
campaign and own another), and a label says which company a role applies
to. Label `associationTypeId`s are portal-specific (Ops creates them per
portal), so they're resolved at runtime by label **name** via
`AssociationLabelsService` (`src/crm/associationLabels.service.ts`, shared
with the campaign-sync path in `crmCampaigns.service.ts`), cached per
process. A label Ops hasn't created yet logs loudly and the labeled write
is skipped — HubSpot silently drops writes to an undefined association
type, so a silent miss would look like a success.

- **Direct-add / accept**: upserts a contact by email and associates it
  with the campaign's company under the role's label.
- **Role change**: passes `fromRole` through so the old label is archived
  (`batchApi.archiveLabels` — never `batchApi.archive`, which detaches the
  contact from every company association) before the new one is written.
- **Removal**: archives the labeled association for that campaign's
  company. The `team_role` contact property is cleared only when the user
  has no remaining `OrganizationMembership` row anywhere — a role on a
  different campaign must not be blanked by this org's removal.

The non-primary label association must never displace a team member's own
`primaryCompanyToContact` association from their own campaign (ENG-10826
regression, still covered).

`team_role` (values, not labels — `owner` / `campaign manager` /
`volunteer`) is still written alongside the label for CS, pending the data
team's Attribute Registry recording one owner between the property and the
label.

## Org listing gotcha

`GET /v1/organizations` is owned-or-member
(`OR: [{ ownerId }, { memberships: { some: { userId } } }]`) and threads the
viewer's own role onto each entry. This response schema (`APIOrganizationSchema`
in `organizations.controller.ts`) previously 500'd the _whole list_ on a
null external-sourced leaf under `@ResponseSchema` — keep new/changed leaves
nullable, and remember `@ResponseSchema` silently no-ops without the
per-controller `@UseInterceptors(ZodResponseInterceptor)`.
