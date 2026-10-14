# Test Fixtures Module

Test-only API for automated feature QA (the `/validate-feature` runbook) and
any script that needs a dev user in a known product state.

## Endpoints (all `AdminOrM2MGuard`, all 404 outside dev/preview)

| Route                                                 | Purpose                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /v1/test-fixtures/users`                        | Mint a `qa-<uuid>@goodparty.org` user in a state: `free-win`, `pro-win`, `serve`, `serve-won-race` |
| `DELETE /v1/test-fixtures/users`                      | On-demand cleanup (DB + Clerk); the hourly `sweepTestUsers` cron is the safety net                 |
| `POST /v1/test-fixtures/users/:id/session`            | Re-mint the 1h session token for runs longer than an hour                                          |
| `POST /v1/test-fixtures/organizations/:slug/activity` | Fill an existing org with weeks of outreach on every channel (see below)                           |

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

## Shared state transitions

`StateTransitionsService` (`services/stateTransitions.service.ts`, exported by
`StateTransitionsModule`) holds the org-state recipes: find a race, create a
launched campaign, create an elected office, promote a won race. The fixtures
and the staff Test mode module (`src/testMode/`) both call it, and Test mode
runs it in **prod**. So the env gate belongs on the fixtures controller,
never in this service, and a recipe change ships to both callers.

## Seeded activity

`ActivitySeedService` (`services/activitySeed.service.ts`, its own
`ActivitySeedModule`) samples real people from the org's district
(`ContactsService.sampleContacts`, so it needs working voter data and 400s an
org with no district), then writes four efforts: a door-knocking turf, a phone
list, a text send and a settled robocall. Knocks and calls go through
`ContactInteractionDoorKnockService.recordIdempotent` and
`PhoneBankingCallService.recordCall`, so contact statuses move the way a real
canvass moves them. Answered knocks and calls carry confirmed memos from
`SEED_MEMOS`; a Serve text send also gets constituent replies. It then asks
`FeedbackSynthesisService` for a run per effort with memos, so themes come
from whatever engine the deploy runs (`mock` locally). Two things are
deliberate: one call in ten stays unlogged so the list never completes and
starts a second run, and the robocall is written fully settled so no sweep
treats it as live. Win orgs get support and will-vote answers; `eo-` orgs get
follow-up and civic panel answers. Never wire this into Test mode.

`POST /v1/test-fixtures/users` takes `activity: 'seeded'` to run the same
seed on the new org (not with `free-win`, which has nothing to show). A
seeded `serve` fixture is bound to the default race's seat instead of the
custom position, because the custom position has no district to sample.
Locally, `npm run seed:activity` drives both (`docs/development.md`).

## Gotchas

- The env gate is `IS_NON_PROD_DEPLOY` (fail-closed) and it 404s, not 403s.
  Local use requires `OTEL_SERVICE_ENVIRONMENT=dev`.
- Fixture creation composes existing services with every real-user side effect
  bypassed: no HubSpot (`createForUser` via `outerTx`, `launch`/`setIsPro`
  with tracking off), no emails, no Slack. If you add a state, keep it that way.
- Fixture emails are `qa-<uuid>@goodparty.org` — the real internal domain, so
  Amplitude flags targeting internal traffic apply on dev. The `qa-<uuid>`
  local part is what `isTestUser` matches; staff `@goodparty.org` accounts
  never take that shape and are never swept.
- Fixture users are swept by `UsersService.deleteTestUsers` after ~24h — QA
  runs should still delete their own users. The `sweepTestUsers` cron that
  drives it runs **only on the dev and prod deploys**, so a PR preview never
  sweeps: previews share the dev Clerk instance's Backend API budget, and one
  full-catalog pass per open PR is what exhausts it.
- `serve-won-race` sets `details.wonGeneral` + a **past** `electionDate` last,
  mirroring the user-facing election-result flow; reordering that risks the
  stale-election-result reset clearing the win.
