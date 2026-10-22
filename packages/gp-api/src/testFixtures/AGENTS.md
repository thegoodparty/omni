# Test Fixtures Module

Test-only API for automated feature QA (the `/validate-feature` runbook) and
any script that needs a dev user in a known product state.

## Endpoints (all 404 outside dev/preview)

Four auth tiers. Most routes live in `TestFixturesController` and require
`AdminOrM2MGuard`. The vendor-mock routes live in
`TestFixturesVendorMocksController` and require only a normal signed-in session
plus campaign ownership — so Playwright E2E specs can call them using the test
user's own token without admin credentials. The judge chat-case routes live in
`TestFixturesJudgeController` and require only a normal signed-in session,
scoping every row to the caller (see below).

| Route                                                            | Auth                         | Purpose                                                                                                                        |
| ---------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `POST /v1/test-fixtures/users`                                   | `AdminOrM2MGuard`            | Mint a `qa-<uuid>@goodparty.org` user in a state: `free-win`, `pro-win`, `pro-win-10dlc-mock`, `serve`, `serve-won-race`       |
| `DELETE /v1/test-fixtures/users`                                 | `AdminOrM2MGuard`            | On-demand cleanup (DB + Clerk); the hourly `sweepTestUsers` cron is the safety net                                             |
| `POST /v1/test-fixtures/users/:id/session`                       | `AdminOrM2MGuard`            | Re-mint the 1h session token for runs longer than an hour                                                                      |
| `POST /v1/test-fixtures/organizations/:slug/activity`            | `AdminOrM2MGuard`            | Fill an existing org with weeks of outreach on every channel (see below)                                                       |
| `POST /v1/test-fixtures/users/:id/states/pro-win-10dlc-mock`     | session + isTestUser, own id | Run the caller's real 10DLC registration against the vendor mocks to `tcr_approved` (see below)                                |
| `POST /v1/test-fixtures/vendor-mocks/actions`                    | session + ownership          | Apply a mock action (`geoapify.route.fail`, `callhub.campaign.complete`) for a campaign                                        |
| `GET /v1/test-fixtures/vendor-mocks/records`                     | session + ownership          | List a campaign's `VendorMockRecord` rows (incl. CallHub) and the deploy's `vendorMode`                                        |
| `POST /v1/test-fixtures/vendor-mocks/jobs/:name/run`             | session + isTestUser         | Test-user run-job: triggers a sweep by name; `robocall.send` and the 10DLC jobs act on the caller's campaign only              |
| `POST /v1/test-fixtures/vendor-mocks/time-travel`                | session + ownership          | Shift outreach timing for E2E: `robocall.send_due_now`, `robocall.dialed_48h_ago`, `sms.start_date_today`                      |
| `POST /v1/test-fixtures/vendor-mocks/outreach/:id/admin-actions` | session + outreach ownership | `cas.approve` or `results.upload` on an outreach the caller owns (Win campaign or Serve org); any account, not only test users |
| `POST /v1/test-fixtures/jobs/:name/run`                          | `AdminOrM2MGuard`            | Run a named background job on demand (robocall.staging/send/completion/capture)                                                |
| `POST /v1/test-fixtures/judge-chat-cases`                        | session                      | Stage one Universal Judge chat case for the caller (see below)                                                                 |
| `DELETE /v1/test-fixtures/judge-chat-cases/:slug`                | session                      | Remove one, and only one the caller owns under a `judge-` slug                                                                 |

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

## `pro-win-10dlc-mock`

`TestFixturesService.setupProWin10DlcMock(userId)` plays the compliance_setup
agent server-side, through the services behind the agent's routes and in its
order: filing (`createAgentic`, while the campaign still reads non-Pro so no real
agent run is queued), `setIsPro`, a publishable website, domain search and
purchase, publish, `verifyLive`, the CV pre-submission override
(`overrideCvValidation`, the same call as the `cv-validation/override` route),
`submitToPeerlyForAgent`, `peerly.cv.approve`, the PIN (`123456`), `peerly.usecase.activate`
and the activation check. It ends by asserting stage `tcr_approved` and a
`peerlyIdentityId`, and takes about 4 seconds. `POST /users` also accepts the state.

- The purchase call blocks until the Vercel mock completes the order (30s after
  the buy), so a short loop calls `VendorMockRecordService.completeVercelOrders`
  until the purchase settles.
- It 400s unless `VENDOR_MODE=mock`: live mode would buy a real domain and file a
  real Campaign Verify request. The route also 404s off a non-prod deploy and
  only runs for the signed-in test user's own id.
- `internalTestingAt` stays null on purpose. The P2P send gate
  (`requirePeerlyIdentityId`) blocks internal-testing rows, and this user must pass it.
- A user that already has a TCR record gets 409, unless it is already approved
  by this fixture, which returns the existing result.
