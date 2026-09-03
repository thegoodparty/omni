# Authentication Module

JWT + Clerk M2M auth, role enforcement, and user-facing auth flows (set/reset password). The actual directory name is `src/authentication/` (not `src/auth/`).

Auth state is enforced globally via three guards registered in order. Most routes are protected by default; opt-out is explicit via `@PublicAccess()`.

## Key files

| Path                                     | Purpose                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `authentication.module.ts`               | Registers global guards as `APP_GUARD`, requires `AUTH_SECRET` at boot                          |
| `authentication.controller.ts`           | `POST /authentication/set-password-email`, `/reset-password`, `/recover-password`               |
| `authentication.service.ts`              | JWT sign/verify, password reset token issuance, bcrypt compare                                  |
| `authentication.consts.ts`               | `M2M_TOKEN_PREFIX = 'mt_'`                                                                      |
| `decorators/PublicAccess.decorator.ts`   | Skip auth on a controller or route                                                              |
| `decorators/Roles.decorator.ts`          | `@Roles(UserRole.ADMIN, ...)` — role gate via `RolesGuard`                                      |
| `decorators/ReqUser.decorator.ts`        | Inject the authed `User`                                                                        |
| `guards/Session.guard.ts`                | `SessionGuard` — accepts user JWTs from cookies; also verifies Clerk M2M `mt_*` tokens (global) |
| `guards/Roles.guard.ts`                  | `RolesGuard` — reads `@Roles()` metadata and enforces                                           |
| `guards/AdminOrM2M.guard.ts`             | Route-level: admin user OR M2M token                                                            |
| `guards/M2MOnly.guard.ts`                | Route-level: M2M only                                                                           |
| `interceptors/AdminAudit.interceptor.ts` | Logs admin actions for the audit trail                                                          |
| `util/setTokenCookie.util.ts`            | Cookie writer used after login/refresh                                                          |
| `util/effectiveUser.util.ts`             | Resolves the acting human (the admin, when impersonating) for global-role checks                |

## Patterns

- **Global guards run in order**: `SessionGuard` → `RolesGuard` (`SessionGuard` wired as `APP_GUARD` in `app.module.ts`, `RolesGuard` in `authentication.module.ts`). M2M `mt_*` tokens are verified inside `SessionGuard`. New guards belong route-level, not global, unless they're truly cross-cutting.
- **`@PublicAccess()` is the only escape hatch.** Don't conditionally skip auth inside a guard — opt out at the route level.
- **Absence of `@Roles()` = "any authenticated user".** `routeIsPublicAndNoRoles.util.ts` is what makes that work; don't rely on the decorator being present to imply auth.
- Password resets issue a **short-lived JWT**, not a DB-stored token. Side effects after consumption must be done in the same request.
- **Org-scoping guards resolve `request.user.id`, never `effectiveUser`.** Four
  of the five guards behind `X-Organization-Slug` — `UseOrganization`,
  `UseCampaign`, `UseEngagementContext`, `CanDownloadVoterFile` — resolve a
  role for the org through `OrganizationMembershipService.resolveRole`:
  owner fallback (`organization.ownerId === user.id`) first, else an
  `OrganizationMembership` row, else 404/deny with no org-existence leak.
  Every one of them denies a `volunteer` role (fail-closed; Phase 1.5 opens
  specific surfaces deliberately via a later guard, not by loosening these).
  `UseElectedOffice` is untouched — it still does the old ownerId-only
  lookup and never calls `resolveRole`, so Serve stays owner-only regardless
  of any membership row. Switching resolution to `effectiveUser` would
  authorize the impersonating admin instead of the impersonated subject,
  404ing every org-scoped route for admins mid-impersonation — `RolesGuard`/
  `AdminOrM2MGuard` use `effectiveUser` deliberately because they check the
  acting human's *global* roles, a different question from org membership.
- **The team-role line is `OrganizationRoleGuard`
  (`src/organizations/guards/OrganizationRole.guard.ts`)**, appended to
  `UseOrganization`'s and `UseCampaign`'s own `UseGuards(...)` list so it
  always runs after the scoping guard has attached
  `request.organizationRole`. Default (no decorator): owner or
  `campaignAdmin`. `@OwnerOnly()` narrows to owner. `@AllowVolunteer()`
  admits any resolved member — currently unreachable in practice, since the
  scoping guards above still fail closed on a volunteer membership before
  this guard ever runs; Phase 1.5 opens specific surfaces by loosening those.
  Deny is `ForbiddenException` (403), not 404 — the caller already proved
  membership, so org existence isn't a secret from them. When
  `request.organizationRole` is unset (no scoping guard ran, or it ran with
  `continueIfNotFound` and found nothing), this guard passes through.

## Gotchas

- `AUTH_SECRET` must be set at boot — module throws otherwise. No fallback path.
- ADR for the M2M flow is `docs/adr/0004-clerk-m2m-auth.md` — read before adding new M2M-callable endpoints.
- `effectiveUser.util.ts` returns `req.actorUser ?? req.user` — **the admin**
  when an actor claim is present, not the impersonated user. Audit logging
  needs both — pull the real admin from `effectiveUser`, the impersonated
  subject from `req.user`.
- `AdminAudit.interceptor.ts` only fires when explicitly applied — it is **not** global. Routes that mutate user data should opt in.
- The `services/` directory exists but is empty. Don't be surprised; the only service lives at the module root for historical reasons.
- **`SessionGuard` calls Clerk only to verify the session token.** Identity
  fields (email, name, avatar) come from Postgres, which is authoritative;
  there is no per-request Clerk profile fetch. `verifyToken` and `m2m.verify`
  are capped at `CLERK_API_TIMEOUT_MS` (default 2s, see
  `vendors/clerk/clerk.consts.ts`) and wrapped in `clerkCall()`, which also
  emits the span — the SDK uses undici, which our OTel setup does not
  instrument, so a call made without that wrapper is invisible in Tempo.
