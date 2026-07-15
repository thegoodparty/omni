Regenerate the committed Amplitude event git-provenance dataset (the curated summary of instrumentation-related git events in this repo) and open a PR with the refreshed file. This is the fallback/audit path; the instrument-analytics-event skill keeps rows fresh per-PR, and the host repo's `analytics-governance` GitHub Actions workflow runs this walk on a weekly schedule (the scheduled walk is the authoritative writer of the CSV; see that workflow's header for the state story). The engine is `scripts/python/amplitude_event_provenance_backfill.py`; this runbook is the orchestration around it.

## Prerequisites

**Tools**: `uv` (runs the engine from `scripts/python/`), `gh` (authenticated, push access), `git`.
**Databricks**: one read per run (the event universe from `goodparty_data_catalog.dbt.stg_airbyte_source__amplitude_taxonomy_event_type`). Auth is OAuth via the SDK profile in `~/.databrickscfg` (`databricks auth login`) — the analytics standard, no PAT. Set `DATABRICKS_HTTP_PATH` in `scripts/.env` and pick the profile with `DATABRICKS_CONFIG_PROFILE` if it is not the default. If a run errors with an empty-host / auth error, run `databricks auth login` and retry.

## Steps

1. **Branch.** From an up-to-date `develop`, create `chore/refresh-event-provenance-<YYYY-MM-DD>`. Never commit to `develop` directly.
2. **Run the walk** from the repo root:
   ```sh
   cd packages/runbooks/scripts/python && uv run python amplitude_event_provenance_backfill.py walk
   ```
   It auto-detects: no state file means a full backfill, a state file means an incremental walk of `last_sha..origin/develop`. It rewrites `instrumentation_data/amplitude_event_provenance.csv` and `..._state.json`. The walk targets `origin/develop` and fetches it first.
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
- **Skill vs walk.** The instrument-analytics-event skill writes *provisional* rows (PR link + date, blank merge SHA) as PRs are authored. This walk upgrades them to exact (real merge SHA + date) and catches any event added/removed without the skill being run. A state-only rebuild — delete `instrumentation_data/amplitude_event_provenance_state.json` and re-run, keeping the CSV — re-walks history but preserves provisional rows the skill wrote for not-yet-merged PRs (git at `origin/develop` can't see those commits yet, so the backfill carries the provisional entry forward). Do **not** delete the CSV file itself while such PRs are open: that discards their provisional rows, which would then have to be re-upserted.

## Provenance CSV columns

Core columns produced by the backfill walk:

- `call_site_count` — number of `trackEvent(EVENTS.X.Y, …)` call sites at the deploy ref
  (non-test instrumentation paths). `0` = declared but uncalled; empty = no resolvable
  key-path (backend `AnalyticsService.track` or dynamic events — not covered).
- `call_site_retired_date` — date the call-site count last dropped to zero (targeted
  `git log -S` on the key-path), populated only when `call_site_count` is `0`.
- `instrumented_author_email` / `retired_author_email` — git author email (`%ae`) of the
  commit that instrumented and the commit that retired the event, for follow-up. Empty when
  the event is still in code (no retirement) or predates the walk window.

## Troubleshooting

- `Databricks profile resolved an empty host` / auth error → run `databricks auth login` (and set `DATABRICKS_CONFIG_PROFILE` if not the default), then retry.
- `DATABRICKS_HTTP_PATH is not set` → set it in `scripts/.env` (`/sql/1.0/warehouses/<id>`).
- Summary row count near zero → bad universe read or empty walk; do not commit.
