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
case_scout/lambda/; everything it imports (ai_secrets, bucket, github_auth)
is an ordinary top-level module in the case_scout package, shipped alongside
this handler in the same zip (see infrastructure/modules/case-scout's
archive_file) — so `from case_scout import ...` resolves normally both at
runtime and in tests.

Both actions are stubs today (this story is the scaffold; the Reader's and
Publisher's real logic are later stories — see the acceptance criteria this
file satisfies):
  - `start` claims the night (claims/<runDate>, If-None-Match: *) and returns.
    No Reader dispatch yet.
  - `publish` accepts a runId and returns without erroring, whether or not a
    bundle exists yet for that run.
"""

import json
from datetime import UTC, datetime
from typing import Any

from case_scout import bucket


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

    store = bucket.CaseScoutBucket()
    claimed = store.claim_run(run_date)
    if not claimed:
        print(f"case_scout start: {run_date} already claimed; no-op (one run a night)")
        return {"statusCode": 200, "body": json.dumps({"status": "already_claimed", "runDate": run_date})}

    # TODO(S4 — Case scout Reader: mock view reader, marker/claim handling,
    # session segmentation): launch the Reader Fargate task here. Until then,
    # claiming the night with nothing reading it is harmless — the marker
    # never advances, so the next night's claim covers the same ground, same
    # as any other missed-run recovery (TDD "Failure and recovery").
    print(f"case_scout start: claimed {run_date}; Reader dispatch is not wired yet")
    return {"statusCode": 200, "body": json.dumps({"status": "claimed", "runDate": run_date})}


def _handle_publish(event: dict[str, Any]) -> dict[str, Any]:
    run_id = event.get("runId")
    if not isinstance(run_id, str) or not run_id:
        return {"statusCode": 400, "body": json.dumps({"error": "runId is required"})}

    store = bucket.CaseScoutBucket()
    existing_bundle = store.read_run_bundle(run_id)

    # TODO(S8 — Case scout Publisher: PR, Slack note, marker advance, dry-run
    # mode): read the bundle, open the PR, post the Slack note, and advance
    # the marker with If-Match. Until then this only confirms the entry point
    # has the right shape — accepting a runId and not erroring whether or not
    # a bundle exists yet (a stub `start` claims but never writes one).
    if existing_bundle is None:
        print(f"case_scout publish: no bundle yet for runId={run_id}; stub path, nothing to publish")
    else:
        print(f"case_scout publish: bundle found for runId={run_id}; Publisher logic is not wired yet")
    return {"statusCode": 200, "body": json.dumps({"status": "accepted", "runId": run_id})}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    action = event.get("action")
    if action == "start":
        return _handle_start(event)
    if action == "publish":
        return _handle_publish(event)
    print(f"ERROR: case_scout Lambda invoked with an unknown action: {action!r}")
    return {"statusCode": 400, "body": json.dumps({"error": f"unknown action {action!r}"})}
