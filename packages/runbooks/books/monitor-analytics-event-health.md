Reconcile every Amplitude event across three axes (declared intent, code presence, firing
volume), classify each against the analytics-event-change SOP status model, detect
firing-volume anomalies, track description-metadata completeness, and append a
severity-ranked digest to a longitudinal log. Then investigate the loud flags in code,
heal the watchlist, and hand metadata fixes to the event-metadata skill.

Source of truth for the lifecycle model: the Analytics event change SOP (ClickUp doc
`2ky4jq2q-110533` / page `2ky4jq2q-91453`).

## Prerequisites

- **Auth**: Databricks OAuth via the SDK profile in `~/.databrickscfg` (`databricks auth login`).
  Set `DATABRICKS_HTTP_PATH` in `scripts/.env` and pick the profile with
  `DATABRICKS_CONFIG_PROFILE` if it is not the default. No PAT — the backfill shares this path.
- **Tools**: `uv`, `git`, `ripgrep` (`rg`), a clone of the omni monorepo (this package lives in it).
- **Setup**: `cd scripts/python && uv sync`.
- **Code axis**: `scripts/python/instrumentation_data/amplitude_event_provenance.csv` must be
  current. If it looks stale, refresh it first via `books/refresh-event-provenance.md`.

## What this does

A deterministic Python script reconciles three axes and writes a digest. It never reads
application code and never writes to Amplitude; the code investigation (stage 2) and the
metadata writes (stage 4) are the agent's and the event-metadata skill's jobs.

The three axes:

1. **Declared intent** — the `gp-meta` block parsed from the Govern description
   (`in use` / `not in use`, `supersession`). Sparse today; where absent, fall back to code x firing.
2. **Code** — the provenance CSV: `retired_date` empty means the instrumentation is still in code.
3. **Firing** — the catalog (`int__amplitude_event_catalog`) plus a trailing weekly aggregate
   of the raw stream (`stg_airbyte_source__amplitude_api_events`).

Scope is hybrid: every catalog event gets a status; the curated watchlist
(`monitored_events.yaml`) drives severity elevation and the self-healing proposal queue.

## Status model (SOP)

| Status | Code (CSV) | Firing | Digest treatment |
| --- | --- | --- | --- |
| active | `retired_date` empty | fired in 30d | none |
| dormant | empty | quiet 30d | "still intended?" (elevated for onboarding/activation) |
| deprecating | set | quiet, within 30d holding window | informational |
| orphaned_firing | set | still firing | highest severity, escalate |
| retired | set | quiet 30d+ | none |
| code_unknown | no provenance row | any | auto-tracked or brand-new; anomaly-watched only |
| instrumented_never_observed | present, not retired | never in catalog | possible broken instrumentation; flag |
| system | n/a | n/a | auto-tracked (`page`, `[Amplitude] …`); anomaly-watched, never a status flag |

Severity ranks (1 = loudest): 1 orphaned-firing / declared-not-in-use-still-firing · 2 call-site
removed, name constant survives (DATA-2046) · 3 anomaly drop on an active elevated event · 4
anomaly drop on any active/system event · 5 intent divergence · 6 dormant elevated · 7
instrumented-never-observed · 8 dormant (collapsed to a single tail line in the digest).

## Stage 1 — run the monitor

```bash
cd scripts/python
uv run analytics_event_health.py
```

