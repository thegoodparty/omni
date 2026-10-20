# Robocall payment (hold + run-window settlement)

<!-- Moved verbatim from outreach/AGENTS.md so the auto-loaded AGENTS.md stays small. Edit here. -->

Robocall billing is a hold-then-capture model: authorize a hold on the estimate
before the call dials, then — once the run window has elapsed — capture the FULL
authorized estimate. CallHub cannot report a per-campaign connected-call count
(`credits_usage` is account-wide, not per-broadcast), so a run is NOT settled on
a vendor count. Instead the completion sweep settles on TIME: `ROBOCALL_RUN_HOURS`
(48h) after the dial (or sooner if the hold nears its `captureBefore`), the calls
have had their chance and the run is billed for the full estimate the hold was
placed for. Every money figure is `calcRobocallTotalInCents` = per-call cost
(`calcRobocallAmountInCents`) + the flat `ROBOCALL_NUMBER_FEE_CENTS` ($2) rental
for the outgoing caller-ID number. The $2 fee is part of the estimate and IS
charged for any run that dialed. `POST /outreach/robocall`
(`OutreachRobocallService.createDraft`) is the foundation — it persists the
`pending_payment` spine + `OutreachRobocall` satellite and returns the
server-derived estimate. The satellite's `settleState` (`RobocallSettleState`
enum: `pending_payment → hold_pending → authorized → settling → capturing →
captured|charged`, plus the `hold_failed` decline terminal, the `send_failed`
terminal (a PERMANENT staging/dial failure BEFORE any phone was dialed — the
hold is voided, no money moves; distinct from `uncollectable`, which is a
DELIVERED run we could not capture and may still owe), and the
`voided|cancelled|disputed|uncollectable` terminals) tracks the lifecycle, and
the satellite carries the Stripe (customer / payment-method / authorization &
charge intent / captured amount) and CallHub (campaign / dial-window) fields the
later slices fill. A `draft` settleState sits outside that chain: it pairs with a
spine `draft` and has no schedule, no hold and no billing, and every sweep above
filters on its own settle state, so a draft is invisible to all of them.
`billableCount` / `amountInCents` are therefore NULLABLE and null exactly while
the spine is `draft` — billing is derived at resume, when the candidate schedules
and pays — so every read of them outside the draft path guards on null.

**Hold placement (pay time).** `POST /outreach/robocall/:outreachId/authorize`
(`OutreachRobocallHoldService.authorizeHold`, Pro-gated + campaign-scoped like
the siblings; body `{ paymentMethodId }`) places the manual-capture Stripe hold.
This RESERVES REAL MONEY. Invariants, in order:

- **Window.** If the send (`Outreach.date`) is more than
  `ROBOCALL_HOLD_WINDOW_DAYS` (3) out, return `deferred` and place NO hold, but
  first validate the chosen card the same way the immediate path does
  (`ensureCustomer` → `retrievePaymentMethod` → `pm.customer` match →
  `type === 'card'`; a bad PM throws 400/502 and persists nothing) and persist
  `paymentMethodId` + `stripeCustomerId` onto the still-`pending_payment` draft
  so the deferred sweep bills exactly that card. The persist is a CAS
  (`updateMany` guarded on `settleState = pending_payment`): after the two async
  Stripe validations a concurrent reschedule-into-window + placement could have
  advanced the row, and the guard means the chosen card is never written onto an
  already-`authorized` row. When that CAS matches 0 rows (the row advanced under
  us), the response reports the row's live state via `currentStateResult` rather
  than a stale `deferred` that would tell the client no hold exists when one
  does. This stores WHICH card to later charge — no hold, no money moved. The daily deferred sweep
  (`outreachRobocallDeferredHold.service.ts`) places it once the send enters the
  window, calling `authorizeHold` with NO paymentMethodId so it re-reads the
  row's persisted card AFTER winning the placement claim (never a pre-claim
  snapshot a concurrent re-authorize could have replaced). The window must be strictly under `auth_lifetime − run − settle`
  (`~7d − 48h − 24h = 4d`) so a window-edge send still clears the capture-window
  fit below; 3 days (3d + 72h = 6d) fits even a `capture_before` that lands under
  a full 7 days.
- **Placement CAS + idempotency.** A conditional `updateMany`
  (`pending_payment` + `authorizationIntentId IS NULL → hold_pending`) elects a
  single placer; count 0 means a concurrent placer won or the draft already
  advanced → return the current state (`authorized` echoes the frozen amount,
  else `noop`), no hold. The Stripe hold uses idempotency key
  `robocall-hold-<customerId>-<outreachId>-<attempt>` (attempt = `payAttempt + 1`;
  the Stripe customer keeps it unique across PR previews, which share one Stripe
  test account but each restart outreach ids at 1), and the
  Stripe calls run OUTSIDE any DB transaction. A second conditional `updateMany`
  (`hold_pending → authorized`) commits the intent id / frozen
  `authorizedAmountInCents` / `captureBefore` / `paymentMethodId` /
  `stripeCustomerId` / `payAttempt`; if it finds nothing (the draft moved
  mid-placement) the just-placed hold is voided. That commit ALSO nulls
  `callhubCampaignPkStr` / `callhubStartingDate` / `callhubExpirationDate`: a
  (re)authorization re-derives the billable count, so any previously-staged
  campaign (a `hold_failed` re-auth) is invalidated — clearing the fields forces
  the staging sweep (`callhubCampaignPkStr IS NULL`) to re-stage a phonebook
  matching the new count, so billed amount and dialed audience can't diverge. On
  a first authorize these are already null (a no-op); the orphaned PAUSED campaign
  charges nothing and is recorded (best-effort) in `RobocallOrphanedCampaign` so
  the CallHub cleanup sweep ABORTs it.
- **INV-2 sanity cap.** The re-derived estimate over
  `ROBOCALL_PER_RUN_CEILING_CENTS` ($10,000) reverts `hold_pending →
pending_payment`, logs `error` (human alert), and 409s — no hold. It backstops
  an anomalous/runaway estimate (a count or pricing bug); the 100k-contact
  audience cap tops out around $4,500, so a legitimate run clears it.
