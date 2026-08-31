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
| `POST /outreach/robocall/number`                                                                                        | `outreachRobocall.controller.ts`      | Rents a fresh CallHub caller-ID number for this robocall (VO 2.0 robocall): stateless, Pro-gated the same way. Returns `{ phoneNumber, region }` via `CallhubNumbersService`. The candidate reads it aloud as the callback number, so it's rented before the disclosure draft. Rent-per-robocall (spam-flagging); the CallHub account auto-un-rents idle numbers. Requests a number local to the campaign's zip (`resolveRobocallAreaCode` in `util/robocallAreaCode.util.ts`, via `AreaCodeFromZipService`); a missing/unresolvable zip or CallHub having no local inventory all degrade to a plain national rental rather than failing the request (CallHub itself never errors on an exhausted prefix — it silently substitutes a national number, logged when detected)                                                                                          |
| `POST /outreach/robocall/audio/presign`                                                                                 | `outreachRobocallAudio.controller.ts` | Presigned S3 POST for the recorded robocall audio (VO 2.0 robocall): stateless, Pro-gated the same way. Returns `{ url, fields, key, expiresIn }`; the browser submits a multipart form to `ROBOCALL_AUDIO_BUCKET` and holds the key until the send is created in a later step. It's a POST (not PUT) so the policy's `content-length-range` lets S3 reject an oversize upload at upload time |
| `POST /outreach/robocall/compliance`                                                                                    | `outreachRobocall.controller.ts`      | Fail-closed compliance gate for the recorded audio (VO 2.0 robocall): Pro-gated the same way. Confirms the `audioKey` belongs to THIS campaign (prefix `robocall/<campaignId>/`, so a caller can't check another campaign's recording), derives candidate + organization server-side, then runs `RobocallComplianceService.checkRecording` on `{ audioKey, contentType }`. Everything the transcript is checked against is server-derived — the callback-number check only confirms a number is spoken, so the client has no expected value to spoof it with (the caller-ID voters reach is enforced at dial time). Returns the `RobocallComplianceVerdict`; a transcription/LLM failure is 502. After the check returns, the verdict is UPSERTED (keyed by `audioKey`) as a `RobocallComplianceResult` via `RobocallComplianceResultService.recordVerdict` — a re-check overwrites — so the create gate has a durable server-side record (the check logic itself is untouched)                                                                                          |
| `POST /outreach/robocall`                                                                                               | `outreachRobocall.controller.ts`      | Draft-first create (VO 2.0 robocall), Pro-gated the same way. Confirms the `audioKey` belongs to THIS campaign (prefix `robocall/<campaignId>/`), REQUIRES a persisted PASSING `RobocallComplianceResult` for that `audioKey` (else 400 `Robocall audio has not passed compliance` — the server-side backstop under the client UI gate), then persists the `pending_payment` spine + `OutreachRobocall` satellite (settleState `pending_payment`, `compliancePassedAt` stamped from the verdict's `checkedAt`) in one transaction. Billable count + amount are derived server-side from `voterFileFilterId` (landline forced) — never a client count — and returned for the pay-step estimate. The only robocall write; hold + settlement are later slices                                                                                                        |
| `POST /outreach/robocall/:outreachId/authorize`                                                                         | `outreachRobocall.controller.ts`      | Places the pay-time manual-capture Stripe hold on a scheduled `pending_payment` draft (VO 2.0 robocall), Pro-gated the same way. Body `{ paymentMethodId }`. RESERVES REAL MONEY: a single-owner placement CAS (`pending_payment → hold_pending → authorized`), the server-re-derived + frozen estimate, the $500 testing ceiling, the 3-day window (else `deferred`), and the capture-window fit — all in `OutreachRobocallHoldService.authorizeHold`. See "Robocall payment" below. No capture/CallHub/sweep/retry here                                                                                                        |
| `POST /outreach/serve/social/draft` / `serve/social/generate` / `serve/social` (save), `GET /outreach/serve`, `GET /outreach/serve/:id`                                | `outreachServeSocial.controller.ts`   | Serve counterpart to the social flow above (ENG-10970): org-scoped via `@UseElectedOffice()` (the server-side mirror of the webapp's `serveAccess()` — 404s an org with no `ElectedOffice` row), never a campaign. Compose shares `OutreachSocialGenerationService`/`OutreachSocialService`/`OutreachService` with Win, parametrized by a `SocialVoiceConfig` (elected-official purpose vocabulary + system prompts) and a scope (`{ campaignId: null, organizationSlug }`) rather than forking any of them. Archive/restore reuses `PATCH /outreach/:id/archive` on the social controller unchanged (already `organizationSlug`-scoped)                                                                                                        |

`GET /outreach/:id` deliberately lives on the social controller: detail reads
must stay outside `OutreachNotificationInterceptor` — a 404 there would fire
a CAS failure Slack meant for send attempts. Same reasoning keeps
`GET /outreach/serve/:id` off that interceptor.

## Services

| Service                                             | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `outreach.service.ts`                               | Spine CRUD + `finalizeOutreachPurchase` (see below). `findByCampaignId` (Win, 404s if empty) and `findByOrganizationSlug` (Serve, empty array is fine — a fresh org has no history) both call a shared private `findByScope({ campaignId } \| { organizationSlug })` rather than duplicating the query                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `outreachPurchase.service.ts`                       | The `PurchaseType.TEXT` purchase handler (registered in the module constructor). Re-derives the billable count server-side from the phone-list token (Peerly `leads_loaded`, falling back to captured recipient rows) — the client's `contactCount` is never trusted for billing. Applies the free-texts (5,000) discount server-side                                                                                                                                                                                                                                                                                          |
| `outreachSocial.service.ts`                         | Saves/reads the social satellite: spine (status `completed` — nothing is sent, so no lifecycle) + `OutreachSocial` + `OutreachSocialAsset` rows in one transaction. `saveSocialOutreach`/`findDetail` take a scope (`{ campaignId, organizationSlug }` for Win, `{ campaignId: null, organizationSlug }` for Serve) rather than a `Campaign` — the Win/Serve isolation boundary, ENG-10976                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `outreachSocialGeneration.service.ts`               | Stateless LLM compose (temperature 0.8, Zod-validated output): one draft per draft/improve call, all per-platform assets in one structured generate call. Fresh generation is refused for the `custom` purpose (improve allowed); improve is a detail-preserving polish, never new content. Per-surface voice (purpose goals + the 3 system prompts + the name label/fallback) is a `SocialVoiceConfig` the caller passes in — `WIN_SOCIAL_VOICE` (byte-identical to the pre-Serve strings) and `SERVE_SOCIAL_VOICE` (elected-official framing, no "candidate"/"voters"); everything else (platform rules, output schemas, the LLM call) stays single-sourced                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `outreachPhoneBankingGeneration.service.ts`         | Stateless LLM compose for call scripts, same shape as social generation. Per-purpose structure (volunteer opener, why-statement, issue-ID question for `persuade`, real election-day/early-voting dates for `vote-early`/`election-day` — grounded from `campaign.details` and, for `vote-early` only, a live `CampaignsService.fetchLiveRaceTargetMetrics` milestones fetch — with no bracket placeholders anywhere except `[your name]` and the voter-name token (`VOTER_NAME_TOKEN`, contracts), which the caller page interpolates with the active contact's first name); hard-bans SMS/robocall compliance lines (`Reply STOP`, `Paid for by`, callback numbers) since a volunteer reads this live                                                          |
| `outreachRobocallGeneration.service.ts`             | Stateless LLM compose for the recorded robocall message, same shape again. Differs from phone banking in the opener — a robocall is the CANDIDATE speaking, so the rule is a first-person self-ID (`This is [first name], candidate for [office]`), not a volunteer intro — and in length (about 40-75 words, four or five short sentences, well inside a 60-second recording). Compliance is conditional on the request's `callbackNumber`: with no number the `Paid for by` disclaimer / callback number / opt-out are banned (the number isn't rented until compose); once a number is passed, the script MUST end with the spoken disclosure ("paid for by" + that number), which is what the compliance gate later verifies. Refuses fresh generation for `custom` (improve allowed), like social |
| `outreachRobocall.service.ts`                       | Persists the robocall draft (`OutreachRobocallService`, `createPrismaBase(MODELS.OutreachRobocall)`): `deriveBillableCount` (the saved list resolved with `hasLandline` forced → people-db total, never a client count), `assertReachableCount` (a 0-landline audience is not purchasable), the future-schedule guard, the `ROBOCALL_MAX_SCHEDULE_DAYS` (85-day) max-schedule guard (`@/shared/util/robocallHold.util`, kept in sync with the webapp's `RobocallFlow` — no shared package reaches both), and `createDraft` (spine `pending_payment` + satellite settleState `pending_payment` in one transaction, then a best-effort `EVENTS.Robocall.Scheduled` milestone on a FRESH create only — messageId `<outreachId>:scheduled`, not re-emitted on the idempotent existing-draft return). No hold/Stripe/CallHub/settlement — the payment/callhub satellite fields stay unset until later slices                                                                                                                                                                                                                                                                                     |
| `outreachRobocallHold.service.ts`                   | The pay-time authorization hold (`OutreachRobocallHoldService`, `createPrismaBase(MODELS.OutreachRobocall)`): `authorizeHold` places a manual-capture Stripe hold off-session on the vaulted card for the server-re-derived, frozen estimate. Single-owner placement CAS (`pending_payment → hold_pending → authorized`), the $500 `ROBOCALL_PER_RUN_CEILING_CENTS`, the `ROBOCALL_HOLD_WINDOW_DAYS` (3) window, the capture-window fit, the decline-vs-502 split, and the `HoldPlaced`/`HoldFailed` milestones. The success commit ALSO nulls `callhubCampaignPkStr`/dates so a `hold_failed` re-auth (which re-derives the count) forces a fresh re-stage instead of dialing the stale phonebook. Both success paths (the authorize commit AND the deferred card-save) advance the SPINE `Outreach.status` `pending_payment → pending` via `markSpineScheduled` (guarded on `pending_payment`, so idempotent and never flips an unpaid/declined row) — the robocall lifecycle otherwise only moves the satellite settleState, and `findByCampaignId` filters `pending_payment` out, so without this a committed robocall never appears in `GET /outreach`. RESERVES REAL MONEY. See "Robocall payment" below                                                                                                                                                                                                                                                              |
| `outreachRobocallHoldRecovery.service.ts`           | Stale-`hold_pending` recovery (`OutreachRobocallHoldRecoveryService`, `createPrismaBase(MODELS.OutreachRobocall)`): a `@Cron` (`8,18,28,38,48,58 * * * *`, `EASTERN_TIMEZONE`) that rescues drafts stranded in `hold_pending` past `ROBOCALL_HOLD_PENDING_STALE_MINUTES` (15) — a placement that won the `pending_payment → hold_pending` claim but died before its commit / decline / revert. No other sweep touches `hold_pending`, so such a row is stuck AND a hold placed just before the crash reserves the card with nothing to capture or void it (the intent id is persisted only at commit, so it was never recorded). `recoverStaleHoldPending` re-claims via a stale-guarded self-transition CAS (writing `hold_pending` bumps `@updatedAt`, electing one recoverer), finds any live hold by the outreach metadata (`StripeService.findLiveManualHoldsByOutreach` — `status:requires_capture`), CANCELS it (release the money, the conservative direction) with the THROWING `cancelHold` (not best-effort `voidHold`), then reverts `hold_pending → pending_payment` with `payAttempt++` (fresh idempotency key on re-auth) and cleared authorization fields. A Stripe search OR cancel failure throws → the per-record catch leaves the row `hold_pending` (never revert with a possibly-live orphan still reserving funds) to retry next sweep — the throwing cancel is what makes that guarantee real (a swallowed void would silently revert and let a re-auth stack a second hold). Never places or captures — only voids + reverts — so **prod-only but deliberately NOT kill-switch-gated**: a `hold_pending` strand can happen during the supervised live test (placement is on-session, unswitched), and stranded reserved money is the harm. No `CronLockService` (per-record claim is idempotent across replicas). See "Robocall payment" below |
| `robocallOrphanedCampaign.service.ts`               | Records + reads the work queue of orphaned CallHub campaigns (`RobocallOrphanedCampaignService`, `createPrismaBase(MODELS.RobocallOrphanedCampaign)`): `record(pkStr, outreachId, reason)` upserts by `campaignPkStr` (idempotent — a redelivered write collapses to one row, and it never un-stamps `abortedAt`), `findUnaborted()` feeds the sweep, `markAborted(id)` stamps once via a CAS. Three callers record here (best-effort, DB-only, never a CallHub call in a request path): the hold service on a re-auth that nulls a staged campaign (`reason: reauth_restage`), the staging orphan-guard on a lost commit (`reason: staging_lost_commit`), and `failSend` when a permanent send failure abandons a staged PAUSED campaign (`reason: send_failed`) |
| `outreachRobocallCallhubCleanup.service.ts`         | Orphaned-campaign cleanup (`OutreachRobocallCallhubCleanupService`): a `@Cron` (`0,10,20,30,40,50 * * * *`, `EASTERN_TIMEZONE`) that reads `findUnaborted()` and `CallhubCampaignService.abortVoiceBroadcast`s each (ABORT, status 3 — the campaign can then never dial), then `markAborted`s it; per-record `try`/`catch` so one CallHub failure leaves that row unaborted to retry next pass (but `abortVoiceBroadcast` treats a 404 as already-retired, so a genuinely-gone campaign is stamped rather than retried against the rate-limited API forever). Only ever ABORTs pk_strs recorded at a known abandonment point (never an account-wide list-and-reconcile), so it can never abort a live, still-referenced campaign meant to dial. **prod-only** (`OTEL_SERVICE_ENVIRONMENT`) but deliberately **NOT kill-switch-gated** (ABORT only makes a campaign LESS likely to dial; a PAUSED orphan charges nothing, so this is account hygiene, not money safety); no `CronLockService` (the per-row `markAborted` CAS is idempotent across replicas) |
| `outreachRobocallDeferredHold.service.ts`           | Deferred hold placement (`OutreachRobocallDeferredHoldService`, `createPrismaBase(MODELS.OutreachRobocall)`): a daily `@Cron` (`13 8 * * *`, `EASTERN_TIMEZONE`) that finds `pending_payment` drafts with a card persisted at defer time (`paymentMethodId` + `stripeCustomerId` NOT NULL) whose send has entered the window (`now < outreach.date <= now + ROBOCALL_HOLD_WINDOW_DAYS`), loads user + campaign + organization, and calls `OutreachRobocallHoldService.authorizeHold` passing NO paymentMethodId — authorizeHold re-reads the row's persisted card AFTER winning the placement claim, so the sweep can never bill a card a concurrent re-authorize replaced after this sweep's snapshot. Trigger + context loader + per-record try/catch only — `authorizeHold` owns the placement CAS, the hold, the window-fit, and the milestones. When the persisted card is a GENUINE permanent problem (stale/foreign/non-card), authorizeHold escalates ATOMICALLY on its deferred path — it moves the `hold_pending` row it owns straight to `hold_failed` + emits `HoldFailed` and RETURNS a `hold_failed` result (never throws `RobocallCardError` on the no-PM path) — so the draft leaves the pending_payment candidate set (no daily retry storm) and the candidate is emailed, with NO separate sweep-level escalation call that could itself fail and strand the row. The sweep's catch only ever sees a transient/non-card error (a zero-audience or reschedule-race `BadRequestException`, or a transient 502): it is logged and the draft is left `pending_payment` to retry next pass. Idempotent across replicas via the placement CAS (an already-`authorized` draft leaves the candidate set). **prod-only** (`OTEL_SERVICE_ENVIRONMENT`) AND kill-switch-gated (`ROBOCALL_DEFERRED_HOLD_ENABLED`, default OFF — it reserves real money off-session); no `CronLockService`. A SECOND `@Cron` (`1,16,31,46 * * * *`) is the cancel-at-deadline cleanup (`sweepExpiredDeferred` → `cancelExpiredDeferred`): a deferred, card-persisted `pending_payment` draft whose `outreach.date <= now` (send passed with NO hold ever placed) is transitioned `pending_payment → cancelled` via a single-owner CAS + emits `Canceled` (messageId `${outreachId}:canceled`) so the candidate is told — no Stripe hold exists to void, and it flips the spine `pending → canceled` (best-effort, guarded on `pending`) so a now-visible deferred draft doesn't linger in history as "In review" (the same reflection the `payment_method.detached` webhook cancel makes). This cleanup is **prod-only but deliberately NOT kill-switch-gated**: the leak it rescues happens precisely when placement is disabled past the window, so gating it on `ROBOCALL_DEFERRED_HOLD_ENABLED` would strand the very drafts it exists to cancel. See "Robocall payment" below |
| `outreachRobocallStaging.service.ts`                | CallHub campaign staging (`OutreachRobocallStagingService`, `createPrismaBase(MODELS.OutreachRobocall)`): for an `authorized`, unstaged draft whose send is approaching, `stageCampaign` creates the PAUSED CallHub voice-broadcast campaign and persists its `callhubCampaignPkStr` + the COMPUTED `callhubStartingDate`/`callhubExpirationDate` (returned by `createVoiceBroadcast`, never null on success). Single-owner claim CAS (`callhubCampaignPkStr IS NULL` AND [`authorized`, OR `staging` gone stale past `ROBOCALL_STAGING_STALE_MINUTES` — a crashed run's stranded claim, reclaimed] → `staging`), CallHub calls (`uploadMedia` FIRST so a bad audio format fails cheap, THEN `loadAudienceToPhonebook` → `createVoiceBroadcast`) OUTSIDE any DB transaction, commit CAS (`staging → authorized` + fields), revert-to-`authorized` on any TRANSIENT failure (a PERMANENT `CallhubPermanentError` instead persists a `permanentSendFailure` marker on the `staging` row THEN surfaces via `failSend(outreachId, 'staging')` → `send_failed` + voided hold + `SendFailed` email; the stale reclaim reads that marker and fails the row rather than re-staging into the same reject if the earlier failSend never committed — mirrors the send slice, see "Send failures"), and an orphan guard (a committed-nothing race logs the orphaned pk_str — a PAUSED campaign charges nothing; no delete). A `@Cron` sweep (`7,17,27,37,47,57 * * * *`, `EASTERN_TIMEZONE`) stages in-window drafts + reclaims stale staging rows; **prod-only** (`OTEL_SERVICE_ENVIRONMENT`, a rate-limited vendor); no `CronLockService` (the per-record claim makes it idempotent across replicas). STAGING ONLY — no dial/START, no Stripe. See "Robocall payment" below |
| `outreachRobocallSend.service.ts`                   | Send-time dial (`OutreachRobocallSendService`, `createPrismaBase(MODELS.OutreachRobocall)`): `startCampaign` STARTs a staged, still-paid draft's PAUSED CallHub campaign — the step that DIALS REAL PHONES. The two invariants: (1) NEVER dial twice — a single-owner claim CAS (`authorized` AND `callhubCampaignPkStr IS NOT NULL → dialing`) elects one dialer; a launch commits `dialed` ONLY when its response reads back status `START` (a 200 echoing PAUSE/null/`{}` is not trusted), and a lost response OR a non-STARTED 200 is NEVER blind-retried but reconciled against a fresh `CallhubCampaignReportService.getCampaignStatus(pkStr)` read (STARTED → commit `dialed`; PAUSED → revert `authorized` for a transient error, or — when the launch error was a `CallhubPermanentError` — `failSend(outreachId, 'send')` → `send_failed` + voided hold + `SendFailed` email; unknown/read-fail → left `dialing` for the stale sweep, unless the launch error was permanent, which persists a `permanentSendFailure` marker and `failSend`s even on a read-fail since a 4xx guarantees the campaign never STARTED — and the stale sweep reads that marker so a permanently-failed strand whose `failSend` never committed is failed, never reverted-and-relaunched into the same reject); the commit CAS (`dialing → dialed` + `dialedAt`) records the launch. (2) NEVER dial unpaid — a FRESH `StripeService.retrievePaymentIntent(authorizationIntentId)` re-read AFTER the claim and BEFORE the launch must read `requires_capture`, else the draft goes `hold_failed` with the authorization fields CLEARED (so the hold service's `authorizationIntentId IS NULL` retry CAS can re-pick it) and emits `HoldFailed` (messageId `<id>:hold_failed_at_dial`) so the absent candidate gets the reminder email; it does not dial. `CallhubCampaignService.launchVoiceBroadcast(pkStr)` runs OUTSIDE any DB transaction; a Stripe-read failure BEFORE launch reverts `dialing → authorized` and rethrows; a commit-miss logs a CRITICAL alert with the pk_str (no safe un-dial). A compliance-pass gate is ANDed with the live-hold check: after the claim + hold re-read and BEFORE launch, a null `compliancePassedAt` (impossible given the create gate — belt-and-suspenders) reverts the claim to `authorized`, does NOT dial, and logs CRITICAL. The `@Cron` sweep (`4,14,24,34,44,54 * * * *`, `EASTERN_TIMEZONE`) dials `authorized` + staged arrived drafts AND recovers rows stranded in `dialing` past `ROBOCALL_DIALING_STALE_MINUTES` via the same status read (stale-guarded reclaim CAS elects one recoverer); **prod-only AND behind the `ROBOCALL_SEND_ENABLED` kill-switch** (default OFF — the deliberate enable-switch for the supervised live dial test); no `CronLockService` (the per-record claims make it idempotent across replicas). READS the hold only — no capture/void, no completion poll. See "Robocall payment" below |
| `outreachRobocallCapture.service.ts`                | Capture (`OutreachRobocallCaptureService`, `createPrismaBase(MODELS.OutreachRobocall)`): the money-capture half of settlement. For a run the completion sweep parked in `settling` with a confirmed `completedCallCount`, `captureDraft` captures the authorized hold for the ACTUAL billable amount. Single-owner claim CAS (`settling → capturing`), then a FRESH `StripeService.retrievePaymentIntent` re-read (never trust persisted state before moving money) decides: `requires_capture` → `capturePaymentIntent(min(calcRobocallTotalInCents(completedCallCount), authorizedAmountInCents), key=robocall-capture-<id>)` (INV-1 clamp; Stripe frees the remainder) → `capturing → captured` + `capturedAmountInCents` + `Receipt` milestone once; a zero-connected run is voided and the $2 number fee is released (whether the hold is live or already gone); the fee is collected only when at least one call connects; an already-`succeeded` PI → idempotent reconcile to `captured` off `amount_received` (no second capture); a lapsed/`canceled` hold → `capturing → uncollectable` + CRITICAL alert (delivered run we could not capture — never blind-charged; `outreachRobocallFreshCharge.service.ts` recovers it with a fresh off-session charge). A transient PI-read or capture-call failure reverts `capturing → settling` to retry. The `@Cron` sweep (`2,12,22,32,42,52 * * * *`, `EASTERN_TIMEZONE`) captures arrived `settling` runs ordered by `captureBefore` asc (expiry-priority, not FIFO, so a backlog never lets a hold lapse uncaptured); **prod-only AND behind the `ROBOCALL_CAPTURE_ENABLED` kill-switch** (default OFF — a SECOND deliberate enable, distinct from `ROBOCALL_SEND_ENABLED`, so dialing and charging are two separate switches for the supervised live test); no `CronLockService` (the per-record claim is idempotent across replicas). MOVES REAL MONEY. See "Robocall payment" below |
| `outreachRobocallFreshCharge.service.ts`            | Fresh-charge recovery (`OutreachRobocallFreshChargeService`, `createPrismaBase(MODELS.OutreachRobocall)`): for a DELIVERED run the capture slice parked in `uncollectable` because its hold lapsed before capture, charges the saved card OFF-SESSION (`StripeService.createOffSessionCharge`, automatic capture — NOT a hold capture) for `min(calcRobocallTotalInCents(completedCallCount), authorizedAmountInCents)` (INV-1 clamp — a fresh charge can never exceed what was authorized). Single-owner claim CAS (`uncollectable → charging`, guarded on `chargeIntentId IS NULL`), stable idempotency key `robocall-fresh-charge-<id>` (a retry replays, never double-charges), then `charging → charged` + `chargeIntentId` + `capturedAmountInCents` + `Receipt` once. A decline commits back to `uncollectable` WITH the declined PI id in `chargeIntentId` (so the run is never re-attempted and a later dispute reconciles via the webhook) + CRITICAL; a transient infra failure reverts to `uncollectable` with NO `chargeIntentId` to retry. Stale-`charging` recovery (`ROBOCALL_CHARGING_STALE_MINUTES`, 15) re-runs the settle path — the stable key replays. Candidate filter requires count + authorized amount + saved card (a data anomaly is left for manual review, never charged blind). `@Cron` (`5,15,25,35,45,55 * * * *`, `EASTERN_TIMEZONE`), **prod-only AND behind `ROBOCALL_CAPTURE_ENABLED`** (default OFF — shares the capture money switch); no `CronLockService`. CHARGES A CARD WITHOUT A LIVE AUTHORIZATION — the riskiest money step, reached only for the rare lapsed-hold run. See "Robocall payment" below |
| `robocallOrphanedHold.service.ts`                   | Records + reads the queue of authorization-hold PaymentIntents whose best-effort `voidHold` may not have landed (`RobocallOrphanedHoldService`, `createPrismaBase(MODELS.RobocallOrphanedHold)`): `record(pkId, outreachId, reason)` upserts by intent id (idempotent, never un-stamps `voidedAt`), `findUnvoided()` feeds the sweep, `markVoided(id)` stamps once via a CAS. Recorded (best-effort) at every best-effort void site: the hold-service window-fit (`window_fit`) + lost-commit (`lost_commit`) voids (whose intent id is never persisted on the row), the capture zero-billable void (`zero_billable`), and the webhook cancel-before-send void (`cancel_before_send`) |
| `outreachRobocallHoldReconcile.service.ts`          | Orphaned-hold reconcile (`OutreachRobocallHoldReconcileService`): a `@Cron` (`3,13,23,33,43,53 * * * *`, `EASTERN_TIMEZONE`) that reads `findUnvoided()` and, per hold, re-reads the PI (`retrievePaymentIntent`) — `requires_capture` (the void did NOT land, hold still live) → `cancelHold` (THROWING) + stamp `voidedAt`; any terminal status (canceled/succeeded/expired) → stamp `voidedAt`, nothing to release; a read/cancel failure leaves the row to retry next sweep. Releases the candidate's reserved money rather than waiting out the ~7-day auth expiry. Only ever touches intent ids recorded at a real void site (never an account-wide scan), so it can NEVER void a hold a live run still needs. **prod-only** but deliberately **NOT kill-switch-gated** (voiding only releases money; an orphan can arise whenever a void fails regardless of the switches); no `CronLockService` (the per-row `markVoided` CAS is idempotent across replicas) |
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
from S3); a Peerly failure reverts the status and rethrows so Stripe retries
(except a content rejection, which propagates as a 400 carrying Peerly's own
message — the webhook handler acks it rather than retrying a permanent error).
`schemas/createOutreachSchema.ts`: only p2p may be a draft, and clients can
never send `pending_payment` themselves.

## Robocall payment (hold + capture-actual)

Robocall billing is a hold-then-capture-actual model, not prepay-on-estimate:
authorize a hold on the estimate before the call dials, then capture for the
ACTUAL billable count CallHub reports. Every money figure is
`calcRobocallTotalInCents` = per-call cost (`calcRobocallAmountInCents`) + the
flat `ROBOCALL_NUMBER_FEE_CENTS` ($2) rental for the outgoing caller-ID number.
The fee is authorized up front and captured for every run that connects at
least one call. A run that connects zero calls releases the whole hold, fee
included (`voided`), whether the hold is live or lapsed at capture time (see
capture INV-1 below). `POST /outreach/robocall`
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
  charges nothing and is recorded (best-effort) in `RobocallOrphanedCampaign` so
  the CallHub cleanup sweep ABORTs it.
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
`EASTERN_TIMEZONE`, **prod-only AND behind `ROBOCALL_SEND_ENABLED`** — default
OFF, the deliberate enable-switch for the supervised live dial test; no
`CronLockService` — the per-record claims are idempotent across replicas) dials
`authorized` + staged arrived drafts (per-record `try`/`catch`) AND recovers rows
stranded in `dialing` past `ROBOCALL_DIALING_STALE_MINUTES` — a stale-guarded
reclaim CAS elects one recoverer, which reconciles via the same status read
(STARTED → `dialed`, PAUSED → `authorized`, else left `dialing`). It READS the
hold only — no capture/void, no CallHub completion poll.

**Send failures (surface vs retry).** A CallHub error is only surfaced to the
candidate when it is PERMANENT — a request we can never make succeed by retrying
(a 4xx/validation reject: bad audio format, a malformed campaign, a rejected
launch). The signal is typed at the vendor layer: `CallhubErrorHandlingService`
throws `CallhubPermanentError` (a `BadGatewayException` subclass, still a 502
externally so no other caller's behavior changes) for a non-429 4xx, and a plain
`BadGatewayException` for everything transient (429, 5xx, a lost response). The
staging and send services branch on `err instanceof CallhubPermanentError`:
permanent → `OutreachRobocallHoldService.failSend(outreachId, 'staging' | 'send')`
and return (no rethrow, no retry); transient → the existing revert-claim + rethrow
so the sweep retries next pass. `failSend` is the single surface path: a
single-owner CAS moves the satellite `authorized|staging|dialing → send_failed`
(count 0 → a concurrent winner already handled it, return), VOIDS the hold if one
is live (`StripeService.voidHold` best-effort + `RobocallOrphanedHoldService.record`
with reason `send_failed` so the reconcile sweep re-voids a missed release — NO
phone was dialed, so nothing is owed), records any staged PAUSED campaign
(`callhubCampaignPkStr`) in `RobocallOrphanedCampaign` (`reason: send_failed`,
best-effort) so the cleanup sweep ABORTs it rather than leaving it in CallHub,
flips the SPINE `Outreach.status → failed`
(guarded on `pending|pending_payment`, best-effort, like `markSpineScheduled`), and
emits `EVENTS.Robocall.SendFailed`. It logs CRITICAL as an ops hook (the alert
wiring in `deploy/components/alerts.ts` is a separate follow-up). The SEND path
only fails AFTER the status reconcile CONFIRMS the campaign never STARTED (PAUSED)
— a permanent launch error whose status reads STARTED still commits `dialed`, never
`send_failed`, because a dialed run must never have its hold voided. Symmetrically,
the completion poll's PERMANENT schema mismatch (a `ZodError` on the
`credits_usage` read) routes a DELIVERED run to `uncollectable` + CRITICAL, NOT
`send_failed` — money may be owed on a run that already dialed. `send_failed` is
strictly pre-delivery.

**Capture (settlement).** `OutreachRobocallCaptureService.captureDraft` captures
the authorization hold for the ACTUAL completed-call count once the completion
sweep parks the run in `settling` with a confirmed `completedCallCount`. This
MOVES REAL MONEY. Invariants:

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
  captured amount is
  `min(calcRobocallTotalInCents(completedCallCount), authorizedAmountInCents)`
  (calls + the flat number fee) — clamped to the authorized hold, so a count that
  somehow exceeds the frozen estimate still cannot overcharge. Stripe releases the
  uncaptured remainder. A zero-connected run releases the hold (fee included) →
  `voided`; only runs with at least one connected call are captured. The capture idempotency key is stable
  (`robocall-capture-<outreachId>`, the amount being deterministic per run) so a
  lost response replays instead of double-charging.
- **Receipt + terminal.** The commit CAS (`capturing → captured`) stamps
  `capturedAmountInCents` and emits `EVENTS.Robocall.Receipt` once (deterministic
  messageId `<outreachId>:receipt`, best-effort — the capture already committed).
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
  FIFO — a backlog must never let a hold lapse uncaptured); **prod-only AND behind
  `ROBOCALL_CAPTURE_ENABLED`** (default OFF — a SECOND deliberate money switch,
  distinct from `ROBOCALL_SEND_ENABLED`, so dialing and charging are enabled
  separately for the supervised live test); no `CronLockService` (the per-record
  claim is idempotent across replicas). **PRE-LIVE GATE:** before flipping the
  switch, verify CallHub `credits_usage` `voice_calls` is per-campaign-attributable
  and final for a real run (the only path that could record an over-count; INV-1
  still caps the charge either way).

**Fresh-charge recovery (lapsed hold).** `OutreachRobocallFreshChargeService.chargeUncollectable`
recovers a DELIVERED run the capture slice parked in `uncollectable` because its
authorization hold lapsed (expired/canceled) before capture. It charges the saved
card OFF-SESSION — a fresh charge WITHOUT a live pre-authorization
(`StripeService.createOffSessionCharge`, automatic capture), the riskiest money
step, so it is gated behind `ROBOCALL_CAPTURE_ENABLED` and reached only for the
rare lapsed-hold run. Invariants:

- **INV-1.** The charge is `min(calcRobocallTotalInCents(completedCallCount),
  authorizedAmountInCents)` (calls + the flat number fee) — a fresh charge can
  never exceed what the candidate originally authorized.
- **Single-owner + never-twice.** A conditional `updateMany` (`uncollectable →
  charging`, guarded on `chargeIntentId IS NULL`) elects one charger; the stable
  idempotency key `robocall-fresh-charge-<id>` makes a retry replay the same PI
  instead of charging twice. Success commits `charging → charged` + `chargeIntentId`
  + `capturedAmountInCents` + a `Receipt` once.
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
  `robocall_fresh_charge` kind + outreachId metadata) and, if found, commits
  `charged` off it WITHOUT charging again — so recovery is idempotent independent
  of Stripe's 24h idempotency-key window, which the capture kill-switch's own
  toggling (crash → disable to investigate → re-enable next day) can outlast. The
  stable key is a second layer for within-window retries. Mirrors the capture
  slice's stale-`capturing` recovery.
