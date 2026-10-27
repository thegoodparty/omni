# src/outreach/

Voter outreach: the `Outreach` spine row (one per send), the Peerly p2p
texting backend behind it, the social channel satellite, the stateless
AI compose endpoints for the Voter Outreach 2.0 flows, and the shared text
delivery layer that carries a Serve SMS send out and its replies back
without Peerly. Frontend counterpart:
`packages/gp-webapp/app/dashboard/outreach/AGENTS.md`.

## Controllers (all under `/outreach`, campaign-scoped via `@UseCampaign()`;

Moved to [`docs/controllers.md`](docs/controllers.md) (~233 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## Services

Moved to [`docs/services.md`](docs/services.md) (~340 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## Draft-first purchase (p2p)

This is the ONLY way a p2p send is created. The client creates the outreach
with `draft: true` BEFORE payment → row stored `pending_payment` (hidden from
`GET /outreach`); the draft id rides in the checkout-session metadata as
`outreachId`. On payment completion the Stripe webhook path calls
`finalizeOutreachPurchase`: atomic claim
`pending_payment → pending`, then `submitDraftToPeerly` (re-reads the image
from S3); a Peerly failure, or a failed read of the claimed draft, reverts the
status and rethrows so Stripe retries
(except a content rejection, which propagates as a 400 carrying Peerly's own
message — the webhook handler acks it rather than retrying a permanent error).
`schemas/createOutreachSchema.ts`: only p2p may be a draft, EVERY p2p create
must be one (`draft: true`, or a `draftOutreachId` resume — a body with
neither is a 400 at the pipe, so no p2p row and no Peerly job can be produced
outside this flow), and clients can never send `pending_payment` themselves. A
p2p create normally REQUIRES `phoneListId`, but under the managed Amplitude
flag `win_sms_hold_billing` that requirement is relaxed for the caller it's on
for — the draft can be created and paid while its build is still in progress,
and the build-ready edge stamps `phoneListId` later (pay-before-build). The DTO
itself has no request context to evaluate a per-user flag against, so the Zod
schema never enforces `phoneListId`; `OutreachService.create` (which has the
request user) is the single enforcement point, evaluating the flag via
`FeaturesService.isFeatureEnabled` at entry. The RESUME path
(`convertP2pDraft`) re-checks the SAME flag independently, at resume time —
a draft created pay-before-build (flag on, no `phoneListId`) can be resumed
after the per-user flag has since turned off, and a resume with no usable
`phoneListId` (the request's own, or the one already stamped on the draft)
is refused there before any payment if the flag now reads off for this user;
never trusting the flag's value at create time is what keeps a later flag
flip from charging a send that can never complete. A `phoneListId` that
names no `PeerlyPhoneList` this campaign uploaded (`{ peerlyListId,
campaignId }`) is a 400 before anything is written, on a fresh create and a
resume alike: it is both the list the send goes to and the list the
checkout is priced from.
`finalizeOutreachPurchase` → `submitDraftToPeerly` is therefore the only p2p
path that reaches `createPeerlyP2pJob`. `finalizeOutreachPurchase` DEFERS
(SATELLITE-gated, not flag-gated) when the p2p draft has no numeric
`phoneListId` yet (a draft paid before its phone-list build finished):
`submitDraftToPeerly` needs the list id, so it peeks before the claim and
returns without transitioning the row, leaving the send to the build-ready edge
(`OutreachP2pSmsCaptureService.finalizeDraftsForReadyList`), which stamps
`phoneListId` once the list exists and re-enters here. Deferral is SCOPED to a
draft whose satellite is already linked (`peerlyPhoneListId`, stamped by
recordHold on the paid path) — only such a draft is recoverable by the
build-ready edge; the hold-less free ($0) path has no link and is never deferred,
so it can't silently strand. The build-before-pay flow always carries
`phoneListId` on the draft and never defers. It returns an outcome
(`finalized | deferred | duplicate_refused`) so the webhook handler logs a
deferral rather than a false "finalized". After the claim, a duplicate guard
refuses a draft that matches a live submitted p2p send (same campaign, list,
script, message, date): it cancels the draft, releasing the payment, without
restoring the free-texts offer (it never applied it), and returns
`duplicate_refused`; a redelivery sees the `canceled` draft as terminal and returns `duplicate_refused` again. After the projectId is stamped this is
also where the SMS channel's send terminal fires —
`EVENTS.Outreach.CampaignScheduled` (`channel: 'sms'`, DATA-2526) — exactly once
by construction, since every replay returns at the claim above. It is keyed on
`campaign.userId`, NOT the loaded `user` relation, so a missing user record does
not silently drop the OKR signal the way it skips the notifications.

## Saved drafts (`status: draft`)

Distinct from the `pending_payment` purchase draft above: that one is a paid
send mid-checkout, this one is work a candidate KEEPS because they cannot send
yet. `POST /outreach/drafts` (`OutreachDraftService`) writes the spine with
`status: draft` and nothing the send needs — no date, no phone list, no Peerly
identity, no billing — and returns the `OutreachDetail` shape via
`OutreachSocialService.findDetail`, so the history drawer renders it like any
other row (`findByScope` filters only `pending_payment`, so drafts list).
Robocall drafts carry a satellite with `settleState: draft` and null
`billableCount`/`amountInCents`: pricing is re-derived at resume, against the
audience as it is then. `OutreachDetail.robocall` exposes exactly the two
satellite fields a resume cannot re-derive — `audioKey` and `callbackNumber`
— because the resume's own `POST /outreach/robocall` has to send them back;
the rest of the satellite is billing and settlement state no client reads.
One active draft per type per campaign, so the wizard resumes rather than
accumulating half-built sends; the cap check runs INSIDE the insert's
`Serializable` transaction (with a cheap `preflight` copy before the image
upload, so a rejected create orphans no S3 object). `deleteDraftRow` is the
shared teardown (also used by the expiry job): a `status: draft`-guarded
`deleteMany` on the spine runs FIRST — a 0 count (the row was resumed between
the caller's scan/check and this call) skips the S3/compliance-result cleanup
entirely, so a converted row's live image/audio is never touched — and only a
successful guarded delete proceeds to clear the satellite's S3 objects and
`RobocallComplianceResult`. `OutreachDraftExpiryService` (daily `@Cron`,
`37 4 * * *` ET, `CronLockService`) deletes any `draft` row older than
`DRAFT_RETENTION_DAYS` (90) via that same teardown, isolating one row's
delete failure from the rest of the sweep.

Resume converts that row IN PLACE, never inserting a second one: `POST
/outreach` with `draftOutreachId` (p2p, no file — the row's saved `imageUrl`
stands) and `POST /outreach/robocall` with `draftOutreachId` re-run the
fresh-create gates (Peerly identity + script compliance; the compliance/ETag
bind, schedule guards and server-derived billing, shared via
`resolveScheduleGates`) and move the same row `draft → pending_payment` — 404
for another campaign's row, 409 once it is no longer a draft. That transition
is a CAS on `status: draft` (the spine `updateMany` inside the robocall
transaction, so a zero count aborts before the satellite is repriced), so two
concurrent resume submits convert once and the loser 409s instead of silently
overwriting the winner. A bare robocall
create that reuses a draft's `audioKey` 409s with that draft's `existingId`
(`findExistingDraft` scopes `draft` + `pending_payment`) instead of tripping
the unique index: scheduling a saved draft has to be explicit.
A bank-debit (ACH) checkout completes with `payment_status: unpaid`, so the
completion defers and the draft stays `pending_payment` until Stripe's
`async_payment_succeeded` runs the same finalize days later. If the debit
fails instead, `async_payment_failed` reaches `failOutreachPurchase`: the
same claim shape (`pending_payment` + `projectId IS NULL → failed`, so a
draft a racing finalize already sent to Peerly is never failed and a
redelivery notifies nobody twice), then the CAS failure Slack (step
`payment`) and a plain email to the candidate. Nothing was sent or charged;
the row surfaces in history as "Couldn't send".

## Serve SMS create (draft-first, org-scoped)

`POST /outreach/serve/sms` writes the row BEFORE checkout, for the same
reason the p2p flow does and one more: the composed message can reach
`SMS_COMPOSED_MAX_LENGTH` (2000) and a Stripe metadata VALUE caps at 500, so
checkout cannot carry the content. It carries two ids instead.

What the row is: `{ campaignId: null, organizationSlug }`, `outreachType:
text` (NOT `p2p` — that type drags Peerly semantics through the create path),
`status: pending_payment`, plus `message`, `imageUrl`, `scheduledLocalDate`,
`voterFileFilterId` and the server-derived `textCount`. `date` and
`scheduledLocalTime` are deliberately left null: Serve sends at a fixed 11am
local, so B3/B4 must read a Serve row's day off `scheduledLocalDate`, not
`date`.

- **The list id is the audience, and it is re-resolved at send.** The row
  stores `voterFileFilterId`; the delivery layer resolves it again at handoff.
  A saved list edited between draft and send produces a different recipient
  set than the one priced. Deliberate, and the same as Win.
- **`textCount` is server-derived and is the only number priced.** A count in
  the request body is stripped by the schema. `MIN_SERVE_SMS_RECIPIENTS` is 25
  — the arithmetic floor is 15 (35 tenth-cents a recipient vs Stripe's 50c
  minimum) and the rest is headroom.
- **The schedule rule is enforced server-side**, mirroring the polls picker:
  strictly more than 2 business days out, no more than 30 days, no weekends.
  "Today" is anchored in Pacific because gp-api runs in UTC and would
  otherwise reject a date the picker had just offered.
- **No edit route.** A `pending_payment` draft is immutable; re-entering the
  flow creates a fresh draft. That is what keeps the priced count and the row
  the purchase handler re-reads the same thing.
- **A priority's text is one purchase in two rounds.** `roundTwoSize`
  (behind `serve-citizen-panels` too, and only with a `priorityId`, never on
  a report back) holds a follow-up beside the send being created: a second
  row in the same transaction with `roundOneOutreachId` pointing at the
  first, `scheduledLocalDate` `FOLLOW_UP_BUSINESS_DAYS` (10) business days
  later, and `textCount` `min(roundTwoSize, 90% of (pool - the
first send's count))` (`FOLLOW_UP_POOL_SHARE`, a buffer for opt-outs), the pool being the list's whole criteria (`sampleSize: null`, so
  never its sample) on cell phones less `roundTwoExclusions` (the
  priority's other sends' people and every opt-out). Under
  `MIN_TEXTS_PER_ROUND` (25) there is no follow-up and the response has no
  `followUp`. The follow-up points at a copy of the list's criteria
  (`createUndrawnSampleOf`, named `<list>, follow-up`) with `sampleSize`
  set and no `sampledAt`, and carries no proposal key (the first send holds
  the card's). That undrawn state is what marks it as round 2
  (`isUndrawnSample`); `roundOneOutreachId` is what ties it to its
  purchase. The response's `followUp` gives its id, count and date, and the
  review step quotes both rounds as one number. Who gets it is drawn by
  `priorities/services/priorityRoundTwoDraw.service.ts`; see
  `docs/features/civic-panel-mrp.md`.

Both WRITE routes on this controller are gated by the `serve-sms-outreach`
feature flag (404 when off), and only those two: the delivery service, the
ingest, the purchase handler and the two results readers below are
unreachable without an `Outreach` row, and the create route is the only thing
that writes one, so gating the writer makes the rest inert. The flag gates
ROLLOUT — `@UseElectedOffice()` is the access check either way.

## Serve SMS results (slice 3)

Two ungated reads on the same controller, both org-scoped:

- **`GET /v1/outreach/serve/:id/results`** — the Statistics card, the
  Serve sibling of `GET /v1/outreach/:id/results`. Both call one
  `OutreachService.getSmsResults`, which now takes an `OutreachScope`
  (`{ campaignId }` or `{ organizationSlug, campaignId: null }`) instead of a
  bare campaign id, the same union `findByScope` takes. **`campaignId: null`
  is load-bearing:** a Win row carries an organizationSlug too, so an org
  holding both a Campaign and an ElectedOffice would otherwise read its Win
  results through the Serve route (ENG-10976). The counts themselves have no
  surface branch — they come off `ContactInteractionText`, which is already
  organizationSlug-scoped, and the shared ingest writes both products' reply
  and opt-out events onto it.
- **`GET /v1/outreach/serve/:id/replies`** — the read-only reply list
  (`OutreachSmsRepliesService`), paged by `limit`/`offset`. Reply CONTENT
  lives on `poll_individual_message` and nowhere else: the Win inbound sweep
  records reply and opt-out TIMESTAMPS on `ContactInteractionText` and never
  a body, which is why the counts read can be counts-only and this one
  cannot. Inbound only (`sender: CONSTITUENT`) — an outbound row on the same
  envelope is the blast itself. First name, surname and place come from ONE
  people-api read per page (`filters.id.in` over the page's personIds, not a
  lookup per reply the way the ingest's phone fallback has to be), and that
  read DEGRADES rather than throws: a name is decoration on a reply the
  official can already read.

No Win sibling for the replies route, and that is not an omission — Win sends
go out through Peerly, whose sweep stores no reply bodies to list.

## Serve SMS purchase (draft-first, org-scoped)

The Serve counterpart of the p2p draft-first flow above, and the one purchase
path that never touches Peerly. `OutreachServeSmsPurchaseHandlerService`
(`PurchaseType.SERVE_TEXT`) prices and fulfils a Serve text send;
`purchase.controller.ts`'s `create-checkout-session` already accepts a
campaign OR an organization, which is how an elected official pays.

Checkout metadata carries two ids and nothing else (`outreachId`,
`organizationSlug`) — the composed message can reach
`SMS_COMPOSED_MAX_LENGTH` (2000) and a Stripe metadata VALUE caps at 500, so
the poll pattern of carrying content through checkout cannot work here.
`organizationSlug` is server-resolved on both call paths (merged from
`@UseOrganization()` at session creation, read back off the session on the
webhook), and every query is scoped by it plus `campaignId: null`, so a
client-chosen `outreachId` can reach neither another org's row nor a Win p2p
row.

Money invariants:

- **Never bill a client count.** `calculateAmount` re-reads
  `Outreach.textCount` — written server-side at draft from the saved list with
  the opt-out scrub applied — and prices it with `calcTextAmountInCents`, the
  same function polls and Win SMS use. A null or zero count is refused rather
  than falling back to metadata.
- **Never charge twice for one send.** `validatePurchase` refuses any row not
  in `pending_payment`, so a second checkout session cannot be minted for a
  send the first payment already claimed.
- **Post-purchase is idempotent.** The claim is a CAS `updateMany`
  (`pending_payment → pending`, mirroring `finalizeOutreachPurchase`) that also
  stamps `billableTextCount` and the checkout session id in the same write. A
  caller that loses the claim decides from the row: missing/not this org →
  `BadRequestException` (the webhook acks permanently); still `pending_payment`
  → a plain error so Stripe redelivers; `canceled`/`denied` → refuse loudly;
  `pending` → re-enqueue, because unlike Win's `projectId` nothing stamps
  "the send was enqueued"; anything further along → return without enqueuing.
- **A failure after the claim reverts.** An enqueue failure reverts
  `pending → pending_payment` (guarded on `pending`) and rethrows, so the row
  is re-claimable on redelivery. `stripeCheckoutSessionId` is deliberately left
  in place — the row is paid, and a bare `pending_payment` with no session id
  would read as an unpaid draft.

A paid `poll` row is held instead: the claim stops at `pending` ("In review"),
enqueues nothing, and the claim winner alone posts a "New poll awaiting review"
notice (`SlackChannel.botTevynApi`) and the `Polls - Poll Submitted For Review`
event. The staff approval (`outreachPollAdmin.controller.ts`) is what enqueues
it. The consumer maps an approved poll to a `sample` audience (sample poll)
or the saved filter (list poll), and refuses one with no `approvedAt`. For
`sendSeq` above 1 it reads the expansion (`resolveDelivery`, acked when missing
or unapproved) and delivers a `sample` of its `textCount` that excludes every
`OutreachTextRecipient` of the outreach, capped at that count. A sample is clamped to what the
pool still holds, with a warn log of the shortfall, rather than failing the
paid send.

A first send with an unpaid follow-up (`roundTwo`) is priced with it, both
counts in one checkout, and claimed with it in one transaction, each row
recording its own `billableTextCount` and the session id. The first is
enqueued and puts the check out as usual. The follow-up (its list an
undrawn sample) is held at `pending` with no notice: the round 2 draw
enqueues it on the last day staff can still take it (`roundTwoDrawCutoff`),
and a lost claim on such a row does not re-enqueue. The consumer acks, without sending, any text whose list is
still undrawn.

The enqueue is `outreachTextSend { outreachId, sendSeq }` on the FIFO queue,
message group `outreachTextSend-<outreachId>` so two deliveries for one send
serialize, `throwOnError: true` (the producer swallows failures by default, and
a swallowed one here would leave a paid row claimed with no send behind it),
and a deterministic deduplication id `outreachTextSend-<id>-<seq>` so the
webhook/redirect race collapses to one message while a later Stripe redelivery
is still allowed through to recover a genuinely lost one.

A managed civic panel wave is the one Serve text that reaches `pending`
without this handler: `ManagedWaveFundingService.claimFree` makes the same
claim with `fundedBy: goodparty_pilot` and no session, and nothing else may
(contacts AGENTS.md, "Managed civic panel"). No request schema takes
`fundedBy` or `managedPanelWaveId`, and checkout metadata cannot carry them
through.

## Text delivery layer (shared: Serve SMS now, polls later)

Moved to [`docs/text-delivery.md`](docs/text-delivery.md) (~9 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## Robocall payment (hold + run-window settlement)

Moved to [`docs/robocall-payment.md`](docs/robocall-payment.md) (~47 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## Event invites

Every draft endpoint that writes an event invite (SMS Win and Serve, phone
banking Win and Serve, door knocking Win and Serve) takes an optional `event`
`{ date, time, location }` (contracts `OutreachEventDetailsSchema`:
`YYYY-MM-DD`, 24-hour `HH:MM`, a one-line place). The webapp asks for it on
its own step before drafting, so a fresh invite normally carries it.
`util/eventDetails.util.ts`'s `eventDetailsContext` is the one block every
channel appends for `event_invite` on a FRESH draft (never a polish): with
details it writes them out formatted (`Saturday, October 17`, `6:30 PM`) and
tells the model to use them as given; without them it says none were given
and to leave the logistics out. No channel's prompt asks for a bracket for a
missing logistic any more, on any purpose: the webapp blocks Continue on an
unfilled `[Date]`, so a bracket in a draft is a dead end, not a blank to
fill. The remaining sanctioned brackets are phone banking's `[your name]`
and the voter/constituent-name token, which the caller page fills. An agent's
outreach proposal can carry the same details as `event` (contracts
`ProposalEventSchema`, every part optional) for the flow to open on.

## Gotchas / invariants

- **A new `PurchaseType` needs THREE registrations, and the third one is the
  easy miss.** `registerPurchaseHandler` and
  `registerCheckoutSessionPostPurchaseHandler` in `OutreachModule`'s
  constructor, AND a `case` in `PurchaseService.getPaymentType`
  (`payments/services/purchase.service.ts`). That method's default branch
  THROWS, so a missing case does not degrade — checkout 500s, with an error
  naming the payment-type map and nothing about the feature. `SERVE_TEXT`
  maps to `PaymentType.OUTREACH_PURCHASE`, the same as `TEXT`; only the
  handler differs.
- **Registering a provider whose dependencies are not all bindable takes down
  every test that builds `OutreachModule`,** not just the ones that touch it
  — around 190 files. `OutreachServeSmsPurchaseHandlerService` is why
  `QueueProducerModule` is in this module's imports. Run the WHOLE suite after
  a module change; a green `src/outreach` proves very little.
- **SMS Improve rewrites the whole message and never sees its locked
  parts.** With `currentDraft`, `POST /outreach/sms/draft` and
  `POST /outreach/serve/sms/draft` receive the full message as sent
  (greeting, body, paid-for-by, opt-out), not a body: the webapp's compose
  field holds all of it. `OutreachSmsGenerationService`
  swaps each part contracts `deriveSmsProtectedParts` would lock for a `⟦n⟧`
  marker (`util/smsProtectedImprove.util.ts`), accepts a reply only if every
  marker comes back exactly once and in order, puts the text back, and refuses
  a reply that fails a `checkSmsStandards` rule the original passed, or that
  carries more civic panel lines (`countCivicPanelLines`) or opt-out lines than
  the original did (a model that wrote its own beside the marker), or, where
  paid-for-by is enforced (Win), more paid-for-by lines. The footer (the closing run of markers: paid-for-by,
  opt-out, a civic panel line) is never sent: the model polishes the rest and
  the footer is appended back verbatim, since a reply that dropped one of its
  markers failed the whole request (ENG-11297). Two tries, and a second try
  after a dropped marker is told which markers to keep rather than re-asked
  the same prompt; then 502, which the webapp shows as its "try again". Every SMS
  prompt, Win and Serve, draft and improve, carries
  `SMS_LOCKED_LINES_AND_STYLE_RULE`: never write a JOIN, LEAVE or STOP line,
  no em or en dashes, never "just". The Serve create refuses (400) a message
  with no opt-out or a second civic panel line (`assertServeSmsLockedLines`,
  `util/serveSmsLockedLines.util.ts`, which the managed civic panel's
  approval also runs).
  The controllers
  pass the names and committee scheduling checks against (Win: the campaign
  owner plus `tcr_compliance`, as `requireCompliantScript` reads them; Serve:
  the official, paid-for-by ignored). A fresh draft is still the body only and
  the webapp composes around it. This reverses the 2026-09-02 rule that the
  footer is appended out of the model's and candidate's reach
  (`docs/features/message-composer.md`).
- **The candidate a message identifies is the campaign OWNER, never the
  requester.** With team accounts, `@ReqUser()` can be a Campaign Manager, so
  the Win draft/generate endpoints (sms, social, phone banking, robocall,
  door knocking) and robocall's compliance self-ID check resolve the name via
  `@/campaigns/util/ownerCandidateName.util.ts` (shared with the
  campaign-story rewrite since ENG-11139) from the campaign's `user` relation
  (`@UseCampaign({ include: { user: true } })`) — the same source
  `requireCompliantScript` checks at scheduling. `@ReqUser()` remains correct
  for actor attribution (LLM-call `userId`, `canceledBy`) and for payment
  (managers pay on their own card).
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
  list itself, not onto an `Outreach` row. `POST /v1/phone-banking/serve/lists`
  (`src/phoneBanking/`, ENG-10985) is the Serve counterpart of
  `POST /v1/phone-banking/lists`, gated by `@UseElectedOffice()`: both routes
  call the same `PhoneBankingListService.create`, differing only in the scope
  they pass (`{ campaignId: null, organizationSlug }` for Serve) — the
  controller derives the scope from which route was called, never from
  whether the org happens to have a `Campaign` row, so a dual-role org keeps
  Win and Serve lists isolated the same way social does.
- **A chat card's proposal link rides on the Serve creates.** The Serve phone
  banking create, `POST /outreach/serve/social` and `POST /outreach/serve/sms`
  accept an optional `proposalKey` + `priorityId`, plus the check it puts out
  (`stepId` + `side`) (contracts `ProposalLinkSchema`, the key the card
  derives and never the model). `resolveProposalLink`
  (`priorities/util/proposalLink.util.ts`) checks the priority against the
  caller's own office and that the step is a gate with both halves given;
  the four land on the outreach row in its INSERT. A phone banking or social
  create carrying a key that already names this org's outreach of the same
  channel returns that outreach instead of building another (a race loses to
  the unique index and reads the winner back); a key held by another org or
  another channel is a 409. The phone banking replay reports `hasMore:
false`: it hands back what was built, not a fresh build. A text holds the
  key from its unpaid draft on: re-entering the flow moves the key to the
  fresh draft, and once a draft under it is paid the key is spent (409).
  Win's text takes the same key on `POST /outreach` (`proposalKey`, a new
  p2p draft only, never a resume), with the same rules
  (`util/createUnderProposalKey.util.ts`, shared with the Serve SMS create);
  it carries no priority, since the Campaign Manager's card puts out no
  check. The Win phone banking create, `POST /outreach/social` and
  `POST /door-knocking/turfs` take that key alone the same way (never a
  priority, which their strict schemas refuse), with the same replay, race
  and 409 rules as their Serve siblings. `findByProposalKey` skips `pending_payment` and `draft`, so an
  unpaid text reads as not sent, and `GET
/outreach/by-proposal-key/:proposalKey` is org-scoped so a Win card
  resolves too. Each create (and each replay) calls
  `PriorityStatusService.recordOutreachSentOrLog` after its own commit,
  which moves that side of the priority's check to out and logs rather than
  throws, since the send stands either way; the text records from the
  purchase handler once paid and enqueued, where a throw makes Stripe
  redeliver. A write that fails is healed by the next replay or by
  `healSends`, which the priority flow runs before each turn reads the
  status. Door knocking takes the link on `POST
/door-knocking/serve/turfs` (`CreateServeDoorKnockingTurfSchema`) and
  writes it on a new campaign's anchor envelope only; a key this org already
  spent on a walk leaves the next walk unlinked. See
  `gp-webapp/app/dashboard/shared/agent-chat/AGENTS.md` ("Cards").
- Tone vocabulary (`util/messageTone.util.ts`) is shared across every
  stateless compose endpoint — don't redefine `TONE_STYLES` per channel.
- `nativePhoneBanking` and `nativeDoorKnocking` envelopes are never touched
  by `OutreachMaterializationService` — same reasoning as the exclusion
  above. The nativePhoneBanking envelope flips to `completed` from inside
  `PhoneBankingCallService` (`src/phoneBanking/`, ENG-10915), in the same
  transaction as the interaction-row upsert that logs the last un-logged
  person, once every person on every entry has a row. `nativeDoorKnocking`
  flips too, but on a different trigger: someone marking the list done
  (`POST /v1/door-knocking/turfs/:id/complete`, or
  `POST /v1/door-knocking/campaigns/:anchorId/complete` for every turf in a
  campaign), not exhaustion of the roster — a walk is routinely finished with
  doors left unlogged, so "every person has a row" would almost never fire.
  There is no mirror and no `completedAt`: this row's `status` IS the
  door-knocking lifecycle, which is why a Serve org gets an envelope
  (`campaignId: null`) rather than the turf keeping columns of its own. See
  `docs/door-knocking.md`.
- **Only the LEGACY robocall type materializes recipients; VO 2.0's robocall
  writes NO per-contact rows.** The legacy type (created via the generic `POST
/outreach`, fulfilled out of band, off the legacy Slack) reaches
  `OutreachMaterializationService` via `OutreachService.tryMaterializeOutreach`
  and writes `ContactInteractionRobocall` rows whose `answeredAt`/
  `voicemailLeftAt` stay permanently null (no vendor read — CallHub is never
  called for it, and Peerly's integration is SMS-shaped). VO 2.0's robocall
  (`outreachRobocall*.service.ts`) DOES dial through CallHub but no longer
  materializes at all: the run-window billing model does not know who was
  reached (CallHub reports no per-call disposition and the per-person feed is
  hidden), so its dial records only the aggregate count on the `OutreachRobocall`
  row. `OutreachInboundSweep` is text/p2p only and must stay that way — **do not
  build a partial robocall sweep**; half-populating the legacy rows' disposition
  columns turns "we never looked" into a disposition. The real thing is a
  full robocall twin of `OutreachInboundSweep`.
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
- **Door knocking's lifecycle lives on THIS row, and door knocking owns the
  writes.** `DoorKnockingTurf` has no `completedAt`/`archivedAt` any more. The
  turf-to-envelope mirror this bullet used to describe is gone, and so are the
  ordering and shared-timestamp rules that existed only to keep two copies
  honest: 3.0 writes an org-scoped envelope for a Serve org too
  (`campaignId: null`), which removed the reason the columns lived on the turf.
  `status` is completion, `archivedAt` is the shelf, and
  `DoorKnockingTurfService` writes both — `complete` / `setArchived` for one
  turf, `completeCampaign` / `setCampaignArchived` for every envelope in a
  campaign (the anchor plus every row carrying its id in `campaignOutreachId`).
  Each campaign write is ONE guarded `updateMany` (`status: in_progress` for
  complete, `archivedAt: null` for archive), so the archive timestamp is a
  single bound parameter shared across siblings and a repeat press moves
  nothing. `OutreachService.setArchived` must still not be the way in for a
  door-knocking row: the door-knocking methods are the ones carrying the turf
  scope and the idempotence guards, and the history drawer's Archive button
  calls them. See `docs/door-knocking.md`.
- **`OutreachDetail.doorKnocking` is the door-knocking satellite block**, the
  sibling of `phoneBanking`, filled by `OutreachSocialService.findDetail` for a
  `nativeDoorKnocking` row, keyed on the envelope's own `doorKnockingTurfId`.
  It used to be keyed on `doorKnockingRouteId` and reach the turf through the
  route, which worked exactly as long as every turf had one — a campaign
  nobody has walked yet would have dropped out of its own drawer. Such a row
  gets the block with `routeId: null` and its REAL doors and people — those
  are frozen when the turf is DRAWN, not when it is walked — which is the
  state, not a tombstone (a tombstoned turf still yields no block at all).
  Its three counts come from
  `DoorKnockingTurfCountsService` — the SAME aggregate the door-knocking rail
  reads — and must keep coming from there: a second derivation is the
  two-denominator failure: two different numbers for one quantity.
  `OutreachModule` imports `DoorKnockingModule` behind a `forwardRef` for it
  (the module graph loops back through contacts → campaigns → peerly). A
  tombstoned turf yields no block.

## Contracts / models

- `@goodparty_org/contracts` `src/outreach/`: `OutreachEvent.schema.ts`
  (an event invite's date, time and place, above),
  `OutreachSocial.schema.ts`,
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
  `POST /outreach/robocall/:outreachId/authorize`),
  `OutreachDraft.schema.ts` (`CreateOutreachDraftRequestSchema` for
  `POST /outreach/drafts` — one schema covering both channels, plus the
  `{ existingId }` conflict body).
- Prisma: `outreach.prisma` (spine), `outreachSocial.prisma` +
  `ServeSms.schema.ts` (the Serve draft request/response, the draft-first
  create request/response with its three counts, and the staff results-upload
  row + report shapes the delivery layer's inbound half is driven by).
- Prisma: `outreach.prisma` (spine), `outreachTextRecipient.prisma`
  (`OutreachTextRecipient`: who a send went to and on which number, unique on
  `(outreachId, personId)` and indexed on `(outreachId, phone)` for the
  inbound lookup — Win's `PeerlyPhoneListRecipient` cannot serve here because
  `PeerlyPhoneList.campaignId` is NOT NULL and a Serve send has no campaign),
  `outreachSocial.prisma` +
  `outreachSocialAsset.prisma` (social satellite), `outreachRobocall.prisma`
  (`OutreachRobocall` payment/state satellite + the `RobocallSettleState` enum;
  its `compliancePassedAt` mirrors the passing verdict at create so the dial
  gate has a per-draft fact; its nullable `overdueAlertedAt` is the overdue-alert
  sweep's once-per-run dedupe stamp, read by nothing else; its nullable
  `backlogAlertedAt` is the proactive backlog-alert sweep's once-per-run dedupe
  stamp (the queue is projected to push this run past its scheduled day), read
  by nothing else; its nullable
  `poolFreedAt` is the serial send sweep's "CallHub pool slot freed early" stamp
  (set when the completion seam reports a dialed run DONE and its campaign is
  aborted — OPERATIONAL only, never settlement), read only by the serial gate and
  the free-and-advance step; its nullable `dialingStartedAt` is stamped at the dial
  claim and NEVER bumped by stale-dialing recovery's self-transition, so it is the
  STABLE clock the deadlock backstop measures a stuck `dialing` row's age from —
  read only there; its nullable `stagedCallsPerMinute` is the CallHub `frequency`
  this campaign was created with, FROZEN at stage time so the dial-completion
  ceiling and the backlog projection read the rate THIS run dials at rather than a
  later-raised live `CALLHUB_VB_CALLS_PER_MINUTE` — null for a pre-R1 run, which
  falls back to the live rate), `robocallComplianceResult.prisma`
  (`RobocallComplianceResult`: `audioKey` unique, `passed`, `checkedAt` — the
  per-audioKey verdict store the create gate reads; `audioEtag` binds the verdict
  to the exact audio bytes, and `OutreachRobocall.complianceAudioEtag` freezes it
  onto the draft for the dial path), `robocallOrphanedCampaign.prisma`
  (`RobocallOrphanedCampaign`: `campaignPkStr` unique, `outreachId?`, `reason`,
  `abortedAt?` — the work queue of PAUSED CallHub campaigns abandoned before they
  could dial, ABORTed by the cleanup sweep), `robocallOrphanedHold.prisma`
  (`RobocallOrphanedHold`: `paymentIntentId` unique, `outreachId?`, `reason`,
  `voidedAt?` — the work queue of authorization holds whose best-effort void may
  not have landed, confirmed + re-voided by the reconcile sweep),
  `outreachOptOutReconcile.prisma` (`OutreachOptOutReconcile`: `outreachId`
  primary key, `attemptedAt` — when the opt-out backup pass last asked Peerly
  for that send's flags, kept off the outreach row so it never bumps
  `updatedAt`). Phone banking's own tables
  (`PhoneBankingList`, `PhoneBankingListEntry[Person]`,
  `ContactInteractionPhoneBanking`, `PhoneBankingSuppressedPhone`) and
  controller/service live in a separate `src/phoneBanking/` module — this
  package only owns the stateless draft/improve endpoint above. That
  module's two caller routes (`GET lists/:id`, `POST lists/:id/calls`)
  carry `@AllowVolunteer()`; a volunteer is admitted only when
  `PhoneBankingAccessService` finds an `OutreachAssignment` on the list's
  envelope (via `OutreachAssignmentService.existsFor`, imported from this
  module), else 404 — create/serve-create/delete stay manager+ (ENG-11050).

## Tests

Moved to [`docs/tests.md`](docs/tests.md) (~21 KB). Grep it for the file, class, or route you are working on; do not read it whole.
