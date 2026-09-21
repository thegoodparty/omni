# Serve SMS slices 0-3: parallel implementation plan

Companion to `docs/features/serve-sms.md`. That document says what to
build and why. This one says how to cut it up so several agents can work at
once without stepping on each other.

Target: the named customer can create an SMS send, pay for it, have it
fulfilled, and see who replied and who opted out.

## How this runs

Base branch `serve-sms`, small PRs onto it, **nothing reaches main until the
team has seen the TDD** (same shape as the CallFire migration). Each task is
one worktree, one PR onto `serve-sms`.

This costs nothing in review quality. `gp-api.yml`, `gp-webapp.yml` and
`gp-admin.yml` all declare `on: pull_request:` with no `branches:` filter, so a
PR onto `serve-sms` gets the same pipeline as one onto main: full checks, a
gp-api preview stack at `pr-<N>.preview.goodparty.org`, webapp and admin
previews, and Playwright against that pair. Each preview also gets **its own
database** (`gpdb_pr_<n>` on the shared Aurora cluster, created by the preview
entrypoint, which runs `prisma migrate deploy` + seed), so the W0 migration is
exercised per PR in isolation and dev's database is never touched.

**Open the `serve-sms` → main PR as a draft on day one.** It merges nothing,
the team can watch the work accumulate, and when the TDD is presented that
draft is the artifact sitting beside it. Transparency without merging.

**Rebase `serve-sms` on main every couple of days**, not at the end. The only
real cost of a base branch is drift, and it compounds. W0's migration is
additive so conflicts are unlikely, but verify how Prisma handles a migration
folder timestamped earlier than ones dev has already applied rather than
assuming it is fine.

Per-task loop, unchanged from the standing workflow: worktree → smoke test on
local → critics → PR → drive a delegate to merge → pull the base → next task.
Critics run before every delegate round, not just the first.

Before any push, the CI-faithful verify: next typegen, then a **full unfiltered
`tsc`**, then the whole affected test directory. SWC-backed vitest skips
typechecking, so a tsc-only error passes tests locally and fails CI.

## Pre-work: one PR to main, before anything else

**This does not wait on the TDD review.** It is not part of the feature, it
changes no behavior, and it defuses the one failure this plan cannot otherwise
catch.

`@dev-only` Playwright specs are **grepped out of pull request runs entirely**
and run only post-merge on the release train. `gpbot-dev-test-triage.yml` says
it outright: "These never run on PRs, so nothing saw them before the merge."
There is a prior incident, ENG-11106.

The poll e2e is `@dev-only`. So when B2 removes the `aws s3 cp` line from the
poll Slack message, the spec throws and **no PR anywhere will fail.** It
surfaces on the train, after the final `serve-sms` → main merge, which is the
highest-stakes merge of this project, and it will read as though the feature
broke the e2e. The advisory `devonly-drift.yml` comment matches on changed
routes and B2's change is a Slack string in gp-api, so do not count on it.

**The line feeds two parsers, not one** (found while building PR-0; the TDD
originally named only the first). `getBucketNameFromSlackMessage` takes the
bucket, and `getQueueNameFromSlackMessage` takes the same
`serve-analyze-data-<env>` string and maps the env suffix to the SQS queue
name. Both throw when the line goes.

**PR-0 — shipped, #2024 (to main, standalone):**

