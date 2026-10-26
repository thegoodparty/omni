# Text delivery layer (shared: Serve SMS now, polls later)

<!-- Moved verbatim from outreach/AGENTS.md so the auto-loaded AGENTS.md stays small. Edit here. -->

One wire, two products. The layer resolves recipients, scrubs opt-outs,
hands the send off and ingests what comes back; it knows nothing about polls
or SMS. The test for whether something belongs here: would it still be true
if Slack were swapped for Twilio? Scrubbing opt-outs, yes; ranking themes,
no. Design: `docs/features/serve-sms.md`, "Layer 1: Delivery".

**Trigger.** The Serve SMS purchase handler's post-purchase step enqueues
`outreachTextSend { outreachId, sendSeq }`. `QueueConsumerService`'s case for
it reads `message`, `imageUrl`, `scheduledLocalDate` and `voterFileFilterId`
back off the row and calls `OutreachTextDeliveryService.requestSend` with a
`savedFilter` audience. The product-shaped half of the input is assembled
there on purpose: `requestSend` takes an audience SPEC, not an outreach id,
so polls can hand it a random sample later without the layer learning what a
poll is. `QueueConsumerModule` imports `OutreachModule` to reach the service.

**What the consumer acks and what it redelivers.** Acked, because no
redelivery can change the outcome: the outreach does not exist; the row has
no saved list / message / send date; its list is a round 2 sample not drawn
yet (only the draw enqueues one); and `requestSend` returning
`audienceResolved: false` with `recipientCount: 0`, which is the spine
refusing the send (canceled, unpaid, already sent). Redelivered: anything
that throws — S3, Slack, the database — because the send is idempotent under
retry. A payload the schema cannot read also throws, so a producer bug on a
paid send ages to the DLQ instead of being ack-dropped.

**The funding gate.** A send is handed off only if it was paid at checkout
(`Outreach.stripeCheckoutSessionId`, or the expansion's own for `sendSeq`
above 1) or is a free managed civic panel wave: `fundedBy:
goodparty_pilot`, a Serve `text` linked to a wave of its own org's
enrollment, the enrollment not `stopped`, and `serve-citizen-panels` still
on for the official who approved it. `OutreachTextSendFundingService.check` is asked twice: by the consumer
before it builds an audience, and by `requestSend` before its claim, whose
`pending -> in_progress` filter repeats the database half of the rule
(`fundedTextSendWhere`) so a stop landing between the two still matches
nothing. A refusal acks with
`terminalReason: 'unfunded'`, writes no CSV, posts nothing to fulfilment,
leaves the row where it was, and raises the alarm: the
`managed_panel.funding_alarm.count{kind="send_refused"}` metric behind the
`serve-managed-panel-unfunded-send-refused` Grafana rule, a CRITICAL log
line, and a notice in #bot-tevyn-api. A row that is not `pending` is not a
funding question and raises nothing. Every legitimate send passes because
the SERVE_TEXT purchase claim stamps the session on texts, polls, round 2
follow-ups and expansions, and a Serve text never prices at zero, so the
free-purchase path never reaches one. `ManagedPanelFundingReconcileService`
(06:47 Eastern, dev and prod) re-checks every Serve send that moved past
`pending_payment` and was created in the last week (so one left alone keeps
paging daily), and every pilot wave still `pending` four hours after its
claim, and raises `serve-managed-panel-funding-mismatch` on any it cannot
account for.

**Claim before handoff, not a check after it.** `requestSend` CASes the spine
`pending → in_progress` FIRST. A read would not close the window: a user can
cancel between the check and the handoff, and by then a human has the CSV.
Once the row reads `in_progress`, `cancelOutreach` (which accepts
`in_progress` only for a p2p row, never a `text` send) is refused
rather than racing the send. The claim IS the spine advance; any
failure after it hands the claim back, guarded on `in_progress`, which can
only ever be this send's own claim because the queue is FIFO per outreach.
An expansion (`sendSeq > 1`) claims, reverts and fails its own
`OutreachPollExpansion` row (`pending → in_progress`) and never writes the
spine, which is already past `pending`. A sample draw that returns someone an
earlier send reached logs at error.

**The counts mean one specific thing.** `excludedOptedOutCount` is how many
people THIS audience lost to the scrub — they matched the filter, had a cell
phone, and were dropped for having opted out. An org with 1,000 historical
opt-outs whose filter reaches 5 reports 5, not 1,000. `excludedDuplicateCount`
is the same shape for phone dedupe. `audienceResolved` says whether either
number was measured at all: when false they are 0 meaning "not measured", not
"none". Getting an honest number required a change of MECHANISM, not
arithmetic — handing the opt-out ids to people-api as an exclusion filter
means those rows never come back and there is nothing to intersect, so both
this service and `outreachServeSmsCreate.service.ts` pass an EMPTY exclusion
set upstream and apply the scrub in-process through `resolveFilterAudience`'s
`isEligible` hook, positioned after the cell-phone check and before
dedupe/cap. `PeerlyPhoneList.excludedOptedOutCount` still has the old wart;
do not copy it.

