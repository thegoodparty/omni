"""The "no run happened in 36 hours" check (Implementation Notes section 8
metrics/alerts; S9 ticket AC: "no run for 36 hours triggers an alert").

Top-level (not under reader/) because it runs from the Lambda's `start`
action (lambda/handler.py) — the one entry point the nightly GitHub Actions
schedule guarantees fires every night regardless of whether tonight's Reader
run itself ever happens, so it's the only reliable place to notice "it's
been too long since the last one."
"""

from datetime import UTC, datetime, timedelta

from case_scout.bucket import CaseScoutBucket

DEFAULT_MAX_STALE_HOURS = 36.0


def latest_run_id(bucket: CaseScoutBucket, now: datetime) -> str | None:
    """The most recent runId with a record.json, or None if the scout has
    never completed a run. Run ids are calendar dates (YYYY-MM-DD, set by
    night.run_night's run_id=run_date), so lexicographic max across this and
    last month's listings is the most recent one — list_run_ids_for_month is
    already a prefix listing, so two calls (current + previous month) covers
    every month boundary without listing the whole bucket."""
    months = {now.strftime("%Y-%m"), (now - timedelta(days=31)).strftime("%Y-%m")}
    latest: str | None = None
    for yyyymm in months:
        for run_id in bucket.list_run_ids_for_month(yyyymm):
            if latest is None or run_id > latest:
                latest = run_id
    return latest


def is_run_stale(bucket: CaseScoutBucket, now: datetime, max_stale_hours: float = DEFAULT_MAX_STALE_HOURS) -> bool:
    """True when the scout's last completed run is more than `max_stale_hours`
    old, or there has never been one — either way, an alert-worthy "no run
    happened" condition."""
    latest = latest_run_id(bucket, now)
    if latest is None:
        return True
    try:
        latest_date = datetime.fromisoformat(latest).replace(tzinfo=UTC)
    except ValueError:
        # A malformed runId should never silently suppress the alert — the
        # safer failure mode is "treat as stale", not "treat as fresh".
        return True
    return (now - latest_date) > timedelta(hours=max_stale_hours)