- **Decline vs infra.** A declined card is `StripeHoldDeclinedError` from
  `createManualCaptureHold` → `hold_pending → hold_failed`, `payAttempt++`, a
  `HoldFailed` milestone, and a `hold_failed` result (NOT a 502). A confirmed PI
  that did NOT land in `requires_capture` (e.g. `requires_action`, returned
  without throwing) is also treated as a decline — "verify before stamping
  state", never authorize on a non-holding PI. Any other Stripe failure is a 502
  that reverts `hold_pending → pending_payment` WITHOUT bumping `payAttempt` (key
  reuse recovers a possibly-live PI).
- **Capture-window fit.** `send + ROBOCALL_RUN_HOURS (48) +
ROBOCALL_SETTLE_MARGIN_HOURS (24)` must fit inside the hold's `capture_before`
  (parsed from the Stripe response via `fromUnixTime`, falling back to now+7d);
  otherwise void the hold, revert, and 400 — a hold that expires before capture
  is unusable. This void-and-revert (and the lost-commit void) persists an
  incremented `payAttempt`, so a retry derives a FRESH idempotency key instead of
  idempotent-replaying the just-canceled PI. `voidHold` is best-effort (logs and
  returns on a Stripe error) so a failed void never strands the row in
  `hold_pending`; the intent id is recorded in `RobocallOrphanedHold` so the
  hold-reconcile sweep confirms and re-voids it (and it auto-expires within the
  auth lifetime).
- **Milestones.** `EVENTS.Robocall.HoldPlaced` / `HoldFailed`, emitted ONLY from
  the winning transition via `AnalyticsService.track` with a deterministic
  Segment messageId (`<outreachId>:hold_placed` / `<outreachId>:hold_failed`) so
  a replay dedups to one email. The emit is best-effort (a Segment failure logs,
  does not rethrow) — the money op already committed, so a lost email must not
  500 the request onto the noop path. The send slice fires `HoldFailed` a second
  legitimate time when a hold is found dead AT DIAL, under a distinct messageId
  (`<id>:hold_failed_at_dial`). `EVENTS.Robocall.SendFailed` (messageId
  `<id>:send_failed`) is the send-failure email — emitted the same best-effort,
  deterministic way from `failSend` when a PERMANENT staging/dial failure surfaces
  (see "Send failures" below). Capture/deferred-sweep/reminder-retry-cancel are
  later slices. Every one of these milestones (plus Scheduled, Reminder,
  Canceled, and Receipt elsewhere in this file) is delivered to the candidate
  by a HubSpot workflow keyed on the Segment event — there is no per-event
  single-send email leg.
- **Cross-channel send terminal.** `EVENTS.Outreach.CampaignScheduled`
  (`Voter Outreach - Campaign Scheduled`, `channel: 'robocall'`, messageId
  `<outreachId>:campaign_scheduled`, DATA-2526), emitted from the authorize
  COMMIT and from `scheduleCoveredRun` — **not** from `scheduleSpineAndNotify`.
  That distinction is load-bearing: the deferred card-save path advances the
  spine before any hold exists, so gating on the spine transition emitted for an
  unpaid row AND left the deferred sweep's real commit finding the spine already
  `pending`, dropping the event entirely. Keep it on the money commit.
  `recipientCount` is the count the authorization was PRICED on, passed in by
  the caller — `OutreachRobocall.billableCount` is the draft-time snapshot that
  authorize re-derives and never persists, so reading it back would report a
  number nobody was charged for. No HubSpot leg — this exists to answer "how many
  candidates committed a send, by channel?" across sms/robocall/social in ONE
  event, so do not add a per-channel twin. It is NOT a double-fire with
  `Robocall - Scheduled`, which fires earlier, at draft-create, on a still-unpaid
  row. **It is not exactly-once per outreach:** a hold that lapses before dial
  resets the row to `hold_failed`, and a new-card re-authorize commits and emits
  again under the same messageId, days later and outside Segment's ~24h dedup
  window — one send commitment, retried, which downstream collapses on
  `outreachId`. The sms and social emits live in `outreach.service.ts`
  (`finalizeOutreachPurchase`) and `outreachSocial.service.ts`
  (`saveSocialOutreach`, Win only).

**Send (dial time).** `OutreachRobocallSendService.startCampaign` STARTs a
staged, still-paid draft's PAUSED CallHub campaign — the step that DIALS REAL
PHONES — behind two absolute invariants:

- **Never dial twice.** A single-owner dial claim CAS (`authorized` AND
  `callhubCampaignPkStr IS NOT NULL → dialing`) elects one dialer; count 0 (a row
  already `dialing`/`dialed`, or not yet staged) returns. A launch commits `dialed`
  ONLY when its response reads back status `START` — a 200 that echoes PAUSE / null
  / `{}` (all valid under the nullish response schema) is NOT trusted, and routes
  through the same reconcile path below rather than blindly stamping `dialed` on a
  still-PAUSED campaign. On a verified START the commit CAS (`dialing → dialed`,
  stamping `dialedAt`) records it. **A lost launch response is never blind-retried**
  — a re-sent START could re-dial the whole audience if the first PUT reached
  CallHub. A lost response OR a non-STARTED 200 reconciles against a fresh
  `CallhubCampaignReportService.getCampaignStatus(pkStr)` read: **STARTED** → the
  dial happened → commit `dialed` (idempotent); **PAUSED** → it did not → revert
  `dialing → authorized`, safe to relaunch next sweep; **read-fail or any other
  status** → LEAVE the row in `dialing` (never relaunch without a PAUSED read,
  never mark dialed without a STARTED read) for the stale-dialing sweep, and
  alert — UNLESS the launch error was a `CallhubPermanentError`, in which case
  even a failed read resolves to `failSend(outreachId, 'send')`: a definitive 4xx
  guarantees the campaign never STARTED. The permanent path first persists a
  `permanentSendFailure` marker (a best-effort CAS on the `dialing` row) BEFORE
  calling `failSend`, so if `failSend` itself cannot commit (a transient DB error
  mid-fail) the row stays `dialing` carrying the marker, and the stale-dialing
  sweep reads it and re-enters the permanent path (fail, not revert). Without the
  marker the sweep would reconcile that strand WITHOUT the permanent flag — a
  PAUSED read would revert it to `authorized` and relaunch into the same reject
  forever. If the marker write ALSO fails the row simply retries next stale pass
  (a fresh launch re-derives permanence), so it converges. A commit-miss (the draft moved underneath) means the campaign may be
  dialing with no `dialed` record — logged CRITICAL with the pk_str; no safe
  un-dial, so no un-launch is attempted. A crash between the claim and the
  commit/revert strands the row in `dialing`; the sweep recovers it (below).
