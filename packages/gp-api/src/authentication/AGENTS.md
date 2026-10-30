# Authentication Module

JWT + Clerk M2M + Vercel and GitHub Actions OIDC auth, role enforcement, and user-facing auth flows (set/reset password). The actual directory name is `src/authentication/` (not `src/auth/`).

Auth state is enforced globally via three guards registered in order. Most routes are protected by default; opt-out is explicit via `@PublicAccess()`.

## Key files

| Path                                     | Purpose                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `authentication.module.ts`               | Registers global guards as `APP_GUARD`, requires `AUTH_SECRET` at boot                   |
| `authentication.controller.ts`           | `POST /authentication/set-password-email`, `/reset-password`, `/recover-password`        |
| `authentication.service.ts`              | JWT sign/verify, password reset token issuance, bcrypt compare                           |
| `authentication.consts.ts`               | `M2M_TOKEN_PREFIX = 'mt_'`                                                               |
| `decorators/PublicAccess.decorator.ts`   | Skip auth on a controller or route                                                       |
| `decorators/Roles.decorator.ts`          | `@Roles(UserRole.ADMIN, ...)` — role gate via `RolesGuard`                               |
| `decorators/ReqUser.decorator.ts`        | Inject the authed `User`                                                                 |
| `guards/Session.guard.ts`                | `SessionGuard` — accepts user JWTs from cookies; also verifies Clerk M2M tokens (global) |
| `guards/Roles.guard.ts`                  | `RolesGuard` — reads `@Roles()` metadata and enforces                                    |
| `guards/AdminOrM2M.guard.ts`             | Route-level: admin user OR M2M token                                                     |
| `guards/M2MOnly.guard.ts`                | Route-level: M2M only                                                                    |
| `guards/ServiceRead.guard.ts`            | Route-level: service reader (M2M JWT, Vercel or GitHub OIDC), `mt_*` M2M, or admin       |
| `vercelOidc.service.ts`                  | Verifies a Vercel deployment's OIDC token against the project allowlist                  |
| `githubOidc.service.ts`                  | Verifies a GitHub Actions workflow's OIDC token against the workflow allowlist           |
| `guards/ServiceReadOrOwner.guard.ts`     | `ServiceReadGuard` plus the user whose `personId` matches the `personId` query param     |
| `interceptors/AdminAudit.interceptor.ts` | Logs admin actions for the audit trail                                                   |
| `util/setTokenCookie.util.ts`            | Cookie writer used after login/refresh                                                   |
| `util/effectiveUser.util.ts`             | Resolves the acting human (the admin, when impersonating) for global-role checks         |

## Patterns

- **Global guards run in order**: `SessionGuard` → `RolesGuard` (`SessionGuard` wired as `APP_GUARD` in `app.module.ts`, `RolesGuard` in `authentication.module.ts`). M2M `mt_*` tokens are verified inside `SessionGuard`. New guards belong route-level, not global, unless they're truly cross-cutting.
- **Clerk M2M has two tiers.** An opaque `mt_*` token is verified by Clerk
  against `GP_API_MACHINE_SECRET`, which enforces machine scope, and sets
  `request.m2mToken` — full M2M, trusted by `AdminOrM2MGuard`, `M2MOnly` and
  `UserOrM2M`. A JWT-format M2M token (`sub` starts with `mch_`) is verified
  only against the instance JWKS; Clerk checks neither its scopes nor our
  secret, so any machine in the instance can mint one. It sets
  `request.serviceReader`, never `m2mToken`, and passes `SessionGuard` only on
  `@PublicAccess()` routes (401 elsewhere). Gate a read for it with
  `ServiceReadGuard`. Use `ServiceReadOrOwnerGuard` only where the
  `personId` query param names the one record returned; on a list route it
  would let any user with a `personId` self-authorize. gp-marketing reads the
  public person-profile and public-campaign endpoints as a service reader
  (Vercel OIDC, Clerk JWT fallback), and candidate-sites reads
  `GET /websites/:vanityPath/view` and `GET /websites/by-domain/:domain` with
  its Vercel OIDC token.
- **`@PublicAccess()` is the only escape hatch.** Don't conditionally skip auth inside a guard — opt out at the route level.
- **A Vercel OIDC token is the other service reader.** gp-marketing and
  candidate-sites run on Vercel, which signs each deployment a short-lived
  RS256 token naming its project and environment, so they need no stored
  secret. `SessionGuard` recognizes one by its unverified `iss`
  (`https://oidc.vercel.com...`) before any Clerk path, and
  `VercelOidcService` verifies it against Vercel's JWKS: issuer
  `https://oidc.vercel.com/good-party` (team mode) or
  `https://oidc.vercel.com` (global mode), audience
  `https://vercel.com/good-party`. Its `project_id:environment` must be in
  `VERCEL_OIDC_ALLOWED_PROJECTS` (set per env in `deploy/index.ts`; empty
  turns the path off). A verified token sets `serviceReader` with
  `source: 'vercel-oidc'`, never `m2mToken`, and passes only on
  `@PublicAccess()` routes, exactly like a JWT-format M2M token. A bad or
  unlisted token, or an unreachable JWKS, leaves no `serviceReader` and logs
  one warn. The `user` field of the request log reads
  `vercel:<project>:<environment>`. Clerk JWTs stay accepted while callers
  migrate (`docs/adr/2026-10-29-machine-callers-authenticate-with-platform-oidc.md`).
