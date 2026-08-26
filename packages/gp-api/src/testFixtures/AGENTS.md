# Test Fixtures Module

Test-only API for automated feature QA (the `/validate-feature` runbook) and
any script that needs a dev user in a known product state.

## Endpoints (all `AdminOrM2MGuard`, all 404 outside dev/preview)

| Route                                 | Purpose                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `POST /v1/test-fixtures/users`        | Mint a `@test.goodparty.org` user in a state: `free-win`, `pro-win`, `serve`, `serve-won-race` |
| `DELETE /v1/test-fixtures/users`      | On-demand cleanup (DB + Clerk); the 6-hourly `deleteTestUsers` cron is the safety net |
| `POST /v1/test-fixtures/users/:id/session` | Re-mint the 1h session token for runs longer than an hour          |

The create/session responses carry credentials by contract (password, session
token, a single-use Clerk `signInToken`, and a cookie triple) — **never log a
response object**. Response shapes live in `@goodparty_org/contracts`
(`testFixtures/`). Consumer login recipe: gp-webapp pages are gated by the
**Clerk session** (`clerkMiddleware` on `auth().userId`), so a browser must
redeem `signInToken` on a public page
(`window.Clerk.client.signIn.create({ strategy: 'ticket', ticket })` then
`setActive`), then set the `organization-slug` cookie to select the org. The
`sessionToken` / `token` cookie only authenticate direct gp-api calls — they
do NOT log a browser into the webapp.

## Gotchas

- The env gate is `IS_NON_PROD_DEPLOY` (fail-closed) and it 404s, not 403s.
  Local use requires `OTEL_SERVICE_ENVIRONMENT=dev`.
- Fixture creation composes existing services with every real-user side effect
  bypassed: no HubSpot (`createForUser` via `outerTx`, `launch`/`setIsPro`
  with tracking off), no emails, no Slack. If you add a state, keep it that way.
- Fixture users are swept by `UsersService.deleteTestUsers` after ~24h — QA
  runs should still delete their own users.
- `serve-won-race` sets `details.wonGeneral` + a **past** `electionDate` last,
  mirroring the user-facing election-result flow; reordering that risks the
  stale-election-result reset clearing the win.
