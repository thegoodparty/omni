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

`GET /outreach/:id` deliberately lives on the social controller: detail reads
must stay outside `OutreachNotificationInterceptor` — a 404 there would fire
a CAS failure Slack meant for send attempts.

## Services

| Service | What |
| --- | --- |
| `outreach.service.ts` | Spine CRUD + `finalizeOutreachPurchase` (see below) |
| `outreachPurchase.service.ts` | The `PurchaseType.TEXT` purchase handler (registered in the module constructor). Re-derives the billable count server-side from the phone-list token (Peerly `leads_loaded`, falling back to captured recipient rows) — the client's `contactCount` is never trusted for billing. Applies the free-texts (5,000) discount server-side |
| `outreachSocial.service.ts` | Saves/reads the social satellite: spine (status `completed` — nothing is sent, so no lifecycle) + `OutreachSocial` + `OutreachSocialAsset` rows in one transaction |
| `outreachSocialGeneration.service.ts` | Stateless LLM compose (temperature 0.8, Zod-validated output): one draft per draft/improve call, all per-platform assets in one structured generate call. Fresh generation is refused for the `custom` purpose (improve allowed); improve is a detail-preserving polish, never new content |
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

## Contracts / models

- `@goodparty_org/contracts` `src/outreach/`: `OutreachSocial.schema.ts`,
  `OutreachScript.const.ts`.
- Prisma: `outreach.prisma` (spine), `outreachSocial.prisma` +
  `outreachSocialAsset.prisma` (satellite).

## Tests

`tests/` runs through the HTTP harness (`useTestService`) with LLM calls
mocked at `LlmService`: `outreachSocial.test.ts` covers the compose + save
endpoints; `outreachFlow.test.ts` covers the submission contract, the
draft-first purchase path, and the failure-still-Slacks interceptor
behavior.
