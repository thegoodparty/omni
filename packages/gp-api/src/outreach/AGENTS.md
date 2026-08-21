# src/outreach/

Voter outreach: the `Outreach` spine row (one per send), the Peerly p2p
texting backend behind it, the social channel satellite, and the stateless
AI compose endpoints for the Voter Outreach 2.0 flows. Frontend counterpart:
`packages/gp-webapp/app/dashboard/outreach/AGENTS.md`.

## Controllers (all under `/outreach`, campaign-scoped via `@UseCampaign()`;
phone banking also carries `@UseOrganization()` for the Pro gate)

| Route | Where | What |
| --- | --- | --- |
| `POST /outreach` (multipart) + `GET /outreach` | `outreach.controller.ts` | Legacy create/list. Create accepts `draft: true` (p2p only) → row stored `pending_payment`, hidden from the list. Image required for text/p2p |
| `POST /outreach/social/draft` / `social/generate` / `social` (save), `GET /outreach/:id` | `outreachSocial.controller.ts` | Social flow (VO 2.0 phase 1): stateless draft/improve, per-platform asset generation, atomic save, detail read |
| `POST /outreach/phone-banking/draft` | `outreachPhoneBanking.controller.ts` | Phone banking script draft/improve (VO 2.0 phone banking): stateless, Pro-gated (`@UseOrganization()` + `ContactsService.assertProAccess`) — the create flow freezes the chosen text onto the list itself via `POST /phone-banking/lists` (`src/phoneBanking/`) |

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
| `outreachPhoneBankingGeneration.service.ts` | Stateless LLM compose for call scripts, same shape as social generation. Per-purpose structure (volunteer opener, why-statement, issue-ID question for `persuade`, bracketed voting-logistics slots for `vote-early`/`election-day`); hard-bans SMS/robocall compliance lines (`Reply STOP`, `Paid for by`, callback numbers) since a volunteer reads this live |
| `outreachComposeContext.service.ts` | Builds prompt blocks from the candidate's own materials — campaign story, stated issue positions, plan opportunities/challenges, trimmed for prompt size (product decision 2026-08-17: compose generation must ground in these; never invent positions). Every block optional; the no-materials fallback is name/place/office. Shared by social and phone-banking generation |
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
  has no such flip today — it stays `in_progress` for the life of the route.

## Contracts / models

- `@goodparty_org/contracts` `src/outreach/`: `OutreachSocial.schema.ts`,
  `OutreachScript.const.ts`, `PhoneBankingScript.schema.ts`.
- Prisma: `outreach.prisma` (spine), `outreachSocial.prisma` +
  `outreachSocialAsset.prisma` (satellite). Phone banking's own tables
  (`PhoneBankingList`, `PhoneBankingListEntry[Person]`,
  `ContactInteractionPhoneBanking`, `PhoneBankingSuppressedPhone`) and
  controller/service live in a separate `src/phoneBanking/` module — this
  package only owns the stateless draft/improve endpoint above.

## Tests

`tests/` runs through the HTTP harness (`useTestService`) with LLM calls
mocked at `LlmService`: `outreachSocial.test.ts` covers the compose + save
endpoints; `outreachPhoneBanking.test.ts` covers the phone-banking draft
endpoint (Pro gate, per-purpose prompt assembly, improve mode);
`outreachFlow.test.ts` covers the submission contract, the draft-first
purchase path, and the failure-still-Slacks interceptor behavior.