- **A GitHub Actions OIDC token is the third service reader.** gp-marketing's
  `generate-people-sitemaps` workflow requests one with audience `gp-api`, so
  it needs no stored secret. `SessionGuard` recognizes it by its unverified
  `iss` (`https://token.actions.githubusercontent.com`), right after the
  Vercel check, and `GithubOidcService` verifies it against GitHub's JWKS
  (RS256, audience `gp-api`). Its `repository` and `repository_id` must match
  a pair pinned in `GITHUB_REPOSITORY_IDS` in the service (ids survive
  renames; a freed name can be re-registered), and its `job_workflow_ref`
  must match an entry of `GITHUB_OIDC_ALLOWED_WORKFLOWS`
  (`<owner>/<repo>/<path>@<ref>`, comma-separated; `<ref>` may be `*`; set
  per env in `deploy/index.ts`; empty turns the path off). Prod allows only
  `@refs/heads/develop`, gp-marketing's default branch; dev and preview allow
  `@*` so a PR's workflow can run against dev. A verified token sets
  `serviceReader` with `source: 'github-oidc'`, never `m2mToken`, and behaves
  like the Vercel path otherwise, including the one warn on a bad token. The
  request log `user` reads `github:<repo>:<workflow file basename>`.
- **Absence of `@Roles()` = "any authenticated user".** `routeIsPublicAndNoRoles.util.ts` is what makes that work; don't rely on the decorator being present to imply auth.
- Password resets issue a **short-lived JWT**, not a DB-stored token. Side effects after consumption must be done in the same request.
- **Org-scoping guards resolve `request.user.id`, never `effectiveUser`.** Four
  of the five guards behind `X-Organization-Slug` — `UseOrganization`,
  `UseCampaign`, `UseEngagementContext`, `CanDownloadVoterFile` — resolve a
  role for the org through `OrganizationMembershipService.resolveRole`:
  owner fallback (`organization.ownerId === user.id`) first, else an
  `OrganizationMembership` row, else 404/deny with no org-existence leak.
  `UseOrganization` and `UseCampaign` attach any resolved role, including
  `volunteer`, and leave the team-role decision to `OrganizationRoleGuard`;
  `UseEngagementContext` and `CanDownloadVoterFile` still deny a `volunteer`
  themselves, permanently (CRM and voter-file download are not part of the
  team-role rollout). `UseElectedOffice` is untouched — it still does the
  old ownerId-only lookup and never calls `resolveRole`, so Serve stays
  owner-only regardless of any membership row. Switching resolution to
  `effectiveUser` would authorize the impersonating admin instead of the
  impersonated subject, 404ing every org-scoped route for admins
  mid-impersonation — `RolesGuard`/`AdminOrM2MGuard` use `effectiveUser`
  deliberately because they check the acting human's _global_ roles, a
  different question from org membership.
- **The team-role line is `OrganizationRoleGuard`
  (`src/organizations/guards/OrganizationRole.guard.ts`)**, appended to
  `UseOrganization`'s and `UseCampaign`'s own `UseGuards(...)` list so it
  always runs after the scoping guard has attached
  `request.organizationRole`. Default (no decorator): owner or
  `campaignAdmin`. `@OwnerOnly()` narrows to owner. `@AllowVolunteer()`
  admits any resolved member, including volunteer — reachable end-to-end on
  any route that carries it, now that the scoping guards above attach a
  volunteer's role instead of failing closed on it. Deny is
  `ForbiddenException` (403), not 404 — the caller already proved
  membership, so org existence isn't a secret from them. When
  `request.organizationRole` is unset (no scoping guard ran, or it ran with
  `continueIfNotFound` and found nothing), this guard passes through.

## Gotchas

- `AUTH_SECRET` must be set at boot — module throws otherwise. No fallback path.
- **`SessionGuard` never verifies the `Authorization` header under
  `/v1/vendor-mocks/`.** Those routes receive a real vendor client's own
  credential (CallHub sends `Token <key>`), and `verifySessionToken` throws
  on it before `@PublicAccess()` is consulted, so every mocked call 401'd on
  previews. The guard goes straight to the public-and-no-roles check there,
  so a vendor-mock route without `@PublicAccess()` is still rejected.
- `effectiveUser.util.ts` returns `req.actorUser ?? req.user` — **the admin**
  when an actor claim is present, not the impersonated user. Audit logging
  needs both — pull the real admin from `effectiveUser`, the impersonated
  subject from `req.user`.
