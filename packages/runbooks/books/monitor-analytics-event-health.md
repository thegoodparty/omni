Reconcile every Amplitude event across three axes (declared intent, code presence, firing
volume), classify each against the analytics-event-change SOP status model, detect
firing-volume anomalies, track description-metadata completeness, and append a
severity-ranked digest to a longitudinal log. Then investigate the loud flags in code,
heal the watchlist, and hand metadata fixes to the event-metadata skill.

Source of truth for the lifecycle model: the Analytics event change SOP (ClickUp doc
`2ky4jq2q-110533` / page `2ky4jq2q-91453`).

**Scheduled run**: the host repo's `analytics-governance` GitHub Actions workflow runs the
monitor (with `--slack`) Mondays and Thursdays on the shared service identities, and commits
the log/state back via an auto-merge PR. The manual procedure below remains valid for ad-hoc
runs and for the stage-2 code investigation, which is agent work the schedule cannot do.

## Prerequisites

- **Auth**: Databricks OAuth via the SDK profile in `~/.databrickscfg` (`databricks auth login`).
  Set `DATABRICKS_HTTP_PATH` in `scripts/.env` and pick the profile with
  `DATABRICKS_CONFIG_PROFILE` if it is not the default. No PAT — the backfill shares this path.
- **`GP_DATA_PLATFORM_READ_TOKEN`** (DATA-2421): a read-only Contents token on
  `thegoodparty/gp-data-platform`, in 1Password under `Product-Analytics` / "GP Data
  Platform Read Token". `sem_anchors.py` uses it to read that repo's `sem_*.yml` over the
  GitHub API — the semantic layer this monitor derives its OKR watch set from. Without
  it, every OKR dormancy check (the latch, the qualified legs, the registry
  alignment check) disables itself for the run, and the digest says so with a red "OKR
  dormancy checks degraded" line rather than failing. A laptop run without the token
  now reads the sem files through the reviewer's own `gh` auth first, so it degrades
  only when that also has no access. `sem_anchors.py refresh-vendored` writes a committed
  copy to `instrumentation_data/sem/` on every Monday/Thursday run; the pre-merge
  **Analytics guard** (`governance_guard.py`, DATA-2432) reads only that copy, as it stands
  at the PR's merge base, never the network, so a PR check stays fast and a PR cannot edit
  away the leg it breaks.
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
3. **Firing** — the catalog (`mart_analytics.amplitude_event_catalog`) plus a trailing weekly
   aggregate of the event stream (`mart_analytics.amplitude_events`).

Scope is hybrid: every catalog event gets a status; the curated watchlist
(`monitored_events.yaml`) drives severity elevation and the self-healing proposal queue.

## Status model (SOP)

| Status | Code (CSV) | Firing | Digest treatment |
| --- | --- | --- | --- |
| active | `retired_date` empty | fired in 30d | none |
| dormant | empty | quiet 30d | "still intended?" (elevated for onboarding/activation) |
| deprecating | set | last fire on/before `retired_date`, within 30d holding window | informational (fresh retirees land here even while pre-retirement traffic still sits in the 30d count) |
| orphaned_firing | set | last fire *after* `retired_date` (+ small grace for deploy/pipeline lag) | highest severity, escalate |
| retired | set | quiet 30d+ | none |
| code_unknown | no provenance row, or a blank one | any | auto-tracked, fired from outside this repo, or never built; anomaly-watched only |
| instrumented_never_observed | found in code, not retired | never in catalog | possible broken instrumentation; flag once 30 days past `instrumented_date` (`NEVER_OBSERVED_GRACE_DAYS`). Before that it is counted in the digest as "too new to judge", not flagged. An undated row, or an elevated event (watchlist, onboarding, activation, compliance), gets no grace |
| system | n/a | n/a | auto-tracked (`page`, `[Amplitude] …`); anomaly-watched, never a status flag |

Severity ranks (0 = loudest): 0 OKR anchor dormant (latched), see DATA-2421, or counter
blind spot — zero call sites but firing normally, a tooling alert, see DATA-2106 · 1 orphaned-firing / declared-not-in-use-still-firing · 2 call-site
removed, name constant survives (DATA-2046) · 3 anomaly drop on an active elevated event · 4
anomaly drop on any active/system event · 5 intent divergence · 6 dormant elevated · 7
instrumented-never-observed, past its 30-day grace · 8 dormant (collapsed to a single tail line in the digest).