**The CSV key is deterministic**: `${outreachId}-${sendSeq}.csv`, so a
redelivered message reuses the object rather than resampling a different
audience. A reused CSV reports `audienceResolved: false` with a real
`recipientCount` — a completed handoff, not a refusal. Bucket is
`OUTREACH_TEXT_CSVS_BUCKET` falling back to `TEVYN_POLL_CSVS_BUCKET`; the
first is unset in every environment today and the object is an idempotency
record rather than a deliverable, so the two products sharing one bucket is
fine. The poll bucket's S3 notification filters on prefix `input/`, and these
keys have no prefix, so writing here cannot trigger the analysis pipeline.

**The handoff is a port, not a Slack call.** `TEXT_DELIVERY_HANDOFF_PORT`
(`interfaces/textDeliveryHandoff.interface.ts`) is bound in `OutreachModule`
to `util/textDeliverySlack.util.ts`'s `sendTextDeliverySlackMessage`. That
binding is the only line that changes when a real vendor replaces the human
step. The token is a constructor argument of the service, so leaving it
unbound takes down every test that builds `OutreachModule`, not just the
delivery ones. The message carries a per-send button at
`GP_ADMIN_BASE_URL/dashboard/outreach-results/<id>` so the send's identity
travels with it instead of being retyped, and posts to the existing
`SlackChannel.botTevynApi` rather than a new channel constant — a new channel
env var is `undefined` until it is configured in three environments, and the
preview smoke test then fails for a reason that looks nothing like its cause.

**The send is from `organization.owner`**, not `ElectedOffice.userId`. Every
org has exactly one owner, so the lookup is identical for a Serve org and a
Win campaign org and the layer does not have to know which product it is
carrying.

**The civic panel ask rides the same ingest.** A Serve text that carries
contracts' `CIVIC_PANEL_JOIN_LINE` is created with `asksToJoinCivicPanel`
(read off the message, never a request flag). On ingest, a JOIN reply
(`util/civicPanelJoin.util.ts`) to such a send sets the person's
`civic_panel` status to `member`, and a STOP to any Serve send sets it to
`left`, both through `ContactStatusService` keyed on the reply's message id so
a re-upload is a no-op. A LEAVE reply (`util/civicPanelLeave.util.ts`) to any
Serve send sets a member to `left` the same way without opting them out. A
text to a panel-only list (contracts' `isCivicPanelOnlyList`) carries
`CIVIC_PANEL_LEAVE_LINE` instead of the JOIN line and is created with
`offersCivicPanelLeave`; the create 400s both lines together, and the LEAVE
line on any other list. Win sends never write it. Detail in
`src/contacts/AGENTS.md`, "Serve's civic panel".

**Serve SMS has one purpose the other channels do not.** The draft schema
takes contracts' `SERVE_SMS_PURPOSE_VALUES`: the shared Serve list plus
`build_citizens_panel`, the text that introduces the official and their
civic panel. Its `SERVE_SMS_VOICE` structure writes the body only and
never the JOIN ask, because the webapp appends the locked
`CIVIC_PANEL_JOIN_LINE` and the reply reader honors only those words. The
draft route 404s that purpose while `serve-citizen-panels` is off, on top of
the `serve-sms-outreach` gate, and the create route 400s any message carrying
a join line (`findCivicPanelJoinLine`) while it is off, since that line is
what marks a send as asking.

**A report back is a text, not an ask.** `report_back` (contracts'
`REPORT_BACK_PURPOSE`) tells everyone who answered a priority, on texts,
calls or doors, what the official heard and will do next; its voice structure writes themes and
the official's next step from the materials only, and never a JOIN ask. The
draft route 404s it with `serve-citizen-panels` off. The create takes
`reportBackForOutreachId` (404 with the flag off) and stores it on
`Outreach.reportBackForOutreachId`; `assertReportBackTarget` 400s one whose
target is not this office's priority text with its replies in, one carrying a
priority or a check of its own, and one carrying the join line. The column is
the marker: a report back is linked through the send it answers, never to the
priority, so it gets no report back card of its own and stays out of the
priority's pooled themes and results.
One report back goes out each time the priority's read status changes. A new
draft supersedes the unpaid ones before it (`canceledBy:
superseded_report_back`), so only one can reach checkout, and the create and
the checkout refuse once one is past checkout since the priority's latest
report back card was made. The post-purchase claim is serialized per answered send under an advisory
lock: a second draft paid at the same moment (two checkouts opened before
either draft was superseded) is canceled unsent
(`canceledBy: report_back_already_sent`) and refunded the way a
cancel-before-send is; a failed refund is logged and the row keeps its
checkout session for staff.
`OutreachReportBackService` (its own `OutreachReportBackModule`, importing
nothing) is the one read of all this: which priorities have a text with its
replies in (completed, with no effort summary still running), how many people
answered across channels, and whether one has gone out since the read last
changed.

**Opt-out has one definition**, `util/textOptOut.util.ts`, and both products
use it. An unambiguous keyword as a standalone SENTENCE, an ordinary-verb
keyword only as the WHOLE message, or an explicit revocation phrase. It is
deliberately NOT the analysis pipeline's rule (any message whose last word is
"stop"), which reads "the noise from the site needs to stop" as a revocation.
The pipeline's `is_opt_out` flag is a hint, never the source of truth:
producers hand this layer the text and the predicate decides. Both failure
directions are real — a missed opt-out leaves somebody on the next send, and
an invented one silences a constituent org-wide and forever.