Prints the dated digest section, inserts it newest-first at the top of
`instrumentation_data/analytics-event-health-log.md` (the growing longitudinal history,
below the header), and writes `analytics_event_health_state.json` (the flagged set, for
next run's changes-since-last-run diff). Useful flags:

- `--today YYYY-MM-DD` — run "as of" a past date (replay / backfill).
- `--json PATH` — also write the full per-event result JSON (gitignored; use it to dig into a flag).
- `--no-log` — print only, do not write to the log.
- `--csv PATH` / `--watchlist PATH` / `--state PATH` — override the default locations.

Read the digest top-down: priority flags table first (ranks 1-7), then the dormant tail,
then changes-since-last-run, then metadata completeness, then watchlist proposals. The loud
ones (rank 1-2) are what you route to Eng/PM; everything else is awareness.

## Stage 2 — investigate a flag in code (on demand)

For a rank-1/2 flag, confirm what the firing axis is telling you by reading the omni code.
This is not part of the scheduled run (the code axis is the provenance CSV); it is the
follow-up when a flag needs a verdict.

1. **Find the instrumentation.** `rg -F "<event_type>" packages/` in the omni repo. Note where
   it fires (gp-webapp `trackEvent` or gp-api `AnalyticsService.track`).
2. **Look for a change in the window.** `git log -S"<event_type>" -- packages/` and inspect the
   diffs around the drop. A removal or rename of the string explains an intentional drop; note the PR.
3. **Confirm a replacement.** If a same-family event appeared in the same PR that removed this
   one, it is a rename -> replacement (Amplitude keys events by name, so a rename is a new event).
4. **Classify**: intentional redesign (code change + replacement firing) · intentional
   continuity-gap (code change, no replacement; dashboards now blind) · likely break (no code
   change explains the drop — the loud one).
5. Record event, classification, confidence, drop dates, and supporting PR/commit + replacement links.

### Rank 2 — call site removed, name constant remains (DATA-2046)

A rank-2 flag means the event's name is still declared in the `EVENTS` map
(`analyticsHelper.ts`) but it has zero `trackEvent(EVENTS.X.Y, …)` call sites and has
stopped firing. The provenance CSV shows `call_site_count = 0` and usually a
`call_site_retired_date`. This is a removed call site hiding behind a surviving constant —
not a silent break.

This flag's propose-and-confirm flow (never auto-decide):

1. Confirm in git: `git log -S'EVENTS.<KeyPath>' -- packages/gp-webapp` and read the removing
   diff. The key-path is the one resolved from the `EVENTS` map for this event name.
2. Decide the verdict to propose:
   - **Retired** — the call site was deleted and nothing replaced it.
   - **Superseded by <event>** — a new event took its place (cite it). Never guess; if a
     replacement is not evident in the diff, propose "retired" and note the uncertainty.
3. Present the proposal (event, verdict, removing PR/commit, date) for human confirmation.
4. On confirmation, hand off to the `event-metadata` skill to stamp the status in Amplitude
   Govern (dev + prod), embedding the PR/commit as code-removal proof. The monitor itself
   never writes a status.

Note: a rank-2 flag with `call_site_count = 0` but the event **still firing** does not occur
under the current rule (the flag requires a firing flatline); a genuinely still-firing event
with no callers would surface as an anomaly/orphaned-firing flag instead.

## Stage 3 — heal the watchlist (review + agree on additions)

The digest's **Watchlist proposals** section lists events that started firing in a watched
family but are not on `monitored_events.yaml` yet, as ready-to-paste YAML rows.

1. **Triage.** Add an event if it is a real funnel/activation milestone (a completion,
   conversion, or distinct step). Skip pure UI micro-interactions unless one is a key conversion.
2. **Confirm in code.** `rg -F "<event>" packages/` to verify it is genuinely instrumented.
3. **Present for sign-off.** List the ones you recommend with a one-line why each; the human
   picks. Do not add unilaterally.
4. **Apply.** Paste the agreed rows into `monitored_events.yaml` under `events:`; set
   `product`/`family` from the proposal, fill `owner` if known. Surface the diff for approval.

## Stage 4 — metadata remediation (description backfill)

The **Metadata completeness** section reports how many non-system events carry a description
and lists onboarding/activation/compliance events that are missing one (fill these first).
System/auto-tracked events are excluded — we do not curate those.

To remediate, produce a payload the devs can answer yes/no/edit, then hand the approved
entries to the event-metadata skill:

1. Build `instrumentation_data/event-metadata-payload-YYYY-MM-DD.yaml` (gitignored): one entry
   per event with the proposed `gp-meta` fields (purpose, supersession, in-use status),
   a confidence (confirmed / verify), the evidence, and a `decision:` field (yes / no / edit).
2. Get dev/PM answers. For each `yes`/`edit`, feed the entry to the **event-metadata** skill
   (`.claude/skills/event-metadata`), which writes the `gp-meta` block into the Amplitude event
   description (read-modify-write, dev + prod). Client (Amplitude) events only.
3. **Stamp the payload once written (double-write guard).** Immediately after the batch
   lands, add a `# WRITTEN: YYYY-MM-DD` line to the payload's top comment header. Payloads
   are gitignored and long-lived on disk, so a reviewed-but-unstamped payload is
   indistinguishable from an unwritten one. Conversely, before executing ANY payload: if the
   header carries a `WRITTEN` stamp, stop — and even without one, spot-check a few entries
   against live declared intent (the `gpmeta` field in the monitor's `--json` report). If the
   blocks already match the payload, the batch was already written; never re-run it.

## Stage 5 — refresh the consumer surface (independent, non-fatal)

After the monitor's run and log/state write-back (Stage 1), bring the event-state Google
Sheet current. Its status column is recomputed live from the underlying data, so this path
needs no override — a plain refresh is enough:

```bash
scripts/shell/refresh-event-state.sh
```

On a host without the shared Sheets credentials the wrapper exits 0 with `…not configured…;
skipping` — that is expected, not an error; the sheet is refreshed by whichever configured
host runs the monitor. If it fails for another reason, note it and continue — the monitor run
has already completed its own work; re-run the wrapper manually once the issue is resolved.
Do not fail the monitor run on a refresh error.

## gp-meta parsing spec (from the SOP)

Block delimited by `<!-- gp-meta -->` … `<!-- /gp-meta -->` inside the description:

- Line 1: purpose (the question the event answers).
- `supersession:` `original` | `supersedes <event>` | `superseded by <event> (reason)`.
- `in use: YYYY-MM-DD (#PR)` or `not in use: YYYY-MM-DD (reason, #PR)`.

Declared intent = the in-use / not-in-use line; lineage = the supersession pointer.

## Thresholds (SOP defaults, tunable, pending Eng confirmation)

Set as constants at the top of `analytics_event_health.py`:

- `DORMANT_DAYS = 30` — dormant cutoff and the deprecating -> retired holding window.
- `RETIREMENT_FLOOR_PCT = 0.05` — current week below this fraction of the trailing 4-week
  baseline = anomaly drop.
- `ABSOLUTE_FLOOR = 5` — baseline fires/week below which a fall to zero replaces the % rule.
- `MIN_BASELINE_WEEKS = 5` — need the current week plus four complete baseline weeks to judge an anomaly.
- `PROPOSAL_WINDOW_DAYS = 90` — surface watched-family events first seen within this window.

## Output

The committed durable artifacts are the longitudinal log and the diff state. The full JSON
report (`--json`) and the remediation payloads are gitignored transients. Route rank-1/2
flags + their stage-2 verdicts to Eng/PM.

### Post the digest to Slack (`--slack`, DATA-2057)

Pass `--slack` to also push a delta-led digest to the analytics event-lifecycle Slack
channel: a parent message with the status transitions + newly flagged/resolved events, the
anomaly/proposal headline, and the status breakdown, plus a threaded reply with per-event
anomaly numbers and the watchlist proposals. It is **quiet** — nothing posts when no event
was newly flagged, escalated, or resolved and no new anomaly appeared. The post happens
inline **before** the state file is advanced (the diff is consumed once state is written),
and is **non-fatal**: a Slack error prints a warning and never changes the monitor's exit
code. Needs `SLACK_APP_BOT_TOKEN` + `SLACK_EVENT_LIFECYCLE_CHANNEL_ID` in `scripts/.env`;
without them, `--slack` warns and skips while the monitor runs normally.

## Troubleshooting

- `Databricks profile resolved an empty host` / auth errors → run `databricks auth login`,
  confirm `DATABRICKS_HTTP_PATH` is set and 1Password is unlocked, open a fresh shell.
- Everything reads dormant / anomalous across the board → likely the Amplitude -> Databricks
  sync is lagging; the latest complete week is incomplete. Re-run once the sync catches up.
- A provenance-axis event looks wrong (e.g. `code_unknown` for a known event) → the CSV may be
  stale; refresh via `books/refresh-event-provenance.md`.
