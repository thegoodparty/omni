# src/outreach/

Voter outreach: the `Outreach` spine row (one per send), the Peerly p2p
texting backend behind it, the social channel satellite, and the stateless
AI compose endpoints for the Voter Outreach 2.0 flows. Frontend counterpart:
`packages/gp-webapp/app/dashboard/outreach/AGENTS.md`.

## Controllers (all under `/outreach`, campaign-scoped via `@UseCampaign()`;

phone banking also carries `@UseOrganization()` for the Pro gate)

| Route                                                                                                                   | Where                                 | What                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /outreach` (multipart) + `GET /outreach`                                                                          | `outreach.controller.ts`              | Legacy create/list. Create accepts `draft: true` (p2p only) → row stored `pending_payment`, hidden from the list. Image required for text/p2p                                                                                                                                                                                                                                                 |
| `POST /outreach/social/draft` / `social/generate` / `social` (save), `GET /outreach/:id`, `GET /outreach/:id/receipt`, `POST /outreach/:id/cancel`, `PATCH /outreach/:id/archive` | `outreachSocial.controller.ts`        | Social flow (VO 2.0 phase 1): stateless draft/improve, per-platform asset generation, atomic save, detail read; receipt (live Stripe read off the stored checkout session, dollars; 404 free-texts rows, 502 on Stripe failure) and cancel-before-send for paid SMS rows, campaign-scoped; archive/restore for the history drawer, org-scoped via `@UseOrganization()`                                                                                                                                                                                                   |
| `POST /outreach/phone-banking/draft`                                                                                    | `outreachPhoneBanking.controller.ts`  | Phone banking script draft/improve (VO 2.0 phone banking): stateless, Pro-gated (`@UseOrganization()` + `ContactsService.assertProAccess`) — the create flow freezes the chosen text onto the list itself via `POST /phone-banking/lists` (`src/phoneBanking/`)                                                                                                                               |
| `POST /outreach/robocall/draft`                                                                                         | `outreachRobocall.controller.ts`      | Robocall script draft/improve (VO 2.0 robocall): stateless, Pro-gated the same way. Purpose + tone (`currentDraft` polishes the `custom` purpose in place) → the script the candidate reads into the recording. An optional `callbackNumber` (the rented number, below) flips the generator from banning the disclosure to REQUIRING it — the script then ends with the spoken "paid for by" + callback number. Nothing persists here                                                                                                             |
| `POST /outreach/robocall/number`                                                                                        | `outreachRobocall.controller.ts`      | Rents a fresh CallHub caller-ID number for this robocall (VO 2.0 robocall): stateless, Pro-gated the same way. Returns `{ phoneNumber, region }` via `CallhubNumbersService`. The candidate reads it aloud as the callback number, so it's rented before the disclosure draft. Rent-per-robocall (spam-flagging); the CallHub account auto-un-rents idle numbers. Area-code targeting from campaign location is a later refinement (US national for now)                                                                                          |
| `POST /outreach/robocall/audio/presign`                                                                                 | `outreachRobocallAudio.controller.ts` | Presigned S3 POST for the recorded robocall audio (VO 2.0 robocall): stateless, Pro-gated the same way. Returns `{ url, fields, key, expiresIn }`; the browser submits a multipart form to `ROBOCALL_AUDIO_BUCKET` and holds the key until the send is created in a later step. It's a POST (not PUT) so the policy's `content-length-range` lets S3 reject an oversize upload at upload time |
| `POST /outreach/robocall/compliance`                                                                                    | `outreachRobocall.controller.ts`      | Fail-closed compliance gate for the recorded audio (VO 2.0 robocall): Pro-gated the same way. Confirms the `audioKey` belongs to THIS campaign (prefix `robocall/<campaignId>/`, so a caller can't check another campaign's recording), derives candidate + organization server-side, then runs `RobocallComplianceService.checkRecording` on `{ audioKey, contentType }`. Everything the transcript is checked against is server-derived — the callback-number check only confirms a number is spoken, so the client has no expected value to spoof it with (the caller-ID voters reach is enforced at dial time). Returns the `RobocallComplianceVerdict`; a transcription/LLM failure is 502. After the check returns, the verdict is UPSERTED (keyed by `audioKey`) as a `RobocallComplianceResult` via `RobocallComplianceResultService.recordVerdict` — a re-check overwrites — so the create gate has a durable server-side record (the check logic itself is untouched)                                                                                          |
| `POST /outreach/robocall`                                                                                               | `outreachRobocall.controller.ts`      | Draft-first create (VO 2.0 robocall), Pro-gated the same way. Confirms the `audioKey` belongs to THIS campaign (prefix `robocall/<campaignId>/`), REQUIRES a persisted PASSING `RobocallComplianceResult` for that `audioKey` (else 400 `Robocall audio has not passed compliance` — the server-side backstop under the client UI gate), then persists the `pending_payment` spine + `OutreachRobocall` satellite (settleState `pending_payment`, `compliancePassedAt` stamped from the verdict's `checkedAt`) in one transaction. Billable count + amount are derived server-side from `voterFileFilterId` (landline forced) — never a client count — and returned for the pay-step estimate. The only robocall write; hold + settlement are later slices                                                                                                        |
| `POST /outreach/robocall/:outreachId/authorize`                                                                         | `outreachRobocall.controller.ts`      | Places the pay-time manual-capture Stripe hold on a scheduled `pending_payment` draft (VO 2.0 robocall), Pro-gated the same way. Body `{ paymentMethodId }`. RESERVES REAL MONEY: a single-owner placement CAS (`pending_payment → hold_pending → authorized`), the server-re-derived + frozen estimate, the $500 testing ceiling, the 3-day window (else `deferred`), and the capture-window fit — all in `OutreachRobocallHoldService.authorizeHold`. See "Robocall payment" below. No capture/CallHub/sweep/retry here                                                                                                        |

`GET /outreach/:id` deliberately lives on the social controller: detail reads
must stay outside `OutreachNotificationInterceptor` — a 404 there would fire
a CAS failure Slack meant for send attempts.

## Services

| Service                                             | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `outreach.service.ts`                               | Spine CRUD + `finalizeOutreachPurchase` (see below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `outreachPurchase.service.ts`                       | The `PurchaseType.TEXT` purchase handler (registered in the module constructor). Re-derives the billable count server-side from the phone-list token (Peerly `leads_loaded`, falling back to captured recipient rows) — the client's `contactCount` is never trusted for billing. Applies the free-texts (5,000) discount server-side                                                                                                                                                                                                                                                                                          |
| `outreachSocial.service.ts`                         | Saves/reads the social satellite: spine (status `completed` — nothing is sent, so no lifecycle) + `OutreachSocial` + `OutreachSocialAsset` rows in one transaction                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `outreachSocialGeneration.service.ts`               | Stateless LLM compose (temperature 0.8, Zod-validated output): one draft per draft/improve call, all per-platform assets in one structured generate call. Fresh generation is refused for the `custom` purpose (improve allowed); improve is a detail-preserving polish, never new content                                                                                                                                                                                                                                                                                                                                     |
| `outreachPhoneBankingGeneration.service.ts`         | Stateless LLM compose for call scripts, same shape as social generation. Per-purpose structure (volunteer opener, why-statement, issue-ID question for `persuade`, real election-day/early-voting dates for `vote-early`/`election-day` — grounded from `campaign.details` and, for `vote-early` only, a live `CampaignsService.fetchLiveRaceTargetMetrics` milestones fetch — with no bracket placeholders anywhere except `[your name]` and the voter-name token (`VOTER_NAME_TOKEN`, contracts), which the caller page interpolates with the active contact's first name); hard-bans SMS/robocall compliance lines (`Reply STOP`, `Paid for by`, callback numbers) since a volunteer reads this live                                                          |
| `outreachRobocallGeneration.service.ts`             | Stateless LLM compose for the recorded robocall message, same shape again. Differs from phone banking in the opener — a robocall is the CANDIDATE speaking, so the rule is a first-person self-ID (`This is [first name], candidate for [office]`), not a volunteer intro — and in length (about 40-75 words, four or five short sentences, well inside a 60-second recording). Compliance is conditional on the request's `callbackNumber`: with no number the `Paid for by` disclaimer / callback number / opt-out are banned (the number isn't rented until compose); once a number is passed, the script MUST end with the spoken disclosure ("paid for by" + that number), which is what the compliance gate later verifies. Refuses fresh generation for `custom` (improve allowed), like social |
| `outreachRobocall.service.ts`                       | Persists the robocall draft (`OutreachRobocallService`, `createPrismaBase(MODELS.OutreachRobocall)`): `deriveBillableCount` (the saved list resolved with `hasLandline` forced → people-db total, never a client count), `assertReachableCount` (a 0-landline audience is not purchasable), the future-schedule guard, and `createDraft` (spine `pending_payment` + satellite settleState `pending_payment` in one transaction). No hold/Stripe/CallHub/settlement — the payment/callhub satellite fields stay unset until later slices                                                                                                                                                                                                                                                                                     |
| `outreachRobocallHold.service.ts`                   | The pay-time authorization hold (`OutreachRobocallHoldService`, `createPrismaBase(MODELS.OutreachRobocall)`): `authorizeHold` places a manual-capture Stripe hold off-session on the vaulted card for the server-re-derived, frozen estimate. Single-owner placement CAS (`pending_payment → hold_pending → authorized`), the $500 `ROBOCALL_PER_RUN_CEILING_CENTS`, the `ROBOCALL_HOLD_WINDOW_DAYS` (3) window, the capture-window fit, the decline-vs-502 split, and the `HoldPlaced`/`HoldFailed` milestones. The success commit ALSO nulls `callhubCampaignPkStr`/dates so a `hold_failed` re-auth (which re-derives the count) forces a fresh re-stage instead of dialing the stale phonebook. RESERVES REAL MONEY. See "Robocall payment" below                                                                                                                                                                                                                                                              |
| `outreachRobocallDeferredHold.service.ts`           | Deferred hold placement (`OutreachRobocallDeferredHoldService`, `createPrismaBase(MODELS.OutreachRobocall)`): a daily `@Cron` (`13 8 * * *`, `EASTERN_TIMEZONE`) that finds `pending_payment` drafts with a card persisted at defer time (`paymentMethodId` + `stripeCustomerId` NOT NULL) whose send has entered the window (`now < outreach.date <= now + ROBOCALL_HOLD_WINDOW_DAYS`), loads user + campaign + organization, and calls `OutreachRobocallHoldService.authorizeHold` with the persisted card. Trigger + context loader + per-record try/catch only — `authorizeHold` owns the placement CAS, the hold, the window-fit, and the milestones. Idempotent across replicas via that CAS (an already-`authorized` draft leaves the candidate set). **prod-only** (`OTEL_SERVICE_ENVIRONMENT`) AND kill-switch-gated (`ROBOCALL_DEFERRED_HOLD_ENABLED`, default OFF — it reserves real money off-session); no `CronLockService`. See "Robocall payment" below |
| `outreachRobocallStaging.service.ts`                | CallHub campaign staging (`OutreachRobocallStagingService`, `createPrismaBase(MODELS.OutreachRobocall)`): for an `authorized`, unstaged draft whose send is approaching, `stageCampaign` creates the PAUSED CallHub voice-broadcast campaign and persists its `callhubCampaignPkStr` + the COMPUTED `callhubStartingDate`/`callhubExpirationDate` (returned by `createVoiceBroadcast`, never null on success). Single-owner claim CAS (`callhubCampaignPkStr IS NULL` AND [`authorized`, OR `staging` gone stale past `ROBOCALL_STAGING_STALE_MINUTES` — a crashed run's stranded claim, reclaimed] → `staging`), CallHub calls (`uploadMedia` FIRST so a bad audio format fails cheap, THEN `loadAudienceToPhonebook` → `createVoiceBroadcast`) OUTSIDE any DB transaction, commit CAS (`staging → authorized` + fields), revert-to-`authorized` on any failure, and an orphan guard (a committed-nothing race logs the orphaned pk_str — a PAUSED campaign charges nothing; no delete). A `@Cron` sweep (`7,17,27,37,47,57 * * * *`, `EASTERN_TIMEZONE`) stages in-window drafts + reclaims stale staging rows; **prod-only** (`OTEL_SERVICE_ENVIRONMENT`, a rate-limited vendor); no `CronLockService` (the per-record claim makes it idempotent across replicas). STAGING ONLY — no dial/START, no Stripe. See "Robocall payment" below |
| `outreachRobocallSend.service.ts`                   | Send-time dial (`OutreachRobocallSendService`, `createPrismaBase(MODELS.OutreachRobocall)`): `startCampaign` STARTs a staged, still-paid draft's PAUSED CallHub campaign — the step that DIALS REAL PHONES. The two invariants: (1) NEVER dial twice — a single-owner claim CAS (`authorized` AND `callhubCampaignPkStr IS NOT NULL → dialing`) elects one dialer; a launch commits `dialed` ONLY when its response reads back status `START` (a 200 echoing PAUSE/null/`{}` is not trusted), and a lost response OR a non-STARTED 200 is NEVER blind-retried but reconciled against a fresh `CallhubCampaignReportService.getCampaignStatus(pkStr)` read (STARTED → commit `dialed`; PAUSED → revert `authorized`, safe to relaunch; unknown/read-fail → left `dialing` for the stale sweep); the commit CAS (`dialing → dialed` + `dialedAt`) records the launch. (2) NEVER dial unpaid — a FRESH `StripeService.retrievePaymentIntent(authorizationIntentId)` re-read AFTER the claim and BEFORE the launch must read `requires_capture`, else the draft goes `hold_failed` with the authorization fields CLEARED (so the hold service's `authorizationIntentId IS NULL` retry CAS can re-pick it) and emits `HoldFailed` (messageId `<id>:hold_failed_at_dial`) so the absent candidate gets the reminder email; it does not dial. `CallhubCampaignService.launchVoiceBroadcast(pkStr)` runs OUTSIDE any DB transaction; a Stripe-read failure BEFORE launch reverts `dialing → authorized` and rethrows; a commit-miss logs a CRITICAL alert with the pk_str (no safe un-dial). A compliance-pass gate is ANDed with the live-hold check: after the claim + hold re-read and BEFORE launch, a null `compliancePassedAt` (impossible given the create gate — belt-and-suspenders) reverts the claim to `authorized`, does NOT dial, and logs CRITICAL. The `@Cron` sweep (`4,14,24,34,44,54 * * * *`, `EASTERN_TIMEZONE`) dials `authorized` + staged arrived drafts AND recovers rows stranded in `dialing` past `ROBOCALL_DIALING_STALE_MINUTES` via the same status read (stale-guarded reclaim CAS elects one recoverer); **prod-only AND behind the `ROBOCALL_SEND_ENABLED` kill-switch** (default OFF — the deliberate enable-switch for the supervised live dial test); no `CronLockService` (the per-record claims make it idempotent across replicas). READS the hold only — no capture/void, no completion poll. See "Robocall payment" below |
| `outreachRobocallAudio.service.ts`                  | Builds a campaign-scoped object key (`robocall/<campaignId>/<uuid>.<ext>`) and returns a presigned S3 POST (`S3Service.createPresignedUpload`, a `content-length-range` policy capping bytes at `ROBOCALL_AUDIO_MAX_BYTES`), reading the bucket from `ROBOCALL_AUDIO_BUCKET` (throws at construction if unset). Stateless — no row is written                                                                                                                                                                                                                                                                                  |
| `robocallTranscription.service.ts`                  | Batch AWS Transcribe (`@aws-sdk/client-transcribe`, `StartTranscriptionJob` → poll → read the transcript JSON from S3) for a stored robocall recording. Batch, not the streaming path the mic dictation uses, because a stored webm/mp4/mp3 needs container decoding. Task role needs `transcribe:StartTranscriptionJob`/`GetTranscriptionJob` (granted in `deploy/index.ts`)                                                                                                                                                                                                                                                    |
| `robocallCompliance.service.ts`                     | Fail-closed compliance gate: transcribes the recording, then verifies via the LLM (temperature 0) that the FCC calling disclosures are actually spoken — candidate self-ID, organization name, callback number. Returns a `RobocallComplianceVerdict` (per-check booleans + transcript + issues). A transcription/LLM failure propagates as 502; it never silently passes. Distinct from the result sweep (ADR 0013) — this is a pre-send audio check, not a disposition writer                                                                                                                                                  |
| `robocallComplianceResult.service.ts`               | Persists + reads the compliance verdict (`RobocallComplianceResultService`, `createPrismaBase(MODELS.RobocallComplianceResult)`): `recordVerdict` UPSERTS a `passed` boolean + `checkedAt` keyed by `audioKey` (a re-check overwrites — the recording is the same object, so its latest verdict is the only one that gates); `findPassing` answers the create gate. Keyed by `audioKey` (not a draft/outreach id) because compliance runs BEFORE a draft exists. Does not touch `checkRecording`'s check logic — only stores its result                                                                                                  |
| `outreachComposeContext.service.ts`                 | Builds prompt blocks from the candidate's own materials — campaign story, stated issue positions, plan opportunities/challenges, trimmed for prompt size (product decision 2026-08-17: compose generation must ground in these; never invent positions). Every block optional; the no-materials fallback is name/place/office. Shared by social and phone-banking generation                                                                                                                                                                                                                                                   |
| `outreachCompletion.service.ts`                     | Hourly cron: flips Peerly jobs to `completed` once the job's `end_date` day has passed — a time proxy, `leads_remaining` was disproven (ENG-10739). One-way status ratchet                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `outreachInboundSweep.service.ts`                   | Hourly cron (offset :30 from the completion sweep) pulling Peerly CDR/response reports into `ContactInteractionText` inbound events                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `outreachMaterialization.service.ts`                | At launch, resolves the audience filter into per-recipient `ContactInteraction*` rows (text/p2p/robocall only; paged, capped at 100k)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `robocallPhonebook.service.ts`                      | First link of the robocall send chain (invoked by a later send slice, no HTTP route yet): resolves a saved voter list to its landline numbers (forces `hasLandline`, reads each person's `landline`, deduped/digits-only, paged + capped at 100k like materialization), uploads a phone-in-column-0 CSV to `ROBOCALL_AUDIO_BUCKET` and presigns a 1h GET (CallHub fetches the CSV async), creates a fresh CallHub phonebook, fires `CallhubBulkImportService.importContacts`, then polls `CallhubPhonebookService.getContactCount` until the async load reaches the expected total. Returns `{ phonebookPkStr, importedCount }` (local interface — not consumed cross-service). No dialing, no voice-broadcast campaign |
| `outreachNotification.service.ts` + `interceptors/` | CAS Slack notifications. The interceptor wraps the legacy controller so a failed (possibly paid) send attempt notifies before rethrowing; it sits OUTSIDE `FilesInterceptor` so multipart-parse failures are caught too                                                                                                                                                                                                                                                                                                                                                                                                        |

## Draft-first purchase (p2p)

The client creates the outreach with `draft: true` BEFORE payment → row
stored `pending_payment` (hidden from `GET /outreach`); the draft id rides in
the checkout-session metadata as `outreachId`. On payment completion the
Stripe webhook path calls `finalizeOutreachPurchase`: atomic claim
`pending_payment → pending`, then `submitDraftToPeerly` (re-reads the image
from S3); a Peerly failure reverts the status and rethrows so Stripe retries.
`schemas/createOutreachSchema.ts`: only p2p may be a draft, and clients can
never send `pending_payment` themselves.

## Robocall payment (hold + capture-actual)

Robocall billing is a hold-then-capture-actual model, not prepay-on-estimate:
authorize a hold on the estimate before the call dials, then capture for the
ACTUAL billable count CallHub reports. `POST /outreach/robocall`
(`OutreachRobocallService.createDraft`) is the foundation — it persists the
`pending_payment` spine + `OutreachRobocall` satellite and returns the
server-derived estimate. The satellite's `settleState` (`RobocallSettleState`
enum: `pending_payment → hold_pending → authorized → settling →
captured|charged`, plus the `hold_failed` decline terminal and the
`voided|cancelled|disputed|uncollectable` terminals) tracks the lifecycle, and
the satellite carries the Stripe (customer / payment-method / authorization &
charge intent / captured amount) and CallHub (campaign / dial-window) fields the
later slices fill.

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
  so the deferred sweep bills exactly that card. This stores WHICH card to later
  charge — no hold, no money moved. The daily deferred sweep
  (`outreachRobocallDeferredHold.service.ts`) places it once the send enters the
  window. The window must be strictly under `auth_lifetime − run − settle`
  (`~7d − 48h − 24h = 4d`) so a window-edge send still clears the capture-window
  fit below; 3 days (3d + 72h = 6d) fits even a `capture_before` that lands under
  a full 7 days.
- **Placement CAS + idempotency.** A conditional `updateMany`
  (`pending_payment` + `authorizationIntentId IS NULL → hold_pending`) elects a
  single placer; count 0 means a concurrent placer won or the draft already
  advanced → return the current state (`authorized` echoes the frozen amount,
  else `noop`), no hold. The Stripe hold uses idempotency key
  `robocall-hold-<outreachId>-<attempt>` (attempt = `payAttempt + 1`), and the
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
  charges nothing and a later reconciliation slice cleans it.
- **INV-2 testing cap.** The re-derived estimate over
  `ROBOCALL_PER_RUN_CEILING_CENTS` ($500) reverts `hold_pending →
  pending_payment`, logs `error` (human alert), and 409s — no hold. Raise/remove
  the cap once real runs validate.
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
  `hold_pending`; the orphan hold auto-expires / the reverse-reconciliation slice
  reclaims it.
- **Milestones.** `EVENTS.Robocall.HoldPlaced` / `HoldFailed`, emitted ONLY from
  the winning transition via `AnalyticsService.track` with a deterministic
  Segment messageId (`<outreachId>:hold_placed` / `<outreachId>:hold_failed`) so
  a replay dedups to one email. The emit is best-effort (a Segment failure logs,
  does not rethrow) — the money op already committed, so a lost email must not
  500 the request onto the noop path. The send slice fires `HoldFailed` a second
  legitimate time when a hold is found dead AT DIAL, under a distinct messageId
  (`<id>:hold_failed_at_dial`). Capture/deferred-sweep/reminder-retry-cancel are
  later slices.

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
  never mark dialed without a STARTED read) for the stale-dialing sweep, and alert. A commit-miss (the draft moved underneath) means the campaign may be
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
`EASTERN_TIMEZONE`, **prod-only AND behind `ROBOCALL_SEND_ENABLED`** — default
OFF, the deliberate enable-switch for the supervised live dial test; no
`CronLockService` — the per-record claims are idempotent across replicas) dials
`authorized` + staged arrived drafts (per-record `try`/`catch`) AND recovers rows
stranded in `dialing` past `ROBOCALL_DIALING_STALE_MINUTES` — a stale-guarded
reclaim CAS elects one recoverer, which reconciles via the same status read
(STARTED → `dialed`, PAUSED → `authorized`, else left `dialing`). It READS the
hold only — no capture/void, no CallHub completion poll.

## Gotchas / invariants

- The script reaches Peerly VERBATIM (one default MMS template,
  `vendors/peerly/services/peerlyP2pJob.service.ts`). Any client-side
  script composition is a UI guarantee only — nothing server-side
  validates it.
- Script cap: `P2P_SCRIPT_MAX_LENGTH` (2000, contracts) enforced at schema,
  service, and Peerly pre-flight.
- Imageless text/p2p sends are rejected at three layers (controller, schema,
  service).
- Satellite convention: a channel gets its own table only when its data
  changes shape. `OutreachSocial` + `OutreachSocialAsset` are the first
  pair; texting writes through the spine's legacy columns because the
  Peerly backend is unchanged. Legacy rows are never migrated.
- Office name for compose prompts comes from the org's election-api position
  (`resolvePositionNameByOrganizationSlug`), degrading to
  `details.normalizedOffice` — office is prompt enrichment, so an
  election-api failure must not fail the draft.
- Social generation is synchronous and stateless: nothing persists until
  the save call, so a failed generate has a blast radius of one request.
  Phone banking draft is stateless the same way and has no save call at
  all — the create flow freezes the chosen script onto the phone-banking
  list itself, not onto an `Outreach` row.
- Tone vocabulary (`util/messageTone.util.ts`) is shared across every
  stateless compose endpoint — don't redefine `TONE_STYLES` per channel.
- `nativePhoneBanking` and `nativeDoorKnocking` envelopes are never touched
  by `OutreachMaterializationService` — same reasoning as the exclusion
  above. The nativePhoneBanking envelope flips to `completed` from inside
  `PhoneBankingCallService` (`src/phoneBanking/`, ENG-10915), in the same
  transaction as the interaction-row upsert that logs the last un-logged
  person, once every person on every entry has a row. `nativeDoorKnocking`
  flips too, but on a different trigger: the canvasser ending the session
  (`POST /v1/door-knocking/turfs/:id/complete`), not exhaustion of the roster
  — a walk is routinely finished with doors left unlogged, so "every person
  has a row" would almost never fire. The turf's `completedAt` is the source
  of truth and the envelope's status is a mirror of it, because the envelope
  needs a `campaignId` and Serve orgs knock without one; see
  `docs/door-knocking.md`.
- **Robocall materializes recipients and captures no delivery outcome, and
  `answeredAt`/`voicemailLeftAt` on those rows are permanently null (ADR
  0013).** There is no robocall vendor integration to sweep: CallHub is named
  only in prose, Peerly's integration is its P2P texting product (the CDR
  report is SMS-shaped), robocall outreaches never get a `projectId`, and the
  channel has no send step — fulfillment is CAS's, out of band, off the legacy
  `POST /outreach` Slack. The two columns ARE written, but only by the manual
  per-person log (`ContactInteractionsController`, `outreachId: null` by
  design), so the same null means "logged as not answered" on a manual row and
  "never observed" on a campaign row. `OutreachInboundSweep` is text/p2p only
  and must stay that way until the vendor question is settled — **do not build
  a partial robocall sweep**; half-populating those columns turns "we never
  looked" into a disposition. ADR 0013 costs the real thing.
- `Outreach.archivedAt` (nullable, unset at creation) backs the v2 history
  drawer's archive/restore action. `OutreachService.setArchived` scopes the
  update by `organizationSlug` (not `campaignId`) and reads the response back
  from the persisted row rather than trusting the request body.
- **Door knocking archives on the turf, and this row is mirrored off it.**
  `DoorKnockingTurf.archivedAt` is what the list rail acts on, for the same
  reason `completedAt` lives there: a Serve org archives a list it has no
  envelope for. `DoorKnockingTurfService.setArchived` therefore writes both,
  in one transaction, the same way it mirrors `status` on complete —
  `updateMany` on `doorKnockingRouteId`, so a Serve org's missing envelope is a
  no-op. Restore clears both. **The turf is the source and this is the
  projection**, so the mirror writes the turf's timestamp rather than its own
  `now`, and it runs BEFORE that method's idempotence guard so a list archived
  before the mirror shipped can be repaired by pressing Archive again.
  `DoorKnockingTurfService.setArchived` is still the ONLY writer of the pair:
  the history drawer now offers Archive on a door-knocking row, but that button
  calls the turf's endpoint, not `OutreachService.setArchived`, which can reach
  the envelope alone. See `docs/door-knocking.md`.
- **`OutreachDetail.doorKnocking` is the door-knocking satellite block**, the
  sibling of `phoneBanking`, filled by `OutreachSocialService.findDetail` for a
  `nativeDoorKnocking` row. It needed no column: the envelope's
  `doorKnockingRouteId` reaches `door_knocking_route`, whose `doorKnockingTurfId`
  is `@unique`, so route → turf is one hop. Its three counts come from
  `DoorKnockingTurfCountsService` — the SAME aggregate the door-knocking rail
  reads — and must keep coming from there: a second derivation is the
  two-denominator failure ADR 0010 forbids. `OutreachModule` imports
  `DoorKnockingModule` behind a `forwardRef` for it (the module graph loops back
  through contacts → campaigns → peerly). A tombstoned turf yields no block.

## Contracts / models

- `@goodparty_org/contracts` `src/outreach/`: `OutreachSocial.schema.ts`,
  `OutreachScript.const.ts`, `PhoneBankingScript.schema.ts`,
  `RobocallScript.schema.ts` (purpose enum + draft request/response),
  `RobocallAudio.schema.ts` (presign request/response + allowed audio MIME
  types + `ROBOCALL_AUDIO_MAX_BYTES` cap),
  `RobocallCompliance.schema.ts` (the transcription-verdict shape: per-check
  booleans + transcript + issues),
  `RobocallPurchase.schema.ts` (the draft-create request/response for
  `POST /outreach/robocall`),
  `RobocallHold.schema.ts` (the authorize request `{ paymentMethodId }` +
  response `{ status, settleState, authorizedAmountInCents }` for
  `POST /outreach/robocall/:outreachId/authorize`).
- Prisma: `outreach.prisma` (spine), `outreachSocial.prisma` +
  `outreachSocialAsset.prisma` (social satellite), `outreachRobocall.prisma`
  (`OutreachRobocall` payment/state satellite + the `RobocallSettleState` enum;
  its `compliancePassedAt` mirrors the passing verdict at create so the dial
  gate has a per-draft fact), `robocallComplianceResult.prisma`
  (`RobocallComplianceResult`: `audioKey` unique, `passed`, `checkedAt` — the
  per-audioKey verdict store the create gate reads). Phone banking's own tables
  (`PhoneBankingList`, `PhoneBankingListEntry[Person]`,
  `ContactInteractionPhoneBanking`, `PhoneBankingSuppressedPhone`) and
  controller/service live in a separate `src/phoneBanking/` module — this
  package only owns the stateless draft/improve endpoint above.

## Tests

`tests/` runs through the HTTP harness (`useTestService`) with LLM calls
mocked at `LlmService`: `outreachSocial.test.ts` covers the compose + save
endpoints; `outreachPhoneBanking.test.ts` covers the phone-banking draft
endpoint (Pro gate, per-purpose prompt assembly, improve mode);
`outreachRobocall.test.ts` covers the robocall draft endpoint (grounding,
first-person self-ID opener + compliance ban, voting-logistics placeholders,
improve mode, custom-without-draft rejected, Pro gate, LLM failure → 502);
`outreachRobocallAudio.test.ts` covers the audio presign endpoint (URL +
campaign-scoped key + extension mapping, invalid content type, Pro gate),
mocking `S3Service.createPresignedUpload`;
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
placement (idempotency key `robocall-hold-<id>-1`, satellite persisted,
`authorized`, `HoldPlaced` once), the 5-day defer, the INV-2 ceiling → 409 +
revert, a decline → `hold_failed` + `HoldFailed` (not a 502), a payment method
not on the customer → 400, a too-short `capture_before` → void + 400, the
already-authorized/in-flight no-double-hold paths + the lost-commit void, a
`hold_failed` re-authorize clearing any prior staged campaign fields (pkStr +
dates → null), and the Pro gate — mocking the private Stripe client,
`deriveBillableCount`, and `AnalyticsService.track`;
`outreachRobocallStaging.test.ts` covers CallHub campaign staging directly on
the service (no HTTP route): happy-path stages once and persists pk_str + the
computed window, media uploads before the phonebook is created, an already-staged
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
+ `dialedAt`; NEVER-UNPAID (a non-`requires_capture` hold and a missing intent
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
`dialed` draft not re-dialed; the commit-miss CRITICAL alert; and the sweep dials
only arrived drafts once across repeat runs, continues past a failing draft,
no-ops off prod, and no-ops when `ROBOCALL_SEND_ENABLED` is unset even on prod —
mocking `CallhubCampaignService.launchVoiceBroadcast`,
`CallhubCampaignReportService.getCampaignStatus`,
`StripeService.retrievePaymentIntent`, and `AnalyticsService.track`;
`outreachRobocallDeferredHold.test.ts` covers the deferred flow: an
out-of-window authorize persists the chosen card + returns `deferred` with no
hold (and an invalid PM — wrong customer / non-card — 400s and persists
nothing), and the sweep places a hold via `authorizeHold` for an in-window
card-set draft, skips a no-card / out-of-window / already-authorized draft,
does not double-place on a second sweep, and no-ops off prod or with the
kill-switch off — spying on `authorizeHold` and the Stripe intent create;
`outreachFlow.test.ts` covers the submission contract, the draft-first
purchase path, and the failure-still-Slacks interceptor behavior.
