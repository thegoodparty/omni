Detect flatlines / hard drops in key Win + Serve analytics events, then read the code to classify each drop as an intentional change or a likely break.

## Prerequisites

**scripts/.env variables**: `DATABRICKS_API_KEY`, `DATABRICKS_SERVER_HOSTNAME`, `DATABRICKS_HTTP_PATH`
**Tools**: `uv`, `git`, `ripgrep` (`rg`), a clone of the omni monorepo (this package lives in it)
**Setup**: `cd scripts/python && uv sync`

## What this does

A deterministic Python script finds events that have flatlined or dropped hard,
then you (the agent) investigate each one in the omni code to decide whether it was
a deliberate change or a broken/removed event. The script never reads code or posts
anywhere — it writes a JSON report you consume in stage 2.

The watchlist is `scripts/python/monitored_events.yaml` (curated Win + Serve onboarding
+ activation events). It is a subset on purpose; the script also reports newly-instrumented
events in the watched families so you can recommend additions.

## Stage 1 — run detection

```bash
cd scripts/python
uv run analytics_event_health.py
```

Writes `analytics_event_health_report.json`, prints a markdown summary, and appends
that markdown to a growing history at `event-health-log.md`. Useful flags:

- `--end-date YYYY-MM-DD` — run "as of" a past date (replay / backfill).
- `--window-days 90` `--recent-days 7` — baseline vs. recent comparison windows.
- `--drop-fraction 0.25` — hard-drop threshold (recent rate < fraction × baseline rate).
- `--min-active-volume 10` — baseline volume floor below which an event is treated as
  too sparse to flag.
- `--no-git` — skip the (best-effort) git lookup that finds when each event string was
  instrumented; use it if the run feels slow.
- `--log PATH` / `--no-log` — where to append the markdown history / disable appending.

The report has three sections: `flagged` (each with daily series, `first_seen_date`,
`last_seen`, `drop_start_date`, an `instrumented` commit {date, pr}, a `code_status` /
`still_in_code` / `last_code_change`, and same-family `candidate_replacements` each
carrying their own `first_seen_date` + `instrumented`), `healthy`, and
`new_events_in_watched_families`.

`code_status` is the strongest deterministic signal — it greps the event's `trackEvent`
string in gp-webapp/gp-api at HEAD:

- **`removed`** — the instrumentation was deleted/renamed. The drop is *explained*;
  `last_code_change` is the removing commit/PR. If its date ≈ `last_seen`, classify
  **intentional** with high confidence (still note whether a replacement is firing).
- **`present`** + a flatline — the call site is still in the code but not firing. Strong
  **likely break** signal (the registration regression was this). Go straight to stage 2
  step 2 to find what upstream change stopped it reaching the call.
- **`not_found_in_code`** — the literal isn't in those packages (legacy/raw event name or
  built dynamically); fall back to a manual `rg` with a looser pattern.

## Stage 2 — investigate each flagged event in code

For every event in `flagged`, use its `code_string`, `drop_start_date`, and `last_seen`:

1. **Find the instrumentation.** `rg -F "<code_string>" packages/` in the omni repo.
   Note where it fires (gp-webapp `trackEvent` or gp-api `AnalyticsService.track`).
2. **Look for a change in the drop window.**
   `git log -S"<code_string>" --since=<drop_start_date - 1wk> -- packages/` and inspect
   the diffs. A **removal or rename** of the string is strong evidence the drop was
   intentional. Note the PR/commit.
3. **Confirm a replacement.** Check each `candidate_replacement` (a new event in the same
   family): does its string get **added in the same PR** that removed the old one? If so,
   it's a rename → replacement.
4. **Classify** the finding:
   - **intentional redesign** — code change found AND a replacement event is firing.
   - **intentional continuity-gap** — code change found, no replacement firing (the old
     metric just stopped; dashboards relying on it are now blind).
   - **likely break** — no code change explains the drop. This is the loud one (the
     registration regression was this case).
5. Record event, classification, confidence, the drop magnitude/dates, and supporting
   PR/commit + replacement links.

## Stage 3 — heal the watchlist (review + agree on additions)

`new_events_in_watched_families` is the proposal queue: events that started firing in a
watched family but aren't on the watchlist yet (newest first). The report also prints a
**Ready-to-paste watchlist rows** block with each one pre-formatted as a YAML row.

The agree-and-add loop:

1. **Triage by decision criteria.** Add an event if it's a real funnel/activation
   milestone — a completion, conversion, or distinct step (e.g. a new onboarding screen,
   `… Completed`, `… Submitted`). Skip pure UI micro-interactions (individual hovers,
   button clicks, repeated sub-steps) unless one is a key conversion. Lifetime volume and
   `instrumented` PR help: a brand-new step from a recent onboarding PR is a strong add.
2. **Confirm in code.** `rg -F "<event>" packages/` to verify it's genuinely instrumented
   (not a one-off or a typo'd duplicate) and to see where it fires.
3. **Present for sign-off.** List the candidates you recommend with a one-line why each,
   and ask the human to confirm which to add (they pick; you don't add unilaterally).
4. **Apply.** For the confirmed ones, paste the matching rows from the ready-to-paste
   block into `scripts/python/monitored_events.yaml` under `events:` and surface the diff
   for final approval. Set `product`/`family` from the report; fill `owner` if known.

Over time this keeps the watchlist current as the funnels evolve, without anyone
hand-maintaining a list of event names.

## Output

Write a findings report: flagged events with classification + links, and proposed watchlist
additions. (Future: post to Slack and optionally open a fix PR — see DATA-1952 phase 2.)

## Troubleshooting

- `ERROR: Databricks env vars not set` → the three `DATABRICKS_*` vars aren't in the shell.
  Confirm `scripts/.env` (or your global env) has them and 1Password is unlocked.
- Everything looks flat / recent rates near zero across the board → likely the
  Amplitude→Databricks sync is lagging. Bump `--lag-days` and re-run.
- A low-volume Serve event flags often → raise its `floor` in the watchlist or
  `--min-active-volume`; sparse events are inherently noisier.
