# app/dashboard/team/

The Team accounts surface (feature brief ClickUp 86ajk6225; TDD doc
`2ky4jq2q-104653`, implementation notes `2ky4jq2q-104673`): one campaign,
three roles. Roles and membership live in gp-api Postgres
(`OrganizationMembership` is the single source of truth); Clerk carries
identity and invitation delivery only and is never in the authorization
path. This folder is the owner/manager-facing team page. The server half —
endpoints, guards, invite/accept mechanics, HubSpot sync — is documented in
`packages/gp-api/src/organizations/AGENTS.md`; read it before changing
anything that calls `/v1/organizations/team*`.

Shipped in phases: Phase 1 = owner + Campaign Manager (ENG-10816),
Phase 1.5 = volunteer role + outreach assignments (ENG-11044), plus
design-alignment waves against the Lovable prototype (ENG-11060,
ENG-11057/58/59/67). Phase 2 (multi-campaign roll-ups) is future work.

## Role vocabulary (locked)

UI labels are **Owner / Campaign Manager / Volunteer**, read from
`team.util.ts`'s `ROLE_LABELS` — never restated as literals. Never "Admin"
(collides with the internal super-admin role in support conversations) and
never "Candidate" (the account creator isn't always the candidate). The
Lovable prototype (joy-navigate-palette.lovable.app) still uses the OLD
names ("Candidate" / "Campaign Admin") — follow its flows and layout, never
its labels. `ROLE_DESCRIPTIONS` is likewise locked copy shared verbatim by
the invite drawer's role cards and the "How roles work" card, so the two
can't drift.

## Flag

Everything rides `win-team-accounts` (`TEAM_ACCOUNTS_FLAG_KEY` in
`@shared/experiments/teamAccountsFlag.ts`) — one flag for phases 1 and 1.5,
no separate volunteer flag. `page.tsx` wraps the page in `FeatureFlagGuard`;
the nav item reads the same hook with `trackExposure: false` (the page is
the experiment's treatment surface; nav reads aren't). Server-side, gp-api
flag-gates only `POST team/invites` — with no membership rows every other
surface is inert, which is what lets all of this merge to `main` dark.

## Key files

| File                                | Role                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page.tsx`                          | RSC wrapper: auth redirect + flag guard. The URL is deliberately `/dashboard/team`, not the design's `/settings/team` — this app has no `/settings` segment; it's the sibling of `/dashboard/account` |
| `components/TeamPage.tsx`           | The page: "How roles work" card, People table, Pending invites table, and the revoke/remove/role-change mutations                                                                                     |
| `components/InviteMemberDrawer.tsx` | The team page's Invite: a two-step bottom drawer (ENG-11058/ENG-11067) — step 1 name/phone/email, step 2 role cards                                                                                   |
| `components/InviteMemberDialog.tsx` | The single-step dialog kept for the outreach drawer's list-scoped entry point — it knows `role`/`outreachId` up front, so it has no step to pick either                                               |
| `team.util.ts`                      | `ROLE_LABELS`, `ROLE_DESCRIPTIONS`, `teamQueryKey`, `formatName`, `toInviteErrorMessage` — shared with the outreach assignees section so the vocabulary and cache key can't drift                     |

## Patterns and gotchas

- **Nav placement (ENG-11061):** Team lives in the account menu
  (`accountManagementMenuItems.team`, id `nav-dash-team` in
  `DashboardMenu.tsx`), not the primary left rail.
- **Win-only:** an elected-office org (`organization.electedOfficeId`)
  never sees the nav item AND a direct visit degrades to "Team accounts
  aren't available for elected offices yet" without fetching — both checks
  are deliberate (a Serve membership row would half-work; see the gp-api
  doc).
- **One query, shared key:** `GET /v1/organizations/team` under
  `teamQueryKey(orgSlug)`. The outreach assign modal reads the same key, so
  invalidations propagate across both surfaces.
- **`isPending`, never `isLoading`:** React Query v5's `isLoading` is false
  while a query is _disabled_ (orgSlug unresolved), which rendered the page
  loaded-and-empty for that window (ENG-11039). And never derive UI (the
  people count, "No pending invites") from the `?? []` fallback on error —
  error states render their own copy.
- **Shared-mutation per-row state:** each table mutation is one shared
  `useMutation`, and its `variables` reflect only the LAST `mutate()` call —
  good enough to disable the acting row, insufficient for real concurrency.
  Where overlapping calls matter (the assign modal), the pattern is a
  locally tracked in-flight `Set` + `mutateAsync` in try/finally — see
  `app/dashboard/outreach/v2/OutreachAssigneesSection.tsx`.
- **Owner-only management:** the Manage kebab renders only for the owner
  and never on the owner row (the API 400s owner-targeted management
  anyway). A role change is a plain PATCH — it never creates or removes an
  outreach assignment.
- **Invite is manager+, on purpose:** the Invite button is not owner-gated —
  "a manager can invite other managers" is a stated ENG-10816 goal, and the
  server route carries no `@OwnerOnly()`. Revoke is manager+ for the same
  reason.
- **Pending invites split by scope:** a general invite row gets Revoke; a
  list-scoped volunteer invite (`outreachId != null`) renders a
  "List-scoped" qualifier and "Managed in outreach" INSTEAD of Revoke — its
  cancel lives with the outreach that scopes it, in the drawer's assignees
  section.
- **Invite errors:** `toInviteErrorMessage` surfaces gp-api's own 409/400
  copy; nestjs-zod v5 400s carry the static "Validation failed" sentinel
  with the actionable text in `errors[].message`. A 400 in the drawer
  navigates back to step 1 (where the fields are), and dismissal
  (Escape/outside click) is blocked while the invite is in flight.
- **Drawer layout is design-locked (ENG-11067):** step 2's role cards sit
  side by side (icon chip on top, name, description), Back is a header pill
  on step 2 only, and the footer carries a single full-width CTA. Design
  review screenshot-diffs this drawer against the prototype — match the
  layout, not just the copy and flow.
- **Volunteer invites from here are general** (no `outreachId`): the
  invitee lands on `/volunteer`'s empty state until a manager assigns work
  from an outreach's assignees section. The invite's optional phone only
  ever backfills a blank profile, enforced server-side.

## Related surfaces

- `app/team-invite/page.tsx` — the acceptance screen: Clerk
  sign-up/sign-in ticket redemption, org-cookie handoff, then
  `POST /v1/organizations/team/invites/accept`. Nothing client-side is
  trusted — gp-api re-reads the invite from Clerk server-side. An email
  that already has an account must redeem via sign-in
  (`form_identifier_exists`).
- `app/volunteer/` — the reductive volunteer shell (sidebar, assignments
  page, caller/walk route wrappers). It's a distinct purpose-built surface,
  not a stripped dashboard; `candidateAccess()` bounces a volunteer's
  active org off `/dashboard` to `/volunteer` (print/PDF download routes
  exempt). Post-auth routing keys on the server-verifiable org role, never
  a client flag read — the first authed Amplitude read can succeed with the
  wrong value (ENG-11073).
- `app/dashboard/outreach/` (its `AGENTS.md`) — the assignees section, the
  searchable assign modal, and the list-scoped volunteer-invite entry
  point.
- E2E: `e2e-tests/tests/app/dashboard/team/` (`team-page.spec.ts`,
  `team-invite-ticket.spec.ts`). The invite drawer's accessible name is its
  step-1 title ("Who do you want to invite?"); org-picker specs scope
  name-matching to `data-testid="org-picker-item-name"`.
