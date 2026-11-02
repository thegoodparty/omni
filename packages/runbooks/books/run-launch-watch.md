Add, backtest and retire a launch watch check: a daily outcome check for a recent launch that posts to #bugs when the launch stops doing what it shipped to do.

## Prerequisites

**scripts/.env variables**: `DATABRICKS_HTTP_PATH` (a SQL warehouse path, `/sql/1.0/warehouses/<id>`)
**Tools**: `uv`, the Databricks CLI logged in (`databricks auth login`)

Checks live in `scripts/python/launch_watch.yaml` and run daily from the
`launch-watch` GitHub Actions workflow (`scripts/python/launch_watch.py`). It
reads Databricks as the product_analytics service principal and posts with the
analytics Slack app to the channel in the `SLACK_BUGS_CHANNEL_ID` repo
variable. The bot must be a member of that channel.

## When to add one

A launch can work without erroring and still do nothing for users. Sentry and
Grafana see errors, and the event health monitor sees tracking that broke, but
neither sees an outcome that never happens. Add a check when a PR ships a user
flow whose success shows up in the warehouse: an event that should fire for a
known audience, or a row that should get written. The SMS cutoff notice is the
worked example: it went unseen for its first two weeks while 60 to 130
candidates a day reached outreach past their cutoff.

## Steps

1. **Write the SQL.** It returns one row with `exposed` (users who should have
   triggered the outcome in the window) and `fired` (users who did). Use
   `{window_start}` and `{window_end}`, inclusive Eastern dates, and compare
   Eastern days (`from_utc_timestamp(event_time, 'America/New_York')`). Read only
   from `goodparty_data_catalog.mart_analytics`, because the service principal is
   granted that schema and nothing below it.
2. **Add the check** to `launch_watch.yaml`: `id`, `launch`, `what` (the expected
   outcome in one sentence), `prs`, `active_from` (the first full day after the
   deploy), `active_until` (about 14 days later), `window_days`, `min_exposed`
   and `sql`. Set `min_exposed` well above the noise in your exposure count, and
   say in a comment what the count includes that it should not.
3. **Backtest it** against a day you know the answer for:

   ```bash
   cd scripts/python
   uv run launch_watch.py --dry-run --check <id> --as-of <YYYY-MM-DD> --ignore-watch-period
   ```

   It prints the status, the counts and the Slack message it would post.
   `--ignore-watch-period` lets you run outside `active_from`/`active_until`.
4. **Run the tests**: `uv run pytest -q test_launch_watch.py`. One of them checks
   every committed check is well formed.
5. **Open the PR.** After it merges, dispatch the workflow against `main` with
   `dry_run: true` to see the live result
   (`gh workflow run launch-watch.yml --ref main -f dry_run=true`).

## How it decides

- `fail`: at least `min_exposed` users exposed and none fired.
- `low_exposure`: fewer exposed than `min_exposed`. Not a finding.
- `pass`: anything fired.
- A failing check posts only when the previous day's window did not fail, or was
  outside the watch period, so a break posts once rather than every day.
- A query error fails the run, and the failure notice goes to the event-lifecycle
  channel, not #bugs.

## Retiring a check

Delete it once `active_until` has passed. A check outside its watch period
already does nothing, and git keeps the history.

## Troubleshooting

- `Slack refused the post: not_in_channel`: invite the analytics Slack app to the
  channel in `SLACK_BUGS_CHANNEL_ID`.
- The run cannot authenticate to Databricks: the federation policy trusts runs
  on `main` only, so dispatch with `--ref main`.
