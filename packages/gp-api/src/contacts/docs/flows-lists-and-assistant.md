# Flows: saved filters, outreach launch, write-back, AI assistant

<!-- Moved verbatim from contacts/AGENTS.md so the auto-loaded AGENTS.md stays small. Edit here. -->

### Saved-filter lifecycle

Create/edit via the wizard (or the assistant's `crud_saved_filters`) →
`voters/voter-file` CRUD. At first outreach launch
`stampFirstUsedForOutreach` claims the lock atomically
(`updateMany WHERE first_used_for_outreach_at IS NULL`) — after that,
PUT/DELETE 409 ("duplicate to edit"; the webapp reposts criteria as a
copy). The stamp happens **before** the channel guard in materialization,
so channels without an interaction model still lock the filter.

### Outreach launch → materialization (the "list")

`OutreachMaterializationService.materializeOutreach`:

1. Stamp the filter lock (if a filter is attached — p2p can carry a phone
   list without one).
2. Only `text | p2p | robocall` materialize. `doorKnocking` and
   `phoneBanking` are permanently excluded — each writes its own rows from
   its own logging endpoint (the phone-banking call-outcome endpoint,
   `src/phoneBanking/`, ENG-10915) rather than at launch; `socialMedia` has
   no model yet.
3. p2p/text with a captured Peerly phone list: rows come from
   `PeerlyPhoneListRecipient` — the actual SMS-reachable recipients — one
   `ContactInteractionText` per person (`createMany` +
   `skipDuplicates`, idempotent under retry). Fallback when an outreach
   has a `phoneListId` but no capture rows (pre-epic list or failed
   capture write): re-resolve the filter fresh, which can overstate.
   Robocall always resolves the filter.
4. `occurredAt` = launch time, not send-completion time.
5. Pages through the segment (`SEGMENT_PAGE_SIZE` 1000, cap
   `MAX_MATERIALIZED_VOTERS` 100k).

Phone-list generation for saved-filter sends goes through the contacts
pipeline (`findContactsForFilter`), so activity/support conditions are
honored — the list matches what the wizard's count promised
(`src/vendors/peerly/services/p2pPhoneListUpload.service.ts` +
`peerlyPhoneListCapture.service.ts`). The `PeerlyPhoneList` row is created
`queued` before this build runs, not after — see
`src/voters/AGENTS.md`'s capture gotcha for the full `buildId`/`buildStatus`
lifecycle (`queued → processing → ready|failed`) and the additive
`GET /p2p/phone-list/build/:buildId/status` route.

**Opt-out scrub (ENG-10800).** `P2pPhoneListUploadService` excludes every
org-wide opted-out person (`ContactInteractionTextService.findOptedOutPersonIds`
— any past text/p2p send, not just the outreach that recorded it) from a new
phone-list build via `findContactsForFilter`'s `excludePersonIds` param, which
folds into whatever `id` resolution activity conditions/support status already
produced (`ContactsService.excludePersonIdsFromResolution`). Over the
people-db 200k id-filter cap (`MAX_RESOLVED_ID_SET_SIZE`), the scrub is
skipped and logged loudly rather than blocking the send. The excluded count is
persisted on `PeerlyPhoneList.excludedOptedOutCount` for a later UI ticket
(ENG-10808) to surface. The materialization fallback above (re-resolving the
filter when an outreach has a `phoneListId` but no capture rows) does **not**
run this scrub — it already overstates by design, and ENG-10800 didn't touch
it.

**Phone dedup (ENG-10801).** `P2pPhoneListUploadService.buildPhoneList` keeps
one CSV row per phone number: a `Set` of seen numbers spans the whole
pagination loop, and a person whose number was already kept is skipped
(first-seen wins — deterministic given the people-db query's stable ordering). This
also fixes the inbound sweep's phone->person mapping (`PeerlyPhoneListRecipient`),
which was ambiguous whenever two people shared a captured phone. The skipped
count is persisted on `PeerlyPhoneList.excludedDuplicatePhoneCount`, alongside
`excludedOptedOutCount`, for the same ENG-10808 UI to surface.

**The audience cap is checked BEFORE the resolution, not during it.**
`resolveFilterAudience` asks for the matched count on page 1 only (`skipCount:
page > 1`) and refuses a filter whose count already exceeds `maxRecipients`.
The in-loop cap it backs up is correct but was unreachable in production: it
can only throw once `maxRecipients` recipients have been resolved, i.e. page
101 at the phone-list defaults, which at the ~2.17s/page measured in prod is
~219s — and the gateway gives up at ~120s. So an over-cap `POST
/v1/p2p/phone-list` was killed in flight at 120s (logging `statusCode: null`,
which is what pages the `p2p-route-errors` rule), and the handler then spent
another ~99s paging toward a 400 no client was still connected to receive. Ten
of those in the 30 days to 2026-09-27.

Two things to know before touching it:

- **The count is an upper bound, so the refusal is slightly over-eager.**
  Every later step (missing-phone skip, `isEligible`, phone dedupe) only
  removes people, so a matched count over the cap does not prove the
  resolution would have tripped it — a dedupe-heavy list matching 110,500 rows
  can resolve 99,500 recipients. That list is refused now. It also could not
  be served before: 111 pages is ~241s. The honest fix for the band between
  "resolves under the cap" and "cannot resolve inside 120s" is to take the
  build off the request path; until then a fast refusal beats a silent hang.
- **The COUNT is nearly free, and only because it is parallel.** The Databricks
  path runs the count and the page query in `Promise.all`
  (`databricksVoter.service.ts`), so page 1 costs no extra round trip. Moving
  the check to its own call, or asking for the count on every page, would
  reintroduce the per-page COUNT `skipCount` exists to avoid.

**The wall clock is bounded separately from the cap (`timeBudgetMs`,
INC-101).** The pre-flight above only catches a filter over `maxRecipients`, and
the cap sits far above what the gateway will wait for: 100,000 recipients is 100
pages, and at the 1.3–2.5s/page measured in prod two minutes buys 50–90. So a
filter matching 55,000–100,000 rows passed every guard here and was then killed
in flight — in prod, 82 pages, `statusCode: null` at 120,038ms, and the handler
went on to upload the finished phone list to Peerly 45.9s _after_ the browser
had shown a failure, leaving a list nobody could see and inviting the retry that
made a second one. A caller with a request waiting now passes
`MAX_INTERACTIVE_RESOLUTION_MS` (90s — 120s minus the handler's own lookups, CSV
assembly, vendor upload and response) and gets two checks:

- the **projection**, once per full page from page 2 on. `matchedCount /
pageSize` is the pages this filter needs and the pages already fetched are
  what one costs, so a projected finish past the budget is a
  `BadRequestException` naming the matched count and the count that does fit.
  Page 1 is timed but excluded from the average: it carries the parallel COUNT,
  so it is the slowest page, and projecting from it refuses lists that land
  (a 60-page list at 1.4s/page finishes in 84.6s and must not be refused).
- the **hard stop**, before each fetch: elapsed past the budget throws
  `ServiceUnavailableException`. A 503, not a 400, because the projection
  passing and the clock still running out is ours to explain, and the route
  alerts page on 503 while they ignore 400.

Both stop the handler while the client is still connected, which is what keeps
it from creating something nobody will be told about. The band this closes is
still a band — the honest fix is taking the build off the request path — but a
refusal in ~4.5s naming a number beats a two-minute blank.

`outreachServeSmsCreate.service.ts` drives the same resolver on a request path
and gets both guards (the pre-flight cap for free, the deadline because it
passes `timeBudgetMs`). `outreachTextDelivery.service.ts` passes
`skipPreflightCap: true`, no `timeBudgetMs`, and keeps only the in-loop cap: it is SQS-driven, so no
gateway deadline ever applied to it, and there the over-eagerness above is not a
tolerable trade but a regression. Two reasons, either sufficient. Its
matched-minus-resolved gap is routinely the size of the org's whole opt-out set,
because it scrubs opt-outs in-process rather than as a query filter (so the
official can be shown how many _this_ audience lost); and `requestSend` reads a
4xx out of the resolver as "the data is wrong, a retry reads the same rows" and
marks the outreach permanently `failed` — on a row that is already paid, which
its own log line calls out as needing a refund decision. So a filter matching
105,000 rows and resolving 85,000 recipients must keep sending, and does.

### Write-back (collect-forward)

Two `@Cron` sweeps in `src/outreach/services/` (scheduled fetch — Peerly
has no signed webhook):

- `outreachCompletion.service.ts` — flips Peerly job status
  `pending → in_progress → completed`. Completion gates "specific
  campaign" activity conditions. Watch: it infers from `end_date` (the
  scheduled end), not delivery truth — refinement via CDR ingestion is
  ENG-10740 (open).
- `outreachInboundSweep.service.ts` — hourly, streams the message report
  for active/recently-completed jobs, maps phone → person through the
  capture rows, and writes `respondedAt` / `optedOutAt` idempotently on the
  vendor event id. Opt-outs come from the reply text (`isOptOutMessage`),
  plus a pass over Peerly's own opt-out flags for the ones its AI or
  texters mark without a stop word: each send's flags are read at most
  every 6 hours for its first 3 days. Opt-outs drive the record's Opted
  In/Out chip.

### The AI assistant

Tools are **in-code functions with Zod schemas** (foreground CAP agent
pattern — explicitly not MCP): `crm-tools/` builders registered in the
campaign-manager handler (Win, unconditional) and chief-of-staff
handler (Serve, unconditional). Each tool calls the same services as
the UI routes in the user's org context, so mode rules, Pro gates, and
free-tier rules are inherited, never re-implemented. **No tool returns an
individual voter row** — aggregates, dimension metadata, and filter
ids/names only. `describe_filter_dimensions` reads
`filterDimensions.catalog.ts`, the single mode-aware vocabulary source.
**On Chief of Staff and the Campaign Manager the assistant never creates a list itself.** It offers one
with `present_list_proposal` (a display tool, args are the card) and the
official saves it from the card, which posts with a `proposalKey`
(`VoterFileFilter.proposalKey`, unique) so a second press returns the first
list; `GET /v1/voters/voter-file/filter/by-proposal-key/:key` is how a
reloaded card knows. See `docs/cap-interactive-agents.md` § A list is saved
from a card.
`crud_saved_filters` gained `action='get'`, the only way to read a SAVED
list's current size: `list` returns ids and names, `create` counts the filter
it was handed, and nothing answered "how big is list 7 now" — so the
assistant quoted whatever figure appeared earlier in the conversation, which
goes stale the moment a boundary is drawn on that list. It counts via
`ContactsService.countSegment`, which resolves by segment and therefore
applies the frozen geo members and the stored search the way every other
read of that list does. Counts stay OFF `action='list'` deliberately: one
count per saved list is the per-row N+1 that 504'd the lists index in prod.
`create` also takes `sample: { size }` (the size `size_outreach_sample`
returned), drawn through `ContactsService.drawListSample` exactly as the
voter-file filter route draws one, so the assistant can save a random sample
of an audience and the returned `count` is the sample's size. Neither
assistant uses it to hand over a text: both present a proposal card with the
unsaved filter and the sample size, and the text flow saves the list when
the user starts it.
Every list reference it returns also carries `hasBoundary` — whether a shape
is on the list, never where it is. A holder can draw one from either
assistant's own map card in the transcript, so a list's size can change between turns
with the model calling nothing; the webapp sends a hidden turn on that save
and the flag is the recovery path for a conversation that missed it
(`docs/cap-interactive-agents.md` § A drawn boundary reaches the
conversation). Geometry stays out of the INPUT schema: every model-facing
tool is built on `voterFilterBaseSchema`, which has no `geoPoly`, so the
assistant can never create a list already scoped to a shape — the prompt
tells it to say so rather than refuse.
Most catalog entries carry an optional `provenance` mark
(`observed` | `modeled` | `derived`) and the catalog exports the one rule
string that tells the model what a mark obliges it to say
(`FILTER_DIMENSION_PROVENANCE_RULES`, imported by the describe tool's
description and by the Chief of Staff prompt's `CRM_TOOLS_RULES` —
never restated). Most L2 demographics are `modeled`: the warehouse value
says "Likely"/"Probable"/"Estimated"/"Inferred" and the catalog label
strips it, so without the mark the assistant reported modeled ethnicity
as observed fact (Chief of Staff eval D3-05). Two dimensions (`children`,
`languageCodes`) carry no mark at all: `serve/output/l2_haystaq_codebook`
(the L2 National Models User Guide) only documents `hs_*` opinion-score
models, not these base columns, so rather than guess, the rule text tells
the model to treat an unmarked dimension exactly like `modeled` until
someone sources the real answer and a follow-up adds the mark.
The TDD's `GET /v1/contacts/filter-dimensions` route was deliberately
skipped (tools call services in-process). The webapp assistant bar rides
the existing `campaign_assistant` / `chief_of_staff` chat scopes — no new
scope.