## Stage 1 — run the monitor

```bash
cd scripts/python
uv run analytics_event_health.py --no-log
```

Prints the dated digest section, inserts it newest-first at the top of
`instrumentation_data/analytics-event-health-log.md` (the growing longitudinal history,
below the header), and writes `analytics_event_health_state.json` (the flagged set, for
next run's changes-since-last-run diff, plus the OKR latch records — their sticky
pre-break reference survives only there). Useful flags:

- `--today YYYY-MM-DD` — run "as of" a past date (replay / backfill).
- `--json PATH` — also write the full per-event result JSON (gitignored; use it to dig into a flag).
- `--no-log` — print only: writes neither the log nor the state file, so an ad-hoc local
  run leaves the git-tracked `instrumentation_data/` files (the scheduled run authors
  them) untouched. Use it for every local run you are not deliberately writing state from.
- `--csv PATH` / `--watchlist PATH` / `--state PATH` — override the default locations.

Read the digest top-down: the dormant-OKR-anchor latch table and any "OKR dormancy checks
degraded" line first, then the priority flags table (ranks 0-7), then the dormant tail,
then changes-since-last-run, then metadata completeness, then watchlist proposals. The loud
ones (rank 1-2) are what you route to Eng/PM; everything else is awareness.

## Stage 2 — investigate a flag in code (on demand)

For a rank-1/2 flag, confirm what the firing axis is telling you by reading the omni code.
This is not part of the scheduled run (the code axis is the provenance CSV); it is the
follow-up when a flag needs a verdict.

**Known gotchas, pitfalls, traps, false positives and false negatives** in this process are
indexed as a symptom table in [analytics-governance-gotchas.md](analytics-governance-gotchas.md) —
scan it before ruling on any flag. The plain words are spelled out here on purpose: the
rank-0 and rank-2 sections below are two of the entries, and a search for "gotcha" or
"pitfall" does not find a section headed "Rank 0 — counter blind spot".

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

1. Confirm in git. The row's `call_site_retired_date` already names the day and
   `call_site_retired_pr` the PR (the event health console pre-fills it as the proof); the CSV's
   walk is wrap-tolerant, so trust it over your own search. To read the removing diff,
   pickaxe the **leaf key** (`git log -S'CheckGender' -- packages/gp-webapp`) rather than
   the dotted key-path: Prettier wraps a long path across lines, so `-S'EVENTS.<KeyPath>'`
   finds no commit even though the removal is there.
2. Decide the verdict to propose:
   - **Retired** — the call site was deleted and nothing replaced it.
   - **Superseded by <event>** — a new event took its place (cite it). Never guess; if a
     replacement is not evident in the diff, propose "retired" and note the uncertainty.
3. Present the proposal (event, verdict, removing PR/commit, date) for human confirmation.
4. On confirmation, hand off to the `event-metadata` skill to stamp the status in Amplitude
   Govern (dev + prod), embedding the PR/commit as code-removal proof. The monitor itself
   never writes a status.

Note: `call_site_count = 0` with the event **still firing normally** (active, no anomaly)
never reaches rank 2 — it surfaces as rank 0 instead (below). Rank 2 requires a firing
flatline (dormant, an anomaly drop on still-active code), **or** a 30-day window that
straddles the call site's removal: firing that all predates `call_site_retired_date` is a
fresh retirement draining, not a live event, so it takes the retirement path rather than
the canary (DATA-2427).

### Rank 0 — counter blind spot (DATA-2106)

These render in their own digest section and are kept out of the triage queue and the Slack post: a bug in our counter should not compete for attention with a product finding.

A rank-0 flag is a contradiction: the provenance CSV says zero call sites, but the event is
firing normally. A client event cannot fire without a call site, so the call-site counter is
blind to how the reference is written — not the event dead. Fix the counter, not the event:

1. Find the real reference: `rg -F "<leaf key>" packages/gp-webapp` (search the leaf key,
   e.g. `MediaRequested`, not the full key-path — the full path is exactly what the counter
   failed to see).
