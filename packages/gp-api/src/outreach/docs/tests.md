# Tests

<!-- Moved verbatim from outreach/AGENTS.md so the auto-loaded AGENTS.md stays small. Edit here. -->

`tests/` runs through the HTTP harness (`useTestService`) with LLM calls
mocked at `LlmService`: `outreachSocial.test.ts` covers the compose + save
endpoints; `outreachServeSocial.test.ts`
covers the Serve counterpart (a draft per serve purpose asserting the serve
goal/system prompt and no candidate/voter framing, the Win-purpose-slug
rejection, the ElectedOffice 404 gate on every route, custom/improve, LLM
failure → 502), Public Profile grounding (ENG-10982: all five labeled blocks
verbatim, hidden `PersonProfileIssue`s excluded, the profile-less baseline
pinned byte-identical, over-cap trimming, the generate path receiving the
same blocks as draft), and the Win/Serve isolation matrix (disjoint lists,
cross-route 404s on detail, a serve save leaving an existing Win row
byte-unchanged, and archive/restore on a serve row that cannot reach a Win
row); `outreachPhoneBanking.test.ts` covers the phone-banking draft
endpoint (Pro gate, per-purpose prompt assembly, improve mode);
`outreachRobocall.test.ts` covers the robocall draft endpoint (grounding,
first-person self-ID opener + compliance ban, voting-logistics placeholders,
improve mode, custom-without-draft rejected, Pro gate, LLM failure → 502);
`outreachRobocallAudio.test.ts` covers the audio presign endpoint (URL +
campaign-scoped key + extension mapping, invalid content type, allowed for a
non-Pro campaign), mocking `S3Service.createPresignedUpload`;
`services/robocallCompliance.service.test.ts` covers the compliance verdict
(all-present pass, per-element issues, fail-closed on a transcription failure)
mocking the transcription + `LlmService`; the compliance-endpoint suite in
`outreachRobocall.test.ts` also asserts the verdict is PERSISTED (a passing and
a failing row keyed by `audioKey`, and a re-check overwrites to a single row),
and `outreachRobocallDraft.test.ts` covers the create-time compliance gate (400
with no passing verdict, 400 on a failed verdict, and a success stamping
`compliancePassedAt` from the verdict's `checkedAt`), and
`services/robocallTranscription.service.test.ts` covers the batch Transcribe
poll (completion, FAILED → 502, unsupported type) mocking the Transcribe client;
`outreachRobocallHold.test.ts` covers the pay-time hold: happy-path off-session
placement (idempotency key `robocall-hold-<customer>-<id>-1`, satellite persisted,
`authorized`, `HoldPlaced` once), the 5-day defer, the INV-2 ceiling → 409 +
revert (and a large run under the ceiling still placing the hold), a decline →
`hold_failed` + `HoldFailed` (not a 502), a payment method
not on the customer → 400, a too-short `capture_before` → void + 400, the
already-authorized/in-flight no-double-hold paths + the lost-commit void, a
`hold_failed` re-authorize clearing any prior staged campaign fields (pkStr +
dates → null), and the Pro gate — mocking the private Stripe client,
`deriveBillableCount`, and `AnalyticsService.track`;
`outreachRobocallStaging.test.ts` covers CallHub campaign staging directly on
the service (no HTTP route): happy-path stages once and persists pk_str + the
computed window + the frozen `stagedCallsPerMinute` (R1), media uploads before the phonebook is created, an already-staged
draft is skipped (no second CallHub create), a non-authorized draft is skipped, a
CallHub failure and both loadAudio failures (missing object / missing
content-type) revert the claim to `authorized` (no stranded claim) and 502,
a concurrent double-stage places only one campaign (the claim CAS), the
orphan-guard branch (commit misses → orphan logged, no second campaign), a stale
`staging` row is reclaimed while a fresh one is not double-driven, and the
prod-gated `@Cron` sweep stages only in-window drafts once across repeat runs,
reclaims a stranded stale row, continues past a failing draft (order-independent
assertion), and no-ops off prod — mocking the CallHub phonebook/media/campaign
services and `S3Service.getFileBytesWithContentType`;
`outreachRobocallSend.test.ts` covers the send-time dial directly on the service
(no HTTP route): happy-path launches once (pk_str a string) and commits `dialed`

- `dialedAt`; NEVER-UNPAID (a non-`requires_capture` hold and a missing intent
  both → `hold_failed` with the authorization fields CLEARED so the hold-retry CAS
  can re-pick it, no launch, alert, and the dead hold at dial emits `HoldFailed`
  once under `<id>:hold_failed_at_dial`); NEVER-NON-COMPLIANT (a draft whose
  `compliancePassedAt` is null reverts to `authorized`, does not launch, and logs
  CRITICAL); NEVER-TWICE (a concurrent double-start
  launches once via the claim CAS); the double-dial guard (launch throws once but
  CallHub reads STARTED → NO second launch, commit `dialed`); a launch 200 that
  reads back a non-STARTED status → NOT committed dialed, reconciled instead; a
  lost launch that reads
  PAUSED → revert `authorized`, and a subsequent sweep dials it; a lost launch whose
  status read also throws → left `dialing` + alert (not reverted); stale-dialing
  recovery (an aged `dialing` row with CallHub STARTED → `dialed`, with PAUSED →
  `authorized`); a not-staged (pk_str null) and a not-authorized draft skipped; a
  `dialed` draft not re-dialed; the commit-miss CRITICAL alert; the spine +
  no-per-contact-rows behavior on a committed dial (spine `pending → in_progress`
  and ZERO `ContactInteractionRobocall` rows written, on the reconciled-STARTED
  path too, and a canceled spine never flipped to in_progress); the COMPLETION SEAM
  (`isDoneDialing` reports done + `source: 'estimate'` past the ceiling and NOT done
  before it, and the RATE-HAIRCUT floor keeps a run NOT done that the naive
  configured rate would free — the money-safe-floor / finding-1 regression, via the
  `ROBOCALL_DIAL_SAFETY_RATE_DIVISOR` env; and R1 — a run's FROZEN
  `stagedCallsPerMinute` is used over a later-raised live rate, so a slow-staged run
  is never freed early, with a null falling back to live); the SERIAL queue
  (the sweep launches only the single oldest-due run per pass leaving the rest;
  does NOT launch while another run is `dialing`, nor while a `dialed` run's pool
  is unfreed; FREES a `dialed` run past its ceiling — ABORTs its CallHub
  campaign, stamps `poolFreedAt`, leaves `settleState` `dialed` (the estimate floor
  freeing a run the deferred count never confirms) — then launches the
  next queued run; does NOT free a run still within its ceiling; does not
  re-free an already-freed run; and leaves a run in flight when the abort fails so
  the queue stays blocked); the DEADLOCK BACKSTOP (a `dialing` row past
  `ROBOCALL_DIALING_DEADLOCK_MINUTES` measured from `dialingStartedAt` is
  force-failed via `failSend(id,'send')` and the queue then unblocks; a within-timeout
  row is left alone; the timer keys off `dialingStartedAt` not `updatedAt`, so a
  recently-recovered row still ages out); the kill-switch (`ROBOCALL_SEND_MAX_PER_SWEEP=0`
  launches nothing, unset launches one); the throttle revert (an `over_cps_limit`
  launch reverts to `authorized` and a later clean pass dials it); a failing launch
  not throwing out of the sweep; and the sweep dials only arrived drafts once
  across repeat runs and no-ops off prod — mocking
  `CallhubCampaignService.launchVoiceBroadcast` / `abortVoiceBroadcast` /
  `getConfiguredCallsPerMinute`,
  `CallhubCampaignReportService.getCampaignStatus`,
  `StripeService.retrievePaymentIntent`, and `AnalyticsService.track`;
  `outreachRobocallOverdueAlert.test.ts` covers the overdue-alert sweep directly
  on the service (no HTTP route): a past-due STAGED (callhubCampaignPkStr set)
  undialed run alerts once and stamps `overdueAlertedAt`, a `staging` and a
  never-staged (pk_str null) run also alert, a second sweep does NOT re-alert and
  a concurrent double-run alerts once (the dedupe CAS), and a dialed / canceled /
  failed / future / within-grace / already-stamped run never alerts, plus no-ops
  off prod — mocking `OutreachNotificationService.notifyRobocallOverdue`;
  `outreachRobocallBacklogAlert.test.ts` covers the proactive backlog-alert sweep
  directly on the service (no HTTP route): a future run a big in-flight run's
  backlog pushes past its day alerts once and stamps `backlogAlertedAt`, a run
  whose pool is free before it is due does NOT alert, an already-due run (the
  overdue sweep's domain) is NOT paged, a second sweep does NOT re-alert and a
  concurrent double-run alerts once (the dedupe CAS), and an already-stamped /
  canceled / dialed run never alerts, plus no-ops off prod — mocking
  `OutreachNotificationService.notifyRobocallBacklogDelayed`; the pure projection
  math (`projectRobocallDialQueue` / `robocallDialCeilingAt`: serial walk, the
  backlog-vs-own-schedule day-slip distinction, the next-window roll, the
  pool-free floor) is pinned in `@/shared/util/robocallDialCompletion.util.test.ts`;
  `outreachRobocallDeferredHold.test.ts` covers the deferred flow: an
  out-of-window authorize persists the chosen card + returns `deferred` with no
  hold (an invalid PM — wrong customer / non-card — 400s and persists nothing, and
  the persist is a `pending_payment`-guarded CAS that never clobbers an advanced
  row), and the sweep places a hold via `authorizeHold` (passing no PM) for an
  in-window card-set draft, bills the row's CURRENT card rather than the pre-claim
  snapshot when a concurrent re-authorize swapped it, escalates a stale/foreign
  persisted card (a `RobocallCardError`) to `hold_failed` + one `HoldFailed`
  milestone (and does not re-select it next sweep), does NOT escalate a
  zero-audience or reschedule-race `BadRequestException` (stays `pending_payment`,
  re-selectable, no email), marks a declined draft `hold_failed` without a retry
  storm, skips a no-card / out-of-window / already-authorized draft, does not
  double-place on a second sweep, and no-ops off prod;
  and the cancel-at-deadline cleanup (`sweepExpiredDeferred`) cancels a deferred
  card-persisted draft whose send passed + emits `Canceled` once, leaves a
  still-in-window draft alone,
  cancels once under a concurrent double-run (the CAS), and no-ops off prod —
  spying on `authorizeHold`, `AnalyticsService.track`, and the Stripe intent
  create;
  `outreachRobocallCapture.test.ts` covers the capture directly on the service (no
  HTTP route): happy-path captures the actual amount off a live hold (idempotency
  key `robocall-capture-<holdIntentId>`) and records the `Receipt` once; undercharge (fewer
  calls than the estimate → the smaller amount); INV-1 (an actual over the hold
  clamps to the authorized amount, never overbills); a zero-connected run voids
  the hold and releases the fee, whether the hold is live or already gone; an already-`succeeded` PI reconciles to
  `captured` off `amount_received` without a second capture; a lapsed/`canceled`
  hold → `uncollectable` + warn (no blind charge); NEVER-TWICE (a concurrent
  double-capture captures once via the claim CAS); a transient PI-read and a
  capture-call failure both revert to `settling` to retry; a data anomaly (missing
  intent) → `uncollectable` + CRITICAL; a non-settling draft is untouched; the
  sweep captures an arrived run once across repeat runs, captures nearest-expiry
  holds first (distinct intent ids prove the order), skips non-settling, and
  no-ops off prod; and stale-`capturing`
  recovery reconciles a stranded row (backdated `updated_at`) whether its pre-crash
  capture landed (`succeeded` → no re-capture) or not (`requires_capture` →
  re-capture under the stable key), leaves a fresh capturing row alone, and elects
  one recoverer under a concurrent double-sweep — mocking
  `StripeService.retrievePaymentIntent`,
  `capturePaymentIntent`, `voidHold`, and `AnalyticsService.track`;
  `outreachRobocallFreshCharge.test.ts` covers the fresh-charge recovery directly on
  the service (no HTTP route): charges an `uncollectable` delivered run off-session →
  `charged` + `chargeIntentId` + `capturedAmountInCents` + `Receipt` once; INV-1
  (an actual over the authorized clamps to the authorized); undercharge; a decline
  parks `uncollectable` WITH the declined PI id (not re-attempted, no receipt); a
  transient failure reverts to `uncollectable` with NO `chargeIntentId` to retry;
  NEVER-TWICE (a concurrent double-charge charges once via the claim CAS); a
  non-`uncollectable` and an already-attempted (`chargeIntentId` set) row are
  skipped; the sweep charges an arrived run once across repeat runs, skips a run
  missing the card/count, and no-ops off prod;
  and stale-`charging` recovery reconciles a stranded row whether its pre-crash
  charge landed (`charged`) or declined (`uncollectable` + declined PI id), leaves a
  fresh charging row alone, and elects one recoverer under a double-sweep — mocking
  `StripeService.createOffSessionCharge` and `AnalyticsService.track`. The Stripe
  wiring is covered in `stripe.service.test.ts` (`createOffSessionCharge`: stable
  idempotency key + automatic-capture/off-session params, a card decline →
  `StripeChargeDeclinedError` carrying the PI id, a confirmed-but-not-succeeded PI
  treated as a decline, a non-card failure → 502);
  `outreachRobocallHoldRecovery.test.ts` covers stale-`hold_pending` recovery
  directly on the service (no HTTP route): a stranded row (backdated `updated_at`)
  with a live orphan hold is cancelled + reverted to `pending_payment` with
  `payAttempt++`; a stranded row with no live hold reverts without a cancel; the
  revert clears any stale authorization fields; a search anomaly returning >1 hold
  cancels them all; a fresh (not-yet-stale) row is left `hold_pending`; a Stripe
  search failure AND a cancel failure each leave the row `hold_pending` (never
  revert with a possibly-live orphan, retries next sweep); a concurrent
  double-sweep elects one recoverer; it no-ops off
  prod and does not touch a non-`hold_pending` draft — mocking
  `StripeService.findLiveManualHoldsByOutreach` and `cancelHold`;
  `outreachRobocallCallhubCleanup.test.ts` covers the orphaned-campaign queue +
  cleanup sweep: `record` upserts idempotently (same pk_str twice → one row) and
  never un-stamps an aborted row; the sweep ABORTs every unaborted campaign and
  stamps it, skips an already-aborted one, isolates a per-campaign CallHub failure
  (others abort, the failed one stays unaborted to retry), stamps once under a
  concurrent double-run, and no-ops off prod — mocking
  `CallhubCampaignService.abortVoiceBroadcast`. The recording itself is asserted
  where it happens: `outreachRobocallHold.test.ts` checks a `hold_failed` re-auth
  records the cleared campaign (`reauth_restage`), and `outreachRobocallStaging.test.ts`
  checks the lost-commit orphan-guard records it (`staging_lost_commit`);
  `outreachRobocallHoldReconcile.test.ts` covers the orphaned-hold queue + reconcile
  sweep: `record` upserts idempotently and never un-stamps; the sweep re-voids a
  still-live hold (`requires_capture` → `cancelHold` + stamp), stamps an
  already-canceled or succeeded hold WITHOUT cancelling, leaves the row unvoided on
  a PI-read failure and on a cancel failure (never stamps a still-live hold), skips
  an already-voided row, stamps once under a concurrent double-run, and no-ops off
  prod — mocking `StripeService.retrievePaymentIntent` and `cancelHold`. The
  recording is asserted where it happens: `outreachRobocallHold.test.ts` (the
  window-fit → `window_fit` and lost-commit → `lost_commit` voids) and
  `outreachRobocallWebhook.test.ts` (cancel-before-send → `cancel_before_send`);
  `outreachSmsAdmin.test.ts` covers the CAS console (queue derivation +
  standards verdict + vendor-failure degradation, admin gate, approve
  claim/revert/409, internal deny, the staff edit (denial clear +
  booking kept + no-image 400), the staff date edit (unbooked move,
  booked rebook order + approval kept, a vendor failure leaving the row
  unchanged, canceled 409 / past-date + mid-send 400s, admin gate), the
  Sent tab (a booked completed row reads `sent`, an unbooked or
  aged-out completed row is hidden, edit / date edit / test send refuse
  it before any vendor write, detail still serves its stats), the
  assigned-PA owner read (mocked at the HubSpot client: batches of 100,
  merged companies, a 429 not cached as unassigned), and detail stats
  degradation) plus
  `getDetail`'s single-flight/cache/cool-off layer exercised directly on the
  service (concurrent calls collapse to one vendor call, a timed-out read
  stays registered so a later page view doesn't duplicate it, a cached
  result serves a refresh within the TTL, and a failed read's cool-off
  expiry allows a fresh vendor call — `VENDOR_READ_TIMEOUT_MS` and
  `DETAIL_FAILED_RETRY_COOLDOWN_MS` are env-overridable for exactly this,
  shrunk via `vi.stubEnv` instead of waiting out the real windows);
  `outreachFlow.test.ts` covers the submission contract, the draft-first
  purchase path, the failure-still-Slacks interceptor behavior, and a p2p
  create naming an unknown or another campaign's phone list (400, no row).
  `outreachP2pPurchasePricing.test.ts` drives p2p checkout pricing through
  the purchase routes: a draft on an 8,000-lead list is charged for 8,000
  when the request names a 10-lead list, with and without the free-texts
  offer, on the immediate-charge and the hold path (where the send cap lands
  on the draft's build); the zero-amount completion is refused when the offer
  only covers the smaller list; a list scrubbed to 0 reaches the $0 path; a
  checkout with no draft, a finalized draft, or another campaign's draft is a
  400 that mints no session; and a pre-build draft holds the estimate of the
  build for its own saved list and 400s a build from any other.
  `outreachDrafts.test.ts` covers the saved-draft routes through HTTP: a free
  campaign creating a p2p draft (dateless image key, `script` mirrored onto
  `message`, no date/phone list), the one-draft-per-type 409 carrying
  `existingId` (including two racing creates yielding one row, and the cap and
  foreign-list rejections both skipping the upload), a robocall draft as JSON and as multipart-without-file (null
  billing, `settleState: draft`, frozen ETag), the compliance and
  foreign-voter-list rejections, the draft appearing in `GET /outreach`, and
  delete (204 + S3 image/audio deletes + verdict cleared, an off-asset-domain
  imageUrl left alone, 409 on a `pending` row, 404 on another campaign's).
  `services/outreachDraftExpiry.service.test.ts` covers the daily expiry
  sweep: a row past `DRAFT_RETENTION_DAYS` deleted and a fresher one kept,
  the cron-lock no-op and the two-invocations-one-slot case, one row's
  delete failure not blocking another's, and completion sealed in `finally`
  even when the scan itself throws.

Serve SMS and the delivery layer are covered by colocated suites rather than
the HTTP harness, except the controller: `outreachServeSms.controller.test.ts`
covers both routes' feature-flag gate (404 when off, composing nothing and
writing no row) and the pass-through when on;
`tests/outreachServeSmsProposal.test.ts` runs a card's text through the
harness (the key moving to a fresh draft, an unpaid draft reading as unsent,
the paid send putting the priority's check out, a spent key 409ing);
`tests/outreachWinSmsProposal.test.ts` does the same for a Win p2p draft
(the key persisted and moved, unpaid and build-mode drafts reading as
unsent through the Win org's probe, a paid one reading as sent and 409ing
a repeat, another org's key 409ing, a key on a resume refused);
`services/outreachServeSmsCreate.service.test.ts` covers the create
(a client-supplied count ignored, below-25 rejected by name, exactly-25
accepted, an empty audience rejected, weekend / too-soon / too-far / unreal
calendar dates rejected, the opt-out set reaching `findContactsForFilter` and
its size reported, the duplicate count read off the generator's RETURN value,
multi-page resolution, and another org's filter refused);
`services/outreachServeSmsPurchase.service.test.ts` covers pricing and the
post-purchase claim (never billing a client count, refusing a row past
`pending_payment`, the CAS claim, every lost-claim branch, and the revert on
an enqueue failure); `services/outreachTextDelivery.service.test.ts` covers
the outbound half (the counts as an INTERSECTION not the org total, 0 when
the org's opt-outs are outside the filter, scrub-before-dedupe, the over-cap
set still scrubbing loudly, the sample branch, `audienceResolved`
distinguishing the reuse path, a canceled send resolving/writing/handing off
nothing, the claim landing before resolution, and the claim handed back when
the handoff fails); `services/outreachTextIngest.service.test.ts` covers the
inbound half over the harness's real Postgres; `util/textOptOut.util.test.ts`
pins the opt-out predicate in both directions (including the trailing-verb
cases the pipeline's rule gets wrong); and `util/textDeliverySlack.util.test.ts`
covers the handoff message. The queue routing itself is in
`src/queue/consumer/queueConsumer.service.test.ts`: which outcomes ack and
which redeliver.
