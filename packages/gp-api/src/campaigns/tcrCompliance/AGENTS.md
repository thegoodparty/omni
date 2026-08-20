# tcrCompliance/

TCR / 10DLC compliance registration — the gp-api home of the **agentic
`compliance_setup` flow**. A `TcrCompliance` row is the per-campaign record of a 10DLC
brand/campaign registration with Peerly so the candidate can send SMS. This dir owns
both the legacy synchronous `create()` path and the agentic flow that the Pro upgrade
wizard and the `compliance_setup` agent drive through the same endpoints.

Frontend counterpart (the pre-payment wizard that calls these endpoints):
`packages/gp-webapp/app/dashboard/pro-upgrade/CLAUDE.md`.

## Two callers, same endpoints (the Phase 1 contract)

Both the candidate-facing **Pro upgrade wizard** and the **`compliance_setup` agent**
(running in gp-ai-projects, reaching gp-api through the broker) hit the _same_ routes —
there are no agent-only endpoints. The `@McpTool`-decorated methods are what the agent
calls; the wizard calls the same controller methods over HTTP.

| Route                                                                                   | Method                                                           | Caller(s)                    | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /campaigns/tcr-compliance/agentic`                                                | `createAgentic`                                                  | Wizard (filing-details step) | Persist EIN + committee + filing details, create the `TcrCompliance` row, and **conditionally** dispatch the agent. Address one-of: a Google-resolved `placeId`+`formattedAddress` pair (persisted onto the campaign) or a structured `manualAddress` (persisted onto the record's `filing_address_*` columns with a composed `postalAddress`; the campaign address is left untouched).                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `GET /campaigns/tcr-compliance/mine/compliance-state`                                   | `findStateForCampaign` (`@McpTool`)                              | Agent                        | Canonical pipeline state across Campaign/Website/Domain/TcrCompliance. Agent calls this first each run to decide which steps to skip.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `POST /campaigns/tcr-compliance/submit-to-peerly`                                       | `submitToPeerlyForAgent` (`@McpTool`)                            | Agent                        | Submit the registration to Peerly (Identity → Profile → 10DLC Brand → CV Request). Stage-gated on `awaiting_pin`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /campaigns/tcr-compliance`                                                        | `create`                                                         | Legacy non-agentic           | Synchronous full Peerly submission (older flow).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST /campaigns/tcr-compliance/:id/submit-cv-pin`                                      | —                                                                | Wizard / agent               | PIN entry → CV token → approve 10DLC brand.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /campaigns/tcr-compliance/admin/:campaignId/compliance-state`                      | `getComplianceStateForCampaign`                                  | gp-admin (M2M)               | Same payload as `mine/compliance-state` for any campaign (`AdminOrM2MGuard`). Backs the user-page 10DLC status/PIN widget.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `POST /campaigns/tcr-compliance/admin/:campaignId/resend-cv-pin`                        | `resendCampaignVerifyPinForCampaign`                             | gp-admin (M2M)               | Staff-triggered CV PIN resend (Peerly `resend_pin`, ENG-10689). Gated on the **live** CV status being `APPROVED`: 409 once `VERIFIED` (PIN already consumed), 422 before a PIN was issued or before any Peerly identity exists. Non-prod short-circuits to success without calling Peerly. Returns 204. Every accepted resend (incl. the non-prod bypass) fires the `CompliancePinResent` Segment event (`triggered_by: 'admin'`) so HubSpot can surface staff resend activity; failures fire nothing.                                                                                                                                                                                                                                                                                                                              |
| `POST` / `DELETE /campaigns/tcr-compliance/admin/:campaignId/internal-testing-approval` | `grantInternalTestingApproval` / `revokeInternalTestingApproval` | gp-admin (M2M)               | Staff checkbox "treat as 10DLC approved (internal testing)". Grant creates a `TcrCompliance` row with `status: approved` + `internalTestingApprovedAt` and placeholder business fields — **no Peerly identity is ever minted**, so every UI gate passes while the P2P send gate (`requirePeerlyIdentityId`) keeps real sends blocked with a testing-specific 400. Works in all envs, prod included. Only for campaign owners with `@goodparty.org` / `@test.goodparty.org` emails (400 otherwise, enforced server-side); grant 409s if a real compliance row exists, revoke 409s rather than delete one, and both are idempotent. `deriveComplianceStage` short-circuits marker rows to `tcr_approved` (no domain/website footprint). Sweeps ignore marker rows (no `submitted`/`pending` status, no Peerly identity). Returns 204. |

## The key correctness change: dispatch decoupled from submission

Before Phase 3, `createAgentic` enqueued the agent kickoff immediately on submit. But
the wizard now collects **all compliance data before the candidate pays**, so dispatching
on submit would provision a domain + website for an unpaid candidate. The fix:

- **`createAgentic`** dispatches the kickoff inline **only when `campaign.isPro`** (a
  post-payment resubmission). For a pre-payment submit it creates the row and **defers**.
- **The payment webhook** (`payments/services/paymentEventsService.ts` →
  `handleSubscriptionCheckoutCompleted`) calls
  **`enqueueAgenticKickoffIfNeeded(campaignId)`** on `checkout.session.completed`, after
  flipping `isPro`. That's where a pre-payment record's agent finally launches. It's
  best-effort there (a failure must not fail the webhook; the sweep recovers).

So: **`isPro` is the dispatch gate.** Don't move dispatch back onto submit.

## Existing-Pro users: profile-before-dispatch (ENG-10856)

