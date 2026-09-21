# Serve texting: delivery, SMS, and polls (TDD)

Owner: Stephen. Status: design pass, pre-build. Scope is how a message gets to
constituents and how replies come back, for two products that share that
mechanism and nothing else.

**What this document does not design, but the customer still needs.** Creating
and paying for a send (the Serve SMS surface, the draft endpoint, the purchase
handler) is not designed here, because the feasibility pass found it low-risk
with direct precedents in the repo. **None of it is built.** It is slice 0 in
Sequencing and it blocks the customer exactly as much as everything else here
does. Do not plan delivery off slices 1 through 3 alone.

Immediate need: SMS for elected officials, for a named customer. Standing
constraint: polls eventually stops being its own page and becomes a channel in
outreach. This document is written so the first build is a step toward the
second rather than a thing to undo.

Design reference (UI):
[Claude Design - Voter Outreach](https://claude.ai/design/p/db901089-c99e-4063-bf79-c3344c959704?via=share&file=Voter+Outreach.dc.html)
(login-gated). Read it with the `claude-design-read` skill;
`DesignSync.get_file` truncates this file silently and reports success. The
results anatomy below is transcribed from the `polls` channel: `pollData`,
`pollResultsCard`, `pollDetailDone`, `pollIssueDetail`, `pollCommentsSection`,
`renderGatherFlow`.

Build plan: `docs/features/serve-sms-implementation-plan.md` (waves, file
ownership per task, the pre-work PR, and a retrospective).

Related: `packages/gp-api/src/outreach/AGENTS.md`,
`packages/gp-webapp/app/dashboard/constituent-outreach/AGENTS.md`,
`packages/gp-api/src/polls/`, `packages/gp-ai/serve/v1_pipeline/`.

## Summary

Serve SMS reuses the Win SMS flow up to payment and then diverges completely.
There is no Peerly identity for an elected official and no 10DLC registration
to gate on, so fulfillment works the way polls works: gp-api builds a recipient
CSV, posts it to a Slack channel, and a human sends the messages and returns
the replies.

The design decision this document turns on is **not** which poll code to reuse.
It is where to draw the line between the texting mechanism and the products
built on it. There are three layers:

1. **Delivery.** Resolve recipients, scrub opt-outs, dedupe, capture the
   phone-to-person map, hand the send off, ingest raw replies. Knows nothing
   about polls or SMS. Slack and CSVs today; a vendor API and webhooks later.
2. **SMS.** A message to a saved list. Results are engagement counts and a
   reply list.
3. **Polls.** A question to a sample or a list, plus analysis. Results are
   clustered themes, issues, confidence, and an expansion flow.

The clustering pipeline belongs to layer 3, not layer 1. That is the load-
bearing claim here. An earlier draft of this document let analysis leak into
the transport, which is exactly what would have made the two products hard to
keep distinct, and would have made an SMS send's basic reply counts depend on
an LLM run succeeding.

**SMS bypasses clustering entirely** (decided 2026-09-18). It does not run the
Fargate analysis, does not read a cluster artifact, and does not consume theme
events. Consequence: SMS needs no part of the S3-plus-Lambda-plus-Fargate
chain, so its replies arrive through an upload instead.

**Both products return results through one surface** (decided 2026-09-18).
Fulfillment must never have to work out which kind of send a Slack message is
about, or remember two ways to send results back. gp-api takes one upload and
routes server-side: a poll's file is written to the bucket the pipeline
already watches, an SMS file is ingested directly. The human-facing
unification therefore lands immediately, in slice 2, and does not wait for the
backend unification in slice 4. See Layer 1, inbound.

Creating hidden `Poll` rows to ride the existing poll consumer would ship
faster and is rejected. It adds a second caller to the thing we intend to
retire, and it inherits an opt-out bug polls has today.

## Goals

* A Serve SMS send that goes out and comes back, end to end, with counts the
  official can see.
* A delivery layer whose interface survives replacing Slack with a real
  vendor, and which polls can move onto without reshaping.
* Polls and SMS distinct at every level above delivery: separate compose,
  separate result semantics, separate storage for anything product-specific.
* Opt-out honored at send time, which polls does not do today.
* Reply content stored where the constituent record can read it, so an SMS
  send appears on the Serve timeline the way a poll does.
* A data shape that makes polls-into-outreach a re-key rather than a rewrite.

## Non-goals (v1)

* Any Peerly involvement. The Serve path never touches
  `resolveP2pCreateInputs`, no identity, no phone list, no job, no CAS console.
* Clustering, themes, or issues for SMS. Ever, not just in v1.
* Migrating existing poll data or retiring the polls page. This build makes
  that possible; it does not do it.
* Two-way reply threads. See Out of scope.
* Scheduling precision. See Send timing.

## The three layers

### Why the line is here

The two products share one question ("get this text to these people and bring
back what they said") and agree on nothing after that. A poll's output is a
ranked set of themes over a statistically meaningful sample. An SMS campaign's
output is how many people replied and what they said. Those are different
products that happen to ride the same wire.

Putting the wire in one place buys three things: the vendor swap is one change
instead of two, the opt-out obligation is enforced once instead of per product,
and polls-into-outreach becomes a re-key because the per-person reply data is
already outreach-scoped.

### What lives where

| Concern | Layer |
|---|---|
| Resolve a saved filter or a random sample into recipients | Delivery |
| Opt-out scrub, phone dedupe, recipient cap | Delivery |
| Recipient capture (phone ↔ person ↔ outreach) | Delivery |
| Handoff (Slack CSV now, vendor API later) | Delivery |
| Raw reply ingest, opt-out detection, CRM write-back | Delivery |
| Reply flags (favorite, read) and, later, threads | Delivery |
| Tone and purpose compose, engagement counts, reply list | SMS |
| Question compose, bias analysis, sample sizing | Polls |
| Clustering run, themes, issues, confidence, expansion | Polls |

The test for whether something belongs in delivery: would it still be true if
we swapped Slack for Twilio? Scrubbing opt-outs, yes. Ranking themes, no.

### The interface

Defined in terms that name neither product. The product resolves its own
"who" and "what"; delivery owns everything that is a transport obligation.

```
requestSend({
  outreachId,          // the envelope, org-scoped
  audience,            // { savedFilterId } | { sampleSize, excludePersonIds }
  message,             // text sent verbatim
  imageUrl,            // optional
  scheduledFor,        // see Send timing
  sendSeq,             // 1, then incremented per expansion
}) → { recipientCount, excludedOptedOutCount, excludedDuplicateCount, sendKey }

ingestReplies({
  outreachId,
  rows,                // [{ phone, content, receivedAt }]
  sourceLabel,         // which producer, for the audit trail
}) → { matched, unmatched, optOuts }
```

`audience` accepts a sample spec on day one even though only polls will pass
one, and nothing calls it that way yet. That is the guard against the layer
quietly becoming SMS-shaped: if the sample branch does not work, the layer is
not shared.

`ingestReplies` is source-agnostic. One writer, two producers: both start from
the same upload, but SMS's rows are parsed straight out of it while polls' rows
come back from the analysis pipeline's artifact after the file has been through
it. One human surface, two code paths, and the human never sees the seam. This
is the concrete thing the layering buys.

## Data model (gp-api)

### Delivery layer

**`Outreach`** (existing, unchanged). A Serve row is
`{ campaignId: null, organizationSlug }`, which the existing CHECK already
permits and Serve social rows already use. SMS is `outreachType: text`, not
`p2p` (which carries Peerly semantics through the create path). Polls will
later be a new `poll` type on the same spine. The spine already carries
`script`, `message`, `imageUrl`, `date`, `scheduledLocalDate`,
`voterFileFilterId`, `textCount`, `billableTextCount` and
`stripeCheckoutSessionId`.

**`ContactInteractionText`** (existing, unchanged). Already
`organizationSlug`-scoped with a nullable `outreachId` and a
`(outreachId, personId)` unique. Stays the spine for counts, the opt-out
scrub, and the constituent record. This is what makes the design's Statistics
card free.

**`ContactInteractionTextService`** (existing) is already vendor-agnostic:
`createManyIdempotent` materializes recipients, `applyInboundEvent` writes a
reply or opt-out with idempotency in the UPDATE's WHERE clause, and
`findOptedOutPersonIds(organizationSlug)` returns the scrub set. The Peerly
sweep is one producer; this layer becomes a second.

**Per-person message rows.** This is `PollIndividualMessage`, generalized.
It already has `content`, `sender`, `isOptOut`, `personCellPhone`, `personId`,
`electedOfficeId` and a join to issues. It is poll-bound only because `pollId`
is non-null.

```
pollId      String?   // was non-null
outreachId  Int?      // new
CHECK (exactly one of pollId, outreachId)
```

Same XOR-scope pattern `Outreach` already uses for `campaignId` /
`organizationSlug`. Add an `[electedOfficeId, outreachId, personCellPhone]`
index to mirror the existing poll one, which is the phone-to-person lookup.

Chosen over a parallel `OutreachTextResponse` table because
`contactEngagement`, the constituent issues reader, and the response CSV
download keep working for both surfaces with one predicate change instead of a
second implementation. It also means polls-into-outreach flips `pollId` to
`outreachId` rather than copying rows between shapes. Cost: the table keeps a
poll-flavored name until a later rename, and one additive migration touches a
table with production data.

Note this is **the only place in the schema that stores inbound SMS text.**
The Win inbound sweep persists timestamps and never the body. Nothing else
can serve the design's comments list or quote attribution.

**Recipient map.** `outreachId`, `organizationSlug`, `personId`, `phone`,
unique on `(outreachId, personId)`, indexed on `(outreachId, phone)`. Needed to
attribute an inbound reply. Win's equivalent is `PeerlyPhoneListRecipient`,
unusable here because `PeerlyPhoneList.campaignId` is non-null.

**Reply flags** (favorite, read). `(userId, messageId)` with `favoritedAt` and
`readAt`. Nothing like it exists today. Delivery layer because both products'
reply lists want it. Optional in v1; see Out of scope.

### SMS layer

No new tables. The spine carries everything, and results are counts plus the
shared message rows.

### Polls layer

Not built in this work, specified so the delivery layer is shaped correctly.

When polls moves in, it becomes an `Outreach` row of type `poll` plus an
`OutreachPoll` satellite, following the repo's documented satellite convention
(a channel gets its own table only when its data changes shape, as with
`OutreachSocial` and `OutreachRobocall`). The satellite carries what the spine
has no column for: `targetAudienceSize`, `confidence`, `responseCount`,
`estimatedCompletionDate`, `lastAnalysisAt`. `PollIssue` is re-keyed from
`pollId` to `outreachId` the same XOR way. The `Poll` table then collapses into
the spine.

## Layer 1: Delivery

### Outbound

Modeled on `triggerPollExecution`
(`gp-api/src/queue/consumer/queueConsumer.service.ts:1210`), with sampling
replaced by an audience spec.

**Trigger.** The purchase handler's post-purchase step claims
`pending_payment → pending` with a CAS (mirroring `finalizeOutreachPurchase`)
and enqueues `outreachTextSend { outreachId }` on the existing SQS FIFO queue
with a per-outreach message group, so two deliveries serialize.

**Audience resolution.** Two branches behind one spec:

* *Saved filter* (SMS today, polls later). Use the paging loop from
  `P2pPhoneListUploadService.buildPhoneList`
  (`gp-api/src/vendors/peerly/services/p2pPhoneListUpload.service.ts:178`),
  which already forces `hasCellPhone`, pages with `skipCount`, dedupes by phone
  across pages, skips rows people-api cannot give a phone for, and caps
  recipients. Lift it into the delivery service; the Peerly caller keeps its own
  CSV shape.
* *Random sample* (polls). `ContactsService.sampleContacts`, which is
  district-wide with `hasCellPhone` forced and takes `excludeIds`. Wire it now
  even though nothing calls it, per the guard above.

**Opt-out scrub.** `findOptedOutPersonIds(organizationSlug)` passed as
`excludePersonIds`, exactly as `resolveOptOutScrub` does for Win. Record the
excluded count for the review step, as `PeerlyPhoneList.excludedOptedOutCount`
does. This is the behavior polls lacks; see Opt-out.

**CSV.** Header `id,firstName,lastName,cellPhone`, the shape fulfillment
already receives from polls (`buildCsvFromContacts`, ~line 1415). Key it
deterministically so a redelivered queue message reuses the object rather than
resampling a different audience: `${outreachId}-${sendSeq}.csv`. Polls uses
`${poll.id}-${estimatedCompletionDate}` and relies on that date never changing;
an explicit counter beats a timestamp that happens to be stable.

**Recipient capture.** Recipient-map rows with `skipDuplicates`, and
`ContactInteractionText` rows through `createManyIdempotent` with `occurredAt`
at handoff time. Both idempotent on retry.

**Handoff.** Copy the block structure of `sendTevynAPIPollMessage`
(`gp-api/src/polls/utils/polls.utils.ts:10`) into a delivery-owned helper:
official name, email, phone, message body, image URL, scheduled date,
recipient count, the outreach id, and the return instruction. On an expansion,
carry the same "combine previous responses with the new responses" note the
poll expansion does, because a poll re-analyzes its whole corpus.

**Status.** Advance the spine `pending → in_progress` once the handoff lands,
CAS-guarded on `pending`. That is what makes the drawer read "Sent, now
gathering responses. No action needed."

### Inbound

One upload surface for both products, two producers behind it, one writer.

**The human-factors constraint comes first here.** Today the Slack message
hands fulfillment an `aws s3 cp` command
(`gp-api/src/polls/utils/polls.utils.ts:210`) that they must run with AWS
credentials and an exactly correct key. gp-api is not in that path at all; it
only reads the pipeline's output much later. Two consequences: a mistyped key
fails silently, with nobody to report to, and adding a second return path for
SMS would leave fulfillment holding two commands and a rule for choosing
between them. That rule is the thing to design away.

**The upload surface.** Every send's Slack message carries a button linking to
a gp-admin page scoped to that exact send. The identity of the send travels to
the human rather than being recalled by them, so the whole class of wrong-key
and wrong-send errors disappears. A "results inbox" in gp-admin lists every
send awaiting results and opens the same page, for when the Slack message has
scrolled away; it doubles as a work queue so nothing sits forgotten.

The page shows what it expects before accepting anything (send name, recipient
count, message body), then parses on upload and reports before committing:
"340 rows, 328 matched a recipient, 12 matched nobody, 9 opt-outs". This is a
money-adjacent operation and silent partial failure is the current failure
mode. It lives beside the existing SMS console
(`gp-admin/src/app/dashboard/sms-outreach/`) behind the same `AdminOrM2MGuard`.

Accepted columns: phone and message text required, received timestamp optional
(defaults to upload time). Accept the header spellings the pipeline already
accepts (`phone_number` / `Contact Phone Number`, `message_text` /
`Message Text`, `sent_at` / `Sent At`) so fulfillment does not learn a second
format.

**Routing is server-side**, keyed on the outreach type, and the human never
knows there are two paths:

* *SMS* → parse and call `ingestReplies` directly. No S3 object, no Lambda, no
  Fargate, no LLM, and no dependency on the AI pipeline for basic counts.
* *Poll* → write the file to `input/<pollId>.csv` in
  `SERVE_ANALYSIS_BUCKET_NAME`. The existing S3 notification fires the Lambda,
  which launches the Fargate task, which runs
  `packages/gp-ai/serve/v1_pipeline` and publishes to SQS. **Nothing in that
  chain changes.** gp-api simply becomes the thing that puts the object there
  instead of a person's terminal.

**Reversed 2026-09-21: the `aws s3 cp` line stays, and polls does not move
onto the upload surface in slice 2.** Slice 2 becomes SMS-only.

The earlier plan removed the line and routed poll uploads through the page in
the same slice, so fulfilment would learn one thing once. That is still the
right end state, but it made slice 2 the one piece of the customer's path that
changed a live workflow, which meant it could not ship without a scheduled
conversation. Deferring it takes that dependency off the critical path
entirely.

What this costs: fulfilment temporarily has two return paths — the CLI command
for polls, the button for Serve SMS. That is precisely the cognitive overhead
this design set out to remove, so it is a debt, not a simplification. It is
tolerable only because the split is per product rather than per message, and
because Serve SMS starts with one customer.

**Agreed follow-up (2026-09-21): once Serve SMS has been tested end to end,
move polls onto the upload surface and delete the `aws s3 cp` line.** That is
its own change, sequenced after the customer is live rather than bundled into
their path. It is the only slice that alters fulfilment's existing workflow,
so it is the one that gets scheduled with them. Nothing blocks it technically:
PR #2024 already decoupled the poll e2e from that line.

Two things make the deferral cheap. A5's handoff helper is used only by the
delivery layer, so the button already appears solely on Serve SMS messages and
polls' Slack message is untouched as things stand. And PR #2024 already
decoupled the poll e2e from the CLI line, so keeping the line is now a free
choice rather than something the test depends on.

**This is gated on a pre-work PR to main, and the reason is that no PR will
catch it.** `@dev-only` Playwright specs are grepped out of pull request runs
entirely and run only post-merge on the release train
(`gpbot-dev-test-triage.yml`: "These never run on PRs, so nothing saw them
before the merge"; prior incident ENG-11106). The poll e2e is `@dev-only`, so
removing the line fails nothing until the train runs.

**Pre-work, shipped to main on its own before this line is removed: PR #2024.**
Two env vars named in `release.yml`'s `e2e-shard` job (plain config, not
credentials) and both parsers deleted. Harmless on main today, since the CLI
line still exists and the env vars resolve to what the parsers produced.

**The line feeds two parsers, not one.** The poll e2e does not use the upload
path at all (it publishes `pollAnalysisComplete` to SQS itself and writes its
artifact under an `e2e-test/` prefix, `polls-onboarding.spec.ts:258-301`), so
the design change does not affect what it exercises. But both
`getBucketNameFromSlackMessage` and `getQueueNameFromSlackMessage` regex
`serve-analyze-data-[a-z]+` out of the Slack message text, the second using the
env suffix to pick the queue name, and the `aws s3 cp` line is the only place
that string appears. Removing it throws in both. PR #2024 sets
`SERVE_ANALYZE_S3_BUCKET` and `E2E_SQS_QUEUE_NAME` and drops both parsers.

Worth noting while we are here: because the test injects below the upload
surface, the real S3-to-Lambda-to-Fargate chain has no automated coverage
today. Not a blocker, and not this slice's job to fix.

**Why not read the file out of Slack directly.** A file attached as a thread
reply would be lower friction still, and the thread makes the send identity
implicit. But the Slack integration is currently outbound only: there is no
controller, no event subscription, no interactivity endpoint and no signature
verification anywhere in gp-api. Supporting it means a public inbound endpoint,
signing-secret verification, `files:read`, app manifest and scope changes, and
a token to pull the file out of Slack storage. That is real work and a new
attack surface for a step-change the button mostly already delivers. It stays
available as a pure addition later, because the ingest is already one function
with pluggable producers.

**The event split.** Today one message carries both the responses artifact
location and a required issues array, so reply counts and clustering succeed or
fail together. Split them: the pipeline always emits the artifact location, and
emits themes as a separate payload. Polls consumes both. Nothing consumes the
theme payload for SMS because SMS never triggers the pipeline.

**Ingest (shared).** Whichever producer:

1. Group rows by `(phone, receivedAt)`. One reply can span several rows after
   the pipeline splits compound messages; a direct upload will not, and the
   grouping is harmless there.
2. Map phone to `personId` through the recipient map for this outreach. Keep
   the poll handler's People DB fallback for a phone that was not on the send
   (a forwarded message answered by someone else) and its decision to skip an
   unattributable reply with a log rather than throw. Throwing bubbles to SQS
   and redelivers forever, blocking every other reply in the batch.
3. Detect opt-out with **one predicate in this layer**, applied to every row
   regardless of producer. Today polls takes `isOptOut` from the pipeline and a
   direct upload has no such field, which is two definitions waiting to drift.
   The pipeline's flag becomes a hint, not the source of truth.
4. Write message rows with deterministic uuidv5 ids from
   `(outreachId, personId, receivedAt)`, inside a transaction that first deletes
   the ids it is about to write. The poll handler's idempotency pattern;
   survives redelivery and re-analysis.
5. Apply reply and opt-out events onto `ContactInteractionText` via
   `applyInboundEvent`, using the message row id as `sourceEventId`. This lights
   up the Statistics card, the opt-out chip on the person record, and the scrub
   for the next send.
6. Advance the spine `in_progress → completed`, CAS-guarded.

Steps 1 through 6 contain nothing product-specific. Polls adds a step 7 that
writes themes.

### Send timing

The one place the Win flow's promises cannot be kept, and it needs a product
decision before the schedule step is built.

Win enforces a 48-hour minimum, hourly slots 9am to 8pm, and sends
`scheduledLocalTime` as the start of a recipient-local window closing at the
9pm cutoff, all enforced at Peerly. Here a human reads a date off a Slack
message and sends when they get to it.

The design resolves this by removing the choice: "GoodParty.org sends all polls
at 11am local time to maximize responses", with a fixed send date and an
estimated completion. Polls in the product does the same with
`addBusinessDays(scheduledDate, 3)`.

**Decided 2026-09-21: mimic what polls already ships.** Not the design's looser
version, the live one, so the two Serve products make the same promise:

* No time picker. Fixed 11am local, stated rather than chosen.
* Date only, at least **2 business days** out, no more than **30 days**, and
  weekends disabled. The predicate is `getDisabledState` in
  `PollScheduledDateSelector.tsx`; lift it rather than re-deriving it.
* Copy is `POLLS_SCHEDULING_COPY`: "All polls are sent at 11am local time. You
  can schedule at least 2 business days in advance, and no more than 30 days
  out." Reword the noun for SMS, keep the shape.
* Estimated completion is `addBusinessDays(scheduledDate, 3)`, matching
  `polls.service.ts`.

This is strictly simpler than Win's step: no hourly slots, no custom time, no
48-hour arithmetic. It also drops `scheduledLocalTime` from the Serve create
payload entirely, since the time is a constant rather than a choice.

### Vendor swap

What changes when Slack goes away: `requestSend`'s handoff becomes an API call
plus a stored vendor job id, and the SMS producer of `ingestReplies` becomes a
webhook or a sweep instead of an upload. The interface, the scrub, the
recipient map, the dedupe, the opt-out predicate, and every consumer above the
layer are untouched. Polls keeps its pipeline, now fed from the same ingest.

A real two-way number is also the precondition for reply threads, for both
products at once. That is one decision, not three.

## Layer 2: SMS (Serve)

What SMS adds on top of delivery is small, which is the point.

**Create and pay** (slice 0; not designed in detail here, and not built).
`SmsFlow` takes a `surface` prop the way `SocialFlow` and `PhoneBankingFlow`
already do
(`PhoneBankingFlow.tsx:201` is the shape). A `POST /v1/outreach/serve/sms`
draft mirrors `outreachServeSocial.controller.ts` under
`@UseElectedOffice()`. Payment runs through the existing org-capable checkout
(`purchase.controller.ts:236` already takes campaign or organization) under a
new purchase type, because the `TEXT` handler hard-requires a `campaignId` and
`outreachType === 'p2p'` and finalizes to Peerly
(`outreachPurchase.service.ts:246`).

Draft-first is required, not preferred: the poll pattern puts message content
in Stripe checkout metadata, which caps values at 500 characters, and
`SMS_COMPOSED_MAX_LENGTH` is 1000.

**Results.** `getSmsResults` with its campaign predicate parametrized to an org
scope, the same way `findByScope` already handles Win and Serve. Plus a
read-only reply list off the shared message rows.

**No themes, no confidence, no expansion.** A second send to a different list
is a new send.

## Layer 3: Polls

Not built here. What it will add, once it moves in:

* Question compose with the existing bias analysis
  (`pollBiasAnalysis.service.ts`), sample sizing, and the audience-size
  purchase math.
* The clustering trigger (the S3 drop) and the theme payload consumer.
* Confidence, the low-response terminal state, and "gather more feedback".
* The themes and issue-detail UI.

The migration, once the delivery layer exists: add the `poll` outreach type and
the `OutreachPoll` satellite, backfill an `Outreach` row per `Poll`, flip
message rows and issue rows from `pollId` to `outreachId`, repoint the polls
page at the outreach reader, delete it. No data reshaping, because the
per-person rows are already in the shared table.

## Results UI, from the design

Transcribed so the data requirements are explicit; line ranges in parentheses.

**Collapsed row** (`resultsText`, ~115). A poll reads `"{responses}
responses"`. An SMS row reads `"{responses} responses · {unsub} unsub"`.

**Row drawer, done** (~4780-4900), in order: Audience (list name and filter
pills), Overview (start, end, name, sample), Statistics, Top issues (polls
only), Payment details with View receipt, Message. Footer CTA by status:
scheduled gets Cancel and Edit; in-progress gets the static "Sent, now
gathering responses. No action needed."; done gets "View full results".

**The Statistics card is already built.** The design renders the identical
three-row card for the `sms` and `polls` channels from the same three numbers:
contacts, responded, opted out. That is exactly `SmsOutreachResultsSchema`
(`contracts/src/outreach/OutreachResults.schema.ts`) and exactly what
`getSmsResults` returns. Nothing new for this half of the results, on either
product.

**Full-results takeover** (`pollDetailDone`, ~6302) is polls-only: confidence
alert, "Results Last Updated", an accordion holding Statistics, Message and
Audience, "Top Themes" as `ContentCard`s with a `#rank` eyebrow and
"{mentions} mentions ({new} new)", a "Non-clustered feedback" card, and the
footnote "There are {n} additional comments not captured in these top themes."

**Low-response terminal state**, polls-only: responses above zero but under 20
(`lowFeedback`) replaces all of the above with "Not enough responses yet",
the Statistics card, and a "Gather more feedback" CTA.

**Issue detail** (~6344-6420) is polls-only, and the comments list under it is
the one part both products want: respondent first name, content, an expandable
CRM panel, "Show all {n} responses" past the first 10. The heart, the unread
dot, the reply thread, the composer, and the filters that depend on read state
are addressed under Out of scope.

**Two things from the design's own fixtures** worth noting, because they
validate the layering:

* The design already targets saved lists for polls, not only random samples.
  Rows h17, h21 and h22 carry audience names "Renters — housing cost
  concerns", "Northside residents" and "Library card holders" with real filter
  pills; only the onboarding poll uses "500 randomly selected residents". Both
  audience branches are real product, which is why the delivery layer takes a
  spec rather than a size.
* Small sends are contemplated. h22 is 240 contacts and 41 responses, resolving
  to two low-confidence themes with 5 and 3 mentions. The design does not
  assume poll-scale volume.

## Gaps in the current poll implementation

These are places the shipped poll results do not produce what the design draws.
They are polls-layer problems, listed so the migration does not inherit them
and so the theme payload is specified correctly when it is split out.

**"(N new)" cannot be computed today.** `PollIssue` ids are
`${pollId}-${rank}`, so a theme moving from rank 2 to rank 1 takes over the
other's id, and the handler deletes every issue before writing the new set.
Nothing survives to diff. Neither carrying a prior count forward by title match
(titles drift) nor stable cluster ids (clustering is not stable across re-runs,
especially when k changes) is sound. **Derive it from the responses instead:**
new mentions equals responses linked to this theme with `receivedAt` after
`lastAnalysisAt`. Exact, needs no theme identity, survives re-clustering.

**Quotes lose their attribution.** The event carries
`quotes: [{ quote, phone_number }]` and the handler writes
`representativeComments: [{ quote }]`, dropping the phone. The design shows a
first name on every quote. Resolve it to a `personId` at ingest, where the
phone map is already in hand, and store that on the quote.

**The response-to-theme join is a string match.** The handler links with
`groupRows.some(row => row.theme === issue.title)`. An LLM-generated title is
not a key. Have the pipeline carry each theme's `clusterId` in the payload and
join on that; the per-response artifact already has it.

**The payload caps at three themes; the design shows five.** Pipeline config
sets `publish_top_n: 3` and the schema pins `rank` to 1..3. The design's
`more-high` variant renders five plus a non-clustered card. Make the count a
request parameter rather than a global, so the two products can differ.

**There is no non-clustered bucket.** The design's card has its own count,
summary and response list. The pipeline discards what does not land in the top
N, and the handler drops any response with no `clusterId` unless it is an
opt-out. Producing the card means emitting the residue as a named bucket with
its own summarization call. The only item here I would consider cutting.

**Confidence has three definitions.** gp-api uses more than 75 responses or at
least 10% of the constituency; the design's gate is under 20 responses; the
pipeline will not cluster under 10 messages. The 10%-of-constituency half is
also meaningless for a list-targeted send, whose denominator is the list rather
than the district. Pick one rule, compute it server-side at ingest, store it on
the satellite so no reader recomputes.

## Opt-out

Polls records `isOptOut` and `contactEngagement` displays it, but nothing
excludes an opted-out constituent from a later send. `sampleContacts` takes
`excludeIds` only for already-messaged people during an expansion, so an
expanded poll can text someone who replied STOP.

This build must not copy that. Honoring STOP follows the message rather than
the sender, and Serve is explicitly a repeat-send product. Because opt-outs
land on `ContactInteractionText` in the shared ingest, the scrub is
`findOptedOutPersonIds(organizationSlug)` and costs nothing new. Putting both
the scrub and the opt-out predicate in the delivery layer is what makes it true
for polls too, the moment polls moves onto it.

Two things to confirm with whoever owns compliance rather than decide here:
whether the fixed opt-out footer stays in the composed Serve message (the Win
footer's other half, paid-for-by, does not apply to an elected official), and
whether the existing polls gap is remediated in this work or separately.

## Out of scope in v1

The design's issue detail shows a reply thread, a favorite heart, unread state,
and a composer with Improve with AI and dictation. **None of it exists
anywhere in the product.** There is no favorites or read-state column on any
model, and no per-person outbound path:
`PollIndividualMessageSender.ELECTED_OFFICIAL` rows are only ever written by
the bulk blast.

**All three are deferred for v1** (decided 2026-09-21). Recorded by cost, since
they come back at different times:

* **Favorites and read state** need no vendor, just one flags table in the
  delivery layer keyed by user and message. Deferred because the customer's
  need is seeing who replied and what they said, not triage.
* **The three filters that depend on read state** (Unread, Responded today,
  Awaiting reply) come free once that table exists, and two of them are
  meaningless without the thread anyway.
* **The reply thread** needs per-person outbound SMS, which Slack fulfillment
  does not have. A vendor decision, not a slice. Do not design around it.

v1 renders the reply list read-only: first name, content, CRM panel, and the
"All" filter.

## Sequencing

Each slice ships independently and leaves the product working.

0. **Create and pay.** `SmsFlow` gains a `surface` prop and a
   `SERVE_SMS_SURFACE`; `POST /v1/outreach/serve/sms` under
   `@UseElectedOffice()`, mirroring `outreachServeSocial.controller.ts`; a
   Serve purchase handler, because the `TEXT` one hard-requires a campaign id
   and finalizes to Peerly. Not designed in this document (see the scope note
   at the top) and not started. Independent of slice 1, so the two can run in
   parallel: slice 1 only needs an `Outreach` row to exist, which can be
   seeded by hand to exercise the Slack handoff before any UI is built.
1. **Delivery, outbound.** The service and its interface, both audience
   branches, opt-out scrub, dedupe, recipient capture, deterministic key, Slack
   handoff, status advance. Verified by watching the Slack channel.
2. **Delivery, inbound, and the upload surface.** `ingestReplies`, the shared
   opt-out predicate, the message-row generalization migration, the
   `ContactInteractionText` write-back, spine completion. Plus the gp-admin
   upload page, the per-send Slack button, the results inbox, and the
   server-side route by outreach type. **SMS only** (reversed 2026-09-21).
   The route branches on outreach type from the start, so polls moving onto
   it later is a re-point rather than a rewrite — but polls keeps its
   `aws s3 cp` line and its current workflow until the first customer is live
   end to end. That follow-up is what retires the line, and it **requires the
   e2e pre-work PR to have landed on main first** or the poll e2e breaks with
   no PR having caught it. See Layer 1, inbound.
3. **SMS results.** Org-scope `getSmsResults`, the Statistics card, the
   collapsed row summary, the read-only reply list.
4. **Polls onto delivery.** Repoint the poll send at `requestSend` and the poll
   consumer at `ingestReplies`, keeping `Poll` rows and the polls page as they
   are. Removes the duplicate send path and fixes polls' opt-out gap. This is
   the backend half of what slice 2 already did for the human.
5. **Theme payload split.** Separate the artifact event from the theme event;
   fix the five gaps above while the payload is open.
6. **Polls into outreach.** The `poll` type, the `OutreachPoll` satellite, the
   backfill, the re-key, retire the page.

**Slices 0 through 3 are the customer's path**, with one exception inside slice
2: moving polls onto the upload surface is there for fulfillment's sake, not
the customer's, and it is the only schedule lever in the set. Pulling it is the
wrong trade in most cases, because SMS messages would then carry a button while
poll messages still carry a CLI command, which is the precise confusion the
design exists to remove. If it has to move, move it as a named slice with a
date rather than leaving it implied.

Slice 4 is the one that pays for the layering, and it is worth doing before 6
so polls runs on the shared layer while still living on its own page.

## Decisions to finalize

Labelled by layer, because **SMS has no clustering, themes, confidence or
expansion.** Every theme-shaped item below is a polls-layer question in slice
5 or 6 and touches nothing the customer build ships.

**Blocks slices 0-3 (the customer path): none.** All settled, see below.

**Polls layer, slices 4-6, not on the customer path:**

* Theme count: keep 3 or raise to 5 (slice 5).
* Whether the non-clustered bucket ships or the card is cut (slice 5).
* One confidence rule, and that it lives on the satellite (slice 5).
* Whether polls' opt-out gap is fixed inside slice 4 or tracked separately.

**Settled (all 2026-09-21 unless noted):**

* *All slices* — **the whole feature ships behind `serve-sms-outreach`**, an
  Amplitude Experiment flag resolved server-side by gp-api
  (`packages/gp-webapp/docs/feature-flags.md`). Two gates, not ten:
  * **gp-api**: both Serve SMS routes on `outreachServeSms.controller.ts`
    (`sms/draft` and `sms`) check `FeaturesService.isFeatureEnabled` and 404
    when off, the same shape `outreachAssignment.controller.ts` uses for
    `win-team-accounts`.
  * **webapp**: a wrapper hook in `app/shared/experiments/serveSmsFlag.ts`,
    consumed where the channel card mounts.

  **Everything downstream is deliberately ungated.** Delivery, ingest, the
  purchase handler and the results readers are all unreachable without an
  `Outreach` row, and the create route is the only writer — so gating the
  writer makes the rest inert. This is the reasoning `win-team-accounts`
  records for gating only its create route, and gate-everywhere would be
  churn that protects nothing extra.

  The flag gates rollout, not authorization. `@UseElectedOffice()` remains the
  real access check on every route, per the docs' own anti-pattern note.

  **One surface the flag cannot reach: the gp-admin results page.** Flags
  resolve for an authenticated product user through gp-api; gp-admin runs on
  Clerk staff auth and has no provider. It is staff-only and lists nothing
  until sends exist, so the exposure is acceptable — but it is not covered,
  and pretending otherwise would be worse than saying so.

  Open, related: whether B2's poll-upload move should also sit behind a flag.
  It changes fulfilment's workflow rather than a candidate-facing surface, so
  it is a coordination question more than a flag one.

* *SMS, slice 0* — **merge tokens follow polls, not Peerly.** Use
  `{{first_name}}` (double braces), the format fulfilment's tool already
  merges for poll messages, with `[Name]` as the authoring affordance the way
  `CreatePoll.tsx` offers it. Win keeps Peerly's single-brace `{first_name}`,
  so this is surface-specific and belongs on the flow's `composeMessage`.
  Without this a constituent receives the literal token: the Win greeting is a
  Peerly merge token and nothing on the Slack path substitutes it.
  Convenient side effect: `checkSmsStandards`' `first_name_token` rule tests
  `script.includes('{first_name}')`, which `{{first_name}}` satisfies as a
  substring, so the rule passes unchanged and `paid_for_by` is the only rule
  needing a Serve override.
* *SMS, slice 0* — **minimum audience is 25 recipients**, enforced server-side
  on create and surfaced on the audience step, not only in the picker.
  Arithmetic floor is 15: `textPricing.util.ts` charges 35 tenth-cents each,
  so 14 recipients is 49 cents and Stripe's minimum is 50. 25 sits above the
  edge with headroom if pricing moves, and a 14-person list is not a campaign.
  Polls does not transfer here — its only floor is 500 constituents in the
  *district* to use the feature at all, which is meaningless for a saved list
  that is deliberately narrower. The free-texts offer does not rescue a small
  send either: that is a Win campaign benefit and a zero-amount purchase takes
  the separate free path without touching Stripe.
* *Delivery* — **fulfilment already filters opt-outs on their side and tracks
  them separately; the product records them anyway.** Two consequences. The
  in-product scrub is defense in depth rather than the only gate, which is
  what makes A6's deliberately strict predicate the right trade: a false
  positive scrubs someone org-wide and permanently, a false negative is caught
  downstream. And the results CSV **must include STOP replies rather than
  excluding them** — if fulfilment filters before returning results, the
  product can never learn who opted out. That is a requirement to confirm in
  the slice 2 conversation, not an implementation detail.

* *SMS, slice 0* — send timing mimics the live polls rule: 11am local fixed,
  2 business days minimum, 30 days maximum, no weekends, completion at
  +3 business days. See Send timing.
* *SMS, slice 0* — the opt-out footer **stays** in the composed Serve message.
  Paid-for-by does not, since it is a campaign-finance line and an elected
  official is not a campaign.
* *SMS, slice 3* — favorites and read state are **deferred**, along with the
  reply thread they share a screen with. The v1 reply list is read-only: first
  name, content, CRM panel, "All" only. See Out of scope.
* *Delivery, slice 2* — fulfillment is briefed on the new upload flow and
  confirms before B2 merges. Owner: Stephen. This is the only slice visible
  outside the team on the day it lands.

The `aws s3 cp` line **stays** (reversed 2026-09-21; the 2026-09-18 decision
retired it in slice 2). Slice 2 is SMS-only, and moving polls onto the upload
surface is a follow-up sequenced after the first customer is live end to end
— see the reversal note in the slice 2 section. Polls is assumed to be working
as it stands; this design does not reopen it, and the confirm-before-commit
step is specified as a property of the new surface rather than as a fix for
anything observed.

## Open questions

Same labelling.

* *Delivery, slice 2* — one Slack channel for both products or two? With the
  upload surface unified and the button carrying the send identity, one
  channel is now the simpler answer; the reason to split them was the
  divergent return path, which slice 2 removes.
* *Delivery, slice 2* — a send whose results never arrive. Polls has no sweep
  and the row sits in progress indefinitely. The results inbox probably
  answers this by making an outstanding send visible in a work queue rather
  than absent; if so it becomes a slice 2 acceptance criterion rather than an
  open question.
* *Delivery, pre-final-merge* — how Prisma handles a migration folder
  timestamped earlier than ones dev has already applied. `serve-sms` will sit
  while main moves. Low risk, additive-only, but verify rather than assume.
* *Polls, slice 6* — does clustering run usefully at list-targeted volumes?
  The design contemplates 41 responses; the pipeline searches k=5 to k=50 and
  will not cluster under 10 messages. It may change the poll product's own
  audience guidance. **Nothing here reaches SMS.**

Turnaround is no longer open: the estimate is `addBusinessDays(scheduledDate,
3)`, the same figure polls already shows.

## Appendix: codebase touchpoints (paths under `omni/packages/`)

| What | Where |
|---|---|
| Poll send to model delivery on | `gp-api/src/queue/consumer/queueConsumer.service.ts:1210` |
| Slack block payload to copy | `gp-api/src/polls/utils/polls.utils.ts:10` |
| Outbound CSV shape | `gp-api/src/queue/consumer/queueConsumer.service.ts:1415` |
| Filter paging + dedupe to lift | `gp-api/src/vendors/peerly/services/p2pPhoneListUpload.service.ts:178` |
| Random-sample branch | `gp-api/src/contacts/services/contacts.service.ts:1218` |
| Opt-out scrub | `gp-api/src/contactInteraction/services/contactInteractionText.service.ts:55` |
| Inbound write-back | same file, `applyInboundEvent` |
| Poll ingest to generalize | `gp-api/src/queue/consumer/queueConsumer.service.ts:626` |
| Event schemas to split | `gp-api/src/queue/queue.types.ts:117` |
| Message rows to generalize | `gp-api/prisma/schema/pollIndividualMessage.prisma` |
| Results contract | `contracts/src/outreach/OutreachResults.schema.ts` |
| Counts service to org-scope | `gp-api/src/outreach/services/outreach.service.ts:1002` |
| Serve controller precedent | `gp-api/src/outreach/outreachServeSocial.controller.ts` |
| Purchase handler to fork | `gp-api/src/outreach/services/outreachPurchase.service.ts:246` |
| Org-capable checkout | `gp-api/src/payments/purchase.controller.ts:236` |
| Serve surface precedent (UI) | `gp-webapp/app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow.tsx:201` |
| Serve hub | `gp-webapp/app/dashboard/constituent-outreach/` |
| Admin console to host the upload | `gp-admin/src/app/dashboard/sms-outreach/` |
| Current upload instruction to retire | `gp-api/src/polls/utils/polls.utils.ts:210` |
| Slack client (outbound only, no inbound) | `gp-api/src/vendors/slack/` |
| Constituent timeline | `gp-api/src/contactEngagement/contactEngagement.service.ts:452` |
| Analysis pipeline (polls only) | `gp-ai/serve/v1_pipeline/` |
| S3 trigger infra (polls only) | `gp-ai/infrastructure/modules/serve-analyze-fargate/` |
