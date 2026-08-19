# src/outreach/

Voter outreach: the `Outreach` spine row (one per send), the Peerly p2p
texting backend behind it, the social channel satellite, and the stateless
AI compose endpoints for the Voter Outreach 2.0 flows. Frontend counterpart:
`packages/gp-webapp/app/dashboard/outreach/AGENTS.md`.

## Controllers (all under `/outreach`, campaign-scoped via `@UseCampaign()`)

| Route | Where | What |
| --- | --- | --- |
| `POST /outreach` (multipart) + `GET /outreach` | `outreach.controller.ts` | Legacy create/list. Create accepts `draft: true` (p2p only) → row stored `pending_payment`, hidden from the list. Image required for text/p2p |
| `POST /outreach/social/draft` / `social/generate` / `social` (save), `GET /outreach/:id` | `outreachSocial.controller.ts` | Social flow (VO 2.0 phase 1): stateless draft/improve, per-platform asset generation, atomic save, detail read |
| `POST /outreach/sms/draft` | `outreachSms.controller.ts` | SMS compose (VO 2.0 phase 2): stateless draft/improve of the SMS body only |

`GET /outreach/:id` deliberately lives on the social controller: detail reads
must stay outside `OutreachNotificationInterceptor` — a 404 there would fire
a CAS failure Slack meant for send attempts.

## Services

| Service | What |
| --- | --- |
| `outreach.service.ts` | Spine CRUD + `finalizeOutreachPurchase` (see below) |
| `outreachPurchase.service.ts` | The `PurchaseType.TEXT` purchase handler (registered in the module constructor). Re-derives the billable count server-side from the phone-list token (Peerly `leads_loaded`, falling back to captured recipient rows) — the client's `contactCount` is never trusted for billing. Applies the free-texts (5,000) discount server-side |
| `outreachSocial.service.ts` | Saves/reads the social satellite: spine + `OutreachSocial` + `OutreachSocialAsset` rows in one transaction |
| `outreachSocialGeneration.service.ts` / `outreachSmsGeneration.service.ts` | Stateless LLM compose (temperature 0.8, Zod-validated output). Fresh generation is refused for the `custom` purpose (improve allowed). The SMS prompt writes ONLY the body (≤300 chars fresh / 340 improve): the client wraps it in system regions inside the 480-char composed cap |
| `outreachComposeContext.service.ts` | Builds prompt blocks from the candidate's own materials — campaign story, stated issue positions, plan opportunities/challenges, trimmed for prompt size (product decision 2026-08-17: compose generation must ground in these; never invent positions). Every block optional; the no-materials fallback is name/place/office |
| `outreachCompletion.service.ts` | Hourly cron: flips Peerly jobs to `completed` once the job's `end_date` day has passed — a time proxy, `leads_remaining` was disproven (ENG-10739). One-way status ratchet |
| `outreachInboundSweep.service.ts` | Hourly cron (offset :30 from the completion sweep) pulling Peerly CDR/response reports into `ContactInteractionText` inbound events |
| `outreachMaterialization.service.ts` | At launch, resolves the audience filter into per-recipient `ContactInteraction*` rows (text/p2p/robocall only; paged, capped at 100k) |
| `outreachNotification.service.ts` + `interceptors/` | CAS Slack notifications. The interceptor wraps the legacy controller so a failed (possibly paid) send attempt notifies before rethrowing; it sits OUTSIDE `FilesInterceptor` so multipart-parse failures are caught too |

## Draft-first purchase (p2p)

The client creates the outreach with `draft: true` BEFORE payment → row
stored `pending_payment` (hidden from `GET /outreach`); the draft id rides in
the checkout-session metadata as `outreachId`. On payment completion the
Stripe webhook path calls `finalizeOutreachPurchase`: atomic claim
`pending_payment → pending`, then `submitDraftToPeerly` (re-reads the image
from S3); a Peerly failure reverts the status and rethrows so Stripe retries.
`schemas/createOutreachSchema.ts`: only p2p may be a draft, and clients can
never send `pending_payment` themselves.

## Gotchas / invariants

- The script reaches Peerly VERBATIM (one default MMS template,
  `vendors/peerly/services/peerlyP2pJob.service.ts`). The v2 UI's
  greeting/identification/opt-out regions are client-side composition —
  nothing server-side validates them (phase 2 TDD open question: decide
  before GA).
- Script cap: `P2P_SCRIPT_MAX_LENGTH` (2000, contracts) enforced at schema,
  service, and Peerly pre-flight. The UI caps (`SMS_COMPOSED_MAX_LENGTH` 480
  / `SMS_BODY_MAX_LENGTH` 360, contracts) sit inside it.
- Imageless text/p2p sends are rejected at three layers (controller, schema,
  service). The v2 SMS flow keeps its image required because of this,
  pending the CS/MMS product decision.
- Satellite convention: a channel gets its own table only when its data
  changes shape. `OutreachSocial` + `OutreachSocialAsset` did; SMS writes
  through the spine's legacy columns because the Peerly backend is
  unchanged; robocall's satellite arrives with its phase.
- Office name for compose prompts comes from the org's election-api position
  (`resolvePositionNameByOrganizationSlug`), degrading to
  `details.normalizedOffice` — office is prompt enrichment, so an
  election-api failure must not fail the draft.

## Contracts / models

- `@goodparty_org/contracts` `src/outreach/`: `OutreachSocial.schema.ts`,
  `OutreachSms.schema.ts`, `OutreachScript.const.ts`.
- Prisma: `outreach.prisma` (spine), `outreachSocial.prisma` +
  `outreachSocialAsset.prisma` (satellite).

## Tests

`tests/` runs through the HTTP harness (`useTestService`) with LLM calls
mocked at `LlmService`: `outreachSms.test.ts` / `outreachSocial.test.ts`
cover the compose + save endpoints; `outreachFlow.test.ts` covers the
submission contract, the draft-first purchase path, and the
failure-still-Slacks interceptor behavior.
