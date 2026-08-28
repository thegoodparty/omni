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
| `POST /outreach/robocall/compliance`                                                                                    | `outreachRobocall.controller.ts`      | Fail-closed compliance gate for the recorded audio (VO 2.0 robocall): Pro-gated the same way. Confirms the `audioKey` belongs to THIS campaign (prefix `robocall/<campaignId>/`, so a caller can't check another campaign's recording), derives candidate + organization server-side, then runs `RobocallComplianceService.checkRecording` on `{ audioKey, contentType }`. Everything the transcript is checked against is server-derived — the callback-number check only confirms a number is spoken, so the client has no expected value to spoof it with (the caller-ID voters reach is enforced at dial time). Returns the `RobocallComplianceVerdict`; a transcription/LLM failure is 502. Stateless — the verdict isn't persisted yet (that lands with the pay slice)                                                                                          |
| `POST /outreach/robocall`                                                                                               | `outreachRobocall.controller.ts`      | Draft-first create (VO 2.0 robocall), Pro-gated the same way. Confirms the `audioKey` belongs to THIS campaign (prefix `robocall/<campaignId>/`), then persists the `pending_payment` spine + `OutreachRobocall` satellite (settleState `pending_payment`) in one transaction. Billable count + amount are derived server-side from `voterFileFilterId` (landline forced) — never a client count — and returned for the pay-step estimate. The only robocall write; hold + settlement are later slices                                                                                                        |
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
| `outreachRobocallHold.service.ts`                   | The pay-time authorization hold (`OutreachRobocallHoldService`, `createPrismaBase(MODELS.OutreachRobocall)`): `authorizeHold` places a manual-capture Stripe hold off-session on the vaulted card for the server-re-derived, frozen estimate. Single-owner placement CAS (`pending_payment → hold_pending → authorized`), the $500 `ROBOCALL_PER_RUN_CEILING_CENTS`, the `ROBOCALL_HOLD_WINDOW_DAYS` (3) window, the capture-window fit, the decline-vs-502 split, and the `HoldPlaced`/`HoldFailed` milestones. RESERVES REAL MONEY. See "Robocall payment" below                                                                                                                                                                                                                                                              |
| `outreachRobocallAudio.service.ts`                  | Builds a campaign-scoped object key (`robocall/<campaignId>/<uuid>.<ext>`) and returns a presigned S3 POST (`S3Service.createPresignedUpload`, a `content-length-range` policy capping bytes at `ROBOCALL_AUDIO_MAX_BYTES`), reading the bucket from `ROBOCALL_AUDIO_BUCKET` (throws at construction if unset). Stateless — no row is written                                                                                                                                                                                                                                                                                  |
| `robocallTranscription.service.ts`                  | Batch AWS Transcribe (`@aws-sdk/client-transcribe`, `StartTranscriptionJob` → poll → read the transcript JSON from S3) for a stored robocall recording. Batch, not the streaming path the mic dictation uses, because a stored webm/mp4/mp3 needs container decoding. Task role needs `transcribe:StartTranscriptionJob`/`GetTranscriptionJob` (granted in `deploy/index.ts`)                                                                                                                                                                                                                                                    |
| `robocallCompliance.service.ts`                     | Fail-closed compliance gate: transcribes the recording, then verifies via the LLM (temperature 0) that the FCC calling disclosures are actually spoken — candidate self-ID, organization name, callback number. Returns a `RobocallComplianceVerdict` (per-check booleans + transcript + issues). A transcription/LLM failure propagates as 502; it never silently passes. Distinct from the result sweep (ADR 0013) — this is a pre-send audio check, not a disposition writer                                                                                                                                                  |
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
  `ROBOCALL_HOLD_WINDOW_DAYS` (3) out, return `deferred` and place nothing — the
  daily sweep (a later slice) places it in-window. The window must be strictly
  under `auth_lifetime − run − settle` (`~7d − 48h − 24h = 4d`) so a window-edge
  send still clears the capture-window fit below; 3 days (3d + 72h = 6d) fits
  even a `capture_before` that lands under a full 7 days.
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
  mid-placement) the just-placed hold is voided.
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
  500 the request onto the noop path. Capture/CallHub/deferred-sweep/reminder-
  retry-cancel are later slices.

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
  (`OutreachRobocall` payment/state satellite + the `RobocallSettleState` enum). Phone banking's own tables
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
mocking the transcription + `LlmService`, and
`services/robocallTranscription.service.test.ts` covers the batch Transcribe
poll (completion, FAILED → 502, unsupported type) mocking the Transcribe client;
`outreachRobocallHold.test.ts` covers the pay-time hold: happy-path off-session
placement (idempotency key `robocall-hold-<id>-1`, satellite persisted,
`authorized`, `HoldPlaced` once), the 5-day defer, the INV-2 ceiling → 409 +
revert, a decline → `hold_failed` + `HoldFailed` (not a 502), a payment method
not on the customer → 400, a too-short `capture_before` → void + 400, the
already-authorized/in-flight no-double-hold paths + the lost-commit void, and
the Pro gate — mocking the private Stripe client, `deriveBillableCount`, and
`AnalyticsService.track`;
`outreachFlow.test.ts` covers the submission contract, the draft-first
purchase path, and the failure-still-Slacks interceptor behavior.
