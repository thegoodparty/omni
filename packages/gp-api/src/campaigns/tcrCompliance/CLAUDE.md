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
(running in gp-ai-projects, reaching gp-api through the broker) hit the *same* routes —
there are no agent-only endpoints. The `@McpTool`-decorated methods are what the agent
calls; the wizard calls the same controller methods over HTTP.

| Route | Method | Caller(s) | Purpose |
|-------|--------|-----------|---------|
| `POST /campaigns/tcr-compliance/agentic` | `createAgentic` | Wizard (filing-details step) | Persist EIN + committee + filing details, create the `TcrCompliance` row, and **conditionally** dispatch the agent. |
| `GET /campaigns/tcr-compliance/mine/compliance-state` | `findStateForCampaign` (`@McpTool`) | Agent | Canonical pipeline state across Campaign/Website/Domain/TcrCompliance. Agent calls this first each run to decide which steps to skip. |
| `POST /campaigns/tcr-compliance/submit-to-peerly` | `submitToPeerlyForAgent` (`@McpTool`) | Agent | Submit the registration to Peerly (Identity → Profile → 10DLC Brand → CV Request). Stage-gated on `awaiting_pin`. |
| `POST /campaigns/tcr-compliance` | `create` | Legacy non-agentic | Synchronous full Peerly submission (older flow). |
| `POST /campaigns/tcr-compliance/:id/submit-cv-pin` | — | Wizard / agent | PIN entry → CV token → approve 10DLC brand. |

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

## Idempotent dispatch (don't double-launch the agent)

`claimAndEnqueueKickoff(record, clerkUserId)` is the single source of the kickoff SQS
message shape, shared by `createAgentic` (already-Pro) and the webhook. Its idempotency
guard is an **atomic claim on `TcrCompliance.kickoffSentAt`**
(`updateMany WHERE kickoffSentAt IS NULL`) *before* the SQS send. A webhook replay or a
submit→pay→resubmit race finds it already set and short-circuits → agent dispatched
exactly once. On send failure the rollback is **scoped to the exact claim timestamp** so
a concurrent re-claimant's live claim isn't cleared, and `kickoffSentAt` returns to null
so the stranded-kickoff sweep can retry.

## Kickoff handling (SQS consumer → agent dispatch)

`handleAgenticKickoff(message)` runs in the queue consumer
(`queue/consumer/queueConsumer.service.ts`, `QueueType.AGENTIC_COMPLIANCE_KICKOFF`). In
order it:

1. **Validates `campaign.details.electionDate`** is a real `YYYY-MM-DD` (the agent
   expands it into domain-name placeholders; a bad value would poison generation).
   Missing/invalid → mark record `error`, no dispatch.
2. **Requires `campaign.placeId`.** Peerly resolves the postal address from `placeId`
   via Google Places; without it the run publishes a site, can't submit, reports
   `partial`, and the resume sweep re-dispatches a ~$10 paid run every few minutes until
   it gives up. So reject at kickoff (status `error`, no dispatch) rather than loop.
3. **`ensureCompliancePublishableWebsite`** (`websites.service.ts`) — the agent buys a
   domain and publishes the site but can't *create* one or author missing copy.
   Legacy-Pro candidates skip the wizard's profile step, so guarantee a publishable site
   before dispatch.
4. **Atomic dispatch claim** on `agenticRunId IS NULL` (+ TTL on
   `agenticDispatchAttemptedAt`) → `experimentRunsService.dispatchRun({ type:
   'compliance_setup', ... })`. Stamps `agenticRunId` scoped to the claim timestamp.

**FAILED and SUPERSEDED runs stay re-dispatchable** — the idempotency skip path
intentionally excludes both (a re-claim clears `agenticRunId` and re-dispatches with
`trigger: 'recovery_resume'` so the agent skips completed steps). Don't add them to the
skip set. `SUPERSEDED` matters because `agenticRunId` is never repointed to the resume
successor, so it keeps pointing at the superseded predecessor; if that successor later
`FAILED`, the record would strand here unless `SUPERSEDED` can fall through to the
retake. `AWAITING_RESUME` *is* in the skip set — the resume sweep owns those, so the
kickoff path must not race it.

## Background sweeps (`@Interval`)

