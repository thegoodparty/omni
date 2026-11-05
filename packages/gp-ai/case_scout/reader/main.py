"""Fargate entrypoint for the Reader.

The service scaffold story wired the task definition and IAM role this runs
under (see infrastructure/modules/case-scout). This story (the mock view
reader / marker / claim / segmentation story) wires Reader pipeline steps
1-3: claim the night, read the marker, fetch messages since the marker minus
the overlap, and segment into sessions (see reader/pipeline.py). Scoring on
Opus, drafting and the PII gate (TDD section 3, steps 4 onward) are later
Reader stories — this entrypoint stops exactly where this story's pipeline
stops and logs what it found, since nothing downstream exists yet to hand
the sessions to.

Nothing invokes this container yet: the `start` Lambda handler's ECS
RunTask dispatch, and a real `case_scout_messages` view to read, both land
with later stories (see case_scout/lambda/handler.py's own TODO and
infrastructure/modules/case-scout/main.tf's "Nothing calls RunTask against
this task definition yet"). Running this locally/in CI before then fails at
the Databricks credential check in reader/messages.py, same as any other
not-yet-provisioned-secret failure.
"""

import os
from datetime import UTC, datetime

from case_scout.bucket import CaseScoutBucket
from case_scout.reader.messages import DatabricksCaseScoutMessageReader
from case_scout.reader.pipeline import run_reader


def _today_run_date() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


def main() -> None:
    environment = os.environ.get("ENVIRONMENT", "unknown")
    run_date = os.environ.get("CASE_SCOUT_RUN_DATE") or _today_run_date()

    result = run_reader(
        run_date=run_date,
        bucket=CaseScoutBucket(),
        message_reader=DatabricksCaseScoutMessageReader(environment),
        environment=environment,
    )

    if not result.claimed:
        print(f"case_scout Reader ({environment}): {run_date} already claimed; no-op")
        return

    print(
        f"case_scout Reader ({environment}): {run_date} claimed, "
        f"{len(result.sessions)} new session(s) to score "
        f"(excluded {result.excluded_processed_count} already-processed, "
        f"capped {result.capped_count}, is_internal filter={result.is_internal_filter}). "
        "Scoring is not wired yet."
    )


if __name__ == "__main__":
    main()