- `AdminAudit.interceptor.ts` is registered **globally** as an `APP_INTERCEPTOR` in `app.module.ts` and fires on every route whose `@Roles()` includes `admin` or whose `@UseGuards()` names `AdminOrM2MGuard` or `M2MOnly` — no opt-in needed. It writes one `Admin route accessed` log line (that log is the audit store; there is no table) with the endpoint, method, IP, user agent and body, plus `authSource`:
  - `session`: `userId`/`userEmail` from `effectiveUser` (the accountable admin), adding `impersonatedUserId`/`impersonatedUserEmail` only while impersonating, and `unresolvedActorSub` when an `act` claim did not resolve to a local user.
  - `m2m`: `machineId` is the verified token's Clerk `subject` (the `mch_` machine). `suppliedActorEmail` is the `actorEmail` the caller put in the body or query string (gp-admin names the staff member that way); nothing verifies it, and it is `null` when none was sent.

  It logs before pipes and the handler run, so a request that then fails validation is still recorded. A couple of controllers also list it in `@UseInterceptors()`; that is redundant, not load-bearing.

- The `services/` directory exists but is empty. Don't be surprised; the only service lives at the module root for historical reasons.
- **The sign-up phone arrives in Clerk `unsafeMetadata`, not as a Clerk
  phone attribute.** Enabling the real attribute would force SMS
  verification on every signup, so the email/password form writes
  `unsafeMetadata.phone` and `ClerkAuthService.getUser` reads it back
  (preferring `primaryPhoneNumber` if the instance ever starts issuing
  one). `findOrProvisionByClerk` copies it onto `User.phone` at provision
  time and backfills it onto a row that has none; from there the existing
  HubSpot sync (`users/services/crmUsers.service.ts`) carries it. Blank-only
  backfill — a number the user edited in their profile always wins.
- **Google signups take a different route to the same field.** OAuth can't
  carry a phone, so the webapp's `/sign-up/phone` step collects it after the
  handshake and `PUT`s it to `/v1/users/me` directly. Clerk sends a completed
  OAuth sign-up straight to the `redirectUrlComplete` the form passed and
  skips the SSO callback page, so the sign-up form and `/login` both name the
  phone step there, not only on the callback's redirect props. The step does
  not rely on the provisioning read above, because `SessionGuard.resolveUser` returns
  early on a `clerkId` hit and never re-reads the Clerk profile once the row
  exists. Both paths land the number before `POST /v1/users/me/crm-registration`
  fires, which is what puts it on the HubSpot contact.
- **`SessionGuard` calls Clerk only to verify the session token.** Identity
  fields (email, name, avatar) come from Postgres, which is authoritative;
  there is no per-request Clerk profile fetch. `verifyToken` and `m2m.verify`
  are capped at `CLERK_API_TIMEOUT_MS` (default 2s, see
  `vendors/clerk/clerk.consts.ts`) and wrapped in `clerkCall()`, which also
  emits the span — the SDK uses undici, which our OTel setup does not
  instrument, so a call made without that wrapper is invisible in Tempo.
  Session tokens and M2M JWTs verify locally against `CLERK_JWT_KEY`, the
  instance's PEM public key, set per environment in `deploy/index.ts`; opaque
  `mt_` M2M tokens still call Clerk. A JWT M2M token verified locally (key
  set) skips the `CLERK_API_TIMEOUT_MS` race (`clerkCall(..., null)`), since
  the timer there only fires when the event loop was frozen; `mt_` tokens
  keep it. Without the key the SDK refetches
  Clerk's JWKS every 5 minutes on the request path, and a fetch slower than
  2s rejects the request (about 0.06% of gp-marketing's M2M calls on
  2026-10-19).
- **gp-api owns the user's first and last name; Clerk holds a copy.** The
  name enters through Clerk at sign-up and `findOrProvisionByClerk` copies it
  once. After that the only writers are `PUT /v1/users/me` (the webapp's
  Account Settings "Edit details" modal) and `PUT /v1/users/:id` (gp-admin),
  both through `UsersService.updateUser`, which rebuilds `User.name` and pushes
  the new first/last name to Clerk. A failed Clerk push is logged, not
  thrown. The webapp hides Clerk's own name section
  (`profileSection__profile`) wherever it opens Clerk's profile modal, so
  there is no Clerk-side writer to drift from. The data pipeline builds the
  public `/people/<slug>` from this name too.
- **Clerk owns the user's email; users cannot write it in gp-api.**
  `User.email` gates staff and test-user affordances (`isInternalUser`,
  `isTestUser`, the `@goodparty.org` checks), so a user must never be able to
  write it. `PUT /v1/users/me` strips `email` from the body. A user changes
  their email in Clerk's profile modal ("Manage sign-in"), which verifies the
  address; the webapp's `UserProvider` then sees Clerk's verified primary
  differ from `User.email` and calls `POST /v1/users/me/sync-email`, which
  re-reads the Clerk user server-side and copies the verified address (409 if
  another row holds it). Provisioning still copies Clerk's primary as is:
  prod Clerk verifies email at sign-up, dev Clerk does not (so e2e sign-ups
  skip the code), and requiring a verified address there would stop dev
  sign-ups from provisioning. `PUT /v1/users/:id` (M2M, gp-admin) can still
  write it.
