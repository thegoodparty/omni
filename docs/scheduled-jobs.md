# Scheduled jobs

**Scheduled work in gp-api is a pg-boss schedule**, declared in `SCHEDULES`
(`packages/gp-api/src/jobs/AGENTS.md` § Schedules). pg-boss sends one job per
occurrence across every replica, with retries, dead letters and alerts, and
runs of one schedule never overlap. A job that touches many records fans out
one job per record (§ Fan-out there).

CI fails any `@Cron` or `@Interval` in `packages/gp-api/src`
(`npm run check:legacy-background-work` in `packages/gp-api`). Dev and prod
run more than one gp-api replica, and `@nestjs/schedule` fires on every one.
Work on one task's own memory, such as flushing a buffer it holds, is a plain
timer started and cleared in that service's lifecycle hooks
(`src/users/services/sessions.service.ts`).

## Pick a non-`:00` minute

Most existing schedules sit on the hour, so `0 * * * *` puts your job in a
thundering herd against them. Pick an offset minute (`23 * * * *`,
`*/10 * * * *`), or `0 10 * * *` when the hour itself is the spacing knob.
Read `SCHEDULES` in `packages/gp-api/src/jobs/jobs.registry.ts` before
choosing.

## Lease a row for runs longer than a minute

A schedule's runs never overlap, but a retry can start beside a run that only
looked dead. Where that must not happen, take a lease on a single row as well.
The email send sweep, a pg-boss schedule that sends for up to 50 seconds a
minute, keeps `email_sweep_lease`
(`src/emailOutreach/services/outreachEmailSendSweep.service.ts`):

- **Take** with one `UPDATE ... WHERE expires_at < now() OR holder = $me`. Zero
  rows updated means another replica holds it, so return.
- **Renew** on every batch, and **release** in a `finally` by setting
  `expires_at = now()`.
- **Check for work first,** before taking the lease, so an idle minute costs one
  query.

The test database reset deletes every row, including the seeded lease row, so
tests that touch the sweep insert it themselves.

## Vendor-cron gate

Jobs that spend money or hit a vendor rate limit gate on `VENDOR_CRONS_ENABLED`
(`shared/util/appEnvironment.util.ts`):

```ts
if (!VENDOR_CRONS_ENABLED) {
  return
}
```

`VENDOR_CRONS_ENABLED = IS_PROD_DEPLOY || VENDOR_MODE === 'mock'`. It is true on
prod (real vendors), true wherever the vendors are mocked (previews, local, and
dev by default, so a human can drive robocall, P2P and 10DLC flows end to end),
and false on a non-prod deploy that has been put back in live mode with
`VENDOR_MODE=live` (the rollback lever), where a real call would spend real
budget. See `CvStatusPollService.runScheduledScan`. Some jobs use a feature-flag gate
instead (`isAutomationEnabled()`, as the Serve agent dispatchers on pg-boss
schedules do); use whichever the surrounding feature already uses.

Tests read the constant at import time, so a test cannot flip it with
`vi.stubEnv`. Call `disableVendorCrons()`
(`shared/test-utils/appEnvOverrides.ts`) for the rest of the test.

### Alerting and Slack-posting crons stay prod-only

Not every job in a vendor flow is a vendor cron. These keep the old
`OTEL_SERVICE_ENVIRONMENT !== 'prod'` return on purpose, each with a WHY comment
at its gate, because mocking the vendor does not make them safe to run elsewhere:

- `outreachRobocallBacklogAlert`, `outreachRobocallOverdueAlert`: alerting
  crons; they would page from dev or a preview.
- The `nightly10DlcReport` and `peerlyVendorEscalation` schedules (the gate is
  in `runNightlyReport` / `runVendorEscalations`): they post to
  `bot-10dlc-compliance` and `@here` Peerly's shared Slack Connect channel,
  which would ping their staff about mock identities.
- `outreachNotification`, `outreachRobocallWebhook`: not vendor crons.

### Not prod-only? Then allowlist — never `!== 'preview'`

A job whose whole point is a non-prod environment still must not run on every
**PR-preview** stack. `OTEL_SERVICE_ENVIRONMENT` is `preview` on all of them at
once, they all hold the `GP_API_DEV` secret, and there are commonly ~25 open at
a time — so an ungated vendor job fires ~25 identical passes on the same
instant against one shared budget. `UsersService.sweepTestUsers` is the case:
it exists to clean the **dev** Clerk instance, which is a real vendor even
though the deploy is non-prod, so `VENDOR_CRONS_ENABLED` (on for every mocked
preview) is the wrong gate for it.

Allowlist the deploys that should run it, rather than excluding preview:

```ts
const SWEEP_DEPLOY_ENVIRONMENTS = new Set(['dev', 'prod'])
...
if (!SWEEP_DEPLOY_ENVIRONMENTS.has(process.env.OTEL_SERVICE_ENVIRONMENT ?? '')) {
  return
}
```

Same fail-closed reasoning as `IS_NON_PROD_DEPLOY` in
`src/shared/util/appEnvironment.util.ts`: an absent or unexpected value (local,
vitest, a typo) is not in the set, so it skips. A skipped sweep is recoverable;
a stampede against a vendor rate limit is not. Read `process.env` live rather
than importing the module constant, so a test can `vi.stubEnv` the gate.

**pg-boss does not substitute for this.** Its queues live in the deploy's own
database, and every preview stack has its own, so a schedule runs once per
deploy, never once across deploys. The environment gate is the fix.

## Serve jobs that fan out per office skip unfinished onboarding

A job that starts paid work for every elected office (community issues,
meeting briefings, ordinance sourcing) selects only offices with
`onboardingCompletedAt` set. Every candidate's win creates an office nobody
has opened yet, and it must not cost agent runs. Staff and admin dispatch
endpoints and the official's own actions are not gated.

## Test fixtures

The non-prod test-fixtures endpoints run a schedule on a preview with
`JobsService.sendScheduleRun(name)`, or send the per-record job scoped to the
caller's campaign, and the spec polls for the outcome
(`tcr.complianceSweep` sends `tcrComplianceStatusCheck`;
`cvStatusPoll.scanFresh` sends `cvStatusFreshScanCampaign`).

## Checklist for a new schedule

- [ ] A `SCHEDULES` entry, cron in UTC, with its local time in a comment
      when it matters.
- [ ] A non-`:00` minute that doesn't collide with an existing schedule.
- [ ] One job per record with `sendMany` when it touches many records.
- [ ] Safe to run twice.
- [ ] `VENDOR_CRONS_ENABLED`, a prod-only guard, a deploy allowlist, or the
      feature's automation flag if it spends money or hits a vendor. Never
      leave it running on previews.
- [ ] A Serve job that fans out per office selects only offices that
      finished onboarding.
- [ ] Tested with `useTestService({ jobs: true })` and
      `service.jobs.runSchedule(name)` (`src/jobs/AGENTS.md` § Tests).
