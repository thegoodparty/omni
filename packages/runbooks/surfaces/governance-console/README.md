# Event health console

One page over the analytics governance snapshot: where the catalog stands, what moved
since the last run, and every open decision in one ranked list. Built for the one person
who triages this, which is what separates it from the analytics-event explorer next door
(that one answers product questions for everyone else).

Ticket: DATA-2546. Subtask DATA-2547 adds the sitemap view.
Design doc: `docs/superpowers/specs/2026-09-28-event-health-console-design.md`
(gitignored, local only).

## How you act on a row

Rule on a row with the buttons: dismiss with a reason, ticket it, look into it, or
reviewed. The judgment is recorded the moment you click, in this browser, keyed by the
run it was made against. Nothing is submitted, and a half-finished session loses
nothing.

When you are done, the bar at the bottom holds the batch. Copy it, paste it into Claude
Code, and it writes each judgment to the file its queue owns, files the tickets, and
opens one PR. The next scheduled run reads those files and stops raising what you
settled.

The failure mode is deliberately visible: if you never paste the handoff, nothing
happened, and Thursday's digest says so. A background sync would fail more quietly.

### What the row already knows, so you do not have to work it out

Every row says which signal its finding comes from, what the detector concludes from
that signal, and whether the signal has a known residual. Where there is one, it also
carries the tell: how to recognise that this row is the residual rather than the
finding.

This is the part that makes the next session cheaper. The first real run cleared three
of twenty-six decisions, and one of the three took forty minutes, all of it spent
re-deriving the rank-0 counter blind spot that `monitor-analytics-event-health.md`
already explains. The bottleneck is confidence per row, not the number of rows, so a
signal verified once belongs on every row that derives from it.

**"No known residual" is the half that does the work.** It is what tells you to stop
looking and rule on the evidence in front of you.

None of this text is a fact of its own. Every residual is a row in
`books/analytics-governance-gotchas.md`, which is where one gets added when it is found
and deleted when it is fixed. The caveats are the path from that file to the person
ruling. Three of the four queues derive every row from the same detector, so their
caveat prints once above the list; flags print theirs per row, because each cause has a
different signal.

### A dismissal has to say why

`dismiss` is the one verdict with no expiry. Its row is read by the next run and every
run after it, and nothing ever asks again, so an unexplained dismissal is a permanent
silence nobody can audit. The page holds the verdict rather than recording it until the
reason box has something in it — the button shows as pressed, the row is marked red, and
nothing reaches the handoff. One keystroke commits it; emptying the box takes it back.

The other three verbs prompt for a reason and accept an empty one. Each of them leads
somewhere a person looks again, so a missing reason costs some context and nothing else.

`Take all N suggestions` will not take a suggested dismissal, because a reason typed on
behalf of twelve rows is not a reason. It leaves those rows marked and waiting, and says
so on the button.

### Ruling on part of a cause

A cause is normally one ruling, but some causes hold more than one decision. On a flag
row with more than one event, the evidence table takes checkboxes and a row of
quick-select chips built from that cause's own data: `all`, `none`, one per distinct
provenance state, and `older than 30d` where it applies. Pick a set, then apply a verb
to just those events.

Today's `never observed` is why this exists. One click on `not found in code` selects
34 of its 69 events, which are the Serve and Win outreach names declared in Govern and
never built. They need a different verb from the thirty instrumented in the last
fortnight that simply have not fired yet.

A per-event ruling coexists with the cause-level one, so "retire the cluster, except
these four" is expressible. In the handoff, events ruled together under the same verb
and reason collapse into one block rather than repeating the verdict per line.

**`Reviewed, fine` on a flag has nowhere to land yet.** The other three verdicts write
to files that already exist and are already read back. Per-event review needs
`analytics_event_health_dispositions.json`, which is the one genuinely new mechanism in
this ticket and is not built. Until it is, a reviewed flag is a note in the handoff and
the digest will raise it again.

Judgments live in `localStorage`, so they are per-browser and can be lost by clearing
site data. That is deliberate for now: the artifact database only exists on a published
page, and this one is still local. Publishing upgrades the store without changing how
the page feels.

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
