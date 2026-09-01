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
| `util/effectiveUser.util.ts`             | Resolves the "acting as" user when admins impersonate                                           |

## Patterns

- **Global guards run in order**: `SessionGuard` → `RolesGuard` (`SessionGuard` wired as `APP_GUARD` in `app.module.ts`, `RolesGuard` in `authentication.module.ts`). M2M `mt_*` tokens are verified inside `SessionGuard`. New guards belong route-level, not global, unless they're truly cross-cutting.
- **`@PublicAccess()` is the only escape hatch.** Don't conditionally skip auth inside a guard — opt out at the route level.
- **Absence of `@Roles()` = "any authenticated user".** `routeIsPublicAndNoRoles.util.ts` is what makes that work; don't rely on the decorator being present to imply auth.
- Password resets issue a **short-lived JWT**, not a DB-stored token. Side effects after consumption must be done in the same request.

## Gotchas

- `AUTH_SECRET` must be set at boot — module throws otherwise. No fallback path.
- ADR for the M2M flow is `docs/adr/0004-clerk-m2m-auth.md` — read before adding new M2M-callable endpoints.
- `effectiveUser.util.ts` returns the **impersonated** user, not the admin doing the impersonation. Audit logging needs both — pull the real admin from the request, not from `effectiveUser`.
- `AdminAudit.interceptor.ts` only fires when explicitly applied — it is **not** global. Routes that mutate user data should opt in.
- The `services/` directory exists but is empty. Don't be surprised; the only service lives at the module root for historical reasons.
- **`SessionGuard` makes live Clerk calls on every authenticated request** — session-token verification, then `resolveUser`, which fetches Clerk profile fields in parallel with the DB lookup. They are capped at `CLERK_API_TIMEOUT_MS` (default 2s, see `vendors/clerk/clerk.consts.ts`) because an uncapped Clerk stall is an uncapped stall on every route. Consequences to know: a timed-out enrichment degrades to DB fields with a null avatar, and a timed-out M2M or session verification is a 401, not a hang. Every Clerk call on this path goes through `clerkCall()`, which also emits the span — the SDK uses undici, which our OTel setup does not instrument, so a call made without that wrapper is invisible in Tempo.