- **Never dial unpaid.** AFTER winning the claim and BEFORE the launch, a FRESH
  `StripeService.retrievePaymentIntent(authorizationIntentId)` must read
  `status === 'requires_capture'` (the manual-capture hold still live and
  uncaptured). The persisted state is NOT trusted. If the hold is not live
  (expired / canceled / already captured, or no intent recorded) the draft goes
  to `hold_failed` **with `authorizationIntentId` / `authorizedAmountInCents` /
  `captureBefore` cleared** — the campaign was never launched in this branch, so
  a later re-auth + re-dial of the still-PAUSED staged campaign is safe, and the
  null intent lets the hold service's new-card retry CAS (`authorizationIntentId
IS NULL`) re-pick it (`hold_failed` is reached from two paths — card decline at
  authorize, dead hold at dial — and both now leave a null intent). Error-logged,
  and it emits the `HoldFailed` milestone (best-effort, deterministic messageId
  `<id>:hold_failed_at_dial` — distinct from the authorize-time
  `<id>:hold_failed` so both fire once) so the candidate, absent when the sweep
  runs, gets the "update your card" email. It does NOT dial.

`CallhubCampaignService.launchVoiceBroadcast(pkStr)` (the `PUT
/v1/voice_broadcasts/{pk_str}/` `status: 1` START — pk_str a STRING end-to-end)
runs OUTSIDE any DB transaction; a Stripe-read failure BEFORE the launch reverts
`dialing → authorized` and rethrows (nothing dialed). A compliance-pass gate is
ANDed with the live-hold check: after the claim + hold re-read and BEFORE the
launch, a draft whose `compliancePassedAt` is null (impossible in practice — the
create gate requires a passing `RobocallComplianceResult` and stamps it — so this
is a belt-and-suspenders backstop against a crafted write) reverts the claim to
`authorized`, does NOT dial, and logs a CRITICAL alert. The `@Cron` send sweep (`4,14,24,34,44,54 * * * *`,
`EASTERN_TIMEZONE`, **prod-only**; no
`CronLockService` — the per-record claims are idempotent across replicas) dials
`authorized` + staged arrived drafts (per-record `try`/`catch`) AND recovers rows
stranded in `dialing` past `ROBOCALL_DIALING_STALE_MINUTES` — a stale-guarded
reclaim CAS elects one recoverer, which reconciles via the same status read
(STARTED → `dialed`, PAUSED → `authorized`, else left `dialing`). It READS the
hold only — no capture/void, no CallHub completion poll.

**Serial queue (serial-send phases 2+3, on the merged dial-completion
estimator).** CallHub's account calls/min pool is SHARED across every running
voice-broadcast campaign, so two dialing at once contend and the second's START
400s `over_cps_limit` (incident 2026-10-08). The sweep therefore runs STRICTLY
SERIAL — at most ONE robocall dials at a time — in four ordered steps:

1. **Free-and-advance** (`freeCompletedDialingRuns`): for every `dialed` run with
   `poolFreedAt` null that the COMPLETION SEAM reports DONE, ABORT its CallHub
   campaign (`abortVoiceBroadcast`, best-effort) to release the shared pool slot,
   then stamp `poolFreedAt`. The abort is OPERATIONAL ONLY: it frees the pool and
   NEVER touches money or `settleState`. The run stays `dialed`, and SETTLEMENT IS
   UNCHANGED — the completion sweep still settles + captures the full authorized
   estimate at `dialedAt + 48h`, its own best-effort abort then a harmless no-op on
   the already-aborted campaign. `poolFreedAt` is stamped only on a CLEAN abort, so
   a transient CallHub failure leaves the run unfreed — the queue stays blocked, the
   money-safe direction — to retry next pass, and an already-freed run is never
   re-aborted (which would spam the rate-limited API for ~48h).
2. **Deadlock backstop** (`forceFailDeadlockedDialing`): force-fail (via the
   existing `failSend(outreachId, 'send')` path) any run stuck in `dialing` past
   `ROBOCALL_DIALING_DEADLOCK_MINUTES` (env, default 360 = 6h), measured from the
   STABLE `dialingStartedAt` — see the backstop note below.
3. **Serial gate** (`hasRunInFlight`): if any run is "in flight" — a `dialing`
   claim, or a `dialed` run with `poolFreedAt` still null (estimated-still-dialing)
   — launch NOTHING this pass (`take: 0`); the pool belongs to it. Bias toward NOT
   launching when unsure: a transient `dialing` row blocks until stale recovery (or
   the deadlock backstop) resolves it, and if the gate ever let two overlap the
   second just `over_cps_limit`s and reverts, losing no calls.
4. **Launch** the single oldest-due `authorized` + staged run (`date` then
   `outreachId`, a total order so both replicas pick the identical row), then
   stale-dialing recovery (always).

`ROBOCALL_SEND_MAX_PER_SWEEP` (env) is kept ONLY as the kill-switch — `0` selects
no rows, pausing every launch with no deploy — capped at one per pass by the serial
gate (`take: Math.min(max, 1)`). `ROBOCALL_SEND_LAUNCH_SPACING_MS` and the in-pass
`over_cps_limit` BREAK are retained as a DEFENSIVE multi-launch safety net (only one
run launches per pass, so neither normally fires); `startCampaign`'s own throttle
revert — a START CallHub throttles reverts the run to `authorized`, never lost —
stays the real self-correction.

**The completion seam (`isDoneDialing`) — correctness does NOT depend on serial.**
CallHub reports no per-campaign dial-progress signal, so the free step asks ONE
thing — `isDoneDialing(dialedRun) → { done, source }` — and does not care HOW
completion is known. It has one wired signal, the money-SAFE floor:

- **Estimate floor (always available, serial OR concurrent).** The merged
  `estimateRobocallDialCompletion({ audienceSize: billableCount, callsPerMinute:
safeRate, startAt: dialedAt })` + `ROBOCALL_DIAL_ESTIMATE_BUFFER_MINUTES` (env,
  default 30), where `safeRate = floor(configuredRate /
ROBOCALL_DIAL_SAFETY_RATE_DIVISOR)` (env divisor, default 2) and `configuredRate
= CallhubCampaignService.getConfiguredCallsPerMinute()` — the SAME source
  `createVoiceBroadcast` dials at. The floor reports done ONLY when the campaign is
  SURELY finished, so it can NEVER abort a still-dialing run; it does not depend on
  the serial model. `source: 'estimate'`.
- **Count speedup (serial-ONLY, CURRENTLY DEFERRED).** When exactly ONE robocall is
  in flight, an account-wide CallHub voice-call count delta would confirm done
  immediately (no dead buffer): snapshot the count at dial start and free once
  `current − snapshot >= billableCount`. It is valid ONLY with exactly one run
  dialing (otherwise the account-wide delta is not attributable — fall through to
  the floor). It is NOT wired: the prior per-campaign `credits_usage` read turned
  out ACCOUNT-WIDE and omitted a required `start_date`, and its field semantics are
  unverified against a real completed run, so wiring it onto the abort decision is a
  money risk we did not take. The extension point is the marked comment in
  `isDoneDialing` plus the `source: 'count'` arm of the `DialCompletion` type; the
  system is correct-but-slower on the floor alone until a reliable account-wide read
  (or a true per-campaign CDR signal) replaces it. Swapping it in is a localized
  change behind the seam — nothing else moves.

**Money-safe floor rationale.** The one real risk of the early free is aborting a
run STILL dialing while the 48h capture charges full (under-delivery + full
charge). The real dial can run SLOWER than the configured rate (vendor pacing,
AMD, retries), so a flat buffer alone runs short for a large audience. The floor
therefore WALKS the estimate at a RATE HAIRCUT (`configuredRate / divisor`, default
÷2, modeling a dial up to 2× slower CORRECTLY through the daily 09:00-21:00 window)
and adds the flat buffer on top — erring LONG by construction. (Started at ÷3;
lowered to ÷2 on 2026-10-15 because ÷3 held the pool ~3× the real dial time and,
one-run-at-a-time, stacked into multi-day backlogs that pushed sends overdue —
observed slowdowns are ~1.5-2×, so ÷2 keeps a safe margin. The durable fix is the
count speedup above, which removes the guess entirely.) The flat BUFFER was
lowered 180 → 30 the same day: at the full-pool 120/min rate the 180 dominated
the ceiling and over-held the pool for hours on a fast dial. It is safe to cut
because the up-to-2× slowdown is PROPORTIONAL to dial time and is already covered
by the ÷2 rate haircut, which scales with list size; the flat buffer need only
absorb startup/tail slack, which 30 does. Do NOT instead drop the divisor to 1
and lean on a flat pad — a constant pad under-covers a large list (a 2× slowdown
on a 7.5k-call run is ~60 min, more than any flat pad we'd set), which is the
early-abort the haircut exists to prevent. For a large audience
the ceiling can exceed the 48h settlement floor, in which case the completion sweep
settles first and the early free simply does not fire (correct, just not faster).

**R1 — the estimate reads the run's STAGED rate, not the live env.** The rate each
campaign is created with is FROZEN at stage time onto `OutreachRobocall.stagedCallsPerMinute`
(`createVoiceBroadcast` returns the `frequency` it stamped), and
`dialCompletionCeilingAt` walks the haircut over `run.stagedCallsPerMinute ??
getConfiguredCallsPerMinute()` — the live value is only the fallback for a run staged
before the freeze. So raising `CALLHUB_VB_CALLS_PER_MINUTE` for new campaigns can
NEVER shorten the ceiling for an in-flight run staged at the old (slower) rate, which
would have freed the pool / aborted it mid-dial while the 48h capture charges full. No
manual drain before a raise. The backlog projection resolves the same per-run rate.

**Deadlock backstop (finding 2).** A run is only transiently `dialing` (a launch
PUT + commit/reconcile, seconds); the real dial happens in `dialed`. A row still
`dialing` hours later is a launch whose CallHub status read never resolves —
stale-dialing recovery re-claims it every 15 min and keeps failing to resolve, so
without a backstop it blocks EVERY queued send up to 48h+. `forceFailDeadlockedDialing`
force-fails one stuck past `ROBOCALL_DIALING_DEADLOCK_MINUTES` (default 360 = 6h)
via `failSend(outreachId, 'send')`. The timer is the STABLE `dialingStartedAt`,
stamped at the dial claim and NEVER bumped by recovery's self-transition (which
bumps `@updatedAt`) — keying on `updatedAt` would let recovery reset the clock
forever. failSend VOIDS the hold: a run that may have dialed but whose status we
can never read is written off UN-billed (a loss to us, the candidate made whole)
rather than deadlocking the whole queue — the money-safe trade — and the recorded
orphan campaign is ABORTed by the cleanup sweep. 6h is ~24 stale-recovery attempts
and well past the 30-min overdue page that already alerts CAS; env-tunable (raise it
during a known CallHub status-read outage). A `dialing` row with NULL
`dialingStartedAt` (a pre-feature anomaly) is left to the overdue alert.

**Frequency.** `CALLHUB_VB_CALLS_PER_MINUTE` default is **120** — the whole
account pool (10 → 30 → 120 on 2026-10-15 as the serial model let the rate
climb; a live PATCH confirmed CallHub accepts 120 on a campaign). The serial gate
makes only one campaign dial at a time, so a single run can own the full pool and
never contends with our own others; it is SAFE for the estimate because R1 freezes
each run's staged rate (an in-flight run keeps its ceiling) and the completion
ceiling walks that frozen rate at the `ROBOCALL_DIAL_SAFETY_RATE_DIVISOR` ratio,
so a higher rate shortens a new run's estimate in step. The once-open caveat —
whether CallHub reserves the pool for merely-SCHEDULED (PAUSED) campaigns — was
resolved AGAINST by the Oct incident: leroy (#84864) ran at 60 while others sat
Paused at 60, so PAUSED campaigns do NOT consume the cap; only running ones do. A
stray `over_cps` self-heals via startCampaign's throttle revert; raising total
throughput ABOVE ~120 needs CallHub (support@callhub.io).

**Overdue alert (the Oct 8 silent-tail gap).**
`OutreachRobocallOverdueAlertService.sweepOverdueAlerts` (`@Cron`
`12,27,42,57 * * * *`, `EASTERN_TIMEZONE`, **prod-only**; no `CronLockService`)
pages CAS when a robocall is past its scheduled date and STILL has not dialed,
whatever the failure mode — closing the gap where a staged-but-stuck run dialed
nothing and nothing surfaced it. Condition: `Outreach.date` older than
`ROBOCALL_OVERDUE_GRACE_MINUTES` (30 — a run merely waiting for the next send
pass, or a backlog draining under the cap, is overdue-but-healthy, not stuck),
the satellite in an UNDIALED settle state (`authorized`, `staging`, or a
`dialing` row stuck oscillating because its stale-dialing recovery keeps
throwing — all have `dialedAt` null), `dialedAt IS NULL`, and the spine NOT
`canceled`/`failed`. CRITICALLY it matches STAGED rows (`callhubCampaignPkStr`
set) too — the exact silent tail the stranded sweep deliberately SKIPS (that one
matches only `callhubCampaignPkStr IS NULL`) — and the stuck-`dialing` tail no
other sweep pages.
It MOVES NO MONEY and touches no dial/hold/capture state: a single-owner CAS
guarded on a new nullable `OutreachRobocall.overdueAlertedAt IS NULL` (SEPARATE
from the dial claim) stamps the column and elects one alerter across replicas and
repeat passes, then posts a best-effort Slack line
(`OutreachNotificationService.notifyRobocallOverdue`, the `notifyRobocallLowCredit`
pattern) carrying campaign/outreach id, the scheduled date, how overdue, and the
current settle state. `overdueAlertedAt` is read by NOTHING but that dedupe, so
the alert can never abandon, double-dial, or strand/charge a hold.

**Proactive backlog alert (serial-send phase 4).**
`OutreachRobocallBacklogAlertService.sweepBacklogAlerts` (`@Cron`
`11,26,41,56 * * * *`, `EASTERN_TIMEZONE`, **prod-only**; no `CronLockService`)
warns CAS BEFORE a send is late, where the overdue alert above warns AFTER. The
serial queue dials one run at a time, so a backlog of earlier/bigger runs can
push a later run's dial past its scheduled DAY. The sweep projects when each
waiting run will actually dial — `projectRobocallDialQueue`
(`@/shared/util/robocallDialCompletion.util`) seeds the pool-free instant from
any in-flight run's money-safe completion ceiling (`robocallDialCeilingAt`, the
SAME ceiling the send sweep's free-and-advance frees a run at, reading the SAME
`ROBOCALL_DIAL_SAFETY_RATE_DIVISOR` + `ROBOCALL_DIAL_ESTIMATE_BUFFER_MINUTES`
env, so the projection matches the queue's real advance), then walks the waiting
runs — the EXACT set the send sweep launches from, `authorized` AND staged
(`callhubCampaignPkStr` set), so an un-staged run is never a phantom occupant —
in the SAME total order the send sweep launches (`date` then
`outreachId`), each starting at `max(pool-free, its schedule)` rolled to the
next 09:00-21:00 Central window open. A run is flagged delayed ONLY when its
projected dial day is LATER than the day it would dial with a FREE pool — so a
run scheduled after the daily window closes (which rolls to the next morning on
its own, independent of any backlog) is NOT paged; only a BACKLOG-caused slip
is. Already-due runs stay in the walk (they hold the pool ahead of future runs)
but only FUTURE runs are alerted — a past-due run is the overdue sweep's domain.
It MOVES NO MONEY and touches no dial/hold/capture state: a single-owner CAS
guarded on a new nullable `OutreachRobocall.backlogAlertedAt IS NULL` (SEPARATE
from the dial claim) stamps the column and elects one alerter across replicas
and repeat passes, then posts a best-effort Slack line
(`OutreachNotificationService.notifyRobocallBacklogDelayed`) carrying the
campaign/outreach id, the scheduled day, and the projected dial day.
`backlogAlertedAt` is read by NOTHING but that dedupe.

**Spine status on dial (no per-contact rows).** `commitDialed` — the one place
every path above converges to record a real dial — also best-effort advances the
spine `Outreach.status` `pending → in_progress` (CAS-guarded on `pending`, so it
is idempotent and never flips a canceled/failed row) after its `dialing → dialed`
CAS matches, so the history UI shows "Sending" during the run window instead of
staying "Scheduled". It fires from the happy launch AND from `reconcileDialing`'s
STARTED resolution (a lost-response or stale-dialing recovery that confirms the
dial). It does NOT write per-contact `ContactInteractionRobocall` rows: this
billing model does not know WHO was reached (CallHub reports no per-call
disposition, and the product's per-person feed for robocall is hidden), so a
robocall records only the aggregate audience/billable count on its
`OutreachRobocall` row (`billableCount`, `completedCallCount`) and never a
per-person feed entry. The failure path stays unchanged: `markSpineFailed →
failed` on a send failure. The spine reaches `completed` at successful capture
(see Capture below).

**Send failures (surface vs retry).** A CallHub error is only surfaced to the
candidate when it is PERMANENT — a request we can never make succeed by retrying
(a 4xx/validation reject: bad audio format, a malformed campaign, a rejected
launch). The signal is typed at the vendor layer: `CallhubErrorHandlingService`
throws `CallhubPermanentError` (a `BadGatewayException` subclass, still a 502
externally so no other caller's behavior changes) for a non-recoverable 4xx, and a
plain `BadGatewayException` for everything transient (401/408/429, 5xx, a lost
response). Permanence is decided by the status EXCEPT for the `detail` codes in
`RECOVERABLE_4XX_DETAILS`, which are recoverable conditions CallHub reports on an
otherwise-permanent status: `over_cps_limit`, its calls-per-second throttle,
arrives as a 400 rather than a 429 and is the same "ask again later" condition, so
it stays transient. That distinction is load-bearing here and nowhere else — a
throttle read as permanent voids the candidate's hold and discards a staged, paid,
compliance-passed run (outreachIds 83747 and 83982, 2026-09-29/30). A
second permanent shape is a `ZodError` parsing the CallHub response: a wrong
response shape a retry can never fix. Its dial-safety differs by slice. STAGING never
dials — it only creates a PAUSED campaign — so BOTH a 4xx (`CallhubPermanentError`)
AND a `createVoiceBroadcast` `ZodError` fail the send outright. SEND may have
dialed, so it never trusts an unparseable launch body alone: a launch `ZodError`
(`shape`) fails ONLY once the status reconcile CONFIRMS PAUSED (definitively never
dialed); on an unresolved status read it stays `dialing` (dial state unknown — a
live run must never be voided on a guess), whereas a 4xx (`permanent`) fails even
on an unresolved read since a rejected START never dialed. The send slice threads
this as a `LaunchOutcome` (`permanent` | `shape` | `transient`) into
`reconcileDialing`. Permanent →
`OutreachRobocallHoldService.failSend(outreachId, 'staging' | 'send')` and return
(no rethrow, no retry); transient → the existing revert-claim + rethrow so the
sweep retries next pass. `failSend` is the single surface path: a
single-owner CAS moves the satellite `authorized|staging|dialing → send_failed`
(count 0 → a concurrent winner already handled it, return), VOIDS the hold if one
is live (`StripeService.voidHold` best-effort + `RobocallOrphanedHoldService.record`
with reason `send_failed` so the reconcile sweep re-voids a missed release — NO
phone was dialed, so nothing is owed), records any staged PAUSED campaign
(`callhubCampaignPkStr`) in `RobocallOrphanedCampaign` (`reason: send_failed`,
best-effort) so the cleanup sweep ABORTs it rather than leaving it in CallHub,
flips the SPINE `Outreach.status → failed`
(guarded on `pending|pending_payment`, best-effort, like `markSpineScheduled`), and
emits `EVENTS.Robocall.SendFailed`. It logs a `CRITICAL robocall` line, which the
`win-robocall-critical` alert (`deploy/components/alerts.ts`) matches to page —
that alert fires on ANY `CRITICAL robocall` log across the send

- settlement chain (send_failed, uncollectable capture, dial
  commit-miss, ETag mismatch, orphaned-hold), so every exceptional path surfaces to
  ops. The SEND path fails only on a read that RULES OUT a dial: a confirmed PAUSED
  for either permanent kind, plus — for a definitive 4xx (`permanent`) only — an
  unresolved read too (a rejected START never dialed). A launch that reads STARTED
  still commits `dialed`, never `send_failed`, because a dialed run must never have
  its hold voided. `send_failed` is strictly pre-delivery — a DELIVERED run that
  cannot settle is never voided; it goes to `uncollectable` (money may be owed on
  a run that already dialed).

A third `failSend` caller is the stranded-`authorized` sweep
(`outreachRobocallStranded.service.ts`): a draft that reached `authorized` (hold
placed) but whose send passed WITHOUT ever staging (`callhubCampaignPkStr` still
NULL) is caught by no other sweep — the staging sweep only stages future sends,
the send sweep only dials staged drafts — so it would strand in `authorized`
forever with its hold reserved and the spine still "Scheduled". It calls
`failSend` with reason `expired_unstaged`, which surfaces only in the CRITICAL
log line — the voided-hold and orphaned-campaign records are still stamped
`send_failed`, like every other `failSend` path. It only releases the money (the
safe direction), which is why it is prod-only.

**Completion (run-window settlement).**
`OutreachRobocallCompletionService.sweepRobocallCompletion` is the read/record
half of settlement — NO money moves here. CallHub cannot report a per-campaign
connected-call count, so a `dialed` run is settled on TIME, not a vendor count: a
run whose `dialedAt` is at least `ROBOCALL_RUN_HOURS` (48h) in the past (OR whose
`captureBefore` is within `ROBOCALL_SETTLE_MARGIN_HOURS` (24h) of now, so a hold
never lapses uncaptured) is ready. `settle` best-effort STOPs the CallHub campaign
(`CallhubCampaignService.abortVoiceBroadcast` — cleanup only: a stop failure,
including a permanent 404 CallHub treats as already-retired, is logged and NEVER
blocks settlement or money, and is not retried once the row leaves `dialed`), then
a single-owner CAS `dialed → settling` records `completedCallCount = billableCount`
(the persisted server-derived audience count the hold was priced from) so the
capture slice bills the FULL authorized estimate. Only hold-model runs settle here:
the candidate filter requires `authorizationIntentId IS NOT NULL`, so an
estimate-billed `paid`/`dialed` run (charged upfront, no hold) never enters
settling/capturing, which would try to capture a non-existent hold and
double-charge. `@Cron` (`9,19,…`, `EASTERN_TIMEZONE`), **prod-only** (a rate-limited
vendor stop; it moves no money — the per-record CAS is
its only write); no `CronLockService`.

**Capture (settlement).** `OutreachRobocallCaptureService.captureDraft` captures
the authorization hold once the completion sweep parks the run in `settling` with
`completedCallCount` set to the full billable count. It captures
`authorizedAmountInCents` DIRECTLY — the estimate that was held on the card and
quoted to the candidate — so the captured amount is independent of any count.
`authorizedAmountInCents` is re-derived from a FRESH `deriveBillableCount` at
AUTHORIZE time, up to ~82 days after the draft-time `billableCount` snapshot
(→ `completedCallCount`); the two diverge if the audience grows in that gap, so
capturing the authorization amount (NOT `min(calc(count), authorized)`, which
would undercharge below the hold) is what removes the count-drift dependence.
INV-1 holds by equality — the captured amount IS the hold. This MOVES REAL MONEY.
Invariants:

- **Single-owner claim.** A conditional `updateMany` (`settling → capturing`)
  elects one capturer; count 0 (a concurrent winner, or an already-advanced row)
  returns. Every branch below moves the row OUT of `capturing` (to a terminal, or
  back to `settling` to retry) so it never strands.
- **Verify before charging.** A FRESH `StripeService.retrievePaymentIntent` read
  AFTER the claim decides the branch — the persisted state is never trusted to
  move money. `requires_capture` → capture; `succeeded` → the hold was already
  captured (a prior run that lost its DB commit), so reconcile to `captured` off
  `amount_received` withOUT capturing again; anything else (`canceled` / expired)
  on a NON-zero run → the hold lapsed and the delivered run is uncapturable →
  `uncollectable` + CRITICAL alert (never blind-charge a fresh PI here;
  `OutreachRobocallFreshChargeService` recovers it with a fresh off-session charge
  — see "Fresh-charge recovery" below). A gone hold on a ZERO-CONNECTED run is
  released to `voided`, no CRITICAL: a run that connected zero calls owes
  nothing, so a lapsed hold is the expected outcome, not a chase target (the
  guard is the CALLS-only amount, which is 0 only for a zero-connected run).
  A transient read/capture failure reverts `capturing → settling` to retry — no
  money moved.
- **INV-1 (never overbill).** For a run with at least one connected call, the
  captured amount is `authorizedAmountInCents` directly — the estimate held and
  quoted — so it equals the hold and can never exceed it. Capturing the
  count-derived `calcRobocallTotalInCents(completedCallCount)` would UNDERcharge:
  the draft-time `billableCount` (→ `completedCallCount`) can be smaller than the
  authorize-time basis when the audience grows in the draft→authorize gap. The
  `completedCallCount == 0` void path is DEFENSIVE-ONLY: completion sets the count
  to `billableCount`, which `assertReachableCount` guarantees is > 0 at draft, so
  a real settling run always captures the full estimate and never voids on a zero
  count. The capture idempotency key is stable (`robocall-capture-<outreachId>`,
  the amount being deterministic per run) so a lost response replays instead of
  double-charging.
- **Receipt + terminal.** The commit CAS (`capturing → captured`) stamps
  `capturedAmountInCents`, best-effort advances the spine `Outreach.status →