- **Sub-minimum → voided (now defensive).** A run billing under Stripe's minimum
  ($0.50) is written off to `voided`, not charged — a fresh PaymentIntent below
  the minimum is REJECTED, and rounding up would overcharge. With the $2 number
  fee this cannot fire in practice: every run owes at least the fee, and a
  zero-connected run is `voided` at capture rather than parked uncollectable, so
  fresh charge never sees a sub-minimum amount. The branch is kept defensively —
  were the fee ever removed, it stops such a run failing-and-retrying forever by
  leaving the candidate set.
- **Sweep.** `@Cron` (`5,15,25,35,45,55 * * * *`, `EASTERN_TIMEZONE`), **prod-only
  AND behind `ROBOCALL_CAPTURE_ENABLED`** (shares the capture money switch — both
  are the settlement charge); no `CronLockService` (the per-record claim is
  idempotent across replicas). MOVES REAL MONEY.

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
failures are isolated. RESERVES REAL MONEY off-session, so it is gated behind
`ROBOCALL_DEFERRED_HOLD_ENABLED` (default OFF), the same switch as the deferred
sweep. Ops: the Stripe webhook endpoint must subscribe to `payment_method.attached`.

## Gotchas / invariants

- **Compliance is bound to the audio bytes by S3 ETag, not just the audioKey.**
  A presigned POST can overwrite a key with different bytes inside its expiry
  window, so a passing verdict on the key alone could be ridden by swapped audio.
  `recordVerdict` stores the object's ETag (`RobocallComplianceResult.audioEtag`)
  at check time; `createDraft` re-reads the CURRENT ETag, refuses a mismatch or a
  verdict with no bound ETag (400, no row), and FREEZES the matched ETag onto the
  draft (`OutreachRobocall.complianceAudioEtag`); staging re-reads the ETag of the
  exact bytes it is about to upload and refuses (502 + CRITICAL, claim reverted)
  anything but the frozen value — so bytes swapped after the create gate never
  reach voters. The draft's frozen ETag is the source of truth, NOT the mutable
  verdict, so re-running compliance on swapped bytes can't retroactively bless a
  live draft. `S3Service.getFileBytesWithContentType`/`headObject` return the ETag
  for this (`etag` optional on both so unrelated callers are unaffected).
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
- **The spine is org-scoped, not just campaign-scoped (ENG-10976).**
  `campaignId` is nullable — a Serve elected-office org (`eo-*` slug) has no
  campaign row, so a serve outreach row persists as `campaignId: null` +
  `organizationSlug` set. A DB CHECK (`outreach_scope_check`) requires at
  least one of the two, so a both-null orphan can never be created. This is
  also the Win/Serve isolation boundary: Win rows key on `campaignId` +
  the campaign org's slug, Serve rows key on `organizationSlug` WITH
  `campaignId: null` pinned in every serve query — Win rows carry BOTH
  fields, and one org can hold a Campaign and an ElectedOffice at once (the
  post-election transition), so the slug alone does not separate the
  surfaces. A serve write can never land in (or overwrite) a Win campaign's
  history, and a serve read can never surface a Win row.
  text/p2p/robocall/phone-banking/door-knocking still set `campaignId`; social
  is the first campaign-less writer, via `outreachServeSocial.controller.ts`
  (ENG-10970). `organization`'s FK is `Cascade`
  (not `SetNull`): an org-only row has no other anchor, so deleting its org
  must delete it too, rather than SetNull-ing `organizationSlug` into the
  both-null state the CHECK forbids. This is a no-op for Win rows — deleting
  an org already cascade-deletes its `Campaign` (`Campaign.organization` is
  `Cascade`), which cascade-deletes that campaign's `Outreach` rows via
  `campaignId` first.
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
  per-audioKey verdict store the create gate reads; `audioEtag` binds the verdict
  to the exact audio bytes, and `OutreachRobocall.complianceAudioEtag` freezes it
  onto the draft for the dial path), `robocallOrphanedCampaign.prisma`
  (`RobocallOrphanedCampaign`: `campaignPkStr` unique, `outreachId?`, `reason`,
  `abortedAt?` — the work queue of PAUSED CallHub campaigns abandoned before they
  could dial, ABORTed by the cleanup sweep), `robocallOrphanedHold.prisma`
  (`RobocallOrphanedHold`: `paymentIntentId` unique, `outreachId?`, `reason`,
  `voidedAt?` — the work queue of authorization holds whose best-effort void may
  not have landed, confirmed + re-voided by the reconcile sweep). Phone banking's own tables
  (`PhoneBankingList`, `PhoneBankingListEntry[Person]`,
  `ContactInteractionPhoneBanking`, `PhoneBankingSuppressedPhone`) and
  controller/service live in a separate `src/phoneBanking/` module — this
  package only owns the stateless draft/improve endpoint above.