2. Identify the shape. Aliased (`const x = EVENTS.<prefix>`) and Prettier-wrapped key-paths
   are counted since DATA-2106, so a rank-0 flag means a NEW shape.
3. Extend `count_call_sites` in `scripts/python/amplitude_event_provenance_backfill.py`
   (tests first), re-run the walk, and confirm the count is non-zero.
4. Never route a rank-0 event into the rank-2 retirement propose-and-confirm flow.

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
   against live declared intent (the `gpmeta` field in the monitor's `--json` report). Since
   DATA-2426, `gpmeta` is non-null for any event with a description at all, so its mere
   presence no longer means a block was written — check `gpmeta.intent` and
   `gpmeta.supersession` specifically; a prose-only record leaves both null. If the
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

- Line 1: purpose (the question the event answers). When the description has no block at
  all, the whole description is the purpose — most events pre-date the block.
- `fires_on:` one plain-English line: the surface and the trigger.
- `url:` the product path, app named when it is not the candidate webapp.
- `supersession:` `original` | `supersedes <event>` | `superseded by <event> (reason)`.
- `in use: YYYY-MM-DD (#PR)` or `not in use: YYYY-MM-DD (reason, #PR)`.

Declared intent = the in-use / not-in-use line; lineage = the supersession pointer.

## Thresholds (SOP defaults, tunable, pending Eng confirmation)

Set as constants at the top of `analytics_event_health.py`:

- `DORMANT_DAYS = 30` — dormant cutoff and the deprecating -> retired holding window.
- `RETIREMENT_FLOOR_PCT = 0.05` — current week below this fraction of the trailing 4-week
  baseline = anomaly drop. The OKR-anchor latch does not use this floor: it has its own,
  tighter `LATCH_BREAK_PCT = 0.10` in `okr_latch.py`.
- `ABSOLUTE_FLOOR = 5` — baseline fires/week below which a fall to zero replaces the % rule.
- `MIN_BASELINE_WEEKS = 5` — need the current week plus four complete baseline weeks to judge an anomaly.
- `PROPOSAL_WINDOW_DAYS = 90` — surface watched-family events first seen within this window.

## Output

The committed durable artifacts are the longitudinal log and the diff state. The full JSON
report (`--json`) and the remediation payloads are gitignored transients. Route rank-1/2
flags + their stage-2 verdicts to Eng/PM.

### How to read the digest

**Flagged (by cause)** is the queue. One line per reason events were flagged, with the
event names under it, worst rank first. The unit is the decision, not the event: a deploy
that stranded twenty-two name constants is one ruling ("retire them or re-point them"), and
counting it as twenty-two made a week's queue look unworkable when it was eight or nine
calls. Events elevated as OKR-adjacent are named on the cause line as well, so one is never
legible only as part of a count.

**Per-event detail** is the same flags, one row each, folded into a `<details>` block. This
file is the longitudinal record, so every row a pass produced stays in it and a flag can
still be traced across weeks.

**Counter blind spots** sit in their own section, below the queue and outside it. They are
our call-site counter failing to see a reference, not a product finding, and they are not
posted to Slack. Fix the counter (see Rank 0 below).

A cause someone has ruled on is struck through and still counted, never removed. Dismiss
one by adding a `cause:` row to `dismissed:` in `monitored_events.yaml`:

```yaml
dismissed:
  - {cause: "call_site_removed@2026-09-01", reason: "retired with the outreach v2 cutover", date: "2026-09-25"}
```

The cause string is the one the digest prints after `@`, or the bare key for a cause with
no qualifier (`orphaned_firing`, `never_observed`). Everything the dismissal covers stays
in the JSON report and keeps its place in the count, so a cluster that keeps growing after
it was waved through is still visible.

`okr_anchor_dormant` and `counter_blind_spot` cannot be dismissed. The loader refuses
those two keys and the digest prints a "Dismissal refused" line naming the row, so the
findings under them stay live whatever the config says.

### Post the digest to Slack (`--slack`, DATA-2057 + DATA-2174)

Pass `--slack` to also push a priority-tiered digest to the analytics event-lifecycle Slack
channel: a parent message with **🔴 needs action**, **🟡 worth watching**, and an **ℹ️
informational** rollup, plus a threaded reply with the full detail (per-event anomaly
numbers, watchlist proposals, informational transitions, and the status breakdown). Each
item's tier comes from `digest_triage.py`: a deterministic rules pass (OKR flag, watchlist
membership, health rank) that a rubric-guided Claude judge may then move by one tier —
never demoting an OKR-anchored red item.

