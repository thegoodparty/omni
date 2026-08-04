---
name: triage-instrumentation-gaps
description: Run the weekly instrumentation-governance review over two queues — instrumentation gaps (instrumentation_gaps.py) and watchlist proposals (analytics_event_health.py) — entered from the Slack governance digest, ending in one PR against develop. Use when the user says "triage instrumentation gaps", "/triage-instrumentation-gaps", "review the watchlist proposals", or picks up the digest's triage line.
---

# Triage instrumentation gaps

Weekly governance review over **two re-nagging queues** that share one reviewer, one
session, and one PR:

- **Queue A — instrumentation gaps** (`instrumentation_gaps.py`): candidate product
  surfaces the weekly sweep thinks are missing an analytics event.
- **Queue B — watchlist proposals** (`analytics_event_health.py`): catalog events in a
  watched family that aren't yet on the curated watchlist.

This skill orchestrates existing Python modules and two other skills. It never
re-implements enumeration, judgment, or proposal detection, and it never edits product
code directly — accepted gaps either get a ClickUp ticket or get handed to
`instrument-analytics-event`.

Background: DATA-2151 built the sweep, the state file, the sheet tab, and the Slack
digest; this skill (DATA-2152) is the missing disposition surface — the only way to act
on either queue used to be hand-editing raw JSON/YAML on GitHub.

## When to use

- The user says "triage instrumentation gaps", "/triage-instrumentation-gaps", or
  "review the watchlist proposals".
- The user pastes (or references) the Slack governance digest's triage line —
  `🛠 Triage: /triage-instrumentation-gaps <run_date>` — or a permalink to that message.
- Weekly cadence: this is the human review step that closes the loop the digest opens.

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

Never post to Slack during this self-load — it's read-only (`slack_read_channel` /
`slack_read_thread` / `slack_search_public`), never `slack_send_message`.

With `run_date` in hand, load both queues scoped to that run.

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

- **Empty batch** → say so ("no new instrumentation gaps this run") and skip straight
  to Queue B.
- **Otherwise**, offer **interactive** or **batch**; suggest **batch** once the batch
  has more than 5 items (walking >5 one-by-one in chat is worse than an editor pass).

Both modes write dispositions back through the **same path**: a filled review
artifact loaded via `--load-review`. There is exactly one write path into
`instrumentation_gaps.json` — interactive mode just fills the artifact itself instead
of asking the reviewer to open an editor.

**Interactive** (small batch):

1. `uv run instrumentation_gaps.py --today "$run_date" --review-artifact /tmp/gap-review-$run_date.md`
   writes one `## <id>` block per gap with blank `- disposition:` / `- reason:` lines
   (`render_review_artifact` → `render_seed_artifact`).
2. For each block, show the reviewer `rank`, `surface_type`, `location`, `rubric_rule`,
   `dashboard_question`, `judge_reason` and ask for a verb: **accept**, **dismiss** (nudge
   for a reason — that's the field that stops the re-nag), or **defer**.
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

**Verb → disposition mapping** (write the literal value into the artifact's
`- disposition:` line):

| Verb    | `- disposition:` value | Notes                                                          |
| ------- | ----------------------- | --------------------------------------------------------------- |
| accept  | `accepted`               | Then act on it (see below).                                     |
| dismiss | `dismissed`              | Always capture `- reason:` — suppresses from every future digest/sheet. |
| defer   | `open`                   | Collapses to a count line in the digest; re-reviewable later.    |

`apply_seed_dispositions` validates against `{new, open, accepted, dismissed}` and
skips (with a stderr warning) anything else, so don't invent other values.

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
   uv run analytics_event_health.py --today "$run_date" \
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
  self-suppressing, same as today).
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

## Write back — one PR

Once both queues are dispositioned:

1. `git status` should show only `instrumentation_gaps.json` and (if Queue B had any
   accept/dismiss) `monitored_events.yaml` under
   `packages/runbooks/scripts/python/instrumentation_data/` /
   `packages/runbooks/scripts/python/`.
2. Stage exactly those files.
3. Invoke the **`ship-pr`** skill to open one PR against `develop`. Title it for the
   run, e.g. `chore(governance): triage <run_date> — gap + watchlist review`. In the
   body, list:
   - Queue A: which gap ids were ticketed (with ClickUp links), which were handed to
     `instrument-analytics-event` (with the resulting event name/PR if different from
     this one), which were dismissed (with reason), which were deferred.
   - Queue B: which events were added to the watchlist, which were dismissed (with
     reason), which were deferred.

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
- **Never edit product code directly** from this skill. Accepted gaps either get a
  ClickUp ticket or get handed to `instrument-analytics-event`, which owns naming,
  registration, and metadata.
- **Never hand-roll a YAML dump of `monitored_events.yaml`.** Edit it as text (append
  lines) so the header comments, section banners, and existing formatting survive.
