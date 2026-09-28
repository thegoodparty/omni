# Event health console

One page over the analytics governance snapshot: where the catalog stands, what moved
since the last run, and every open decision in one ranked list. Built for the one person
who triages this, which is what separates it from the analytics-event explorer next door
(that one answers product questions for everyone else).

Ticket: DATA-2546. Subtask DATA-2547 adds the sitemap view.
Design doc: `docs/superpowers/specs/2026-09-28-event-health-console-design.md`
(gitignored, local only).

## Read-only, for now

This is phase 1. The page shows the queue; rulings still go through Claude Code and
`/triage-instrumentation-gaps`. Phase 2 adds the judgment buttons and the one-line
handoff, which is the part that actually stops the digest re-raising things.

## Rebuilding it

```bash
# 1. the health report is gitignored and lives 30 days as a CI artifact
cd ../../scripts/python
gh run download "$(gh run list --workflow analytics-governance.yml --limit 1 \
  --json databaseId --jq '.[0].databaseId')" \
  --name analytics-event-health-report --dir instrumentation_data

# 2. the snapshot (needs uv; no Databricks, no Google)
uv run governance_console_snapshot.py \
  -o ../../surfaces/governance-console/data/governance-console.json

# 3. the page (needs nothing at all)
cd ../../surfaces/governance-console && python3 build.py
```

Step 3 is deliberately dependency-free. The scheduled republish routine runs it with a
bare interpreter, so `build.py` must never import the governance modules, which pull in
yaml, pandas and the Databricks SDK.

## Where each queue's decisions live

The page shows a queue; these files own what you decide about it. All four are read back
by the twice-weekly run, which is why a decision recorded in one of them stops the
digest raising the item again.

| Queue | Decision goes to |
| --- | --- |
| Flagged causes | a `cause:` row in `monitored_events.yaml` |
| Instrumentation gaps | `instrumentation_gaps.json` |
| Watchlist proposals | an `event:` row in `monitored_events.yaml` |
| Registry vs semantic layer | a `metric:` row in `monitored_events.yaml` |

Per-event "I looked at this one and it is fine" has no home yet. That file is phase 2
and is the only genuinely new mechanism in the whole ticket.

## Things that will surprise you

- **The queue is 12 causes, not 174 flags.** `cluster_flagged` groups the flagged set by
  why it fired, so one deploy that stranded 22 name constants is one row. The count on
  the right of a row is how many events sit under it.
- **Two causes can never be dismissed.** `okr_anchor_dormant` means a number the company
  steers by is wrong right now; `counter_blind_spot` means our call-site counter is
  blind, not that the event is dead. `load_cause_dismissals` refuses both and the digest
  prints the refusal, so the page shows a note instead of an affordance.
- **The cause key is shown verbatim** under each flag row (`call_site_removed@2026-09-01`).
  That exact string is what a dismissal row has to carry, qualifier included, or it
  silently matches nothing.
- **The snapshot is its own prior state.** Each build reads the file it is about to
  replace and takes `prior_flagged` from it. There is no second state file. A first
  build therefore reports every flag as new, which is correct and not a bug.
- **The builder refuses a stale report.** The report is the only gitignored input, so it
  is the only one that can quietly be last week's. If its `run_date` predates the
  committed gap state, the build fails rather than publishing a page that misstates how
  fresh it is.
- **The area rollup is lifted from the explorer snapshot**, not recomputed. The filing
  rule has moved once already (DATA-2532) and one producer is what stops the two pages
  disagreeing about which area an event belongs to.
- **The page declares its own charset.** Opened as a saved file there is no
  `Content-Type` header, and every arrow and middot renders as mojibake without it.
