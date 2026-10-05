---
name: triage-instrumentation-gaps
description: Run the weekly instrumentation-governance review over four queues — flagged causes (analytics_event_health.py), instrumentation gaps (instrumentation_gaps.py), watchlist proposals (analytics_event_health.py), and registry-vs-semantic-layer alignment findings (anchor_alignment.py) — entered from the Slack governance digest or a pasted event health console handoff, ending in one PR against main. Also diagnoses the digest's red/yellow health items. Use when the user says "triage instrumentation gaps", "/triage-instrumentation-gaps", "review the watchlist proposals", "triage the alignment findings", picks up the digest's triage line, or asks to look into / diagnose a red, yellow, dormant, flatlined, or misaligned event from the digest. Also use to resolve drift between a governed metric and the product with no digest in hand: an event a semantic-layer metric counts was renamed, moved or stopped firing, or the business group changed what a governed metric means.
---

# Triage instrumentation gaps

Weekly governance review over **four re-nagging queues** that share one reviewer, one
session, and one PR:

- **Queue 0 — flagged causes** (`analytics_event_health.py`): the flagged set grouped by
  the reason it fired, so a deploy that stranded twenty-two name constants is one ruling.
- **Queue A — instrumentation gaps** (`instrumentation_gaps.py`): candidate product
  surfaces the weekly sweep thinks are missing an analytics event.
- **Queue B — watchlist proposals** (`analytics_event_health.py`): catalog events in a
  watched family that aren't yet on the curated watchlist.
- **Queue C — registry vs semantic layer** (`anchor_alignment.py`): a behavior in
  `monitored_events.yaml` and the governed metric it points at disagree about which
  events count.

This skill orchestrates existing Python modules and three other skills. It never
re-implements enumeration, judgment, or proposal detection, and it never edits product
code directly — accepted gaps either get a ClickUp ticket or get handed to
`instrument-analytics-event`.

Background: DATA-2151 built the sweep, the state file, the sheet tab, and the Slack
digest; this skill (DATA-2152) is the missing disposition surface — the only way to act
on any queue used to be hand-editing raw JSON/YAML on GitHub.

## When to use

- The user says "triage instrumentation gaps", "/triage-instrumentation-gaps", or
  "review the watchlist proposals".
- The user pastes (or references) the Slack governance digest's triage line —
  `🛠 Triage: /triage-instrumentation-gaps <run_date>` — or a permalink to that message.
- The user asks to look into the digest's 🔴/🟡 items ("what happened to <event>",
  "diagnose the red item", "why did these flatline") — run the Diagnose section, in
  the same session as the queues or standalone.
- Weekly cadence: this is the human review step that closes the loop the digest opens.
- **Standalone drift.** A product change renamed, moved or retired an event that a
  governed metric's `anchored_on` names, or the business group ruled that a governed
  metric should count something different. There may be no finding in any queue yet.
  Go straight to **Resolve a drift end to end** under Queue C.

## Resolve the runbooks dir

