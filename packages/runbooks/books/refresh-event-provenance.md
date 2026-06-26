Regenerate the committed Amplitude event git-provenance dataset (the curated summary of instrumentation-related git events in this repo) and open a PR with the refreshed file. This is the fallback/audit path; the instrument-analytics-event skill keeps rows fresh per-PR. The engine is `scripts/python/amplitude_event_provenance_backfill.py`; this runbook is the orchestration around it.

## Prerequisites

**Tools**: `uv` (runs the engine from `scripts/python/`), `gh` (authenticated, push access), `git`.
**Databricks**: one read per run (the event universe from `goodparty_data_catalog.airbyte_source.amplitude_taxonomy_event_type`). `DATABRICKS_SERVER_HOSTNAME` and `DATABRICKS_HTTP_PATH` must be set. Auth is OAuth-first: with no `DATABRICKS_API_KEY`, the engine uses Databricks unified auth — a valid `~/.databrickscfg` profile (`databricks auth login`; `databricks auth profiles` should show `Valid: YES` for the target host). A PAT in `DATABRICKS_API_KEY` still works and takes precedence (CI / service-principal runs).

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

## Troubleshooting

- `DATABRICKS_SERVER_HOSTNAME`/`DATABRICKS_HTTP_PATH` not set → the shell lacks the global vars (a non-interactive shell that didn't source the profile). Set them and retry.
- OAuth auth fails (no PAT) → the Databricks profile is missing or expired. Run `databricks auth login` and confirm `databricks auth profiles` shows `Valid: YES` for the target host, then retry.
- Summary row count near zero → bad universe read or empty walk; do not commit.
