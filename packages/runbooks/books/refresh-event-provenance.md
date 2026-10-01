Regenerate the committed Amplitude event git-provenance dataset (the curated summary of instrumentation-related git events in this repo) and open a PR with the refreshed file. This is the fallback/audit path; the instrument-analytics-event skill keeps rows fresh per-PR, and the host repo's `analytics-governance` GitHub Actions workflow runs this walk on a weekly schedule (the scheduled walk is the authoritative writer of the CSV; see that workflow's header for the state story). The engine is `scripts/python/amplitude_event_provenance_backfill.py`; this runbook is the orchestration around it.

## Prerequisites

**Tools**: `uv` (runs the engine from `scripts/python/`), `gh` (authenticated, push access), `git`.
**Databricks**: one read per run (the event universe from `goodparty_data_catalog.mart_analytics.amplitude_taxonomy_event_type`). Auth is OAuth via the SDK profile in `~/.databrickscfg` (`databricks auth login`) — the analytics standard, no PAT. Set `DATABRICKS_HTTP_PATH` in `scripts/.env` and pick the profile with `DATABRICKS_CONFIG_PROFILE` if it is not the default. If a run errors with an empty-host / auth error, run `databricks auth login` and retry.

## Steps

1. **Branch.** From an up-to-date `main`, create `chore/refresh-event-provenance-<YYYY-MM-DD>`. Never commit to `main` directly.
2. **Run the walk** from the repo root:
   ```sh
   cd packages/runbooks/scripts/python && uv run python amplitude_event_provenance_backfill.py walk
   ```
   It auto-detects: no state file means a full backfill, a state file means an incremental walk of `last_sha..origin/main`. It rewrites `instrumentation_data/amplitude_event_provenance.csv` and `..._state.json`. The walk targets `origin/main` and fetches it first.
3. **Verify before committing.**
   - Read the stderr summary `N rows (present=…, removed=…, not_found_in_code=…)`. `N` should be ~430+. If it collapsed toward zero, stop and investigate rather than commit.
   - `git status --porcelain` shows only the two `instrumentation_data/` files. Any path outside `instrumentation_data/` means stop.
   - If `git status` is clean (no new commits since the watermark), there is nothing to refresh — delete the branch and finish without a PR.
4. **Commit and open a PR.** Commit the two data files; push; open a PR summarizing the row delta. Commit message ends with the co-author trailer:

   ```
   chore(analytics): refresh Amplitude event provenance dataset

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```

5. **Report** the PR URL.

## Notes

