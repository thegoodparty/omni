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

**FAILED runs stay re-dispatchable** — the idempotency skip path intentionally excludes
`FAILED` (a re-claim clears `agenticRunId` and re-dispatches with `trigger:
'recovery_resume'` so the agent skips completed steps). Don't add `FAILED` to the skip
set.

## Background sweeps (`@Interval`)

| Sweep | What it heals |
|-------|---------------|
| `sweepStrandedAgenticKickoffs` | Records `submitted` + no Peerly identity + `kickoffSentAt` null past staleness — re-enqueues the kickoff. **Only sweeps `campaign.isPro` records** so the agent never runs before payment. |
| `sweepUnsubmittedUsecases` | Records whose Peerly Campaign Verify is `VERIFIED` but whose POLITICAL usecase was never submitted (the in-app approve threw) — submits the usecase so the identity doesn't strand "loading". **Acts only on `VERIFIED`, never `APPROVED`** — `APPROVED` can precede the candidate's PIN entry, so advancing it would skip them past the PIN screen. |
| `bootstrapTcrComplianceCheck` | Re-queues `pending` records for status checking. |

## `submitToPeerlyForAgent` notes

- **Stage gate:** rejects with 422 unless the derived compliance stage is `awaiting_pin`
  (domain registered + site published & verified live). The `@McpTool` description names
  this precondition and the route enforces it — keep them in sync.
- **Pre-Peerly claim** on `peerlySubmissionStartedAt` (TTL'd) serializes concurrent
  callers; rollback scoped to the exact claim timestamp.
- **Idempotent:** a record that already has a `peerlyIdentityId` returns the existing
  response without re-submitting. The response is built from the **persisted record**
  (`buildSubmitToPeerlyResponse`), not request input, so a retry can't misreport state.
- Federal office requires a valid `fecCommitteeId` (DTO defers this; re-enforced here,
  falling back to the persisted value).
- Strips leading `www.` from the website URL so Peerly's brand `website`/`email` use the
  apex domain, matching the legacy `create()` path.

## Gotchas

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
