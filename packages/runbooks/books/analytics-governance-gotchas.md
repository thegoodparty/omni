# Analytics Governance Gotchas

Recurring traps in analytics-event governance, as a symptom table. Read this before
ruling on a flag, a retirement, or a coverage number — every row here is a signal that
already misled someone into a confident, wrong verdict.

## Quick reference

- **What this is:** a symptom → mitigation index. Where a book already explains a trap
  properly, the row carries the **symptom** and links there rather than restating it, so a
  fact lives in exactly one place.
- **How to use it:** scan the Symptom column for what you are seeing, then follow the
  mitigation.
- **Who reads it:** you read all of it; the two judges inside the scheduled run read only
  the **Judgment traps** table. `governance_gotchas.py` slices between the
  `<!-- judge-input -->` markers and pastes just that into the system prompt of the gap
  judge (`instrumentation_gaps.py`) and the digest tier judge (`digest_triage.py`), both of
  which rule before any human sees the digest. So a row above the marker changes the
  automated assessment; a row below it is reference for whoever is investigating. Put a row
  in the judge table only if it changes a verdict, keep it short, and never write anything
  there you would not want an automated ruling leaning on.
- **Who writes it:** only a human-in-the-loop session — the
  `/triage-instrumentation-gaps` review proposes rows and the reviewer approves them. The
  scheduled runs read this file and never write to it.
- **Maintenance:** when you hit a new trap, add a one-liner here; put the full explanation
  in the owning domain doc.
- **When a fix ships, DELETE the row. Never mark it fixed.** A row saying "fixed
  2026-10" still costs prompt tokens on every scheduled run and still makes a reader stop
  and think about a problem that no longer exists — the worst kind of stale doc is a
  warning about something already repaired, because it sends someone to investigate
  something fine. Git history keeps the story. Deleting the row belongs in the same PR as
  the fix.
- **Every `state` row names the OPEN ticket that will kill it.** That is what makes the
  row deletable later: no ticket means nobody owns the fix, so the row sits in two judges'
  prompts forever. A row whose ticket has closed without the fix landing is worse than no
  row — it looks owned and is not. If you cannot name an open ticket, file one or say
  "no open ticket" in the row so it is visible.
- **Write the mitigation as a decision rule, not a description.** Two automated judges read
  this file and each one only makes a single decision: the gap judge says "is this surface
  missing an event", the digest judge says "how alarming is this item". A row that only
  describes a phenomenon changes neither. A row that says *what to conclude differently
  from the same evidence* changes both. So phrase it as the instruction — "an absent
  tracking call is weak evidence, not proof", "this status only means a taxonomy row
  exists, so do not read it as a break" — and name the evidence the reader is looking at
  when the trap applies.
- **Name rows in the words a searcher would type, not ours.** This file exists because the
  traps were already documented and nobody found them — the rank-0 counter blind spot is
  explained precisely in `monitor-analytics-event-health.md`, and a search for "gotcha",
  "pitfall", "false positive" or "known issue" returns none of it. So a row's Gotcha cell
  names the *symptom*, and when the owning doc uses internal vocabulary (a rank, a status
  name, a cause key), add the plain words to that doc as well. A file nobody can find is
  the failure this one was built to fix.

## Reading the Status column — these are not all permanent

- **`invariant`** — a structural or methodological truth that does not drift (a property of
  the data model, a limit of a detector, a rule of evidence). Trust it.
- **`state · as-of YYYY-MM`** — a code- or data-state fact with a shelf life. Treat it as a
  **hypothesis to re-verify**, not a standing truth; the older the as-of date, the more
  suspect. Some rows are designed to become false when a fix ships. The as-of date is the
  last point the fact was confirmed.

Dates are month-granular on purpose (no false precision). Nothing re-verifies the `state`
rows automatically yet — see **Follow-up** at the bottom.

## Judgment traps — what to conclude differently from the same evidence

Everything between the markers below is pasted into both judges' system prompts on every
scheduled run (`governance_gotchas.py`). A row earns its place here only if it changes a
verdict someone is about to reach. Keep them short: this is prompt weight twice a week.