completed` (CAS-guarded on `pending`/`in_progress`, so the history UI shows
  "Completed" and it never flips a canceled/failed/already-completed row), and
  emits `EVENTS.Robocall.Receipt` once (deterministic messageId
  `<outreachId>:receipt`, best-effort — the capture already committed).
- **No-strand recovery.** A crash between the Stripe capture and the DB commit
  would strand the row in `capturing` with money taken — invisible to the
  `settling` claim. A second sweep pass reclaims rows stuck in `capturing` past
  `ROBOCALL_CAPTURING_STALE_MINUTES` (15) via a stale-guarded self-transition CAS
  (writing `capturing` bumps `@updatedAt`, electing one recoverer) and re-runs the
  same settle path: the fresh PI re-read sees `succeeded` (the capture DID land →
  record `amount_received`) or `requires_capture` (it did not → re-capture under
  the stable key), so recovery never double-charges. Mirrors the send slice's
  stale-`dialing` recovery.
- **Sweep.** `@Cron` (`2,12,22,32,42,52 * * * *`, `EASTERN_TIMEZONE`) captures
  arrived `settling` runs ordered by `captureBefore` asc (EXPIRY-PRIORITY, not
  FIFO — a backlog must never let a hold lapse uncaptured); **prod-only**; no
  `CronLockService` (the per-record claim is idempotent across replicas). The
  full estimate is captured (INV-1
  clamps to the authorized hold), so there is no vendor count to reconcile.

**Fresh-charge recovery (lapsed hold).** `OutreachRobocallFreshChargeService.chargeUncollectable`
recovers a DELIVERED run the capture slice parked in `uncollectable` because its
authorization hold lapsed (expired/canceled) before capture. It charges the saved
card OFF-SESSION — a fresh charge WITHOUT a live pre-authorization
(`StripeService.createOffSessionCharge`, automatic capture), the riskiest money
step, reached only for the rare lapsed-hold run. Invariants:

- **INV-1.** The charge is `authorizedAmountInCents` directly — the estimate
  held + quoted — so it equals what was authorized and can never exceed it.
  Charging the count-derived `calcRobocallTotalInCents(completedCallCount)` would
  UNDERcharge: the draft-time `billableCount` (→ `completedCallCount`) can be
  smaller than the authorize-time basis when the audience grows in the
  draft→authorize gap. Mirrors the capture slice.
- **Single-owner + never-twice.** A conditional `updateMany` (`uncollectable →
charging`, guarded on `chargeIntentId IS NULL`) elects one charger; the stable
  idempotency key `robocall-fresh-charge-<customerId>-<id>` makes a retry replay the same PI
  instead of charging twice. Success commits `charging → charged` + `chargeIntentId`
  - `capturedAmountInCents` + a `Receipt` once.
- **Decline vs infra.** A declined card commits back to `uncollectable` WITH the
  declined PI id in `chargeIntentId` (a `StripeChargeDeclinedError` carries it) —
  so the candidate filter (`chargeIntentId IS NULL`) never re-attempts it, a later
  dispute/refund on that intent reconciles via `markDisputedByIntent`, and CRITICAL
  is logged (a delivered run we could not collect needs manual follow-up). A
  transient infra failure reverts to `uncollectable` with NO `chargeIntentId`, so
  the next sweep retries under the stable key.
- **No-strand recovery, idempotent forever.** A crash between the Stripe charge
  and the DB commit strands the row in `charging`; the stale-`charging` sweep
  reclaims it past `ROBOCALL_CHARGING_STALE_MINUTES` (15) via a stale-guarded
  self-transition CAS and re-runs the settle path. Before charging, `settleClaimed`
  SEARCHES Stripe for an already-succeeded fresh-charge PI (by the
  `robocall_fresh_charge` kind + outreachId metadata, scoped to the row's Stripe
  customer so another PR preview's charge for the same outreach id never matches)
  and, if found, commits
  `charged` off it WITHOUT charging again — so recovery is idempotent independent
  of Stripe's 24h idempotency-key window, which a recovery delayed by a crash +
  investigation can outlast. The stable key is a second layer for within-window
  retries. Mirrors the capture
  slice's stale-`capturing` recovery.
- **Sub-minimum → voided (now defensive).** A run billing under Stripe's minimum
  ($0.50) is written off to `voided`, not charged — a fresh PaymentIntent below
  the minimum is REJECTED, and rounding up would overcharge. With the $2 number
  fee this cannot fire in practice: every run owes at least the fee, and a
  zero-connected run is `voided` at capture rather than parked uncollectable, so
  fresh charge never sees a sub-minimum amount. The branch is kept defensively —
  were the fee ever removed, it stops such a run failing-and-retrying forever by
  leaving the candidate set.
- **Sweep.** `@Cron` (`5,15,25,35,45,55 * * * *`, `EASTERN_TIMEZONE`),
  **prod-only**; no `CronLockService` (the per-record claim is idempotent across
  replicas). MOVES REAL MONEY.

**Hold-failure recovery (card update).** `OutreachRobocallWebhookService.retryHoldFailedForAttachedCard`
is the team flow's "card updated before send time → retry the hold now" arm. The
Stripe `payment_method.attached` webhook (dispatched from
`PaymentEventsService.paymentMethodAttachedHandler`, cards only) retries the hold
for that customer's `hold_failed` robocall drafts whose send is IN the window
(`now < date <= now + ROBOCALL_HOLD_WINDOW_DAYS`), calling `authorizeHold` with
the newly attached card. The lower bound honors "a card update after send time
does not revive it"; the upper bound keeps authorizeHold on its placement retry
path (`hold_failed` + null intent → `hold_pending`) and off the defer branch,
whose persist CAS is `pending_payment`-only and would silently drop the new card
on an out-of-window `hold_failed` row. authorizeHold owns the single-owner claim, the Stripe hold,
and the `HoldPlaced`/`HoldFailed` milestones, so a Stripe redelivery is idempotent
(a draft already advanced out of `hold_failed` is not re-selected) and per-draft
failures are isolated. RESERVES REAL MONEY off-session. Ops: the Stripe webhook
endpoint must subscribe to `payment_method.attached`.

**Promo codes (reward codes on the pay step).** CAS mints single-use,
amount-off promotion codes in Stripe (a fixed number of calls at a fixed rate)
and hands them to candidates. Stripe only APPLIES a code to a Checkout Session
or invoice, never to the manual-capture hold above, so
`OutreachRobocallPromoService` does what Checkout would: `POST
/outreach/robocall/:id/promo` looks the code up (`StripeService.
findActivePromotionCode`, coupon expanded), prices the discount off the WHOLE
estimate — calls + number fee (product decision 2026-09-23) — and only
REMEMBERS it on the `pending_payment | hold_failed` draft (`promotionCodeId`,
`promoCode`, `promoDiscountInCents`); nothing is consumed, so a candidate who
applies a code and leaves keeps it (`DELETE` forgets it). The code is SPENT
where money commits: `authorizeHold` re-validates it against the live estimate
(a code spent elsewhere since apply 400s before any hold), holds `estimate −
discount`, and on the success commit stamps `promoRedeemedAt` + deactivates the
code in Stripe (`setPromotionCodeActive(false)`, best-effort; the stamp is the
second guard, and `assertUnredeemed` refuses a code any other row has stamped).
That pre-check is a read, so two authorizes on different drafts can both pass
it; the atomic guard is a partial unique index on `promotion_code_id WHERE
promo_redeemed_at IS NOT NULL` (hand-added to the migration — Prisma cannot
declare it, and `migrate diff` ignores partial indexes so it is not drift). The
loser's commit raises P2002: the hold path voids the just-placed hold, records
it in `RobocallOrphanedHold` (`lost_commit`) and reverts the claim, the covered
path touches nothing, and both 400 "already been used". Apply prices the
discount off the RECOMPUTED estimate (`calcRobocallTotalInCents(billableCount)`,
never the stored `amountInCents`, which is fee-less on pre-fee drafts) so the
pay step's `coversTotal` agrees with what authorize will decide.
Stripe never counts these redemptions itself. A code that covers the whole
estimate — or leaves under `ROBOCALL_MIN_HOLD_CENTS` (50), which Stripe would
refuse to hold — takes `scheduleCoveredRun`: the SAME claim shape as placement
(`pending_payment | hold_failed`, no intent) straight to `authorized` with
`authorizedAmountInCents: 0`, NO intent, NO card required (`paymentMethodId`
is optional on the authorize contract for exactly this), and
`promoCoversTotal: true`. Downstream that flag is what a covered run's
`authorizationIntentId IS NULL` means: the send gate skips the live-hold
re-read (the redeemed code is the payment), the completion sweep selects it
alongside hold-model runs, and capture records it `captured` at $0 with no
Stripe call. A pre-dial unwind hands the reward back
(`OutreachRobocallPromoService.restore`: clear `promoRedeemedAt` +
`promoCoversTotal`, reactivate in Stripe, keep the code fields for audit) from
`failSend` and the `payment_method.detached` cancel; a deferred draft that
expires never redeemed anything. The deferred sweep applies a remembered code
the same way when it places the hold. A partial code on a declined card stays
remembered on the `hold_failed` row for the retry.