<!-- BEGIN: resolve-runbooks-dir (keep in sync across commands/*.md) -->

> **Where this runs:** Runbooks lives in the `omni` monorepo at `packages/runbooks`. All paths below (`scripts/python/...`, `books/.env`, `scripts/.env`) are relative to that package root. When invoked from any directory, first resolve and `cd` into it:
>
> 1. If `$RUNBOOKS_DIR` is set, use it.
> 2. Else first that exists: `$HOME/Documents/gp/dev/omni/packages/runbooks`, `$HOME/code/omni/packages/runbooks`, `$HOME/omni/packages/runbooks`.
> 3. Else ask the user where the omni repo is (the runbooks package is at `<omni>/packages/runbooks`); suggest `export RUNBOOKS_DIR=<omni>/packages/runbooks` in their shell profile.

<!-- END: resolve-runbooks-dir -->

All `uv run` commands below run from `<runbooks>/scripts/python`. This is also the
`omni` checkout that gets committed to and PR'd — the ClickUp ticket, the digest read,
and the write-back all resolve against the same repo.

**Prerequisites:**

- `CLICKUP_API_KEY` in `scripts/.env` (used by `clickup_api.py`; never read this file
  yourself, the script loads it via `python-dotenv`).
- `SLACK_EVENT_LIFECYCLE_CHANNEL_ID` (and, only if recomputing Queue B live,
  Databricks OAuth env vars — see `docs/databricks.md`) available in the shell or
  `scripts/.env`, matching `event_state_slack.py`'s `CHANNEL_ENV` constant.
- `uv`, `gh`, and this repo checked out with a clean working tree before you start
  editing state files.

## Load context (self-load)

The reviewer never has to pre-load anything — this skill finds the run itself.

**No argument** — find the latest digest via the Slack MCP:

1. Resolve the channel id from `SLACK_EVENT_LIFECYCLE_CHANNEL_ID` (same var
   `event_state_slack.py`'s `CHANNEL_ENV` reads).
2. `slack_read_channel(channel_id=<id>, limit=20)` and find the newest message whose
   text starts `📊 Analytics event health & instrumentation gaps — <run_date>` (the
   digest's header, from `build_digest_blocks`/`_header` in `event_state_slack.py`).
   If the channel can't be read directly (private, or not found), fall back to
   `slack_search_public(query="Analytics event health & instrumentation gaps")` to
   locate it.
3. `slack_read_thread(channel_id=<id>, message_ts=<parent ts>)` to pull the full
   thread — this carries the ranked gap table, the "Set disposition" / "Browse gaps"
   links, and the `🛠 Triage: /triage-instrumentation-gaps <run_date>` line (Queue A),
   plus the "Watchlist proposals (self-healing)" section (Queue B).
4. Extract `run_date` from the header or the triage line — both carry the same
   `YYYY-MM-DD`.

**With an argument:**

- A bare `YYYY-MM-DD` → use it directly as `run_date`, skip the Slack read.
- A Slack permalink (`https://…/archives/<channel>/p<digits>`) → parse the channel id
  and message timestamp out of the URL (`p1234567890123456` → `1234567890.123456`),
  `slack_read_thread` on that, then extract `run_date` the same way as step 4 above.

**With a pasted console handoff** — the event health console (DATA-2546) is a page over
the same snapshot, where the reviewer reads the evidence and picks a verb per row. It
emits a plain-text batch:

```
DATA-2546 triage handoff
run: 2026-09-28
judgments: 12

## flags
- govern: call_site_removed@2026-09-01
  reason: <why>
  proof: <the commit or PR that deleted the call site>
- dismiss: orphaned_firing  [overridden]
  reason: <why>
  - ticket (34 events): <why these ones>
      <event name>
      <event name>

## gaps
- accept: packages/gp-webapp/app/…#form
  reason: <why>
```

Take `run_date` from the `run:` line and skip the Slack read. Everything downstream is
unchanged: each block names a queue, an item id the queue already keys on, and that
queue's own verb.

**The console replaces the elicitation half of this skill, not the application half.**
The reviewer has already looked at the evidence and chosen. Do not re-ask. What is still
yours is everything after the verb — the per-queue write rules, `is_actioned`, the
accepted-gap routing between a ClickUp ticket and `instrument-analytics-event`, and
`ship-pr`.

Reading the blocks:

- `[overridden]` means the reviewer did not take the suggestion. It is informational;
  the verb is the verb either way.
- An indented `- <verb> (N events):` block under an item is a ruling on **part** of a
  cause, with its member events listed beneath. A cause-level verb and a per-event verb
  can both be present: "retire the cluster, except these four".
- `proof:` appears only on `govern`, and only because the console refuses to record a
  Govern write without it. Carry it into the `event-metadata` handoff — it is the
  code-removal evidence the status write is supposed to embed. A `proof:` beginning
  `no removal:` is the reviewer declaring this write is **not** a retirement; honour
  that and do not write a retirement status.
- A per-event `reviewed` verdict has nowhere to land yet
  (`analytics_event_health_dispositions.json` is not built). Report it in the PR body
  and tell the reviewer the digest will raise it again.
- **Judgments are stamped with a run date.** If a newer run has landed since, a cause's
  membership may have moved. Re-check membership before applying and report what
  changed rather than applying a stale ruling silently.

Never post to Slack during this self-load — it's read-only (`slack_read_channel` /
`slack_read_thread` / `slack_search_public`), never `slack_send_message`.

With `run_date` in hand, load all four queues scoped to that run.

**Read the gotchas book before ruling on anything.** `books/analytics-governance-gotchas.md`
is a symptom table of the traps that have produced confident, wrong verdicts in this
process — blank vs zero call-site counts, the rank-0 counter blind spot, a 30-day window
straddling a retirement, the rolling baseline absorbing a sustained break. Scanning it
first is cheaper than re-deriving one of them from scratch, which is what DATA-2575 was
filed for.

## Queue 0 — flagged causes

**Get the batch:** the digest's **Flagged (by cause)** section, or the console's flags
queue. `cluster_flagged` groups the flagged set by the reason it fired, so one deploy
that stranded twenty-two name constants is one ruling rather than twenty-two.

The unit is the **cause key** — the string the digest prints for that line, qualifier
included (`call_site_removed@2026-09-01`), or the bare key where there is none
(`orphaned_firing`, `never_observed`, `intent_divergence`, `dormant_elevated`,
`anomaly_drop`, `counter_blind_spot`, `okr_anchor_dormant`). Get it exactly right: a
dismissal carrying a mangled qualifier silently matches nothing.

**Verb → action:**

| Verb          | What it means                                  | What you do                                                                                                                                                             |
| ------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `govern`      | Write the event's status in Amplitude Govern   | Hand each member event to the **`event-metadata`** skill, carrying the handoff's `proof:` as the code-removal evidence the status write embeds. **Not a repo change** — see the PR section. |
| `dismiss`     | Silence this cause in every future digest      | Append a `cause:` row to `dismissed:` in `monitored_events.yaml` (below).                                                                                               |
| `ticket`      | Hand it to the backlog                         | File a ClickUp ticket in the Data backlog. See the note below about re-nagging.                                                                                          |
| `investigate` | Nothing is written yet                         | Drop into **Diagnose** with that cause's member events.                                                                                                                  |

**Dismissing a cause:**

```yaml
- {cause: "<cause key>", reason: "<reason>", date: "<run_date>"}
```

- **Check membership first** — skip if the same `cause` is already in `dismissed:`.
- **`okr_anchor_dormant` and `counter_blind_spot` cannot be dismissed.** The loader
  refuses both and the digest prints "Dismissal refused" naming the row, so a dismissal
  written anyway does nothing except tell on itself. A latched OKR anchor clears on
  recovery or when the metric's `anchored_on` changes upstream; a counter blind spot is
  fixed in `count_call_sites` in the provenance backfill. The console does not offer a
  dismiss button on those two rows, so a handoff should never contain one — if it does,
  say so rather than writing it.
- A dismissed cause stays in the digest struck through, with its current member count, and
  stays whole in the JSON report. It is silenced, not deleted, so a cluster that keeps
  growing after it was settled is still visible.

**`ticket` does not stop the nagging, today.** The only silencing mechanism for a cause
is the `cause:` dismissal above, and a `reviewed` disposition per event has no home yet
(`analytics_event_health_dispositions.json` is not built). So a ticketed cause comes
back next run. Say that out loud and ask whether the reviewer also wants it dismissed
with the ticket URL as the reason — don't decide it for them, and don't write a
dismissal they did not ask for.

**A ruling on part of a cause.** A handoff can carry an indented per-event block under a
cause. Apply the cause-level verb first, then the per-event ones, so "retire the cluster
except these four" lands in that order. Per-event `govern` goes to `event-metadata` the
same way. Per-event `reviewed`, `dismiss` and `ticket` have nowhere to land as a silence:
never turn them into a `cause:` row, which would quiet every event under that cause, and
never into an `event:` row, which is a watchlist-proposal rejection and silences no flag.
Record them in the PR body, file the ticket if one was asked for, and tell the reviewer the
digest will raise them again until the cause stops applying.

## Queue A — instrumentation gaps

**Get the batch:**

```bash
cd <runbooks>/scripts/python
uv run instrumentation_gaps.py --today "$run_date" --list-new
```

This is read-only (`load_state` + `new_this_run`, no scan, no judge) and prints this
run's untriaged (`disposition: new`, `first_seen == run_date`) gaps as a JSON array,
each with `id`, `surface_type`, `location`, `rubric_rule`, `dashboard_question`,
`judge_reason`, `rank`.

`resolved` and `retired` are terminal dispositions — a gap that closed itself (the
surface got instrumented, or the surface disappeared) never comes back as `new`, so
neither ever appears in `--list-new`. They only show up in `coverage_stats`'s counts
and the committed state file.

Some entries also carry a `prior_ruling` field: `{id, disposition, reason, ruled_on}`
from a resplit predecessor at the same location/surface_type. When present, show the
reviewer that earlier decision and reason alongside the judge's verdict — it is
usually the same call, made in seconds.

- **Empty batch** → say so ("no new instrumentation gaps this run") and skip straight
  to Queue B.
- **Otherwise**, offer **interactive**, **batch**, or — when the reviewer arrived with a
  console handoff — **apply the handoff**. Suggest **batch** once the batch has more
  than 5 items (walking >5 one-by-one in chat is worse than an editor pass).

Both modes write dispositions back through the **same path**: a filled review
artifact loaded via `--load-review`. There is exactly one write path into
`instrumentation_gaps.json` — interactive mode just fills the artifact itself instead
of asking the reviewer to open an editor.

**Interactive** (small batch):

1. `uv run instrumentation_gaps.py --today "$run_date" --review-artifact /tmp/gap-review-$run_date.md`
   writes one `## <id>` block per gap with blank `- disposition:` / `- reason:` lines
   (`render_review_artifact` → `render_seed_artifact`).
2. For each block, show the reviewer `rank`, `surface_type`, `location`, `rubric_rule`,
   `dashboard_question`, `judge_reason` — and `prior_ruling`, when present, beside the
   judge's verdict — and ask for a verb: **accept**, **dismiss** (nudge for a reason —
   that's the field that stops the re-nag), or **defer**.
3. Edit the artifact file in place, filling each block's disposition per the mapping
   below (never leave `- disposition:` blank for an answered item — blank means "still
   new" to the parser).
4. Once every block is answered:
   ```bash
   uv run instrumentation_gaps.py --today "$run_date" --load-review /tmp/gap-review-$run_date.md
   ```

**Batch** (large batch):

1. Same `--review-artifact` step as above.
2. Tell the reviewer the file path and ask them to fill in `- disposition:` /
   `- reason:` for each block in their editor, then confirm when done.
3. Same `--load-review` step as above.

**Apply the handoff** (the reviewer already ruled, in the console):

1. Same `--review-artifact` step as above.
2. Fill each block from the handoff's `## gaps` section, mapping the verb through the
   table below. Ids match: the console keys a gap on the same `location#surface_type`
   this artifact does.
3. A gap in the artifact that the handoff does not mention stays blank, which the parser
   reads as "still new" — correct, and what the reviewer meant by not ruling on it.
4. Same `--load-review` step as above.

The write path does not change in any of the three modes. There is exactly one way into
`instrumentation_gaps.json`, and it is `--load-review`.

**Verb → disposition mapping** (write the literal value into the artifact's
`- disposition:` line):

| Verb    | `- disposition:` value | Notes                                                          |
| ------- | ----------------------- | --------------------------------------------------------------- |
| accept  | `accepted`               | Then act on it (see below).                                     |
| dismiss | `dismissed`              | Always capture `- reason:` — suppresses from every future digest/sheet. |
| defer   | `open`                   | Collapses to a count line in the digest; re-reviewable later.    |

`apply_seed_dispositions` validates against `{new, open, accepted, dismissed}` and
skips (with a stderr warning) anything else, so don't invent other values.

**This mapping is not optional, and skipping it fails silently.** The verbs above are
the reviewer's words; the values in the middle column are the storage format. They do
not overlap — a console handoff says `accept`, `dismiss`, `defer`, and every one of
those is invalid to the parser. Writing a handoff's verbs straight into the artifact
drops every Queue A ruling with nothing but a stderr line to show for it, and the next
digest re-nags the whole batch as though the review never happened. Translate, then
check the `--load-review` applied count against the number of blocks you filled.

### Act on accepted gaps

For each gap the reviewer just marked `accepted`, first check whether it's already
handled:

```bash
uv run python -c "
from pathlib import Path
from instrumentation_gaps import load_state, is_actioned
state = load_state(Path('instrumentation_data/instrumentation_gaps.json'))
e = state['<gap_id>']
print(is_actioned(e), e.get('ticket_url'), e.get('actioned_at'))
"
```

If `is_actioned` is already `True`, skip it — show it to the reviewer as
already-actioned, don't re-file or re-offer it.

Otherwise offer the reviewer a choice per accepted gap:

**Default — file a ClickUp ticket** in the Data backlog (list `901326391561`):

1. Build the payload safely (never hand-template untrusted text into JSON — same rule
   as `clickup-epic-create.md`):
   ```bash
   python3 -c '
   import json
   payload = {
       "name": "<dashboard_question, or the gap id if blank>",
       "markdown_description": (
           "**Surface type:** <surface_type>\n"
           "**Location:** \`<location>\`\n"
           "**Rubric rule:** <rubric_rule>\n"
           "**Dashboard question:** <dashboard_question>\n"
       ),
   }
   print(json.dumps(payload))
   ' > /tmp/gap-ticket-payload.json
   ```
2. `uv run clickup_api.py POST list/901326391561/task @/tmp/gap-ticket-payload.json`
   — capture the returned `id`; the ticket URL is `https://app.clickup.com/t/<id>`.
3. Stamp the gap so a re-run never double-files it:
   ```bash
   uv run python -c "
   import json
   from pathlib import Path
   from instrumentation_gaps import load_state, stamp_gap
   p = Path('instrumentation_data/instrumentation_gaps.json')
   state = load_state(p)
   stamp_gap(state, '<gap_id>', ticket_url='https://app.clickup.com/t/<id>', actioned_at='$run_date')
   p.write_text(json.dumps(state, indent=2, sort_keys=True) + '\n')
   "
   ```

**Inline "do it now"** — hand the surface straight to `instrument-analytics-event`
in this session (pass it the `location` / `surface_type` / `dashboard_question` as
context for what needs instrumenting), then stamp only `actioned_at` (no
`ticket_url` — there's no ticket, the work is already done):

```bash
uv run python -c "
import json
from pathlib import Path
from instrumentation_gaps import load_state, stamp_gap
p = Path('instrumentation_data/instrumentation_gaps.json')
state = load_state(p)
stamp_gap(state, '<gap_id>', actioned_at='$run_date')
p.write_text(json.dumps(state, indent=2, sort_keys=True) + '\n')
"
```

`stamp_gap` only sets the fields you pass, so calling it twice (e.g. ticket first,
then later instrumented) is safe — it never clobbers a field with `None`.

## Queue B — watchlist proposals

**Get the proposals** for this run, from the health monitor's result JSON (key
`proposals`, each `{event_type, family, first_seen_date}` from
`propose_watchlist_additions`). That JSON is written by `analytics_event_health.py
--json instrumentation_data/analytics_event_health_report.json` in the scheduled
governance workflow, but the file is **gitignored** (not committed) — it only exists
locally as a CI artifact or a fresh local run:

1. Check `instrumentation_data/analytics_event_health_report.json` locally first.
2. If absent, try pulling the latest `analytics-governance` workflow run's
   `analytics-event-health-report` artifact: `gh run list --workflow
   analytics-governance.yml --limit 1` then `gh run download <run_id> --name
   analytics-event-health-report --dir instrumentation_data`.
3. If neither works, recompute live (needs Databricks OAuth env vars — already global
   per this machine's setup):
   ```bash
   # --no-log: this is a read-only recompute, and without it the run rewrites the
   # git-tracked health log and state file that the scheduled run authors.
   uv run analytics_event_health.py --today "$run_date" --no-log \
     --json instrumentation_data/analytics_event_health_report.json
   ```

Read the `proposals` array from whichever JSON you ended up with.

- **Empty** → say so and move to write-back.
- **Otherwise**, same interactive-vs-batch choice as Queue A (suggest batch past ~5).
  For each proposal show `event_type`, `family`, `first_seen_date` and ask for a verb.

**Verb → action on `monitored_events.yaml`** (edit in place — this is a hand-maintained,
comment-heavy YAML; never round-trip it through a YAML dumper, or the comments and
section banners get stripped):

- **accept** — append a row to the `events:` list, in the exact shape
  `_proposal_yaml_row` builds (so the row matches every other line in the file):
  ```yaml
  - {event: "<event_type>", product: <win|serve>, family: <family>, floor: null, owner: TBD}
  ```
  `product` is `win` if `family` starts with `win`, else `serve` (mirrors
  `_proposal_yaml_row`'s own rule). **Check membership first** — skip if an `events:`
  row with this exact `event` string already exists (accept is meant to be
  self-suppressing, same as today). Skip too if the event is any behavior's
  `instrumented_by` in the `behaviors:` block: it is already monitored (the monitor
  unions the two keys, DATA-2290) and validation rule 8 rejects the duplicate anchor.
  The proposal queue already filters those out, so this only bites on a hand-added row.
- **dismiss** — ask for a one-line reason, then append to `dismissed:`:
  ```yaml
  - {event: "<event_type>", reason: "<reason>", date: "<run_date>"}
  ```
  If the file still has the placeholder `dismissed: []`, replace that line with
  `dismissed:` followed by the new block-list entry. **Check membership first** — skip
  if this `event` is already in `dismissed:`.
- **defer** — leave the file untouched; the proposal reappears on the next run within
  its 90-day window. That's the point — "defer" means "ask me again," "dismiss" means
  "stop asking."

## Queue C — registry vs semantic layer

**The rule, stated once.** The semantic layer defines every metric: which raw events count
is whatever gp-data-platform's `sem_*.yml` says under `config.meta.anchored_on`. omni never
writes a metric definition. omni's `behaviors:` are the code map: where in the product a
question is answered and what fires there. When the two disagree, ask which side has the
newer information about the product, and fix that side only:

| Case | Who is behind | What you do |
| --- | --- | --- |
| 1 | omni | Edit `monitored_events.yaml`. Mechanical. |
| 2 | the semantic layer | Draft the `anchored_on` change and, on accept, open a gp-data-platform PR. Never an omni edit that hides it. |
| 3 | unknown, they disagree on scope | Ask the reviewer which side is wrong. Then follow that case's row. |

These cases are the drift types in gp-data-platform's semantic-layer SOP
(`analytics/diagnostics/semantic_catalog/templates/sop.md`, "When the product and a
metric drift apart"): case 2 is **drift B** (the product moved, the meaning did not),
case 3 is **drift C** (the product changed what could be counted), and case 1 is the
last step of either. **Drift A** (the business group changed the meaning) has no case,
because it starts from a ruling rather than a finding. The SOP owns who decides and which
review lane applies; this skill owns the procedure and restates none of that policy.

An old caveat in the yaml saying re-anchoring is "deliberately not done" or waits for
DATA-2421 is history, not an instruction. DATA-2421 shipped. Rewrite the caveat as part of
the edit.

**Get the findings** from the same report JSON Queue B resolved, key `anchor_alignment`.
Each item carries `case`, `kind`, `behavior_id`, `metric`, `surface_label`, `event_key`,
`suggested`, `evidence`, `headline`.

- **Empty** → say so and move to write-back.
- **Otherwise**, walk them in order (the list is sorted case 1, 2, 3). Apply a behavior's
  findings as a set. A repoint that names a previously unmonitored leg also discharges
  that leg's `declared_leg_unmonitored` finding; never add a second surface with the same
  `instrumented_by` and `page_path`. Show `headline`, `event_key` and `suggested` for
  each. `evidence` is populated only on case 2; for cases 1 and 3, read the event's row
  in the report's `records` (`status`, `last_seen_date`, `event_count_30d`,
  `call_site_count`) and show that instead. Before proposing any edit, read the
  declaration yourself so the reviewer sees the source, not the summary:

  ```bash
  gh api -H 'Accept: application/vnd.github.raw+json' \
    repos/thegoodparty/gp-data-platform/contents/dbt/project/models/marts/analytics/sem_analytics__users_win.yml \
    | grep -n -A12 "name: <metric>"
  ```

  (`sem_analytics__users_serve.yml` for serve metrics.) If `gh` cannot read the private
  repo, read the same file from a local gp-data-platform checkout instead.

**Case 1 kinds and the exact edit.** Edit the yaml as text. Never round-trip it through a
dumper.

- `surface_on_historical_leg`: on the named behavior's surface, replace `instrumented_by`
  with one of the `suggested` legs. `suggested` is a list of leg keys joined by `, `, and
  event names carry their own spaces and hyphens, so split on the comma-space and pick the
  leg whose event fires from the surface's `path` file. A suggested key of the form
  `Viewed[path=/dashboard]` becomes two lines: `instrumented_by: Viewed` and
  `page_path: /dashboard`. Read the surface's `path` file to confirm that is where the
  live event fires. Event names live behind `EVENTS.*` constants in
  `packages/gp-webapp/helpers/analyticsHelper.ts` (client) or
  `packages/gp-api/src/vendors/segment/segment.types.ts` (backend); resolve the constant,
  then grep for it. For a path-qualified leg the page event fires from the route tracker,
  not the page component, so confirm the route tracker covers that path and keep the
  surface `path` on the page component. If the behavior's caveat mentions the old leg,
  rewrite it.
- `declared_leg_unmonitored`: add a surface to the behavior that points at the metric, or
  an `events:` row if no behavior owns the question, in the exact row shape Queue B's
  accept uses. Same `page_path` rule.

A finding's `event_key` may carry an `excluding` qualifier
(`Voter Outreach - Campaign Completed[excluding method=manual]`). That is a scope rule the
metric applies over one event, not a second call site, so **never mirror it onto a
surface**: the surface names the bare event and the two still match. `suggested` never
carries one, for the same reason. If the exclusion itself looks wrong, that is an
`anchored_on` change in gp-data-platform, which is case 2.
- `metric_undeclared`: either the pointer is misspelled (fix it against the sem file's
  `name:` values) or the metric is not governed yet. In the second case remove the
  pointer and tell the reviewer the metric is not an OKR until it is declared. Do not
  file a ticket for that; it is the semantic-layer owners' call.

Case 1 has no dismiss. A stale pointer is always wrong.

**Case 2, `declared_leg_dead_with_live_successor`.** Draft the change before asking:

```yaml
# in <metric>'s config.meta.anchored_on
- event: <event_key's event>
  era: historical   # <evidence.retired_date, else evidence.last_seen_date, else evidence.latched_since>
- event: <suggested's event>
  path: <suggested's path, when the key carries one>
```

Show the reviewer the draft, the `evidence` block, and the call site: read the surface's
`path` file and confirm the successor fires there at HEAD. Event names live behind
`EVENTS.*` constants in `packages/gp-webapp/helpers/analyticsHelper.ts` (client) or
`packages/gp-api/src/vendors/segment/segment.types.ts` (backend); resolve the constant,
then grep for it. `call_site_count` is blind for many events (DATA-2427), so read the
site, do not trust the count.

- **accept** → run **Resolve a drift end to end** below. The draft above is only the
  sem-file half. A successor usually needs a preparation PR first, and adding the leg
  without one can double count or miss rows. Record every gp-data-platform PR URL for
  the omni write-back body.
- **dismiss** → the reviewer says the successor is not part of the metric. Append to
  `dismissed:` in `monitored_events.yaml`:
  `- {event: "<suggested>", reason: "<reason>", date: "<run_date>", metric: "<metric>"}`
  and file nothing.
- **defer** → leave everything; it re-nags next run.

**Case 3, `live_instrument_not_declared`.** One question to the reviewer, verbatim:
"Should `<metric>` count `<event_key>`?"

- **yes** → draft an `anchored_on` addition (no `era`, just the new leg). Then ask
  whether the metric's `business_rule` already covers it. If it does, this is drift B
  and follows the case 2 accept path. If counting it changes what the rule says, it is
  drift A: stop, and tell the reviewer the business group has to rule on the new scope
  before any PR is drafted. Once they have, the `business_rule` change rides in the
  same sem PR as the leg, through **Resolve a drift end to end**. Never add the leg and
  leave a rule that contradicts it.
- **no** → the behavior answers a broader question than the metric. Append to
  `dismissed:` in `monitored_events.yaml`, keyed on the finding's `event_key`:
  `- {event: "<event_key>", reason: "<reason>", date: "<run_date>", metric: "<metric>"}`
  so it stops re-nagging, and add one sentence to the behavior's caveat naming the
  surface as outside the metric.
- **defer** → leave it. If the reviewer is not the metric's owner they may defer it to
  the semantic-layer owners; then the output is a Data backlog ticket (`901326391561`,
  same safe-payload discipline as Queue A) carrying the drafted addition. The drafted
  addition has the case 2 shape without `era`: `- event: <event_key's event>` plus
  `path:` when the key carries one. Write the draft into the omni PR body under a Queue C
  heading; that is its home when no ticket is filed.

Never decide a case 3 yourself.

Rows of kind `declared_leg_changed_by_pr` come from `intents:` rows a PR wrote to clear
an analytics guard block. Draft the `anchored_on` change the headline names, exactly like
any case 2. `intent_row_resolved` means the upstream change landed: delete that `intents:`
row in this triage PR. Every `not_a_change` row is a possible guard false positive: check
the PR, and if the guard was wrong, file the fix. An `intents:` row with no `metric:` is a
PR reporting a dead listing the guard got wrong; it is not a metric change, so Queue C
never shows it. Whenever this PR touches `monitored_events.yaml`, look for such rows: file
the guard fix, then delete the row. An `intent_row_resolved` also appears when the metric
keeps the event only as a historical leg, since the guard no longer watches it either.

### Resolve a drift end to end

The procedure behind every case 2 accept, every case 3 yes, and every standalone drift.
Steps 1 to 6 are read-only and come before any plan is shown to the reviewer. Bring the
reviewer the findings of steps 3 to 6 and the drift type **before** building anything:
a specified change still leaves decisions that are theirs.

Queries below run from `<runbooks>/scripts/python` as
`PYTHONPATH=. uv run python -c "import databricks_oauth as dbc; print(dbc.run_query('''<sql>''').to_string())"`.
Keep `.to_string()`: pandas otherwise elides columns, and the elided column is usually
the one that matters. The events table is `dbt.stg_airbyte_source__amplitude_api_events`;
`:` property paths are case-insensitive.

1. **Name the drift** (A, B or C, per the SOP), or confirm the type the case above
   already gave it (a case 2 accept is B, and so is a case 3 yes whose `business_rule`
   already covers the event). For A or C, continue only once the business
   group's ruling is in hand: stop and wait if it is not, and carry on if it is. A rename can hold a C inside a
   B; step 5 is where that surfaces, and it stops there.

   **For drift A there is no old-to-new name map**, so steps 3 to 6 read differently.
   Step 3 pins the dates of the cliff that prompted the ruling and cross-checks them
   against the product DB, so "the event broke" and "usage stopped" are told apart.
   Step 4 is skipped unless a leg is being retired. Steps 5 and 6 become an inventory:
   every event that fires for each channel the ruling names, its call sites, the
   property that separates the products (`product`), and every reader of the
   metric's flag. A flag can feed a second metric that nobody asked to change (on
   DATA-2609, `is_active_serve_user` also gated the People Served cohort), so name
   each one and let the reviewer decide whether it follows.
2. **Read every gotchas book** in full: `books/analytics-governance-gotchas.md` here,
   and **both** of gp-data-platform's product books,
   `.claude/skills/win-analytics-knowledge/references/gotchas.md` and
   `serve-analytics-knowledge/references/gotchas.md`. The outreach events are shared
   across products, so a trap recorded under one applies to the other: read both,
   whichever product the metric is for. A shared cross-product book is being split
   out of the two (path TBD).
   After drafting the plan, check it against them row by row and say which rows
   applied. On DATA-2584 this check found four defects in a plan drafted without it.
3. **Pin the dates** from the warehouse, and the prod release from `release.yml`, not
   from a ticket:
   ```sql
   select event_type, min(event_time) first_t, max(event_time) last_t, count(*) n
   from dbt.stg_airbyte_source__amplitude_api_events
   where event_type in ('<old>', '<new>') and event_time >= '<cutover minus 14 days>'
   group by 1
   ```
   Read `max(event_time)` over the whole table as the freshness edge; the warehouse lags
   Amplitude, and Amplitude's taxonomy (descriptions, merges) is read live.
4. **Prove removal, three ways, before any `era: historical`:**
   ```bash
   git show <change-sha>^:<registry file> | grep -n '<old>'          # present before
   git grep -n '<old>' origin/main -- packages/gp-webapp packages/gp-api   # absent now
   grep '<old>' instrumentation_data/amplitude_event_provenance.csv    # retired_commit / retired_pr
   ```
   The registry file is `packages/gp-webapp/helpers/analyticsHelper.ts` (client) or
   `packages/gp-api/src/vendors/segment/segment.types.ts` (backend). Also search for a
   composed name (`'<prefix> - ' +`, a template literal). If the three disagree, the
   event is not retired; the leg stays live.
5. **Diff the properties, in code and in data.** Keys first, then the values of every
   property an `excluding` qualifier or a de-duplication key reads:
   ```sql
   select event_type, event_time >= '<cutover>' as post, k as property_key, count(*) n
   from dbt.stg_airbyte_source__amplitude_api_events
   lateral view explode(json_object_keys(event_properties)) as k
   where event_type in ('<old>', '<new>') and event_time >= '<cutover minus 14 days>'
   group by all order by 1, 2, 3
   ```
   ```sql
   select event_type, event_time >= '<cutover>' as post,
     event_properties:<qualifier>::string q, event_properties:<channel property>::string ch,
     count(*) n, count(distinct user_id) users
   from dbt.stg_airbyte_source__amplitude_api_events
   where event_type in ('<old>', '<new>') and event_time >= '<cutover minus 14 days>'
   group by all order by 1, 2, 3, 4
   ```
   Then read every call site of the new event and note the qualifier value each sends,
   including paths with no rows yet. Two questions: does each `excluding` still exclude
   exactly what it did, and does every key a model de-duplicates on still exist? A path
   that now passes a qualifier it used to fail (or the reverse) and is not named by the
   rule is **drift C**: stop and take it to the reviewer. So is a **new key that splits
   the population** (`product: win|serve`, `fanout`) where the old event could not tell
   the groups apart: counting it as before is the status quo, but it is now a choice,
   and the reviewer makes it. Once the business group has ruled, carry on from step 6
   with the ruling as part of the plan. The macros compile only `method` and `product`
   exclusions (`is_outreach_activation_event`, `product_output_predicate`), so a group
   separable only by another property cannot be excluded without a macro change.
6. **Find every reader, more than one way**, in both repos:
   ```bash
   # gp-data-platform
   git grep -n -e '<old>' origin/main
   git grep -n -e metric_anchored_events -e is_outreach_activation_event \
     -e is_product_output_event -e is_dashboard_view_event -e amplitude_event_is_recurrent \
     origin/main -- dbt
   git grep -n "like '<old prefix>" origin/main -- dbt/project/macros   # pattern classifiers
   # omni
   git grep -n -e '<old>' origin/main -- packages/runbooks packages/prototypes
   ```
   Macro-derived readers pick up a new leg on their own. Anything that names the event
   literally, keys on one of its properties, or pins the leg list in a test does not.
   **Tests that assert something about the metric are readers too**: an
   `expression_is_true` on `is_activated` encodes the old definition as surely as a
   literal does, and only fails in the CI build. Grep the yaml for the metric's flag
   and its columns (`git grep -n -e 'is_activated' -e 'total_campaigns_sent' -- '*.yml' '*.yaml'`)
   and read each test against the new rule.
   Then **measure the gap**: users whose only qualifying event since the cutover is the
   new name, split into headcount lost (never qualified otherwise) and activity lost.

   **Then put the reviewer's decisions to them as one batch**, before any plan. These
   four come up on every drift, and asked one at a time they cost a round each:
   - **Does the rule have more than one condition** (an AND, such as "sent a poll AND
     pledged")? Say which condition the change touches, and whether the others stay.
   - **Does the metric's flag feed anything else?** Name every other metric or cohort
     that reads it (a column, a gold view, a resolver). Changing it moves them too.
   - **Is any channel the rule names uninstrumented?** For each, say whether it is a
     definitional exclusion (nothing happens in the product) or a gap to ticket.
   - **Is the metric compiled from its declaration, or hard-coded in SQL?** If the leg
     list is only documentation, moving it onto a macro is part of the plan.

   Add anything specific to this drift to the same message, and stop until it is
   answered.
7. **Plan the PRs in the SOP's order** and show the plan. gp-data-platform branches are
   lowercase `data-<number>/<slug>` from `origin/main`, opened through that repo's `pull-request`
   skill, titled `[<TICKET>] …`:
   1. **Preparation PR (no `sem_*.yml`).** Literal readers, de-duplication and property
      fixes, `assert_*` tests. Intermediate yaml docs may ride here; a mart yaml
      (`m_*.yaml`) may not, because CI runs
      `dbt build --full-refresh --select state:modified+` and one mart description
      pulled 1,720 nodes. Merges first: the sem PR changes what these models count.

      Before opening it, from `dbt/project`:
      - **Size the rebuild:** `dbt ls --quiet --output name --resource-type model -s <each changed model>+`.
      - **Compare old and new against prod.** `dbt compile -s <model> --output json`
        on `main` and on the branch, pull `compiled` out of the JSON, and run both.
        Report total rows, users, and the post-cutover slice by channel. Any
        difference must be explained row by row.
      - **Repoint dev schemas first.** Compiled SQL resolves a `ref` to your
        `private_*` schema whenever an object of that name exists there, even a
        stale hand-made one, and says nothing. Grep the compiled SQL for `private_`
        and point each hit at `dbt` before running it.
      - **Know what prod cannot show you.** A model that reads a column the sem
        change itself recomputes upstream (the win_activity rollups read
        `is_recurrent` from the event catalog) runs against a stale prod copy of
        that column. Validate it in the CI build, and say so in the PR.
      - **A model whose SQL comes from the declaration is not "modified".** A model
        that compiles its legs from `anchored_on` through a macro changes what it
        computes when only the sem file changes, but `state:modified+` does not
        select it. Neither the PR's CI nor the merge-time job rebuilds it; prod
        picks up the new legs only on the next scheduled full build, while its
        downstream models rebuild at merge against the stale copy. Select it
        explicitly in the dev build, say so in the sem PR, and in step 8 check its
        `last_altered` before reading the value. DATA-2614 makes the merge job select
        these models; delete this note when it ships.
   2. **Sem PR.** Before editing any `sem_*.yml`, ask the reviewer, as its own question
      and nothing else: "This will change the semantic layer and notify people. Are you
      sure?" Then add the new leg, keep the old one with
      `era: historical   # <last fired>, removed in #<PR>`, update the pin tests in
      `analytics/tests/test_semantic_catalog_anchors.py`, and put
      `<!-- semantic-value: <metric> = <count> -->` in the body for each metric whose
      build moved, computed by query under the new legs. `description` and `known_gaps`
      change only if the rule's wording is now wrong; the rename itself belongs in the
      leg comment. Then, from `analytics/diagnostics`, run
      `uv run python -m semantic_catalog.cli --write` and commit the regenerated
      `canonical_metrics.md` projections, or the blocking catalog-freshness gate
      fails. Open it as a **draft**: a draft posts nothing, and the review groups
      are only notified when it is marked ready. **Never mark it ready yourself.**
      Ask the reviewer, as its own question, whether to mark it ready, and stop until
      they answer. Once it is marked ready, check `requested_reviewers`. While DATA-2593 is open
      the `routing` job cannot request teams (it fails with a 404), so add by hand
      exactly the teams its lane summary names, and no others:
      `gh pr edit <n> --add-reviewer thegoodparty/semantic-layer-data` and/or
      `thegoodparty/semantic-layer-business`.

      **Merged before review? Record the sign-off; never revert.** A revert is a second
      layer change and re-notifies both groups. Open a gp-data-platform PR that
      hand-authors the entries in
      `analytics/diagnostics/semantic_catalog/config/ratifications.yml`: each half's
      `approved:` is the date that group's first human approval lands, `approved_by_pr`
      is the ratification PR you are opening (never the sem PR that merged early), `rule_sha`/`build_sha`/`value_at_signing` come from the merged
      change, and a comment says why it is hand-authored. Request both teams. Merge only
      when each group has a human approval from a current member
      (`gh pr view <n> --json reviews` against
      `gh api orgs/thegoodparty/teams/<team>/members`); delegate-reviewer does not
      count. If an approval lands on a later date than the file says, correct that half
      first. After merge the publish run should print "nothing recorded; no PR to open",
      because the hand-authored entry already holds the sign-off. gp-data-platform #1123 (DATA-2584) is
      the worked example.
   3. **Mart docs PR**, only when an `m_*.yaml` description is now wrong (it names
      the old event, or describes the old rule). Open it after the sem PR merges, so
      the descriptions match what shipped, and keep it to `m_*.yaml` descriptions:
      it is alone because CI full-refreshes everything downstream of a changed mart
      (the 1,720 nodes above). It does not gate the omni PR.
   4. **omni PR**, from a fresh worktree off `origin/main`, after the sem PR merges:
      - **Refresh the OKR copy first:** `uv run python sem_anchors.py refresh-vendored`
        writes the merged sem files into `instrumentation_data/sem/` (the scheduled run
        does the same twice a week). Then
        `test_committed_registry_has_no_case_1_drift_against_the_okr_copy` lists every
        case 1 finding the next scheduled run would raise, offline. Edit until it passes.
        The parser fixture under `scripts/python/fixtures/` needs refreshing only when a
        test reads a leg from it.
      - **Case 1 edits** in `monitored_events.yaml`, per the kinds above. A rename can
        move the call site as well as the name, so read each new event's call sites at
        HEAD and repoint `path`, not just `instrumented_by`.
      - **Then grep the whole yaml for every old name.** Queue C only compares
        behaviors that carry a `metric:` pointer, so a behavior without one keeps
        pointing at the old event and the old file, and nothing reports it. Repoint
        those too; they are the same edit.
      - **Rewrite any caveat or surface the ruling overturned.** A surface with
        `instrumented_by: null` and a comment saying a channel is excluded by
        definition is exactly what a definition change makes false.
      - **Tests naming the old leg stay** while the leg is declared `era: historical`;
        they are still true. Add one for any new qualifier the parser has to keep.
      - **Anchors:** keep the old names' rows, and draft the new names with
        `event_anchors.py --only "<new names>"` (`ANTHROPIC_API_KEY`), then
        `--review-artifact`. They land queued, not accepted. For an event with several
        call sites, check the judge's `evidence` against the metric's exclusions: it can
        pick the one call site the metric excludes (the self-report modal, on
        DATA-2584).
   5. **Watching CI.** Read the dbt Cloud run itself
      (`/api/v2/accounts/<acct>/runs/<run>/?include_related=["run_steps"]`, token in
      `~/.dbt/dbt_cloud.yml`, never printed): the GitHub badge lags the run by minutes
      and names no failing node. Write the watch so a GitHub API error retries rather
      than ending the loop, or a blip reads as silence. **Read delegate's latest verdict
      on every poll, never the first one you see.** Delegate can post a second review on
      the same commit that contradicts the first ("approve", then "request changes"), and
      as a COMMENTED review it does not clear GitHub's approved state, so a watch that
      latches on the first verdict merges over open findings. Re-read it immediately
      before merging.
8. **After merge, verify:** the ratification follow-up PR opened, the catalog
   regenerated, the prod value matches the `semantic-value` line, the digest's
   `okr_anchor_dormant` latch for the old leg cleared, and anything predicted during
   planning (no step at the cutover, no double count) re-measured. Read the latch from
   `latches` in the committed `analytics_event_health_state.json` before and after the
   first scheduled run past the merge, not from the digest text alone. Compare each
   table's `last_altered` against the merge time first: a mart can rebuild before an
   upstream it reads, and then it still shows the old value. Confirm the mart docs PR
   (step 7.3) merged, or say why no `m_*.yaml` description needed it. Then update the
   docs that describe the metric, and move the ticket to done with a resolution comment.

## Diagnose — red/yellow health items

Runs when the digest has a 🔴/🟡 tier and the reviewer wants the story, not just the
flag. Purpose: turn "event X flatlined" into a classified cause, a named owner, and a
paste-ready follow-up message — without the reviewer hand-steering the sleuthing.
(Origin: DATA-2278; the 2026-08-11 session that diagnosed a serve funnel break and a
flag-rollout retirement is the reference run.)

**Load the report first** — if `run_date` is not already set (i.e. Diagnose is
running standalone, not as part of a full triage session), establish it first via the
**Load context** steps above (Slack read or bare date argument). Then anchor the
working directory:

```bash
cd <runbooks>/scripts/python
```

Resolve the health-report JSON the same three-way way Queue B does: local
`instrumentation_data/analytics_event_health_report.json` if its `run_date` matches
this run (it's gitignored, so a local copy may be stale — check, and if it predates
the run, delete it and re-download); else find the `analytics-governance` CI run whose
date matches `run_date` (`gh run list --workflow analytics-governance.yml --limit 20
--json databaseId,createdAt` — `createdAt` is a full ISO 8601 datetime, so match on
its first 10 characters, not the whole string), then `gh run download <run_id> --name
analytics-event-health-report --dir instrumentation_data` and verify the downloaded
report's `run_date` field matches before proceeding (if not, fall through); else
recompute live with `analytics_event_health.py --today "$run_date" --no-log --json …`
(needs Databricks OAuth; `--no-log` because this is a read-only recompute, and
without it the run rewrites the git-tracked health log and state file that the
scheduled run authors).

**If all three paths fail** — stale local file, no CI run matching `run_date`, and no
Databricks OAuth for the live recompute — stop and say so: name the `run_date` you
couldn't load a report for, and point at `docs/databricks.md` for credentials or a
manual artifact download. Do NOT enter the steps below without a resolved report; the
whole diagnosis is read off `records`, so guessing fabricates it.

The report's `flagged` + `records` arrays are the input (each record carries
`anomaly` current/baseline, `last_seen_date`, `event_count_30d`, `call_site_count`,
`instrumented_pr`, `divergence`). Per flagged item, in order — each step narrows
what the next one has to explain:

1. **Sibling-cliff comparison** (localizes the break). From `records`, print every
   event sharing the flagged event's name prefix (and family) with `last_seen_date`
   and 30d count. Events dying on the SAME date share one cause at their common
   surface; healthy siblings bound where the flow still works. A mid-funnel split
   (early steps alive, terminal steps dead same-day) reads as a break; a whole
   correlated cluster draining over days after a date reads as a rollout.
2. **Call-site check**. Resolve the registry entry (`analyticsHelper.ts` EVENTS map
   or `segment.types.ts`) to its trackEvent call site(s); confirm it's live at HEAD
   and note every condition gating it (flag cohorts, success-only paths, terminal
   guards). Don't trust `call_site_count` alone — read the site.
3. **Git archaeology at the cliff**. `git log` the call-site file AND its
   gating/routing code around the last_seen cliff (±1 week). No code change at the
   cliff moves suspicion to config, flags, or traffic — that's signal, not a dead end.
4. **Flag check** (Amplitude MCP). For every flag key the gating code references:
   `search` entityTypes FLAG/EXPERIMENT, then `get_flags` and compare
   `lastModifiedAt` against the cliff date. Prod project is `694490`, dev is
   `703396` — read both; a prod rollout edit at the cliff is the usual smoking gun
   for intentional retirement.
5. **Owner attribution**. Commit author or flag `lastModifiedBy`. Before naming
   anyone in a draft, verify they're still at the org (recent commit activity, or
   just ask the reviewer) — a message addressed to someone who left is worse than
   no name.
6. **Classify and hand off.** Two verdicts:
   - **Genuine break** → lay out the evidence and offer to file a ClickUp ticket
     (Data backlog `901326391561`, same safe-payload discipline as Queue A).
   - **Intentional retirement/supersession** → name the succeeding events, then
     recommend the follow-up by event kind. For **`analyticsHelper.ts`
     (Amplitude/client) events**: tell the reviewer to run the `event-metadata`
     skill afterwards (supersede by migration/generation when there's no 1:1
     successor) — surface the skill name as the next action, do NOT invoke it from
     inside the diagnosis. For **`segment.types.ts` (backend) events**,
     `event-metadata` is out of scope — instead, file a ClickUp ticket in the Data
     backlog (`901326391561`) describing the retirement and the successor events,
     and surface it to the verified owner for follow-up. Status writes stay
     human-confirmed.

   Either way, END with a draft follow-up Slack message: one block per finding,
   the question on the FIRST line, evidence after, recipient = the verified owner.
   Deliver it paste-ready: copy it with `pbcopy` where available (macOS), else
   write it to a file and give the path — and show the text either way. Never
   post it (the no-Slack rule below applies here too).

Diagnosis is read-only — no state-file writes, no `monitored_events.yaml` edits, no
Amplitude writes. Its conclusions route through the existing disposition paths, a
ticket, or the reviewer's own follow-up message.

## Write back — one PR

Once all four queues are dispositioned:

1. **Propose gotchas-book updates for sign-off.** Same shape as Queue B's watchlist
   proposals: you propose, the reviewer picks, you apply. Never edit the book
   unilaterally.

   Run through this session's rulings and collect anything that turned out to be a
   **tooling artifact rather than a product finding** — our counter blind, a window
   straddling a dated change, a provenance column that meant something other than its
   name, a judge that ruled on a premise the data does not support. Also collect any
   **existing row this session contradicted**: a `state · as-of` row whose numbers have
   moved, or one whose fix has since shipped.

   Present them as **"Proposed updates to the gotchas book, from this session"** — one
   block each, ready to paste:

   ```
   ADD     | <symptom, in the words a searcher would type>
   Mitigation: <one line, linking the owning book rather than restating it>
   Status:     invariant | state · as-of YYYY-MM
   Evidence:   <the queue item / event / measurement this came from>

   UPDATE  | <existing row>
   Change:     <what is now wrong, and the re-measured value>
   ```

   Then: list them with a one-line why each, and let the reviewer say yes / no / edit —
   **do not add unilaterally.** Apply only the approved ones to
   `books/analytics-governance-gotchas.md`, and skip any symptom already covered by a row.

   Two things to get right, because both are the point of the book:

   - **Name the row by the symptom, not by our vocabulary.** A row headed by a rank or a
     cause key is a row the next person cannot find — see the book's own maintenance rules.
   - **Re-measure before writing a number.** A figure carried over from a ticket or an
     earlier session is exactly the stale fact the Status column exists to flag.
   - **Check the fix has not already shipped, before proposing any row.** For every row you
     add or update, fetch the live status of each ticket it cites, and run
     `git log origin/main --since="$as_of" -- $row_paths`. Set `$as_of` to the first day of
     the row's `state · as-of YYYY-MM` month (`2026-09-01`) and `$row_paths` to the files
     the row names (e.g. `packages/runbooks/scripts/python/analytics_event_health.py`);
     confirm with `ls $row_paths` that they exist, because a path that matches nothing also
     returns an empty log and reads as "no fix". A
     row whose ticket is closed, or whose problem a merged PR already fixed, is a warning
     about something that is fine, and that is worse than no row: delete or correct it
     instead. A handoff is built from a snapshot, so the console you ruled in can predate
     the fix. 2026-09-30: two rows were added for problems fixed the day before, and two
     more still cited a ticket that had closed unbuilt.

   If nothing came up, say so in one line and move on. A session with no new traps is the
   normal case.

   **Updates to this book happen only here, with a human in the loop.** The scheduled
   Monday/Thursday runs read the book (it is pasted into both judges' prompts — see
   `governance_gotchas.py`) and never write to it.
2. `git status` should show at most `instrumentation_gaps.json` and (if Queue 0 had any
   cause dismissal, Queue B had any accept/dismiss, or Queue C had any case 1 edit or
   dismissal) `monitored_events.yaml` under
   `packages/runbooks/scripts/python/instrumentation_data/` /
   `packages/runbooks/scripts/python/`, plus `books/analytics-governance-gotchas.md` if
   step 1 added a row.

   **A Queue 0 `govern` produces no file change**, so an empty diff after a session of
   Govern writes is correct, not a sign the work was skipped. Do not go looking for
   something to commit.
3. Stage exactly those files.
4. Invoke the **`ship-pr`** skill to open one PR against `main`. Title it for the run,
   e.g. `chore(governance): triage <run_date> — gap + watchlist + alignment review`. In
   the body, list:
   - Queue 0: which causes were dismissed (with reason), which were ticketed (with
     ClickUp links), which were sent to Diagnose. **List the Govern writes separately
     and name the events.** A Govern write changes Amplitude, not this repo, so it
     appears in no diff — a reader who only reads the diff will conclude it did not
     happen. Record what was written, to which events, and the code-removal proof each
     one carried. Same for any per-event `reviewed`, which has nowhere to land yet and
     will be raised again next run. which gap ids were ticketed (with ClickUp links), which were handed to
     `instrument-analytics-event` (with the resulting event name/PR if different from
     this one), which were dismissed (with reason), which were deferred.
   - Queue B: which events were added to the watchlist, which were dismissed (with
     reason), which were deferred.
   - Queue C: which findings were edited in omni (behavior and surface), which produced a
     gp-data-platform PR (link), which were dismissed (with reason), which were deferred.
5. For each finding cleared this session, record in the PR body which analytics guard rule
   would have caught it at PR time, or `escaped`. A cause that escapes twice becomes a
   proposed guard rule in the same PR.

`ship-pr` handles branch creation, pre-flight, delegate convergence, and the check
gate — this skill's job ends at "stage the right files and describe the run."

## Idempotency & safety

- **Never post to Slack from this skill.** The self-load only reads
  (`slack_read_channel` / `slack_read_thread` / `slack_search_public`). Posting stays
  the scheduled governance workflow's job — an ad hoc post from a triage session would
  duplicate the digest and train the channel to ignore it.
- **Re-running this skill for the same run date must not double-file or double-edit.**
  Before acting on an accepted gap, check `is_actioned(entry)` — skip filing/
  instrumenting if it's already `True`.
- **Before appending any row to `monitored_events.yaml`**, check the target section
  (`events:` for accept, `dismissed:` for dismiss) doesn't already contain that
  `event` string. Appending blindly on a re-run would duplicate the row.
- **Queue C writes to two repos.** The omni edit and the gp-data-platform PR are separate
  PRs, and the omni PR body links the other. Never edit an omni pointer to make a case 2
  finding disappear; the finding disappears when the declaration changes.
- **Before appending a Queue C dismissal**, check `dismissed:` for the same `event` and
  `metric`.
- **Never edit product code directly** from this skill. Accepted gaps either get a
  ClickUp ticket or get handed to `instrument-analytics-event`, which owns naming,
  registration, and metadata.
- **Never hand-roll a YAML dump of `monitored_events.yaml`.** Edit it as text (append
  lines) so the header comments, section banners, and existing formatting survive.