That judge, and the gap judge in `instrumentation_gaps.py`, are each **one forced-tool-call
request with a fixed system prompt** — no tools, no filesystem. So they cannot follow a
pointer to a doc; the text has to be in the prompt. `governance_gotchas.py` pastes the
**Judgment traps** table of
[analytics-governance-gotchas.md](analytics-governance-gotchas.md) into both, because both
rule before any human reads the digest and a trap the judge does not know about becomes a
tier or a confirmed gap nobody has reason to question (DATA-2575). Only that table: the
book's other half is tooling defects awaiting a Python fix and process rules about git
archaeology, none of which a judge can act on, so it stays out of the prompt (62% of the
file, and it would be paid twice a week). A missing or corrupt book degrades to the rubric
alone rather than failing the run. The judges only read it — the book is written in the
`/triage-instrumentation-gaps` review, with a human approving each row. The judge needs `ANTHROPIC_API_KEY` and reads its
model from `DIGEST_TRIAGE_MODEL` (default `claude-sonnet-5`); when the key is unset or the
judge call fails, the digest posts anyway on the deterministic rules tier, with a
`⚙️ triage judgment unavailable this run` line in the parent.

It is **quiet with one override**: nothing posts when no event was newly flagged, escalated,
or resolved, no new anomaly appeared, and no new instrumentation gap landed — **except** an
OKR-anchored event sitting in a breaking state, which posts every run until it resolves (a
one-time transition line scrolling away while the OKR sat broken for a month is exactly how
DATA-2174 happened). An event is OKR-anchored when the governed metric declares it under `config.meta.anchored_on`
in gp-data-platform's `sem_*.yml`. Nothing in this repo declares it. The red-persistence
rule and the rules-tier judge key off the `okr` field the monitor derives from that
declaration each run.

A declared leg can be **narrower than its event**, and then it is watched as its own
series under a qualified key rather than as the whole event:

- `path:` — one page-path slice of a site-wide event, `Viewed[path=/dashboard]`.
- `excluding:` — one event minus the property values the metric does not count,
  `Voter Outreach - Campaign Completed[excluding method=manual]`.

Either way the whole event keeps its own catalog row and its own weekly series; the
qualified key is an additional series, and only it carries the `okr` marker. This matters
because a whole-event watch reads healthy off traffic the metric never counted: the shared
outreach terminal kept its counts up on the self-report path after the in-product send
stopped firing on 2026-09-08, so watching the event would have said nothing. Qualified
legs have no Amplitude catalog record, so they are judged from their own weekly rows and,
when latched, appear in the digest as a synthesized `okr_anchor_dormant` row.

A latch reaches further than this digest. gp-data-platform's semantic catalog reads the
`latches` block of the persisted state file and marks that metric's **build approval as
needing re-verification** for as long as the leg is dormant, so a sign-off cannot go on
reading approved over an instrument that stopped firing. That makes `metric`, `since` and
`latched` a cross-repo contract rather than this monitor's private state: renaming one
turns the catalog warning off silently. Change it on both sides or not at all.

The `<!here>` mention on a red section can be overridden with `SLACK_EVENT_ALERT_MENTION`
(e.g. a subteam handle) so paging doesn't always go to the whole channel. The post happens
inline **before** the state file is advanced (the diff is consumed once state is written),
and is **non-fatal**: a Slack error prints a warning and never changes the monitor's exit
code. Needs `SLACK_APP_BOT_TOKEN` + `SLACK_EVENT_LIFECYCLE_CHANNEL_ID` in `scripts/.env`;
without them, `--slack` warns and skips while the monitor runs normally.

## Surface drift (DATA-2531)

A separate weekly detector, `surface_drift.py`, flags analytics events whose label — a
`surface:` tag, or the name prefix before `" - "` — no longer matches where the code can
fire them. It runs in the same `analytics-governance` job, right after the explorer
snapshot (`event_explorer_snapshot.py`), because it reads that snapshot's `surface:` tags
and `okr_metrics` and walks webapp routes through `event_reach.py`, the same module the
PR-time guard's `surface_moved` warning uses. It writes
`instrumentation_data/surface_drift.json`, which the event health console's surface queue
and the triage skill's Queue D read. Nothing here writes to Amplitude; an accepted row is
applied through the `event-metadata` skill's Mode: RELABEL.

