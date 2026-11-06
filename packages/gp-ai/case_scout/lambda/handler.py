"""The case scout's Lambda: two entry points, kept in ONE function (not two
Lambdas) because they share nothing but a deploy unit — `start` claims the
night and (in a later story) kicks off the Reader; `publish` is the Reader's
own hand-off once it has a bundle. Splitting the Lambda would buy nothing: the
TDD's three-process isolation is about the Reader (which holds a transcript)
never sharing a process with the Publisher (which holds the GitHub key), and
both of THIS file's actions run in the no-transcript, has-the-GitHub-key half
of that split (see the TDD's "Discover" section and Implementation Notes
1.5/1.9).

Deploy shape: this file sits in case_scout/lambda/ (the repo-source
convention every containerized gp-ai Lambda member uses — see
autopilot/lambda/ and alert_filter/lambda/), but unlike autopilot's own
lambda/ directory, importing from it needs no by-path loading trick. That
trick exists in autopilot only because `lambda` is a reserved word and
autopilot's Lambda zip IS the `lambda/` directory's contents — so a plain
`import autopilot.lambda.x` can never be a real dotted import, in production
OR under pytest. Here, this file is the one module that lives under
case_scout/lambda/; everything it imports (ai_secrets, alerts, bucket,
dispatch, github_auth, health) is an ordinary top-level module in the
case_scout package, shipped alongside this handler in the same zip (see
infrastructure/modules/case-scout's archive_file) — so
`from case_scout import ...` resolves normally both at runtime and in tests.

`start` (end-to-end wiring, S9): checks run staleness (health.py, alerting
if the scout has gone quiet for 36+ hours), claims the night
(claims/<runDate>, If-None-Match: *), then launches the Reader's Fargate
task (dispatch.py) — claim strictly before launch, same ordering reasoning
as autopilot's own dispatch_stage.

`publish` is the Publisher (S8) — see case_scout/publisher.py for the real
logic (read the bundle, skip caseIds already on main, commit via the Git
Data API, open one PR, post the Slack note, advance the marker, plus the
self-check and gate-health alerts this story, S9, adds). This handler is
just the thin entry point: pull `runId` and `ENVIRONMENT` out of the
event/process env and hand off.
"""

import json
import os
from datetime import UTC, datetime
from typing import Any

from case_scout import alerts, bucket, dispatch, health, publisher


# Kept as a function (not a module-level constant) so a long warm Lambda
# always claims against "tonight", not whatever date it happened to cold
# start under — not meaningful yet since nothing calls datetime.now() more
# than once per invocation, but matching the no-stale-cache discipline the
# rest of gp-ai's Lambdas use for anything the trigger could call with no
# data (this Lambda's own `start` action, from case-scout-nightly.yml, is
# exactly that: GitHub sends it nothing, per the TDD's "GitHub sends and
# receives no data" rule).
def _today_run_date() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


def _handle_start(event: dict[str, Any]) -> dict[str, Any]:
    run_date = event.get("runDate")
    if not isinstance(run_date, str) or not run_date:
        run_date = _today_run_date()

    environment = os.environ.get("ENVIRONMENT", "unknown")
    store = bucket.CaseScoutBucket()

    # The "no run happened in 36 hours" check (Implementation Notes section
    # 8) runs here, BEFORE the claim below, and regardless of tonight's
    # outcome: this is the one entry point the nightly GitHub Actions
    # schedule guarantees fires every night, so it's the only reliable place
    # to notice the scout has gone quiet — a claim failure or a crashed
    # Reader would otherwise never trip this alert on its own.
    if health.is_run_stale(store, datetime.now(UTC)):
        alerts.post_alert(
            environment,
            subject="case scout: no run in over 36 hours",
            message=f"Checked at start of runDate={run_date}; the scout's last completed run is stale or missing.",
        )

    claimed = store.claim_run(run_date)
    if not claimed:
        print(f"case_scout start: {run_date} already claimed; no-op (one run a night)")
        return {"statusCode": 200, "body": json.dumps({"status": "already_claimed", "runDate": run_date})}

    result = dispatch.launch_reader_task(run_date)
    if not result["launched"]:
        # Claiming the night with nothing reading it is harmless on its own —
        # the marker never advances, so the next night's claim covers the
        # same ground (TDD "Failure and recovery") — but a launch failure is
        # exactly the kind of infra problem the Lambda's own CloudWatch error
        # alarm (lambda_errors) is wired to catch: printing ERROR here is
        # what that metric filter matches on.
        print(f"ERROR: case_scout start: claimed {run_date} but Reader dispatch failed: {result.get('error')}")
        return {"statusCode": 200, "body": json.dumps({"status": "dispatch_failed", "runDate": run_date})}

    print(f"case_scout start: claimed {run_date}; Reader task launched: {result.get('task_arn')}")
    return {"statusCode": 200, "body": json.dumps({"status": "claimed", "runDate": run_date})}


def _handle_publish(event: dict[str, Any]) -> dict[str, Any]:
    run_id = event.get("runId")
    if not isinstance(run_id, str) or not run_id:
        return {"statusCode": 400, "body": json.dumps({"error": "runId is required"})}

    environment = os.environ.get("ENVIRONMENT", "unknown")
    store = bucket.CaseScoutBucket()
    result = publisher.run_publish(run_id, store, environment, datetime.now(UTC))

    if not result.had_bundle:
        status = "no_bundle"
    elif not result.marker_advanced:
        # marker_advanced is False only when the GitHub step or the Slack
        # post itself failed (run_publish never advances the marker
        # otherwise) — reporting "published"/"dry_run" here would tell a
        # caller tonight went fine when it didn't. Nothing reads this field
        # yet, but the end-to-end wiring story (S9) will.
        status = "failed"
    elif result.pr_opened:
        status = "published"
    elif result.dry_run:
        status = "dry_run"
    else:
        status = "published"  # live mode, nothing new to commit tonight (e.g. zero drafts)

    print(
        f"case_scout publish ({environment}): runId={run_id} status={status} "
        f"prNumber={result.pr_number} notePosted={result.note_posted} "
        f"markerAdvanced={result.marker_advanced} staleClosed={list(result.stale_closed)}"
    )
    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "status": status,
                "runId": run_id,
                "prNumber": result.pr_number,
                "prUrl": result.pr_url,
                "notePosted": result.note_posted,
                "markerAdvanced": result.marker_advanced,
                "staleClosed": list(result.stale_closed),
            }
        ),
    }


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    action = event.get("action")
    if action == "start":
        return _handle_start(event)
    if action == "publish":
        return _handle_publish(event)
    print(f"ERROR: case_scout Lambda invoked with an unknown action: {action!r}")
    return {"statusCode": 400, "body": json.dumps({"error": f"unknown action {action!r}"})}