Candidates who were Pro **before** the wizard shipped never walk its
pre-payment EIN/candidate-profile steps. They start 10DLC from the standalone
election-filing form, and because their campaign is already Pro,
`createAgentic` dispatches the agent **inline** — which used to burn a ~$1
run that failed terminally at `publish_website` (`profile_incomplete`, no
genuine bio/issues) and strand the record (nothing retries once
`kickoffSentAt` is stamped; three manual prod-repair batches in July 2026).
The class is closed at three layers:

1. **Frontend collects (happy path).** The election-filing form renders the
   shared candidate-profile fields inline when the profile is incomplete and
   persists them before calling `createAgentic`; a dashboard banner
   (`TextingSetupBanner`, in both dashboard homes) prompts Pro candidates who
   never started. Detail:
   `packages/gp-webapp/app/dashboard/pro-upgrade/CLAUDE.md` § Existing-Pro
   users.
2. **Dispatch gate (the invariant).** Every producer path refuses to launch
   a run for a profile that can't pass the publish gate — see the profile
   dispatch gate under "Idempotent dispatch" below. Deferral state is
   `kickoffSentAt IS NULL` with status `submitted` (never `error`); anything
   that goes wrong while _evaluating_ the gate also defers rather than
   erroring, or the record would leave the sweep's candidate set.
3. **Self-heal + visibility.** The stranded-kickoff sweep re-applies the
   gate per record every cycle, so authoring a genuine bio + policy issue
   (via election-filing or campaign-story) dispatches automatically with no
   staff action; the kickoff consumer re-checks first-pass records as
   defense-in-depth; deferred records >24h old surface in the nightly
   report's "Dispatch deferred" nudge section.

Repairing a pre-ENG-10856 stuck record is now just
`UPDATE tcr_compliance SET kickoff_sent_at = NULL` — the gate holds it
deferred until the candidate authors content, then the sweep dispatches. No
more hand-authoring website content in prod.

## Idempotent dispatch (don't double-launch the agent)

`claimAndEnqueueKickoff(record, clerkUserId)` is the single source of the kickoff SQS
message shape, shared by `createAgentic` (already-Pro) and the webhook. Its idempotency
guard is an **atomic claim on `TcrCompliance.kickoffSentAt`**
(`updateMany WHERE kickoffSentAt IS NULL`) _before_ the SQS send. A webhook replay or a
submit→pay→resubmit race finds it already set and short-circuits → agent dispatched
exactly once. On send failure the rollback is **scoped to the exact claim timestamp** so
a concurrent re-claimant's live claim isn't cleared, and `kickoffSentAt` returns to null
so the stranded-kickoff sweep can retry.