<!-- judge-input:start -->

| Gotcha | Symptom | Mitigation | Status |
| --- | --- | --- | --- |
| **`call_site_count` blank is not zero** | An event shows no call-site count and reads as "nothing calls this" — or a blank is counted alongside the zeros as evidence of removal. | Blank means **no resolvable key-path**, zero means a resolved key-path with no references. The walk writes null, never zero, for the blank case precisely so it is never flagged; do not collapse the two when reading the CSV yourself. 91 of 502 live rows are blank, and the split matters: only **4** were ever found in code (dynamic dispatch, or fired from outside this repo — vendor autocapture, gp-marketing); the other **87** have no `instrumented_date` at all, so they are the never-built population of the `instrumented_never_observed` row below, not an instrumentation signal. Columns: [refresh-event-provenance.md](refresh-event-provenance.md). | state · as-of 2026-09 |
| **Zero call sites while firing normally is our counter, not a dead event** | A rank-0 flag: provenance says zero call sites, the event is active with no anomaly. | A client event cannot fire without a call site, so fix the counter, not the event — and never route it into the rank-2 retirement flow. Full triage, including which reference shapes are already counted: [monitor-analytics-event-health.md](monitor-analytics-event-health.md) § Rank 0 (DATA-2106). | invariant |
| **"Still in the code" and "call sites removed" are not a contradiction** | An event sits under `call_site_removed` (rank 2) while its record shows an empty `retired_date`, or a card reads "still in the code". The two look like flat opposites and one of them gets dismissed as a bug. | `retired_date` is set only when the event's **name** has gone from the tree; `call_site_count` counts what still **calls** that name. A surviving constant with no caller is the normal rank-2 shape, not an error. **So never read an empty `retired_date` as evidence the instrument is live, and never read it as contradicting a zero call-site count.** Columns: [refresh-event-provenance.md](refresh-event-provenance.md). Seen 2026-09-29 on `Onboarding V2 - Strategic Landscape Displayed`: name still at `analyticsHelper.ts:799`, caller deleted in `e5e863545` (2026-09-01). | invariant |
| **A 30-day window straddling a dated change reads as traffic after that date** | A freshly retired event looks like it is still firing post-retirement (`orphaned_firing`, rank 1), or a drained call-site removal looks like a live blind spot. | The shape recurs on every date column, and only two are gated: `retired_date` (`ORPHAN_GRACE_DAYS`, DATA-2140) and `call_site_retired_date` (`call_site_removal_straddles_window`, DATA-2427). Before reading a 30-day count as activity after date D, confirm a gate covers **that** column. | invariant (shape) |
| **The rolling baseline absorbs a sustained break** | `detect_anomaly` goes quiet on an instrument that is still dead: after ~4 broken weeks the broken level *is* the baseline, so the alarm switches itself off. This is how a wrong OKR ran quiet for a month. | Good cliff detector, bad liveness guard. The latch (`okr_latch.py`, DATA-2421) holds the finding open against a fixed pre-break reference — but **only for legs declared in the semantic layer**. For anything else, "no anomaly" is not "healthy": read the weekly series against a pre-break level, not the trailing mean. | invariant |
| **`instrumented_never_observed` only means "has a Govern taxonomy row"** | A 69-event cause reads as "69 broken instruments". | The provenance CSV's row set comes from the Amplitude Govern taxonomy, not from code, so an event declared in Govern and never written scores the same as one instrumented last Thursday. As measured 2026-09-28: 34 never written, ~32 too recent to judge, 4 the actual finding. Split by `instrumented_date` and by whether code provenance exists at all before ruling. Two open tickets cover this from different angles and their fixes overlap — **DATA-2573** (the taxonomy row set, plus a grace period) and **DATA-2508** (an all-blank provenance row counting as `in_code = True`, which mis-files 9 `Pro Upgrade - *` events); settle them together. | state · as-of 2026-09 |
| **The blind-counter canary fires on a correct retirement, and cannot be dismissed** | A rank-0 `counter_blind_spot` names events whose code genuinely *was* deleted. `counter_blind_spot` is in `UNDISMISSABLE_CAUSES`, so the queue cannot be closed and correct retirements sit in it indefinitely. | The canary's premise is "a client event cannot fire without a call site", which a straddling window breaks (row above), as does a `call_site_retired_date` the walk cannot resolve — still possible for a path whose last reference was through a namespace alias (`const planEvents = EVENTS.Dashboard.CampaignPlan`), which the counter counts and the removal walk does not see. Undismissable is deliberate — a real blind spot must not be silenced — but it means the *fix* is the only exit: resolve the removal date or extend `count_call_sites`, then the row leaves on its own. Do not reach for `dismissed:`; the loader refuses it and the digest prints "Dismissal refused" naming the row. | invariant |
| **A rename declared in Govern that was never shipped in code** | Live events read as dead and point at successors that have never existed, and the two halves surface as unrelated causes — old names under `orphaned_firing`, new names under `instrumented_never_observed` — with nothing connecting them. | Found live 2026-09-23: `Outreach - Phone Banking: Call Logged` (498/30d), `Door Knocking - Door Logged` (299/30d) and `Dashboard - Campaign Task Status Updated` flipped to `not_in_use` naming successors with no code provenance. **The write path is now guarded** — DATA-2574 (PR #2217) makes `event-metadata` refuse `not in use:` alongside a successor that lacks provenance *or* has never fired, and default a predecessor to `in use` (lineage only) when either half is missing. **Detection is still absent:** nothing reads supersession prose backwards, so records written before that guard, or outside the skill, stay invisible and surface as two unrelated causes. So a `not in use` + successor declaration still has to be checked by hand against the successor's provenance and firing (DATA-2573 §3, open). | state · as-of 2026-09 |
| **A surface with no visible tracking call can already be instrumented** | A code snippet shows no `trackEvent` / `.track(`, so the surface reads as a gap. It fires anyway, one hop away or under a name the detector does not know. | The gap sweep's `has_tracking_call` matches only `trackEvent(`, `AnalyticsService` and `.track(`. Verified against those patterns: a private wrapper (`this.tryTrack(...)`, which fires `Voter Outreach - Campaign Approved`) and a raw event-name string passed to a local helper both read as **untracked**. `tracked_in_hook` covers the hook edge only — one hop, `use*` imports, and nothing else. **So an absent tracking call is weak evidence, not proof:** before confirming a gap, weigh it against the surface's own wording and treat a wrapper-shaped call (`tryX`, `emit`, `log`) or a bare `'Product Area - Action'` literal in the snippet as instrumentation the detector missed. Causes catalogued in DATA-2427. | invariant |
| **A disabled check is indistinguishable from a passing check** | Everything reads green and nothing is being checked. Three OKR metrics were reported off instruments that do not fire, while a guard that would have caught it sat silently disabled by an import error. | A guard that fails open reports the same thing as a guard that passes. Before trusting any green signal as coverage, confirm the check actually ran and actually evaluated something — a non-zero count of things examined, not just the absence of a failure. Same shape as the empty backend queue above (DATA-2343, closed 2026-09-17). | invariant |
| **Retirement declared from absent data** | An event with no recent fires is called dead, and the status write makes that official. | Absent data is not removal. Call an event retired only with **code-removal proof** — the commit or PR that deleted the call site — and embed it in the status write. Propose-and-confirm flow: [monitor-analytics-event-health.md](monitor-analytics-event-health.md) § Rank 2. The inverse is the unshipped-rename row above. | invariant |

<!-- judge-input:end -->

## Known tooling defects and process rules — reference, not judge input

Deliberately **outside** the judge markers, and deliberately not deleted. Two kinds of
row live here:

- **Tooling defects awaiting a code fix.** A judge cannot route around these — the fix is
  a Python change, and until it ships the row exists so nobody re-investigates a known
  bug. Telling a judge about them would spend prompt weight on something it cannot act on.
- **Process rules for whoever is doing the investigating.** They bear on reading git
  history, checking a system of record, or scoping an approach — none of which a judge
  does. They are here because they have cost real rework, and the human path reads this
  file too.

| Gotcha | Symptom | Mitigation | Status |
| --- | --- | --- | --- |
| **Three of the five backend gap-detector patterns match zero gp-api code** | The backend gap queue looks clean. It is blind: of 47 entries in `instrumentation_gaps.json`, exactly one is an `api_job`. | The patterns were written against a NestJS + BullMQ idiom gp-api does not use. Confirmed against `packages/gp-api/src`: `@Processor(`/`@Process(` and `@Post('…webhook')` match nothing, `.process(` matches 2 files (one a test), and only the status-transition pattern (`status: 'COMPLETED'` / `'FAILED'` / `'REJECTED'` / `'APPROVED'`) really fires. The tell is vocabulary: gp-api's one Stripe webhook route is `@Post('events')` under `@Controller('payments')`, so "webhook" never appears in the path. Meanwhile 40 gp-api files import `AnalyticsService`, so backend instrumentation exists — the sweep just cannot see what is *missing* it. Never read an empty backend queue as coverage (DATA-2560, open). | state · as-of 2026-09 |
| **The ticket is not the system of record** | "Nobody approved this", "this is not merged", "this is still open" — read off a ticket, a PR description, a handoff brief, or an earlier summary, all of which are narratives about state written at a moment and go stale silently. | Check the system that owns the fact: `gh pr view <n> --json reviews` for approval, `gh pr list --state merged` or `git log origin/main` for merge state, the live status fetched now for openness. 2026-09-28, DATA-2422: the ticket said five rule halves were pending, so a decision was taken on their behalf — the business group had approved on GitHub the previous day, and both the PR review list and that week's work log said so. **Never put a decision to a human whose premise is an unverified negative**; verifying it is part of forming the question, not a follow-up. | invariant |
| **Planning an approach before probing the real inputs** | A design that is obviously right on inspection, and fails on most real data. The gap-sweep's obvious scope-walk failed on 59% of inputs. | Probe the actual repo or dataset against the candidate approach before writing the plan, and report the hit rate. A plan validated only against reasoning costs a full build to disprove (DATA-2539, done — PR #2164). | invariant |
| **One search is not evidence** | A pickaxe or grep on one identifier returns nothing, and the clean negative reads as proof the thing is absent. A wrong guess at the spelling is indistinguishable from absence. | A negative is not evidence until a second, differently-shaped method agrees. Search the **value**, then the **reference** (constants, aliases, lookup tables, nested groups), then the **tree before the change** (`git grep <term> <sha-before>`, then `git log --diff-filter=D`). When a negative contradicts other evidence — "no call sites since April 2025" against 1,471 fires a month — the negative is wrong until proven otherwise. Dynamic dispatch defeats a literal search outright. Two sightings on 2026-09-29: a pickaxe on `ScheduleTextCampaign` nearly produced a wrong verdict on 14 live events whose call sites referenced the nested `ScheduleCampaign` group (DATA-2546); and a search of the docs for "pitfall / trap / gotcha / known issue" returned nothing an hour later, because the section that documents the trap is headed "Rank 0 — counter blind spot". **The same rule applies to searching prose, and the artifact is as much at fault as the search** — hence the plain-word alias line now in that book. | invariant |
## Follow-up

Not built: a linter that re-verifies the mechanically checkable `state` rows against the
live catalog and CSV (the blank/zero counts, the pre-cutover link count, the
never-observed split) and flags the rest once their as-of date goes stale. **DATA-1960**
owns this — its "Gotcha freshness" section already scopes turning mechanically checkable
state rows into linter assertions, for gp-data-platform's equivalent file. Extend it to
this one rather than filing a second ticket. Until it ships, re-check a `state` row before
acting on it; the as-of date is the last time anyone did.

## Cross-references

Owning docs carry the full explanations:

- [monitor-analytics-event-health.md](monitor-analytics-event-health.md) — the status
  model, severity ranks, and the rank-0 / rank-2 triage flows.
- [refresh-event-provenance.md](refresh-event-provenance.md) — the provenance walk and the
  CSV's columns.
- [refresh-event-state-surface.md](refresh-event-state-surface.md) — the consumer
  event-state sheet.