## Tests

`tests/` runs through the HTTP harness (`useTestService`) with LLM calls
mocked at `LlmService`: `outreachSocial.test.ts` covers the compose + save
endpoints; `outreachServeSocial.test.ts` covers the Serve counterpart (a
draft per serve purpose asserting the serve goal/system prompt and no
candidate/voter framing, the Win-purpose-slug rejection, the ElectedOffice
404 gate on every route, custom/improve, LLM failure → 502) and the
Win/Serve isolation matrix (disjoint lists, cross-route 404s on detail, a
serve save leaving an existing Win row byte-unchanged, and archive/restore
on a serve row that cannot reach a Win row); `outreachPhoneBanking.test.ts`
covers the phone-banking draft
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
double-place on a second sweep, and no-ops off prod or with the kill-switch off;
and the cancel-at-deadline cleanup (`sweepExpiredDeferred`) cancels a deferred
card-persisted draft whose send passed + emits `Canceled` once EVEN WITH
`ROBOCALL_DEFERRED_HOLD_ENABLED` unset, leaves a still-in-window draft alone,
cancels once under a concurrent double-run (the CAS), and no-ops off prod —
spying on `authorizeHold`, `AnalyticsService.track`, and the Stripe intent
create;
`outreachRobocallCapture.test.ts` covers the capture directly on the service (no
HTTP route): happy-path captures the actual amount off a live hold (idempotency
key `robocall-capture-<id>`) and records the `Receipt` once; undercharge (fewer
calls than the estimate → the smaller amount); INV-1 (an actual over the hold
clamps to the authorized amount, never overbills); a zero-connected run voids
the hold and releases the fee, whether the hold is live or already gone; an already-`succeeded` PI reconciles to
`captured` off `amount_received` without a second capture; a lapsed/`canceled`
hold → `uncollectable` + CRITICAL (no blind charge); NEVER-TWICE (a concurrent
double-capture captures once via the claim CAS); a transient PI-read and a
capture-call failure both revert to `settling` to retry; a data anomaly (missing
intent) → `uncollectable` + CRITICAL; a non-settling draft is untouched; the
sweep captures an arrived run once across repeat runs, captures nearest-expiry
holds first (distinct intent ids prove the order), skips non-settling, no-ops off
prod, and no-ops with `ROBOCALL_CAPTURE_ENABLED` unset; and stale-`capturing`
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
missing the card/count, no-ops off prod and with `ROBOCALL_CAPTURE_ENABLED` unset;
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
double-sweep elects one recoverer; recovery runs even with
`ROBOCALL_DEFERRED_HOLD_ENABLED` unset (not kill-switch-gated); it no-ops off
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
`outreachFlow.test.ts` covers the submission contract, the draft-first
purchase path, and the failure-still-Slacks interceptor behavior.
