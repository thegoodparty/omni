"""The case scout's Lambda: the Publisher. gp-api's caseScoutDraft job
writes the night's files to the scout's bucket and invokes this with
`{"action": "publish", "runId": ...}`. It holds the GitHub App key and never
sees a transcript (docs/adr/2026-11-16-case-scout-reader-in-gp-api.md).

Deploy shape: this file sits in case_scout/lambda/ (the repo-source
convention every containerized gp-ai Lambda member uses — see
autopilot/lambda/ and alert_filter/lambda/), but unlike autopilot's own
lambda/ directory, importing from it needs no by-path loading trick. That
trick exists in autopilot only because `lambda` is a reserved word and
autopilot's Lambda zip IS the `lambda/` directory's contents — so a plain
`import autopilot.lambda.x` can never be a real dotted import, in production
OR under pytest. Here, this file is the one module that lives under
case_scout/lambda/; everything it imports is an ordinary top-level module in
the case_scout package, shipped alongside this handler in the same zip (see
infrastructure/modules/case-scout's archive_file) — so
`from case_scout import ...` resolves normally both at runtime and in tests.

See case_scout/publisher.py for the real logic (read the bundle, skip
caseIds already on main, commit via the Git Data API, open one PR, post the
Slack note, advance the marker, plus the self-check and gate-health alerts).
This handler is just the thin entry point: pull `runId` and `ENVIRONMENT` out
of the event/process env and hand off.
"""

import json
import os
from datetime import UTC, datetime
from typing import Any

from case_scout import bucket, publisher


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
        # caller tonight went fine when it didn't. gp-api's
        # caseScoutPublisher.service.ts throws on it, so the job retries.
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
    if action == "publish":
        return _handle_publish(event)
    print(f"ERROR: case_scout Lambda invoked with an unknown action: {action!r}")
    return {"statusCode": 400, "body": json.dumps({"error": f"unknown action {action!r}"})}
