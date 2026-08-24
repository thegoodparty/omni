---
name: triage-instrumentation-gaps
description: Run the weekly instrumentation-governance review over two queues — instrumentation gaps (instrumentation_gaps.py) and watchlist proposals (analytics_event_health.py) — entered from the Slack governance digest, ending in one PR against main. Also diagnoses the digest's red/yellow health items. Use when the user says "triage instrumentation gaps", "/triage-instrumentation-gaps", "review the watchlist proposals", picks up the digest's triage line, or asks to look into / diagnose a red, yellow, dormant, or flatlined event from the digest.
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
- The user asks to look into the digest's 🔴/🟡 items ("what happened to <event>",
  "diagnose the red item", "why did these flatline") — run the Diagnose section, in
  the same session as the queues or standalone.
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
recompute live with `analytics_event_health.py --today "$run_date" --json …` (needs
Databricks OAuth).

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

Once both queues are dispositioned:

1. `git status` should show only `instrumentation_gaps.json` and (if Queue B had any
   accept/dismiss) `monitored_events.yaml` under
   `packages/runbooks/scripts/python/instrumentation_data/` /
   `packages/runbooks/scripts/python/`.
2. Stage exactly those files.
3. Invoke the **`ship-pr`** skill to open one PR against `main`. Title it for the
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
