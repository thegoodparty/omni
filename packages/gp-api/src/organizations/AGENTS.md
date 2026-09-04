# Organizations Module

`Organization` is the shared authorization root across Win (campaign) and
Serve (elected office) — every org-scoped route resolves via the
`X-Organization-Slug` header, never a campaign/electedOffice id directly.

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
   `resolveRole`, attaches `request.organization` / `request.organizationRole`.
   Fails closed on a `volunteer` role today (Phase 1.5 opens specific
   surfaces deliberately) and 404s when no org/role resolves.
2. `OrganizationRoleGuard` — reads `request.organizationRole` and enforces
   the team-role line: default posture is owner-or-campaignAdmin;
   `@OwnerOnly()` restricts to the owner; `@AllowVolunteer()` admits any
   resolved role (currently unreachable — see above).

`@ReqOrganization()` / `@ReqOrganizationRole()` inject what the guard
attached. Read `@UseOrganization()`'s JSDoc before changing the chain order —
`OrganizationRoleGuard` only means anything after the scoping guard runs.

## Team endpoints (`team.controller.ts` + `services/organizationTeam.service.ts`)

Membership rows are created in exactly two places: the invite endpoint (for
an email with an existing account) and the accept endpoint (everyone else,
via a Clerk invitation). No other code path may create one.

| Method | Path                             | Auth                          |
| ------ | -------------------------------- | ------------------------------ |
| GET    | `team`                           | `@UseOrganization()`            |
| POST   | `team/invites`                   | `@UseOrganization()` + flag gate |
| DELETE | `team/invites/:id`                | `@UseOrganization()`            |
| GET    | `team/invites/mine`               | session only, NOT org-scoped   |
| POST   | `team/invites/accept`             | session only, NOT org-scoped   |
| PATCH  | `team/members/:userId`            | `@UseOrganization()` + `@OwnerOnly()` |
| DELETE | `team/members/:userId`            | `@UseOrganization()` + `@OwnerOnly()` |

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

**Invite branches on whether the email has a local account** (never a
Clerk-only check): a known email gets added directly + emailed
(`EmailService.sendTeamMemberAddedEmail`); an unknown email gets a Clerk
invitation (`ClerkInvitationsService.createTeamInvitation`) carrying
`TeamInviteMetadata` as `publicMetadata` — Clerk copies that onto the user
at sign-up, which is the entire persistence mechanism for a pending invite
(nothing is written to Postgres until accept). `GET team` merges Postgres
membership rows with `listPendingTeamInvitations(slug)`, which pages through
Clerk's *entire instance-wide* pending-invitation list (it has no
server-side org filter) before filtering to this org — a single page would
silently drop this org's invites once the instance-wide pending count
exceeds the page size.

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
(exactly one match redeems; zero or several resolve to none). A
fallback-accept also revokes the invitation object after the DB commit,
best-effort, so it can't be re-consumed or linger as pending.
`@@unique([organizationSlug, userId])` makes a double-accept a Prisma unique-constraint conflict; that's caught and turned
into a 200 with the *persisted* row, never the request body — response
source is always the DB, not request input. The Clerk metadata clear runs
*after* the DB commit; a failed clear just means the next accept retries it.

**Owner has no membership row**, so `:userId === Organization.ownerId` is a
400 on both member-management routes (ownership transfer is out of scope).

## HubSpot contact sync (ENG-10826)

Direct-add, accept, and role-change each fire-and-forget
`CrmTeamMembersService.syncTeamMember` (`src/crm/crmTeamMembers.service.ts`)
after the Postgres write — a HubSpot outage must never fail or slow the
response, so the call is `void`-invoked and its own errors are caught and
logged, never surfaced. It upserts a contact by email, sets the `team_role`
property (values, not labels — `owner` / `campaign manager` / `volunteer`),
and associates it with the campaign's company using the non-primary
`companyToContact` association (280), not `primaryCompanyToContact` — a
team member can already have their own primary company from their own
campaign, and this association must not displace it. `team_role` must be
defined as a contact property in the HubSpot portal (21589597) first;
HubSpot silently drops writes to an undefined property. Member removal does
not touch HubSpot — the contact and its `team_role` value are left as-is.

## Org listing gotcha

`GET /v1/organizations` is owned-or-member
(`OR: [{ ownerId }, { memberships: { some: { userId } } }]`) and threads the
viewer's own role onto each entry. This response schema (`APIOrganizationSchema`
in `organizations.controller.ts`) previously 500'd the *whole list* on a
null external-sourced leaf under `@ResponseSchema` — keep new/changed leaves
nullable, and remember `@ResponseSchema` silently no-ops without the
per-controller `@UseInterceptors(ZodResponseInterceptor)`.