- **Idempotent and self-catching-up.** The watermark is the last processed commit SHA, so a missed or failed run is harmless: the next run walks a larger window and catches up.
- **Skill vs walk.** The instrument-analytics-event skill writes _provisional_ rows (PR link + date, blank merge SHA) as PRs are authored. This walk upgrades them to exact (real merge SHA + date) and catches any event added/removed without the skill being run. A state-only rebuild — delete `instrumentation_data/amplitude_event_provenance_state.json` and re-run, keeping the CSV — re-walks history but preserves provisional rows the skill wrote for not-yet-merged PRs (git at `origin/main` can't see those commits yet, so the backfill carries the provisional entry forward). Do **not** delete the CSV file itself while such PRs are open: that discards their provisional rows, which would then have to be re-upserted.

## Provenance CSV columns

Core columns produced by the backfill walk:

- `retired_date` / `retired_commit` / `retired_pr` — when the event's **name** left the
  codebase. Written only when the name string is absent from the instrumentation paths
  at HEAD and the walk has history for it (`classify_code_status` returning `removed`).
  It is silent about whether anything still *calls* that name.
### Removing an event is two steps, and these columns report different ones

Read `retired_date` and `call_site_count` together or neither makes sense. They are not
two views of one fact; they are two stages of the same removal.

1. **The call site goes.** `call_site_count` drops from 1+ to `0`, and
   `call_site_retired_date` gets the date. The name is still in the registry.
2. **The name goes.** Now there is no key-path left to count, so `call_site_count`
   becomes **empty** — not `0` — and `retired_date` / `retired_commit` / `retired_pr`
   are written.

`retired_date` is therefore set only when the event's **name** has left the
instrumentation paths at HEAD (`classify_code_status` returning `removed`). It says
nothing about whether anything still calls that name.

**The two can never both be set.** A zero count beside an empty `retired_date` is a
half-finished removal, not a conflict. Measured 2026-09-29 over 664 rows:

| `call_site_count` | `retired_date` | rows | stage |
| --- | --- | --- | --- |
| 1+ | empty | 372 | live |
| `0` | empty | 39 | call site gone, name left behind |
| empty | set | 162 | both gone |
| empty | empty | 91 | no resolvable key-path (dynamic dispatch, fired outside this repo, or never built) |

**Never read an empty `retired_date` as evidence the instrument is live.**
`classify_status` does exactly that — `if retired_date is None: return "active" if
firing_recent else "dormant"` — so all 39 stage-1 events are classified as *code
present* and can never reach `retired`. That is the blind spot DATA-2046 opened rank 2
to close. Worked example 2026-09-29: `Onboarding V2 - Strategic Landscape Displayed` is
declared at `packages/gp-webapp/helpers/analyticsHelper.ts:799` and its caller was
deleted in `e5e863545` (2026-09-01).

The plain-words version, for searching: **"still in the code" means the name is still
there, not that anything sends the event.**

- `call_site_count` — number of `EVENTS.X.Y` call sites at the deploy ref (non-test
  instrumentation paths). Key-paths resolve from BOTH registries — `gp-webapp`'s
  `helpers/analyticsHelper.ts` and `gp-api`'s `src/vendors/segment/segment.types.ts` —
  and an event declared in both sums their counts. `0` = declared but uncalled; empty =
  no resolvable key-path, which now means only a dynamic-dispatch event or one fired
  from outside this repo (vendor autocapture, gp-marketing).
- `call_site_retired_date` — date the call-site count last dropped to zero, populated only
  when `call_site_count` is `0`. Resolved by one full-history walk that reads every
  commit's diff as two blocks and records the latest one to net-remove each key-path;
  matching the block rather than each line is what makes a Prettier-wrapped key-path
  (`EVENTS.A.B\n  .C`) visible. Comments are stripped first, so deleting prose that names
  a key-path never stamps a date.
- `call_site_retired_commit` / `call_site_retired_pr` — that same removing commit and the
  PR that merged it, so a Govern retirement is handed its code-removal proof. The PR
  comes from the commit subject, else the merge walk, which skips a branch's own
  "merge main into me" merges. For grafted history the walk keeps the oldest-merge rule
  only, because those commits cannot be checked against GitHub; empty beats a guess.
- `instrumented_author_email` / `retired_author_email` — git author email (`%ae`) of the
  commit that instrumented and the commit that retired the event, for follow-up. Empty when
  the event is still in code (no retirement) or predates the walk window.
- `instrumented_pr` / `retired_pr` — full GitHub link to the PR that added and removed the
  instrumentation. **The link is not always an omni PR.** omni's history was grafted from the
  predecessor repos, so a grafted commit's squash subject carries the *source* repo's `(#N)`
  and the link points there (`thegoodparty/gp-webapp/pull/708`, say). Which repo a commit came
  from is read off the `sync(<repo>)` graft merges, not off a cutover date — the predecessor
  repos kept syncing in after omni's first PR, so an imported commit can be dated later than
  the cutover. Every write re-derives this, so a link stored under the wrong repo heals on the
  next walk; the skill's single-row `upsert` has no history to consult and leaves existing
  links alone.

## Troubleshooting

- `Databricks profile resolved an empty host` / auth error → run `databricks auth login` (and set `DATABRICKS_CONFIG_PROFILE` if not the default), then retry.
- `DATABRICKS_HTTP_PATH is not set` → set it in `scripts/.env` (`/sql/1.0/warehouses/<id>`).
- Summary row count near zero → bad universe read or empty walk; do not commit.