| Sweep | What it heals |
|-------|---------------|
| `sweepStrandedAgenticKickoffs` | Records `submitted` + no Peerly identity + `kickoffSentAt` null past staleness — re-enqueues the kickoff. **Only sweeps `campaign.isPro` records** so the agent never runs before payment. |
| `sweepUnsubmittedUsecases` | Records whose Peerly Campaign Verify is `VERIFIED` but whose POLITICAL usecase was never submitted (the in-app approve threw) — submits the usecase so the identity doesn't strand "loading". **Acts only on `VERIFIED`, never `APPROVED`** — `APPROVED` can precede the candidate's PIN entry, so advancing it would skip them past the PIN screen. |
| `sweepPinDeliveryDetection` (ENG-10658) | Records `submitted`/`pending`/`approved` + Peerly identity + no `pinDeliveryMethod` yet — reads the enriched `retrieve_cv`, records the channel + destination Peerly sent the PIN to on the record, and fires the `CompliancePinSent` Segment event **once** so HubSpot can stamp the company + nudge. The event carries the **method only** (`pin_delivery_method`), never the destination — the raw filing email/phone/address stays in our DB and is not synced to the analytics warehouse / HubSpot. The `pinDeliveryMethod IS NULL` filter shrinks the set as PINs are detected (not a growing bulk loop). Once-only via an atomic `pinSentDetectedAt IS NULL` claim; if the event fire fails the claim is rolled back (scoped to its timestamp, and the rollback is itself try/caught so its failure can't mask the original error) so the next sweep retries. **Includes `pending` + `approved`** (not just `submitted`) because the in-app PIN entry / VERIFIED usecase sweep advance a record to `pending` then `approved` the moment the candidate acts — which can beat the hourly sweep — and pre-existing records were already `pending`/`approved` when this shipped; all three states imply the PIN went out, so this never fires for a never-sent record (`rejected`/`error` are failure states, excluded). |
| `bootstrapTcrComplianceCheck` | Re-queues `pending` records for status checking. |

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
- Strips leading `www.` from `Domain.name` so Peerly's brand `website`/`email` use the
  apex domain, matching the legacy `create()` path.
- **`filing_url` must be an official election filing.** CampaignVerify verifies the
  candidate against the URL, so a goodparty.org page or the candidate's own campaign
  site forces CV to contact the election authority by hand for the real filed contact
  info (the increased-mismatch delays Peerly reported after the agentic flow shipped —
  the agent was resolving `filing_url` to `goodparty.org/candidate/...` pages). The
  guard lives in two layers. `tcrComplianceSuperRefine` (`tcrComplianceBase.schema.ts`,
  via the exported `addFilingUrlIssues`) rejects any `goodparty.org` host / credentialed
  URL for the **create** callers (wizard, agentic-create) at write time. The **submit**
  path no longer has a request DTO, so it re-applies those same guards to the *persisted*
  `filingUrl` at submit time via `submitToPeerlyFilingSchema`
  (`submitToPeerlyDto.schema.ts`), plus an own-site check against the registered domain
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
  can't hide the guarded host before an `@`). The filing-URL *instructions*
  Peerly asked about (`filing_url_instructions` in `peerlyIdentity.service.ts`) are a
  separate, still-sent field — the mismatch was the URL value, not the instructions.

## Peerly 10DLC finalization — always token-backed

The PIN flow ends by *finalizing* the 10DLC brand so it reaches the carrier (MNO)
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
unless you have *just* attached a token via `/approve`/`/submit` — a bare finalize is
exactly the token-less finalization that pages Peerly. `verification_status: VERIFIED`
alone does **not** mean the brand has the token; the brand can sit at
`waiting_to_finalize` from an old empty-token `/approve` with no token attached.
Verify recovery worked by reading back `getProfile().profile.campaign_verify_token`.

## Gotchas

- **PIN retry self-recovery:** `verify_pin` consumes the PIN once — it rejects an
  already-`VERIFIED` CV as an invalid PIN. So if a first PIN attempt verified the CV
  but a downstream Peerly step threw (stranding the record at `submitted`), a naive
  retry would dead-end with "Invalid PIN" forever. `retrieveCampaignVerifyToken`
  checks the CV status first and, when it is already `VERIFIED`, skips re-verifying
  and mints the token so the retry finishes the flow. Don't reintroduce an
  unconditional `verify_pin` call ahead of that check.
- **PIN screen is gated on the live Peerly CV status (ENG-10654):**
  `deriveComplianceStage` still returns `awaiting_pin` from the DB `status` alone (a
  `submitted` record with a live site) — that stage value is unchanged because
  `submitToPeerlyForAgent`'s gate depends on it. What changed is that
  `findStateForCampaign` now also resolves the *live* CV status into
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
  firing the `CompliancePinSent` event is the background `sweepPinDeliveryDetection`'s
  job (see the sweeps table), **not** this read — the read only displays, so a candidate
  who never opens the app is still detected + nudged.
- **`createAgentic` retries:** an existing record in `error`/`rejected` is retryable
  (deleted + recreated in one serializable tx); any other existing status returns the
  current record with `created: false`.
- **Non-prod short-circuit:** `submitCampaignVerifyToken` / Peerly approval are
  short-circuited when `OTEL_SERVICE_ENVIRONMENT !== 'prod'`, and `submit-cv-pin` accepts
  a bypass token — so testers can walk the flow without a real Peerly PIN. Status
  advancement guards on this so a non-prod record isn't promoted for a usecase that
  doesn't exist.
- **Process-crash gap:** a crash *between* the `kickoffSentAt` claim and the SQS send
  leaves `kickoffSentAt` set with no message sent (not swept) — same narrow risk profile
  as the other claim patterns; accepted.
- This is a sub-feature dir wired into `CampaignsModule`, not its own Nest module (see
  `src/campaigns/CLAUDE.md`).

## Related

- `packages/gp-webapp/app/dashboard/pro-upgrade/CLAUDE.md` — the wizard that feeds these endpoints.
- `src/payments/CLAUDE.md` — the `checkout.session.completed` webhook that triggers deferred dispatch.
- `src/queue/CLAUDE.md` — the FIFO consumer that runs `handleAgenticKickoff`.
- `src/agentExperiments/CLAUDE.md` — `dispatchRun` and the experiment-run lifecycle.
- Epic plan (local): `~/.claude/plans/86ah2ezny-plan.md` — full task-by-task history.
