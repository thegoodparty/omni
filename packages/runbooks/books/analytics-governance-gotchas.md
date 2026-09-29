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
- **Maintenance:** when you hit a new trap, add a one-liner here; put the full explanation
  in the owning domain doc.

## Reading the Status column — these are not all permanent

- **`invariant`** — a structural or methodological truth that does not drift (a property of
  the data model, a limit of a detector, a rule of evidence). Trust it.
- **`state · as-of YYYY-MM`** — a code- or data-state fact with a shelf life. Treat it as a
  **hypothesis to re-verify**, not a standing truth; the older the as-of date, the more
  suspect. Some rows are designed to become false when a fix ships. The as-of date is the
  last point the fact was confirmed.

Dates are month-granular on purpose (no false precision). Nothing re-verifies the `state`
rows automatically yet — see **Follow-up** at the bottom.

## Gotchas

| Gotcha | Symptom | Mitigation | Status |
| --- | --- | --- | --- |
| **`call_site_count` blank is not zero** | An event shows no call-site count and reads as "nothing calls this" — or a blank is counted alongside the zeros as evidence of removal. | Blank means **no resolvable key-path**, zero means a resolved key-path with no references. The walk writes null, never zero, for the blank case precisely so it is never flagged; do not collapse the two when reading the CSV yourself. 91 of 502 live rows are blank, and the split matters: only **4** were ever found in code (dynamic dispatch, or fired from outside this repo — vendor autocapture, gp-marketing); the other **87** have no `instrumented_date` at all, so they are the never-built population of the `instrumented_never_observed` row below, not an instrumentation signal. Columns: [refresh-event-provenance.md](refresh-event-provenance.md). | state · as-of 2026-09 |
| **Zero call sites while firing normally is our counter, not a dead event** | A rank-0 flag: provenance says zero call sites, the event is active with no anomaly. | A client event cannot fire without a call site, so fix the counter, not the event — and never route it into the rank-2 retirement flow. Full triage, including which reference shapes are already counted: [monitor-analytics-event-health.md](monitor-analytics-event-health.md) § Rank 0 (DATA-2106). | invariant |
| **A Prettier-wrapped key-path resolves no removal date** | Genuine zero count, `call_site_retired_date` empty, so the straddle gate has nothing to straddle and the event surfaces as a rank-0 blind spot instead of a retirement. | `count_call_sites` is wrap-tolerant but `git log -S<key_path>` is not — the pickaxe needs the dotted path as one literal string. **Check this before concluding a new counter shape:** an event whose siblings carry a removal date is almost certainly this. 6 live zero-count rows have no removal date. [monitor-analytics-event-health.md](monitor-analytics-event-health.md) § Rank 0, step 2 (DATA-2427, residual deliberately deferred). | state · as-of 2026-09 |
| **A 30-day window straddling a dated change reads as traffic after that date** | A freshly retired event looks like it is still firing post-retirement (`orphaned_firing`, rank 1), or a drained call-site removal looks like a live blind spot. | The shape recurs on every date column, and only two are gated: `retired_date` (`ORPHAN_GRACE_DAYS`, DATA-2140) and `call_site_retired_date` (`call_site_removal_straddles_window`, DATA-2427). Before reading a 30-day count as activity after date D, confirm a gate covers **that** column. | invariant (shape) |
| **The rolling baseline absorbs a sustained break** | `detect_anomaly` goes quiet on an instrument that is still dead: after ~4 broken weeks the broken level *is* the baseline, so the alarm switches itself off. This is how a wrong OKR ran quiet for a month. | Good cliff detector, bad liveness guard. The latch (`okr_latch.py`, DATA-2421) holds the finding open against a fixed pre-break reference — but **only for legs declared in the semantic layer**. For anything else, "no anomaly" is not "healthy": read the weekly series against a pre-break level, not the trailing mean. | invariant |
| **`instrumented_pr` on a pre-monorepo row links to an unrelated omni PR** | The linked PR has nothing to do with the event — omni PR #708 is a Peerly char-limit change, not the 2025-06-18 commit that instrumented `Dashboard - Candidate Dashboard Viewed`. | omni's history was grafted in (repo created 2026-06-01, PR #1 on 2026-06-05); pre-cutover commit subjects carry the **source repo's** `(#N)`, and `to_pr_url` renders every number under `thegoodparty/omni`. No guard exists. 148 of 372 PR links are pre-cutover. Tell: the linked PR's merge date does not match `instrumented_date` — check it before citing a link as provenance (DATA-2004). | state · as-of 2026-09 |
| **`instrumented_never_observed` only means "has a Govern taxonomy row"** | A 69-event cause reads as "69 broken instruments". | The provenance CSV's row set comes from the Amplitude Govern taxonomy, not from code, so an event declared in Govern and never written scores the same as one instrumented last Thursday. As measured 2026-09-28: 34 never written, ~32 too recent to judge, 4 the actual finding. Split by `instrumented_date` and by whether code provenance exists at all before ruling (DATA-2573, open). | state · as-of 2026-09 |
| **Retirement declared from absent data** | An event with no recent fires is called dead, and the status write makes that official. | Absent data is not removal. Call an event retired only with **code-removal proof** — the commit or PR that deleted the call site — and embed it in the status write. Propose-and-confirm flow: [monitor-analytics-event-health.md](monitor-analytics-event-health.md) § Rank 2. The inverse also bites: a declared successor that was never built, which is why a `superseded by X` write should be checked against X's code provenance. | invariant |
| **One search is not evidence** | A pickaxe or grep on one identifier returns nothing, and the clean negative reads as proof the code is gone. A wrong guess at the spelling is indistinguishable from absence. | A negative is not evidence until a second, differently-shaped method agrees. Search the **value**, then the **reference** (constants, aliases, lookup tables, nested groups), then the **tree before the change** (`git grep <term> <sha-before>`, then `git log --diff-filter=D`). When a negative contradicts other evidence — "no call sites since April 2025" against 1,471 fires a month — the negative is wrong until proven otherwise. Dynamic dispatch defeats a literal search outright. 2026-09-29, DATA-2546: a pickaxe on `ScheduleTextCampaign` nearly produced a wrong verdict on 14 live events whose call sites referenced the nested `ScheduleCampaign` group. | invariant |

## Follow-up

Not built: a linter that re-verifies the mechanically checkable `state` rows against the
live catalog and CSV (the blank/zero counts, the pre-cutover link count, the
never-observed split) and flags the rest once their as-of date goes stale. Until then,
re-check a `state` row before acting on it.

## Cross-references

Owning docs carry the full explanations:

- [monitor-analytics-event-health.md](monitor-analytics-event-health.md) — the status
  model, severity ranks, and the rank-0 / rank-2 triage flows.
- [refresh-event-provenance.md](refresh-event-provenance.md) — the provenance walk and the
  CSV's columns.
- [refresh-event-state-surface.md](refresh-event-state-surface.md) — the consumer
  event-state sheet.
