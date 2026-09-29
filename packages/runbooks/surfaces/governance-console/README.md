# Event health console

One page over the analytics governance snapshot: where the catalog stands, what moved
since the last run, and every open decision in one ranked list. Built for the one person
who triages this, which is what separates it from the analytics-event explorer next door
(that one answers product questions for everyone else).

Ticket: DATA-2546. Subtask DATA-2547 adds the sitemap view.
Design doc: `docs/superpowers/specs/2026-09-28-event-health-console-design.md`
(gitignored, local only).

## How you act on a row

Rule on a row with the buttons. Each queue has its own verbs, in its own words: a flag
can be fixed in Govern, dismissed, ticketed or looked into; a gap can be accepted,
dismissed or deferred. The judgment is recorded the moment you click, in this browser,
keyed by the run it was made against. Nothing is submitted, and a half-finished session
loses nothing.

**A button label names the control; hovering it names the consequence.** "Fix in
Govern" tells you which thing you are touching. The tooltip, and the review panel, say
what it does to other people: *Write this to Amplitude Govern. A retirement here tells
every consumer the events are dead.* Those sentences live in one place,
`VERB_EFFECTS` in the snapshot builder, so the tooltip and the review cannot drift.

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

### `govern` has to show the commit

`govern` is the one verb that leaves this repo. It writes production Amplitude, and what
it usually writes is "this event is dead", which every consumer downstream immediately
believes. The other three land in a file in a PR and are undone by editing it, so they
stay one click.

So a `govern` verdict is held until the box carries code-removal proof: a commit sha, a
commit or PR URL, or `#1234`. Prose is refused, because "the code is gone, I checked" is
exactly the unevidenced claim the rule exists to stop. Absent data is not removal.

**Why there is a second accepted answer.** "Fix in Govern" is not always a retirement,
and `intent_divergence` is where that bites. One cause covers two opposite situations:

| What the monitor found | What fixing it means |
| --- | --- |
| `declared in-use but code removed + quiet` | Govern says alive, the code is gone. Retire it, against the deleting commit. |
| `declared not-in-use but still firing` | Govern says dead, the event is alive. Un-declare it. Nothing was deleted, so no commit exists. |

Requiring a commit for every Govern write would make the second row impossible to
record — and that is the more urgent one, since consumers are being told a live event is
dead. So the box also takes `no removal: <why>`. That is a positive claim, not a waiver:
it says "this write is not a retirement", it goes into the handoff so the apply step
knows not to write a retirement status, and the review panel then describes the decision
as a correction rather than a retirement. What the box will not take is vague prose.

`Take all N suggestions` cannot take a `govern`. Bulk-taking the flags queue today would
declare 22 events dead on one click and nobody's evidence; those rows are left marked and
the button says how many need proof.

### Reading back what you decided, before you send it

`Review` opens the readable version of the handoff: one block per decision, headed by
what that decision does rather than which button produced it. Under each, the row it
applies to and the evidence or reason you gave. `Raw text` still shows the literal text
Claude parses — both are built from the same judgments, so they cannot disagree about
what is going out.

It has three parts, and the second two matter as much as the first:

- **Going out** — every decision the handoff will carry.
- **Waiting on you** — rows where a verdict is held for want of a reason or proof, so
  what is *missing* is as visible as what is ready. Without this a held row is invisible
  from the bottom of the page.
- **Already applied** — decisions sent in an earlier batch this run, kept as a record.

This exists because of a specific failure. On the first real run the page showed which
control had been pressed and never what would happen, so the person who built the system
could not read back his own decisions. Events ruled together under the same verb, reason
and proof are one decision and read as one, the way they do in the handoff.

An applied decision cannot be un-ruled by clicking its verb a second time — that click
would silently erase the record of a change Claude has already made. Choosing a
different verb is allowed, because that is a correction and it goes back into the
handoff; `clear` is still the explicit way to drop one.

### Telling the page a batch was applied

`Copy handoff` stamps the judgments it carried. When Claude has written them, `Mark N
applied` marks exactly those: they get a green chip, drop out of the handoff, and stay
on the page as a record. Anything you ruled on after copying stays open, so "copy, get
distracted, rule on four more, come back" does not sweep the four in with them.

The stamp lives on the judgment, not in a variable, because the whole point of the gap
between copying and marking is that Claude is working in it. A reload or a republish in
that window keeps the batch.

**It is a mark, not a re-check.** A gap or a proposal reaches its file the moment Claude
writes it, but a flagged cause only leaves the queue after a governance run has read
that file, and that is a Monday and Thursday thing. Deriving "done" from a fresh
snapshot would report two thirds of every batch as undone for three days. The next run
is what actually confirms it, and because judgments are keyed by run date, a new run
starts a clean page — which is correct, since by then the report is the better answer.

Applied judgments are left out of the handoff. Sending one twice would add a second
`cause:` row for a decision already recorded, and a YAML list has no idempotency to save
it the way the gap state does.

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