1. Two lines in the `Run Playwright tests` step's `env:` block in
   `release.yml`'s `e2e-shard` job: `SERVE_ANALYZE_S3_BUCKET:
   serve-analyze-data-dev` and `E2E_SQS_QUEUE_NAME: develop-Queue.fifo`. Both
   are plain config, not credentials, so they sit beside the hardcoded
   `BASE_URL` rather than going through secrets. No Vercel involvement; this
   test runs in Actions.
2. Both parsers deleted, replaced by a `requireEnv` helper that throws naming
   the workflow rather than falling back silently.

`release.yml` is deliberately left prettier-unformatted: it already fails
`prettier --check` on main and nothing in CI checks `.github/`, so formatting
it would add unrelated diff noise.

Harmless on main today: the CLI line still exists, and the env vars resolve to
exactly what the parsers produced.

Worth noting after the 2026-09-21 scope cut, which keeps the CLI line for now:
PR-0 is no longer a prerequisite for anything on the customer's path. It still
earned its place — it turned removing that line from a release-train hazard
into a free choice, which is exactly what let the line be kept without anyone
weighing a broken test against a workflow change.

## What is actually serial

Parallelism has a ceiling here and it is worth naming, because the expensive
mistake is fanning out before the ceiling is set.

Three things are genuinely serial:

1. **The contract lock.** Zod schemas, the Prisma migration, queue types, and
   the signatures of the two delivery functions. Everything else is written
   against these. One agent, one PR, merged before anything else starts.
2. **Module wiring.** `outreach.module.ts` and friends are hot files that every
   backend task wants to append a provider to. Convergence task at the end.
3. **The Slack button** modifies the handoff helper that the outbound task
   creates. Same owner or strictly after.

Everything else fans out. The shape is one narrow wave, one wide wave, one
narrow wave.

## Wave 0: the contract lock

**One agent. Blocks all of wave 1. Keep it small and boring.**

### W0 — contracts, schema, signatures

Owns:

- `packages/contracts/src/outreach/ServeSms.schema.ts` (new): draft request and
  response, create request, results response, the admin upload request and its
  parse-report response.
- `packages/contracts/src/index.ts`: exports only.
- `packages/gp-api/prisma/schema/pollIndividualMessage.prisma`: `pollId`
  nullable, add `outreachId Int?`, CHECK exactly-one, add the
  `[electedOfficeId, outreachId, personCellPhone]` index.
- `packages/gp-api/prisma/schema/outreachTextRecipient.prisma` (new).
- One migration covering both.
- `packages/gp-api/src/queue/queue.types.ts`: the `outreachTextSend` message
  type and its schema.
- **Signature stubs that throw.** `outreachTextDelivery.service.ts` with
  `requestSend`, `outreachTextIngest.service.ts` with `ingestReplies`, both
  typed per the TDD and both throwing `NotImplementedException`. This is what
  lets wave 1 import, typecheck and write tests against real types on day one.

Acceptance: migration applies and rolls back cleanly on a local DB; full `tsc`
green; no behavior change anywhere; existing poll tests still pass.

Smoke: create a poll locally, confirm its message rows still write with
`pollId` set and `outreachId` null.

## Wave 1: fan out

**Eight tasks, no shared files. None of them waits for W0 to merge.**

W0 has to be *stable*, not merged. Six tasks branch off `ssms-w0-contract-lock`
directly and GitHub retargets them to `serve-sms` when W0 lands; that is the
same stacking used for A4-on-A3. Merging first would only protect against
review changing W0 under them, and that risk does not disappear on merge — a
problem found later is a follow-up commit and the same rebase. Blocking the
fan-out on a review cycle is the worse trade.

Two tasks do not touch W0 at all and branch straight off `serve-sms`:

| Base | Tasks |
|---|---|
| `serve-sms` | A3 (pure refactor of existing Peerly code), A5 (new file) |
| `ssms-w0-contract-lock` | A1, A2, A4, A6, A7, A8 |

**Start A3 first.** It is the head of the critical path (A3 → A4 → B1 → B2),
it edits a live Win file so everyone else rebases onto it, and it needed
nothing from W0 in the first place.

The file-ownership column is the contract between agents. If a task needs to
touch a file it does not own, it stops and says so rather than editing it.

| # | Task | Owns | Must not touch |
|---|---|---|---|
| A1 | Serve SMS draft endpoint | `outreachServeSms.controller.ts` (new), a `ServeSmsVoiceConfig` beside the Win one | `outreachSmsGeneration.service.ts` internals, module files |
| A2 | Serve purchase handler | `outreachServeSmsPurchase.service.ts` (new) | `outreachPurchase.service.ts`, `purchase.service.ts` |
| A3 | Audience resolution helper | new shared helper extracted from `p2pPhoneListUpload.service.ts:178` | anything else in the Peerly package |
| A4 | Delivery outbound | `outreachTextDelivery.service.ts` (fills the W0 stub) | the Peerly package |
| A5 | Slack handoff helper | `textDeliverySlack.util.ts` (new) | `polls/utils/polls.utils.ts` |
| A6 | Reply ingest | `outreachTextIngest.service.ts` (fills the W0 stub), the opt-out predicate | `queueConsumer.service.ts` |
| A7 | Serve SMS surface (webapp) | `SmsFlow.tsx` surface prop, `SERVE_SMS_SURFACE`, `serveSmsPurposes.ts` | `ConstituentOutreachPage.tsx`, `ServeChannelCards.tsx` |
| A8 | Admin upload page | `gp-admin/.../outreach-results/` (new) | the existing `sms-outreach/` console |

### Task notes

**A1 (draft endpoint).** Mirror `outreachServeSocial.controller.ts` exactly:
`@UseElectedOffice()`, org scope, no campaign. The generation service is shared
with Win and parametrized by a voice config, the same way
`SERVE_SOCIAL_VOICE` works. Serve vocabulary rules apply: constituents, office,
term; never voters, election, candidate or ballot. Read
`docs/product-vocabulary.md` before writing a single string.

**A2 (purchase handler).** A new `PurchaseType`, because the `TEXT` handler
returns early unless `campaignId` is present and `outreachType === 'p2p'`, and
its post-purchase step finalizes to Peerly. Post-purchase here does the CAS
`pending_payment → pending` and enqueues `outreachTextSend`. Money-adjacent:
critics before the first delegate round, no exceptions.

**A3 (audience helper).** Pure extraction, no behavior change. Lift the paging
loop out of `buildPhoneList` so both the Peerly caller and A4 can use it, with
the Peerly caller keeping its own CSV shape. This is the one task that edits a
live Win file, so it lands early and everyone else rebases onto it. Its test is
that the existing Peerly tests pass untouched.

**A4 (delivery outbound).** Consumes A3's helper, so it starts against the W0
stub signature and rebases when A3 lands. Opt-out scrub, dedupe, cap,
deterministic key `${outreachId}-${sendSeq}.csv`, recipient capture,
`ContactInteractionText` materialization. Calls A5's helper behind an injected
interface so the two do not serialize.

**A5 (Slack helper).** Copy the block structure from
`sendTevynAPIPollMessage`; do not import it, do not refactor it. Polls moves
onto this helper in wave 2, not now. Include the per-send button URL from the
start, pointing at A8's route.

**A6 (ingest).** The opt-out predicate lives here and is the single definition
for both products. Deterministic uuidv5 ids, delete-then-write inside one
transaction, `applyInboundEvent` for the CRM write-back. Keep the poll
handler's skip-and-log posture for unattributable replies; do not throw.

**A7 (surface).** `PhoneBankingFlow.tsx:201` is the shape to copy. The surface
carries purposes, name suggestion, endpoints as bound async functions (not
route strings, so each `clientRequest` keeps a literal endpoint key), and
audience copy. Win behavior must be byte-identical when the prop is omitted.

**A8 (admin page).** Two routes: a per-send upload page and the results inbox
listing sends awaiting results. Parse and report before committing. The upload
endpoint itself is wave 2, so build against a mocked response shape from W0's
contracts.

## Wave 2: converge

**Four tasks. B1 and B2 are serial with each other; B3 and B4 are parallel.**

| # | Task | Depends on |
|---|---|---|
| B1 | Module wiring + queue consumer case | A1, A2, A4, A6 |
| B2 | Upload endpoint + route by outreach type | B1, A6, A8 |
| B3 | SMS results (slice 3) | B1 |
| B4 | Serve hub mount + e2e TODO | A7, A8 |

**B1.** All the provider registration, controller registration, and the
`outreachTextSend` case in `queueConsumer.service.ts`. One agent touches the
hot files, once, after everything it wires exists. This is why wave 1 tasks do
not edit module files.

**B2.** The admin upload endpoint, `AdminOrM2MGuard`, and the server-side route:
SMS parses straight to `ingestReplies`, a poll's file is written to
`input/<pollId>.csv` so the existing pipeline runs untouched.

**Scope cut 2026-09-21: B2 is SMS-only.** Polls is out — no write to
`input/<pollId>.csv`, no routing by outreach type, and the `aws s3 cp` line
stays in the poll Slack message. That cut is what makes B2 inert: previously
it was the one piece of the customer's path that changed a live workflow and
so could not merge without a scheduled conversation with fulfilment. Now it
adds a button to a product they have never handled and changes nothing they do
today. The unification is deferred, not dropped — the TDD's Inbound section
records the debt and why slice 4 is its natural home.

**B3.** Org-scope `getSmsResults` (parametrize the campaign predicate the way
`findByScope` already does), the Serve results endpoint, the Statistics card,
the collapsed row summary, and the read-only reply list.

**B4.** Mount the SMS card in `ServeChannelCards.tsx` and the flow in
`ConstituentOutreachPage.tsx`, add the type to `rowClickable` and
`CHANNEL_META`. The e2e TODO that used to live here is now **PR-0**, shipped to
main before any of this starts; if PR-0 has not landed, B2 must not remove the
CLI line.

Also in B4: add the feature to the assistants' product map
(`gp-api/src/chats/general/product-knowledge/`). CI fails a PR that adds a
dashboard surface without it.

## Collision protocol

- **Hot files are owned, never shared.** `outreach.module.ts`,
  `queueConsumer.service.ts`, `contracts/src/index.ts`, `schema.prisma`. W0 and
  B1 are the only tasks allowed in them.
- An agent that finds it needs an unowned file **stops and reports** rather
  than editing. A five-minute handoff beats a merge conflict in a money path.
- Every wave 1 task rebases onto `serve-sms` before opening its PR, and again
  after A3 lands.
- **`AGENTS.md` files are hot files too, and wave 1 does not touch them.** The
  repo rule is that docs ship with the change, and it holds — but
  `src/outreach/AGENTS.md` is a single 270KB table with very long lines, and
  eight agents appending to it concurrently is the conflict the ownership
  contract exists to prevent. Wave 1 tasks describe their doc change in the PR
  body instead; **B1 makes one doc pass** covering every slice it wires. (A1
  and A6 independently reached opposite conclusions here, which is a defect in
  the brief rather than in either of them.)

## Smoke tests, and where they have to run

Per-task smoke tests are in the task notes. Because nothing merges to main, the
preview stack is the integration environment, and it has three properties worth
planning around.

- **Each preview has its own database**, freshly migrated and seeded. Good:
  the migration is proven per PR. Also means no shared state between previews.
- **Previews share dev's S3 buckets** (`environment === 'preview' ? 'dev' :
  environment`). Mostly helpful, since the recipient CSV write is exercised for
  real. But **do not write a poll results file to `input/*.csv` from a
  preview**: the real S3 notification fires, the real Lambda launches the real
  Fargate run, and the resulting SQS event goes to the dev queue where dev's
  gp-api consumes it, not your preview. The loop does not close and you have
  burned a pipeline run. The notification filters on prefix `input/` and suffix
  `.csv`, so previews write poll files to a prefix nothing watches. The SMS
  path never touches that bucket, so the customer-critical half tests cleanly.
- **Slack routing is already per-environment, and A5 must not break that.**
  Channel ids come from env vars (`SLACK_BOT_TEVYN_API_CHANNEL_ID`), and
  preview maps to the `GP_API_DEV` parameter set with no separate preview
  secret, so preview posts wherever dev is pointed. Post to the existing
  `SlackChannel.botTevynApi` constant rather than adding a new one: a new env
  var needs configuring in three environments, and until it is, `channelId` is
  `undefined` and the preview smoke test fails for a reason that looks nothing
  like its cause.
- **Previews get their own SQS queue**, so there is no cross-talk: the stack
  creates `${stage}-Queue.fifo` (`deploy/index.ts:80`) and `stage` is
  `pr-<N>` for preview, `develop` for dev, `master` for prod. A preview
  enqueuing `outreachTextSend` is consumed by that preview's own gp-api.
- **S3 writes may not work from local.** The robocall build hit this with
  Transcribe IAM and moved to dev. Here the equivalent is the preview stack,
  not dev.

To settle "is this resource shared with dev?" for anything else,
`packages/gp-api/deploy/index.ts` is the single source: the `stage` map at the
top is `pr-<N>` / `develop` / `master`, so a resource named off `${stage}` is
per-environment, while one written `environment === 'preview' ? 'dev' :
environment` is deliberately shared with dev.

Integration smoke, after B2, on a preview: create a Serve SMS send end to end,
watch the CSV land in the test Slack channel, click the button, upload a
results CSV with a couple of deliberate non-matching numbers, confirm the parse
report counts them, commit, and confirm the Statistics card and the person
records agree.

## Keeping PRs small enough for the bot

Small diffs are the constraint the slicing exists to satisfy, so two of the
wave 1 tasks are pre-split rather than hoping the bot copes:

- **A3** into (i) pure extraction with no caller changes, and (ii) repoint the
  Peerly caller. The first is mechanical and the bot can verify it changed
  nothing; the second is a few lines.
- **A4** into (i) resolve, scrub and dedupe, (ii) CSV, deterministic key and
  S3 write, (iii) recipient capture and status advance. Each has its own test
  surface.

That is roughly fifteen PRs, all small. Most base directly on `serve-sms` and
are independent by file ownership, so the bot never sees another task's diff.
Only A4-on-A3 and B1 → B2 need stacking, done by setting the PR's base to the
parent's branch so the diff stays incremental; GitHub retargets the child when
the parent merges.

Three cheap things that measurably improve the review:

- **Link the TDD section in every PR description.** The bot reviews far better
  against stated intent than inferred intent, and the intent is already
  written down.
- **Tests land in the same PR as the code**, never after.
- **W0's typed stubs are already doing this work.** A later PR fills a
  signature that exists and is already type-exercised, so its diff is small and
  its contract is legible without reading four other PRs.

## Realistic parallelism

Wave 1 is eight tasks but the critical path is A3 → A4 → B1 → B2, so more than
about five concurrent agents buys little. A sensible allocation is A3 and A2
first (A3 unblocks A4, A2 is money and wants the most review time), then A1,
A5, A6, A7, A8 together, then the wave 2 chain.

The thing that actually determines throughput is whether W0 is right. If the
contracts or the migration need a second pass, every wave 1 task rebases. Spend
the extra half hour on W0.

## Retrospective: what this plan got wrong

Written during the build, not after, so it is specific rather than tidy. The
plan above is left as it was; this records where reality diverged.

**Two tasks fell between slices.** The wave-1 breakdown had eight tasks and
slice 0 needed four: nobody owned `POST /v1/outreach/serve/sms` (added as A9)
or the flow's send path below compose (added as B5). Both fell on the seam
between "build the piece" and "wire it up" — work too substantial to be
wiring, but not given its own task. When slicing by component, walk the user's
journey afterwards and check every step has an owner. Two of seven steps did
not.

**Squash-merging a PR with branches stacked on it breaks them.** The squash
creates a commit with no shared history, so all five children went
`CONFLICTING` at once. Recovery was to reset the base branch, redo the merges
as merge commits, and verify the resulting tree was byte-identical — which
preserved five approvals that a rebase would have invalidated. Use merge
commits on a branch anything is stacked on.

**Registering a provider before its dependencies are bindable takes down
everything.** W0 registered `OutreachTextDeliveryService` (a review finding,
made so parallel slices could inject it); A4 then gave it a port whose binding
was B1's job; B1 had not started. Nest could not instantiate `OutreachModule`,
and **190 unrelated test files failed**. Every individual PR was green, because
each ran a subset. Run the full suite on the *merged* branch — that is the only
place this class of failure is visible.

**CI green is not reviewed.** An empty `reviewDecision` can mean the reviewer
looked and declined to approve. Five PRs carried substantive blockers while
being reported as green. Check the review state, not the checks.

**A force-push after approval reopens review.** A3's rebase turned an approved
PR back into two new blockers. Worth knowing before pushing a cosmetic fix to
something already approved.

**Reviews go stale under concurrency.** One "new" blocker described code fixed
26 minutes earlier. Compare the review timestamp against the commit before
acting on a finding.

**Briefs must carry the repo's own gates.** Agents tripped `check:use-client`
and nearly missed the product-map requirement because the briefs did not
mention them. The gates are documented; the briefs simply did not relay them.

### What worked and is worth repeating

- **File ownership as an explicit contract.** Nine agents, fifteen PRs, zero
  collisions. "Stop and report rather than edit a file you do not own" was
  obeyed every time, and several stop-and-reports surfaced real gaps.
- **One task owning every hot file.** No `AGENTS.md` or module-file conflicts,
  except where the rule was stated too late (A1 and A6 reached opposite
  conclusions before it was written down).
- **Typed stubs in the contract lock.** Later PRs filled a signature that
  already existed and was already type-exercised, which kept their diffs small.
- **Agents disagreeing with the reviewer, with evidence.** A3 refused an
  off-by-one finding and proved the arithmetic with a call-count assertion. A6
  and A8 both improved on fixes suggested to them. A brief that invites
  judgement gets better work than one that dictates.