**Profile dispatch gate (ENG-10859).** Before the claim, the method checks
`wouldBePublishableAfterFallbacks(content, user, campaign)`
(`websites.service.ts`: apply `applyCompliancePublishFallbacks`, then
`isGenericComplianceContent` on the result — so position-seeded issues count,
but a missing/template bio never does). Not publishable → log info and return
**without claiming**. `kickoffSentAt` staying null IS the deferral state (do
NOT use status `error` — that means kickoff-rejected and triggers
`createAgentic`'s delete-and-recreate retry): the record stays in the
stranded-kickoff sweep's candidate set, and the sweep applies the same
predicate per record, so the cycle after the candidate authors a genuine
bio + policy issue (election-filing inline collection or campaign-story) it
dispatches automatically. Wizard users always pass — their profile step
precedes payment. Deferred records >24h old surface in the nightly report's
"Dispatch deferred" nudge section.

## Kickoff handling (SQS consumer → agent dispatch)

`handleAgenticKickoff(message)` runs in the queue consumer
(`queue/consumer/queueConsumer.service.ts`, `QueueType.AGENTIC_COMPLIANCE_KICKOFF`). In
order it:

1. **Validates `campaign.details.electionDate`** is a real `YYYY-MM-DD` (the agent
   expands it into domain-name placeholders; a bad value would poison generation).
   Missing/invalid → mark record `error`, no dispatch.
2. **Requires an address source.** Peerly resolves the postal address from the
   record's manual filing-address columns (`filingAddressLine1/City/State/Zip`,
   set when the candidate entered the address manually — PO Boxes and
   addresses Google Places can't suggest) or, failing that, from
   `campaign.placeId` via Google Places. With neither, the run publishes a
   site, can't submit, reports `partial`, and the resume sweep re-dispatches a
   ~$10 paid run every few minutes until it gives up. So reject at kickoff
   (status `error`, no dispatch) rather than loop. Manual wins over `placeId`
   when both exist — `campaign.placeId` can carry a stale onboarding address,
   while the manual components were entered for this registration
   (`peerlyIdentity.service.ts` `resolveFilingAddress`).
3. **`ensureCompliancePublishableWebsite`** (`websites.service.ts`) — the agent buys a
   domain and publishes the site but can't _create_ one or author missing copy.
   Legacy-Pro candidates skip the wizard's profile step, so guarantee a publishable site
   before dispatch.
4. **Profile re-check (defense behind the producer gate).** After the
   fallbacks persist, re-reads the content and, if
   `isGenericComplianceContent` still holds (the fallbacks never invent a
   bio/issue), does **not** dispatch: rolls `kickoffSentAt` back to null —
   scoped to the value read at handler start plus `agenticRunId IS NULL` so a
   newer claim isn't cleared — and returns, putting the record back in the
   deferral loop. Catches messages enqueued before the producer-side gate and
   any path that skips it.
5. **Atomic dispatch claim** on `agenticRunId IS NULL` (+ TTL on
   `agenticDispatchAttemptedAt`) → `experimentRunsService.dispatchRun({ type:
'compliance_setup', ... })`. Stamps `agenticRunId` scoped to the claim timestamp.

**FAILED and SUPERSEDED runs stay re-dispatchable** — the idempotency skip path
intentionally excludes both (a re-claim clears `agenticRunId` and re-dispatches with
`trigger: 'recovery_resume'` so the agent skips completed steps). Don't add them to the
skip set. `SUPERSEDED` matters because `agenticRunId` is never repointed to the resume
successor, so it keeps pointing at the superseded predecessor; if that successor later
`FAILED`, the record would strand here unless `SUPERSEDED` can fall through to the
retake. `AWAITING_RESUME` _is_ in the skip set — the resume sweep owns those, so the
kickoff path must not race it.

## The twice-daily CV status scan (`CvStatusPollService`)

`cvStatusPoll.service.ts` owns **every scheduled Peerly `retrieve_cv` read**.
Cadence, set size, and pacing were agreed with Peerly (James/Patrick,
2026-08-17) after their rate-limit complaint about the old hourly sweeps
(~5,100 retrieve_cv calls/day for ~88 identities, doubled by the two prod
replicas' independent `@Interval` timers):

- **Schedule:** `@Cron('0 8,20 * * *', { timeZone: EASTERN_TIMEZONE })`,
  **prod-only** (dev/qa would burn vendor-budgeted calls on their own queue,
  and non-prod Peerly flows are stubbed anyway) — every replica's cron
  fires, and the slot-keyed FIFO `deduplicationId`
  (`cvStatusPoll-<yyyy-MM-dd-HH>`) collapses them so exactly one replica
  scans (nightly10DlcReport pattern).
- **Detached from the consumer:** the SQS handler acks immediately and runs
  the scan un-awaited — a paced scan (~1 min/record) would outlive the 300s
  visibility timeout and redeliver into a duplicate concurrent scan. A
  process restart mid-scan leaves the tail for the next slot (oldest-touched
  records poll first).
- **CV pass (rate-limited):** polls only Pro/non-internal, identity-bearing
  records in `submitted`/`pending` whose persisted `peerlyCvStatus` is still
  movable — null, `REQUESTED`, `IN_REVIEW`, or `APPROVED`. `VERIFIED` and
  rejected/withdrawn records never re-enter the set. Calls are spaced
  `CV_SCAN_RETRIEVE_SPACING_MS` apart (60s default — Peerly's requested
  absolute limit of 1 retrieve_cv call/minute regardless of identity). One
  enriched `retrieveCampaignVerifyDetails` read per record feeds three
  consumers, in order: `applyCvDetection` (PIN-delivery + late-rejection
  handling, below — detection runs first so a failure keeps the record in
  the poll set), the persisted status mirror
  (`peerlyCvStatus`/`peerlyCvStatusChangedAt` + the ENG-10796 escalation
  resets, moved here from the nightly poll), and — when the read observes
  `VERIFIED` — an immediate first profile read.
- **Profile pass (not rate-limited):** `VERIFIED` in-flight records get a
  `getProfile` read (350ms spacing) to keep `peerlyProfileStatus` fresh for
  the case-3a/3b stall sections — never another retrieve_cv.
- **Demand-driven reads are unchanged** and outside the scan's budget:
  `resolvePeerlyCvState` at `awaiting_pin` (PIN screen / agent poll), the
  admin PIN-resend pre-check, and the pre-submit existence check.
- The PIN-entry path (`retrieveCampaignVerifyToken`) stamps
  `peerlyCvStatus = VERIFIED` directly on a successful verify, so
  `sweepUnsubmittedUsecases` doesn't wait up to 12h for the next scan — and
  it runs `applyCvDetection` off its own (demand-driven, enriched) read,
  detached and best-effort. That stamp removes the record from the scan's
  poll set, so a candidate who enters their PIN between scans would
  otherwise never get `pinDeliveryMethod` recorded or `CompliancePinSent`
  fired; entry time is the last observation, at zero extra Peerly calls.
  This is deliberately NOT solved by widening the scan's status filter to
  `approved` — legacy `approved` records carry a null persisted CV status
  and would flood the paced scan (the stale set this design evicts).

### `applyCvDetection` (ENG-10658, formerly `sweepPinDeliveryDetection`)

Runs per-record on the scan's observation — no Peerly call of its own.
**Only when the live CV status is `APPROVED` or `VERIFIED`** (Peerly echoes
back the `verification_method`/`filing_email` we submit from day one, so
method presence alone is not proof a PIN went out — ENG-10785 false-nudge
bug), it records the channel + destination Peerly sent the PIN to, fires the
`CompliancePinSent` Segment event **once** (carrying `pin_delivery_method`,
`pin_delivery_destination`, and `pin_sent_at` — the destination is synced
since PR #777 so the nudge can name the exact inbox), then runs the CRM
company sync so the `n10_dlc_pin_*` company properties are stamped directly
by gp-api (the Segment→HubSpot event-property path silently drops unmapped
properties; the company sync is the guaranteed carrier). Candidate-facing
reads still mask the destination. The same observation detects a CV that
flipped to `REJECTED`/`WITHDRAWN` after submission: it persists
`status = rejected` via an atomic transition claim and fires the
`ComplianceRejected` event once (`rejection_source: cv_status_check`); the
synchronous twin fires from `submitToPeerlyForAgent` (`cv_submit`). The
rejection branch runs **before** the already-recorded
(`pinDeliveryMethod` set) early-return, so a late rejection on a
delivered-PIN record still stamps the terminal status. Once-only via an
atomic `pinSentDetectedAt IS NULL` claim; if the event fire fails the claim
is rolled back (scoped to its timestamp, rollback itself try/caught) and the
error propagates to the scan's per-record catch, so the next scan retries.

## Background sweeps

| Sweep                          | What it heals |
| ------------------------------ | ------------- |
| `sweepStrandedAgenticKickoffs` | (`@Interval`, 10 min) Records `submitted` + no Peerly identity + `kickoffSentAt` null past staleness — re-enqueues the kickoff. **Only sweeps `campaign.isPro` records** so the agent never runs before payment. Applies the profile dispatch gate per record (`wouldBePublishableAfterFallbacks`, website content fetched per candidate): profile-incomplete records are skipped every cycle at no cost — this is the deferral self-heal loop. |
| `sweepUnsubmittedUsecases`     | (`@Cron('23 * * * *')` ET, behind `CronLockService.tryClaimHourlyRun`) Records whose **persisted** `peerlyCvStatus` is `VERIFIED` (stamped by the CV status scan or the PIN-entry path — the sweep makes no retrieve_cv read of its own) but whose POLITICAL usecase was never submitted (the in-app approve threw) — submits the usecase so the identity doesn't strand "loading". **Acts only on `VERIFIED`, never `APPROVED`** — `APPROVED` can precede the candidate's PIN entry, so advancing it would skip them past the PIN screen. **The hourly cron lock is load-bearing:** `submitUsecaseIfVerified` has no per-record claim, so two concurrent passes would both mint a CV token and both approve, double-finalizing the 10DLC brand into the MNO queue (manual vendor cleanup). It was an `@Interval` — per-replica and deploy-phase-reset — until that was fixed. See `docs/scheduled-jobs.md`. |
| `bootstrapTcrComplianceCheck`  | (`@Cron('0 7,19 * * *')` ET) Re-queues `pending` records for usecase-activation checking (`get_usecases`, not rate-limited). Each message's FIFO `deduplicationId` is keyed `tcrStatusCheck-<recordId>-<slot>` so both replicas' simultaneous cron enqueues collapse to one. The consumer reads the persisted `peerlyCvStatus` for the token-status Segment event instead of the old live retrieve_cv call (a `pending` record's CV is `VERIFIED` by definition). |

## Nightly 10DLC health report (ENG-10667)

`Nightly10DlcReportService` posts a comprehensive stuck-campaign report to
`bot-10dlc-compliance` every **midnight ET** — it replaced the older
single-class `sweepStuckPeerlySubmissions` hourly digest (and its
`stuckSubmissionAlertedAt` claim column). Mechanics:

- **Schedule:** `@Cron('0 0 * * *', { timeZone: EASTERN_TIMEZONE })` — a
  daily `@Interval` would reset on every weekday prod deploy and never fire.
- **Prod-only:** the cron handler returns immediately unless
  `OTEL_SERVICE_ENVIRONMENT === 'prod'`, so dev/qa never enqueue or post.
- **Exactly-once across replicas:** every replica's cron enqueues, but the
  SQS FIFO `deduplicationId` is keyed to the ET report date
  (`nightly10DlcReport-<yyyy-MM-dd>`), so the consumer handles one message
  (`weeklyTasksDigest` pattern). The handler returns `false` when the Slack
  post fails (SlackService swallows errors and resolves `undefined`), so SQS
  redelivers rather than silently skipping a night.
- **Always posts** — a zero-stuck night gets an explicit ✅ all-clear with
  in-flight pipeline counts, so a _missing_ report is itself a signal.
- **The report makes no Peerly calls (since the 2026-08-17 rate-limit
  work — the poll it used to run, ENG-10793, moved to the twice-daily CV
  status scan above).** The sections read the persisted
  `peerlyCvStatus`/`peerlyProfileStatus` columns, at most ~4h stale (last
  scan slot 8pm ET, report at midnight ET); every section floor is ≥13h so
  the staleness is immaterial. The columns store raw vendor strings (not
  Prisma enums — vendor values degrade gracefully, same reasoning as
  `pinDeliveryMethod`), and the `*ChangedAt` companions advance only when an
  observed value differs from what's stored — an unchanged observation
  writes nothing at all, so `updatedAt` (which the awaiting-PIN section keys
  off) is untouched.
- **A "Dispatch deferred" nudge section (ENG-10859):** `submitted` + no
  identity + `kickoffSentAt` null + >24h old + profile-incomplete (the
  publishability filter runs in code — content lives on the website
  relation). These are the dispatch gate's deferrals; without this section
  they'd match nothing (the stuck-submission filter's `kickoffSentAt: { lt }`
  never matches null). Nudge-style like awaiting-PIN, not counted as stuck —
  the fix is candidate action, and the sweep dispatches automatically once
  the profile is completed.
- **Ten failure sections**, all scoped to `campaign.isPro` (pre-payment records
  intentionally sit idle) and excluding internal accounts (user email
  ending `@goodparty.org` / `@test.goodparty.org` — staff walk this flow
  in prod and their stuck records are noise): submission never completed (>24h after kickoff,
  with agentic run status), kickoff `error`, Peerly/CV `rejected`, active
  billing block (within `PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES`), domain
  purchase never completed (post-cutoff `registrantVerifiedAt` NULL — see
  the legacy-domain gotcha below), CV never reached (ENG-10795 case 1: identity
  minted, `submitted` 13+ hours ago — one full scan cycle plus margin, since
  CV creates the request at `Requested` synchronously on submission
  (confirmed with Peerly/Nate 2026-08-17), so a scan-observed null past that
  window is a dropped submission, not propagation lag — `peerlyCvStatus`
  still null; disjoint from "submission never completed", which is
  `peerlyIdentityId: null` and never even reached Peerly),
  PIN-verified-but-stalled (ENG-10795 case 3a:
  `peerlyCvStatus` `VERIFIED` + `peerlyProfileStatus` `pending` past a 20h
  floor — i.e. the pair observed across multiple scan slots, filtering
  out records still mid-PIN-flow), the two vendor-escalation
  mirror sections (ENG-10796 cases 2 and 3b — see below), and an awaiting-PIN
  > 7d nudge section that is reported but not counted as stuck. Sections cap
  > at 25 rows with an explicit `…and N more`.

### Vendor escalation into the shared Peerly channel (ENG-10796)

Cases 2 and 3b are Peerly-side stalls (CampaignVerify or the finalize step
can't complete on Peerly's end) — James at Peerly agreed we escalate these
directly into the shared Slack Connect channel
(`SlackChannel.sharedGoodpartyPeerly10Dlc`), on top of the internal report:

- **Case 2:** `peerlyCvStatus` `IN_REVIEW` for more than 3 business days.
- **Case 3b:** `peerlyCvStatus` `VERIFIED` and `peerlyProfileStatus`
  `waiting_to_finalize` (`PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE`) for
  more than 3 business days (CV token attached, `/approve` called, waiting
  on Peerly's own finalize confirmation).

Business-day math (`date-fns` `differenceInBusinessDays`, never calendar
days — a Friday stall must not read as escalatable by Monday) can't live in
the Prisma `where` clause, so `handleNightlyReport` fetches every
currently-`IN_REVIEW` / currently-`waiting_to_finalize` candidate (same
in-flight population the CV status scan polls) and applies the
>3-business-day floor in code.

**Once-only per stall**, mirroring the `pinSentDetectedAt` claim/rollback
pattern: an atomic `updateMany WHERE cvInReviewEscalatedAt IS NULL` (resp.
`finalizeStalledEscalatedAt`) claims the record _before_ the Slack post; only
a claim count of 1 posts. `SlackService.message` swallows delivery errors
and resolves `undefined` — a failed post rolls the claim back (scoped to the
exact timestamp written) so the next nightly run retries. Escalation runs
_after_ the internal report posts, so a first-night detection can render as
"escalation pending" in the mirror section before the claim lands.

**Reset on progress:** the CV status scan's persist writes
(`CvStatusPollService`) that advance `peerlyCvStatus`/`peerlyProfileStatus`
also clear the matching escalation column, but only when the _previous_
stored value was the escalatable one (`IN_REVIEW` / `waiting_to_finalize`) —
i.e. only when the record is actually leaving that state. A later re-stall
is a new incident and re-escalates. The PIN-entry path's VERIFIED stamp
clears `cvInReviewEscalatedAt` the same way.

**Vendor-appropriate content only:** the Slack message carries the Peerly
identity ID, committee name, which state it's stuck in, and since-when
(date + business-day count) — never the candidate's email/phone, no
internal campaign IDs, no gp-admin links.

**Internal mirror:** two more report sections ("Escalated to Peerly: CV
IN_REVIEW >3 business days" / "... waiting_to_finalize >3 business days")
list the same escalation-eligible set every night while still stuck, each
line suffixed `(escalated <date>)` from the claim column, or
`escalation pending` if the claim is still null. They count toward the
header's stuck total.

## `submitToPeerlyForAgent` notes

- **No request body — every Peerly field comes from the persisted record.**
  `submit-to-peerly` takes no `@Body`; gp-api sources `ein`, `committeeName`,
  `filingUrl`, `email`, `phone`, `officeLevel`, `committeeType`, and `fecCommitteeId`
  off the persisted `TcrCompliance` row, and the website host off the campaign's
  registered `Domain.name`. The agent only supplies the campaign context (resolved by
  `@UseCampaign`), matching what the `compliance_setup` instruction already promises
  ("gp-api reads the candidate's data itself"). This is the ENG-10640 fix: the DTO used
  to carry these fields and the handler trusted the agent's values, which is how
  `goodparty.org/candidate/...` filing URLs reached CampaignVerify. Don't reintroduce a
  request body that feeds these fields.
- **Stage gate:** rejects with 422 unless the derived compliance stage is `awaiting_pin`
  (domain registered + site published & verified live). The `@McpTool` description names
  this precondition and the route enforces it — keep them in sync.
- **Pre-Peerly claim** on `peerlySubmissionStartedAt` (TTL'd) serializes concurrent
  callers; rollback scoped to the exact claim timestamp.
- **Idempotent:** a record that already has a `peerlyIdentityId` returns the existing
  response without re-submitting. The response is built from the **persisted record**
  (`buildSubmitToPeerlyResponse`), so a retry can't misreport state.
- Federal office requires a valid `fecCommitteeId`, re-enforced here against the
  persisted value (the agent can't resolve it reliably; staff may backfill it).
- **Peerly billing-outage hold (ENG-10653).** When Peerly's CampaignVerify `submit_cv`
  returns its unrecoverable billing error (`400` with `details.message` =
  `"No payment method available"`), `submitCampaignVerifyRequest`
  (`peerlyIdentity.service.ts`) detects it via `isPeerlyBillingError`
  (`utils/peerlyBillingError.util.ts`), fires a **distinct** Slack alert to
  `bot-10dlc-compliance` (separate from the generic per-identity error alert so a
  billing outage is recognizable), and throws `PeerlyBillingException` (a
  `BadGatewayException` subclass). `submitToPeerlyForAgent` catches it, stamps
  `TcrCompliance.peerlyBillingBlockedAt`, and on any subsequent call within
  `PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES` (6h) refuses with a `503` **before touching
  Peerly** — so an agent-resume / kickoff re-dispatch can't storm Peerly with the same
  deterministically-failing submission. After the cooldown it probes again (re-alerting
  if still failing); a successful submit clears the block. Only this billing signal is
  matched — normal transient 5xx still flow through `handleApiError` and retry.
- **CampaignVerify data rejections surface as 400, not 502.** Peerly proxies CV on
  `submit_cv`: a CV rejection comes back as HTTP 400 with
  `Error: "Campaign Verify API request failed."` and CV's own status echoed in the
  nested `status_code`. A nested 400 (e.g. `"FEC filing URLs are not allowed."`) is a
  deterministic data rejection — `isPeerlyCvRejection`
  (`utils/peerlyCvRejection.util.ts`) detects it and `submitCampaignVerifyRequest`
  throws `BadRequestException` carrying CV's parsed `details` reason. Before this, the
  generic handler wrapped it as a 502, which the compliance agent treats as transient:
  3 in-run retries (one Slack alert each) plus recovery-loop re-dispatch to the
  5-resume cap, then a FAILED run whose blocker said `peerly_transient` with no reason
  (campaign-325772 / campaign-75502, Jul 2026). A nested 5xx (CV itself down) still
  flows through the generic 502/transient path. The Slack alert still fires once per
  attempt; the 400 is what stops the retries.
- Strips leading `www.` from `Domain.name` so Peerly's brand `website`/`email` use the
  apex domain, matching the legacy `create()` path.
- **`filing_url` must be an official election filing.** CampaignVerify verifies the
  candidate against the URL, so a goodparty.org page or the candidate's own campaign
  site forces CV to contact the election authority by hand for the real filed contact
  info (the increased-mismatch delays Peerly reported after the agentic flow shipped —
  the agent was resolving `filing_url` to `goodparty.org/candidate/...` pages). The
  guard lives in two layers. `tcrComplianceSuperRefine` (`tcrComplianceBase.schema.ts`,
  via the exported `addFilingUrlIssues`) rejects any `goodparty.org` host / credentialed
  URL for the **create** callers (wizard, agentic-create) at write time, and (via
  `addNonFederalFecFilingUrlIssue`) any `fec.gov`-hosted URL for **non-federal**
  records — CampaignVerify rejects those outright with
  `"FEC filing URLs are not allowed."` (federal is the opposite: the create schema
  _requires_ an FEC.gov link). The **submit**
  path no longer has a request DTO, so it re-applies those same guards to the _persisted_
  `filingUrl` at submit time via `submitToPeerlyFilingSchema`
  (`submitToPeerlyDto.schema.ts`) — which takes the persisted `officeLevel` for the
  non-federal FEC check — plus an own-site check against the registered domain
  host — a record saved before the guard shipped (or via a path without it) can still
  carry a bad value, and it must 400 rather than reach Peerly (existing bad rows are a
  data-repair follow-up). All return 400 so the candidate's saved filing details must be
  corrected; the `submit-to-peerly` `@McpTool` description names this. Host matching uses
  `getUrlHostname` (`shared/util/strings.util.ts`), which lowercases and strips `www.`;
  match `goodparty.org` as `host === 'goodparty.org' || host.endsWith('.goodparty.org')`
  so a lookalike like `notgoodparty.org` is not caught. Two host-parse footguns are
  closed alongside: `getUrlProtocol` matches any scheme (so `ftp://goodparty.org/x`
  is not re-prefixed into `https://ftp://…`, which would parse host `ftp`), and
  `urlHasCredentials` rejects any URL with userinfo (so `https://goodparty.org@sos.gov`
  can't hide the guarded host before an `@`). The filing-URL _instructions_
  Peerly asked about (`filing_url_instructions` in `peerlyIdentity.service.ts`) are a
  separate, still-sent field — the mismatch was the URL value, not the instructions.

## Recovering a rejected record (`tcr_rejected`)

Three layers disagree about whether `rejected` is recoverable, and the disagreement
is load-bearing — read this before touching a rejected record.

| Layer                                                  | Treats `rejected` as | Where                                                           |
| ------------------------------------------------------ | -------------------- | --------------------------------------------------------------- |
| `createAgentic`                                        | retryable            | `error`/`rejected` → delete + recreate the row                  |
| Admin retry (`POST /v1/admin/agent-runs/:runId/retry`) | retryable            | queues a real run, 201, costs money                             |
| The `compliance_setup` agent                           | terminal             | `instruction.md` Step 1 — refuses to resubmit at `tcr_rejected` |

The agent is right to refuse: resubmitting an uncorrected record just re-fails and
spams CampaignVerify. But the record is not necessarily dead — the **operator**
recovery path is to correct the data and then clear the rejection. Until the
rejection is cleared there is nothing for a retry to do, so **the admin retry
endpoint refuses with 409 while the derived stage is `tcr_rejected`**
(`AdminAgentRunsService.retry`). It keys on the stage, not `status === 'rejected'`,
so `error` is covered too. Before that guard the retry silently succeeded, queued a
real run, and billed for it (~$0.43 on campaign 325819, Aug 2026) — the run read the
state, wrote `stage: "failed"`, and exited indistinguishably from a real failure.

**Correcting the data is not sufficient.** `deriveComplianceStage` maps both
`rejected` and `error` to `tcr_rejected` _before_ any domain/website check, and
`submitToPeerlyForAgent` gates on stage `awaiting_pin`. So a record with a fixed
`filingUrl` still derives `tcr_rejected` and still can't submit. The status has to
move too.

Which recovery applies depends entirely on `peerlyIdentityId`:

| `peerlyIdentityId` | What happened                                                                                                                                                                                                | Recoverable by us                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NULL               | CV rejected the submission synchronously (`PeerlyCvRejectionException`, `rejection_source: cv_submit`). The rollback stamped `rejected` and never persisted the identity, so no CV request exists at Peerly. | **Yes.** Correct the data, then `status` → `submitted`. The next run re-walks the full submit: it finds the orphaned Peerly identity by `identity_name` and reuses it (no duplicate), and mints a fresh CV request with the corrected values.                                                                                                                                                                                                                                                                                                                     |
| set                | The CV was accepted at submit and later flipped `REJECTED`/`WITHDRAWN`; the CV status scan's `applyCvDetection` stamped `rejected` (`rejection_source: cv_status_check`). Or it's a legacy `create()`-path record.       | **No — a status flip is a no-op.** `submitToPeerlyForAgent` short-circuits on a non-null `peerlyIdentityId` and returns the persisted response without calling Peerly. Nulling the identity locally doesn't help either: the resubmit reuses the identity and then `getCampaignVerifyRequest` returns the existing rejected CV with a `verification_status`, so the helper **skips** CV submission and the corrected filing URL never reaches CampaignVerify. Escalate to Peerly (`SlackChannel.sharedGoodpartyPeerly10Dlc`) to withdraw/recreate the CV request. |

All three currently-`rejected` prod rows (Aug 2026) are the second kind. The
incident that produced this section (campaign 325819) was the first.

**The rejection reason is not on the record.** There is no reason column and
`ComplianceStateOutput` carries no `rejection_reason`. Read it from the
`ComplianceRejected` Segment event, the `bot-10dlc-compliance` Slack alert, or the
FAILED run's blocker `detail`.

**`peerlyCvStatus` reads null while `rejected`.** The CV status scan only
covers `submitted`/`pending`, and `resolvePeerlyCvState` only fires `retrieve_cv` at
`awaiting_pin` — so the compliance-state read shows `peerlyCvStatus: null` at
`tcr_rejected` no matter what Peerly thinks. After the reset flips the stage to
`awaiting_pin`, the same read _does_ hit Peerly: a live `REJECTED` coming back there
means the reset was wrong and this is the second row above.

Operator procedure, verification, and the exact SQL:
`packages/runbooks/books/recover-rejected-10dlc-compliance.md`. There is **no admin
endpoint that resets the status** — recovery is a direct DB write today.

## Peerly 10DLC finalization — always token-backed

The PIN flow ends by _finalizing_ the 10DLC brand so it reaches the carrier (MNO)
review queue. The one invariant that matters: **a brand must never be finalized
without a submitted Campaign Verify (CV) token.** A token-less finalization strands
the identity in Peerly's MNO queue and they have to clear it out by hand.

Peerly's state machine and the only correct sequence:

1. Candidate enters PIN → `verify_pin` moves the CV `APPROVED → VERIFIED` (one-shot;
   a `VERIFIED` CV rejects a re-entered PIN as invalid).
2. `create_cv_token` mints the token (only works once the CV is `VERIFIED`).
3. The token is submitted to the **brand**: `/approve` carries it in its body for a
   `pending` brand; `/submit` re-attaches it (and re-opens `finalized → pending`) when
   the brand was already finalized.
4. `GET /v2/tdlc/{id}/finalize` confirms the registration (mimics the email-link
   click) so it advances to MNO review. **`/finalize` carries no token of its own** —
   it only works correctly if step 3 already attached one.

`submitCampaignVerifyTokenToBrand` is the single code path to `/finalize`, and it
always runs `/approve` (or `/submit` + `/approve`) with a real token first, so the
auto-finalize is always token-backed. `approve10DLCBrand` **requires** a non-empty
token and throws `BadRequestException` otherwise — calling it with an empty token was
the original ENG-7508 bug (the old sweep finalized brands with `campaign_verify_token:
''`). Do not reintroduce an empty-token default.

**Never call `GET /finalize` directly on a brand** (e.g. during manual recovery)
unless you have _just_ attached a token via `/approve`/`/submit` — a bare finalize is
exactly the token-less finalization that pages Peerly. `verification_status: VERIFIED`
alone does **not** mean the brand has the token; the brand can sit at
`waiting_to_finalize` from an old empty-token `/approve` with no token attached.
Verify recovery worked by reading back `getProfile().profile.campaign_verify_token`.

## Gotchas

- **Legacy domains (bought before 2026-06-01) never got `registrantVerifiedAt`.**
  Purchase-time stamping only became universal then; the interim email-verification
  flow that would have stamped older rows was removed 2026-05-29, so ~300 registered
  prod domains carry a NULL stamp forever. `deriveComplianceStage` treats a domain
  created before that cutoff as registrant-verified (the registrant contact has
  always been the constant, ICANN-verified GoodParty identity) — without this, a
  legacy-domain candidate's Pro upgrade strands the agent at `pending_website_live`
  until the resume cap (campaign 304314, Jul 2026). Post-cutoff rows still require
  the stamp: for them NULL genuinely means the registrar purchase never completed.
- **PIN retry self-recovery:** `verify_pin` consumes the PIN once — it rejects an
  already-`VERIFIED` CV as an invalid PIN. So if a first PIN attempt verified the CV
  but a downstream Peerly step threw (stranding the record at `submitted`), a naive
  retry would dead-end with "Invalid PIN" forever. `retrieveCampaignVerifyToken`
  checks the CV status first and, when it is already `VERIFIED`, skips re-verifying
  and mints the token so the retry finishes the flow. Don't reintroduce an
  unconditional `verify_pin` call ahead of that check.
- **A rejected PIN is not an incident — it must not page `bot-10dlc-compliance`.**
  Peerly proxies CampaignVerify on `verify_pin` and `resend_pin` and collapses CV's
  answer into HTTP 400 with CV's own status nested in `status_code` — the same
  envelope `isPeerlyCvRejection` reads on `submit_cv`. A nested 4xx is CV declining
  the request: a wrong or expired code on `verify_pin`, or a resend CV won't repeat
  yet on `resend_pin` (it refuses within 10 days of a mailed PIN). Both are ordinary
  outcomes of the flow, and the candidate or staff member who triggered it already
  sees the failure in the response, so `isPeerlyCvPinRejection`
  (`utils/peerlyCvPinRejection.util.ts`) passes `suppressSlackAlert` on those two
  paths. Every one of these used to fire the generic 🚨 error alert, which is what
  made the channel unreadable — one wrong digit from a candidate looked identical to
  a vendor outage. A nested **5xx** (CV itself down) and any non-CV Peerly 400 still
  alert. The HTTP status the caller gets is unchanged; only the alert is suppressed.
- **The 🚨 error alert carries the request line and Peerly's response body — nothing
  else.** `sendSlackErrorNotification` (`vendors/peerly/services/peerlyIdentity.service.ts`)
  passes `requestSummary` (`METHOD url → status`) and the parsed `response.data` into
  `buildPeerlySlackErrorMessage`; a non-Axios failure falls back to the error message.
  An object body is pretty-printed and rendered in a `rich_text_preformatted` block
  (a plain rich-text section collapses the indentation); a body that is already a
  string — Peerly's gateway errors return HTML — passes through as-is, and an
  oversized one is cut at 1500 chars with a `… (truncated)` marker so Slack doesn't
  silently drop the tail.
  It used to `JSON.stringify` the whole serialized Axios error, which posted
  `config.headers.Authorization` — a live Peerly bearer token — plus the request body
  (the candidate's CV PIN in cleartext) into `bot-10dlc-compliance` on every alert.
  Never widen this payload back to the error object, `config`, headers, or a stack;
  `peerlyIdentity.service.test.ts` asserts the rendered blocks contain no
  `Authorization`. Grafana logs still get the full formatted error — that's fine,
  they're access-controlled; Slack is not.
- **PIN screen is gated on the live Peerly CV status (ENG-10654):**
  `deriveComplianceStage` still returns `awaiting_pin` from the DB `status` alone (a
  `submitted` record with a live site) — that stage value is unchanged because
  `submitToPeerlyForAgent`'s gate depends on it. What changed is that
  `findStateForCampaign` now also resolves the _live_ CV status into
  `ComplianceStateOutput.peerlyCvStatus`, and only at the `awaiting_pin` stage (so the
  extra Peerly `retrieve_cv` read stays off the other stages the agent polls). The FE
  (`ProUpgrade3Compliance.tsx`) shows the PIN-entry box only when `peerlyCvStatus` is
  `APPROVED`/`VERIFIED`; for `REQUESTED`/`IN_REVIEW`/`null` (Peerly hasn't issued a PIN
  yet) it shows a "verification in progress" state instead. `resolvePeerlyCvState`
  short-circuits to `APPROVED` in non-prod (Peerly is stubbed there, mirroring
  `retrieveCampaignVerifyToken`'s bypass) so testers still reach the PIN screen, and
  parses Peerly's status defensively so an unrecognized value degrades to the
  in-progress state rather than 500ing the read.
- **PIN delivery channel is surfaced live + to HubSpot (ENG-10658):**
  `resolvePeerlyCvState` uses one `retrieveCampaignVerifyDetails` call (enriched
  `retrieve_cv`) to return both `peerlyCvStatus` and `ComplianceStateOutput.pinDelivery`
  (`{ method, displayString } | null`) at `awaiting_pin`. `displayString` is
  **masked server-side** (`maskPinDeliveryDestination`) — the raw filing
  email/phone is redacted and the postal address dropped, so the unredacted
  destination never crosses the wire (the raw value stays on the DB record). The
  FE PIN screen composes the "we sent your PIN…" copy from it; `null` (method
  absent or unrecognized, or non-prod) falls back to the generic copy. Persisting the channel +
  firing the `CompliancePinSent` event is the CV status scan's
  `applyCvDetection` job (see its section above), **not** this read — the read only
  displays, so a candidate who never opens the app is still detected + nudged.
- **A `rejected` record is not necessarily dead, and the admin Retry button is a
  silent no-op on one** — see "Recovering a rejected record" above before touching
  one.
- **`createAgentic` retries:** an existing record in `error`/`rejected` is retryable
  (deleted + recreated in one serializable tx); any other existing status returns the
  current record with `created: false`.
- **Non-prod short-circuit:** `submitCampaignVerifyToken` / Peerly approval are
  short-circuited when `OTEL_SERVICE_ENVIRONMENT !== 'prod'`, and `submit-cv-pin` accepts
  a bypass token — so testers can walk the flow without a real Peerly PIN. Status
  advancement guards on this so a non-prod record isn't promoted for a usecase that
  doesn't exist.
- **Process-crash gap:** a crash _between_ the `kickoffSentAt` claim and the SQS send
  leaves `kickoffSentAt` set with no message sent (not swept) — same narrow risk profile
  as the other claim patterns; accepted.
- This is a sub-feature dir wired into `CampaignsModule`, not its own Nest module (see
  `src/campaigns/CLAUDE.md`).

## Related

- `packages/gp-webapp/app/dashboard/pro-upgrade/CLAUDE.md` — the wizard that feeds these endpoints.
- `src/payments/CLAUDE.md` — the `checkout.session.completed` webhook that triggers deferred dispatch.
- `src/queue/CLAUDE.md` — the FIFO consumer that runs `handleAgenticKickoff`.
- `src/agentExperiments/CLAUDE.md` — `dispatchRun` and the experiment-run lifecycle.
- `packages/runbooks/books/recover-rejected-10dlc-compliance.md` — the operator
  procedure for clearing a rejected record.
- Epic plan (local): `~/.claude/plans/86ah2ezny-plan.md` — full task-by-task history.