### Verdicts

| Verdict | Condition | Goes to |
| --- | --- | --- |
| `moved` | Reachable areas exclude the area the label claims | Relabel proposal |
| `stale_area_name` | Same area by route, but the label uses a name the nav no longer shows, or a `surface:` tag names an area that no longer exists while the code resolves to one area | Relabel proposal, batched per prefix, lower priority |
| `dashboard_wide` | The event's code reaches 5 or more areas | Reported, nothing proposed |
| `moved_then_quiet` | `moved`, and zero fires in the last 30 days | A relabel proposal too, proposed confidence only — see below |
| `unclear` | Walk has gaps, no call site, or code and volume data disagree | A human |
| `consistent` | Otherwise | Nothing |

`moved_then_quiet` is a relabel proposal, never a flag: a quiet event still reachable on a
live page is usually a rare action, not a break, the same read as a dormant event
elsewhere in this book.

### Confidence

`high` (arrives pre-checked in the console) requires all of:

- a `moved` verdict, no walk gaps, exactly one reachable area;
- the label's claimed area provably dead for this event, with the removal commit named;
- the event is not counted by any semantic-layer metric (`okr_metrics` is empty);
- the page-path signal agrees: at least 0.8 agreement, at least 10 attributed fires, at
  least 0.5 attribution coverage, and at least 5 distinct users (`MIN_USERS`, added in
  calibration — a signal can clear every other floor on two people).

Everything else that is `moved` or `stale_area_name` is `proposed`: shown in the console,
not pre-checked, with the options laid out.

The page-path signal attributes each fire to the user's last `Viewed` event within 30
minutes. A page that emits few `Viewed` events of its own (Account Settings is the
measured case) reads low agreement and low coverage, which costs a missed `high` grade,
never a false one — attribution inherits the page the user came from, it never invents
the reached area.

### `meta.backend_not_examined` and `meta.unmapped_prefixes`

Backend (gp-api) events are out of scope; `meta.backend_not_examined` is how many were
skipped, so a clean run can be told from one that silently covered less.

`meta.unmapped_prefixes` lists name prefixes the detector could not match to any area and
that are not already a flow prefix — never guessed. For each, add a row in
`monitored_events.yaml`: to `flow_prefixes:` if it names a flow rather than a place (Pro
Upgrade, 10DLC, Navigation, …), or to `prefix_areas:` if it is a real surface the
detector's own name matching misses. A `prefix_areas:` alias **adds** the area it names to
the prefix's own name match — it does not replace it — because one prefix can span pages
with different area names: `Serve Onboarding` fires from both `/serve/onboarding`, whose
area is named only `onboarding`, and `/polls/onboarding`, named
`welcome-to-goodparty-org-serve-onboarding`; the alias covers the first without breaking
the second.

### Calibration (2026-10-02)

Calibrated against 14 known positives (the 5 DATA-2525 stale-area-name events, the 8
Running Against events, and the Settings upload event) and a 30-event sample of
`consistent` events across 14 areas. All 14 positives landed on the expected verdict and
zero negatives reached `high`. Two positives reached `high`: Settings - Personal Info:
Click Upload (96 fires, 73 users) and Profile - Running Against: Click Save (33 fires, 33
users). Median page-path coverage was 0.96 for positives and 0.94 for negatives —
coverage was not the binding constraint, agreement was. The user floor (`MIN_USERS = 5`)
was added during this pass: two Running Against events cleared every other floor on 14
fires from 2 users.

## Troubleshooting

- `Databricks profile resolved an empty host` / auth errors → run `databricks auth login`,
  confirm `DATABRICKS_HTTP_PATH` is set and 1Password is unlocked, open a fresh shell.
- Everything reads dormant / anomalous across the board → likely the Amplitude -> Databricks
  sync is lagging; the latest complete week is incomplete. Re-run once the sync catches up.
- A provenance-axis event looks wrong (e.g. `code_unknown` for a known event) → the CSV may be
  stale; refresh via `books/refresh-event-provenance.md`.