- Only the campaign's own activation check runs (`tcr.complianceSweep`'s body),
  not the global `tcr.usecaseSweep`.

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

An `eo-` org then gets the civic panel loop, all through production
services so the rows match what a real office writes:

- **Build plan**: `CivicPanelBuildPlanService.create` at 2 hours a week. A
  rerun's `ConflictException` (plan already there) is swallowed.
- **Panel invite text**: carries `CIVIC_PANEL_JOIN_LINE` and
  `asksToJoinCivicPanel`, goes to residents not on the panel and not opted
  out, and its list is set on the plan's first text step. Every sixth one
  replies JOIN through `OutreachTextIngestService.ingestReplies`, which
  writes the `civic_panel` events. The plan is read afterward, which is
  what links the step to the send and reads it done.
- **Priority ask**: `PrioritiesService.create`, then a text with
  `priorityId` set, `campaignId` null, to panel members first, then other
  residents, then residents from each of the read's major tracts. The
  groups come from `CensusCompositionSource.mrpInputs`'s frame, the one the
  read poststratifies to (`readGroups` in
  `util/priorityAnswerAllocation.util.ts`); the census weighs a tract by its
  adults, so a tract the district line cuts can be major while a voter file
  sample holds almost none of it. Each tract gets `walkableAreaWithin` doors
  with cell phones, which is also how the seed knows their tract. With no
  frame (route tests, no warehouse) nothing extra is drawn. Every one of
  them replies with fixed answers from `PRIORITY_REPLIES`, through the same
  ingest, and gets a `PriorityAnswer` row coded the way the classifier would
  (the priority's read counts coded answers, not replies). The body's
  `answers` caps how many reply (0 to 500), and `allocateAnswers` picks them
  so every major group gets five before anyone else. `split` (`lean`, nine
  in ten yes, or `even`, half yes and half no) sets the codes, cycled within
  each age band and sex so no group comes out all one way; `--answers` and `--split` on `npm run seed:activity`
  send them, to `--org` and `--fixture` alike (`POST /users` takes them beside
  `activity: 'seeded'`). The pooled `requestPriorityRun` gives the results
  page themes, and is skipped when fewer than five answers can be summarized.

A text send needs `OutreachTextRecipient` rows (`createTextSend`) or the
ingest cannot match a reply to a person. A smaller `people` seeds the same loop with fewer answers.

`POST /v1/test-fixtures/users` takes `activity: 'seeded'` to run the same
seed on the new org (not with `free-win`, which has nothing to show). A
seeded `serve` fixture is bound to the default race's seat instead of the
custom position, because the custom position has no district to sample.
Locally, `npm run seed:activity` drives both (`docs/development.md`).

## Judge chat cases

`TestFixturesJudgeController` + `JudgeChatFixtureService` stage the Universal
Judge's chat fixture for an arm that drives a **deployed PR preview over
HTTP** and so has no Prisma client of its own. They decide nothing about the
fixture: `seedChatOrgRows` in
`src/chats/evals/judge/runners/seedChatOrg.ts` is the same function the
in-process vitest arm calls, so both arms seed the same rows.

`POST` takes `{ agentId, sweepId, slugKey, accountState? }` and answers the
`SeededChatOrg` the in-process arm gets. The **slug is derived**
(`chatOrgSlug`), never passed, which is what keeps attempt i of both arms on
one organization and keeps a caller from naming one. Setup is idempotent by
tearing the same slug down first — the seeder creates rather than upserts, and
the in-process arm wants that collision.

Unless `accountState.district` is `false`, setup also checks that the seeded
position resolves to a district on this deployment
(`DistrictResolverService.resolveByOrgSlug`) and returns it as `district`. When
it does not resolve, setup removes the fixture and answers 503, because the
constituent tools would quietly not register and the case would record a
district the agent never had.

`sweepId` is in the slug — `judge-<sweepId>-<agentId>-<caseId>-<digest>` —
because two sweeps against one database (dev, which every PR's base arm
targets) otherwise stage the identical organization and the second's
teardown-first step removes the first's fixture mid-run. It costs the
identical-config refusal nothing: one sweep's two arms are handed the same
value, so their system prompts still match. The id is validated against the
same alphabet `sweepEnv.SweepIdSchema` holds it to, restated rather than
imported because `src/chats/evals/**` is dropped from the production build.
It does **not** make `briefing_annotation` concurrency-safe — see the judge
README.

`DELETE` is scoped twice over: the request schema refuses a slug without the
`judge-` prefix, and the delete itself matches on that prefix **and** the
caller's own `ownerId` in one where clause. There is no request that reaches
a real organization. It answers `{ organizationSlug, removed }` rather than
404ing, so a retried teardown and somebody else's judge slug look the same.

Teardown that never runs (a cancelled sweep) leaves rows that
`organization.slug startsWith 'judge-'` finds — the handle is on the row
itself, so nothing extra is needed to sweep them.

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
