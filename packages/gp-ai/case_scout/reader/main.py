"""Fargate entrypoint for the Reader.

The service scaffold story wired the task definition and IAM role this runs
under (see infrastructure/modules/case-scout). Earlier stories wired the rest
of the Reader pipeline on top of pipeline.py's steps 1-3: score each session
(scoring.py), select candidates, draft up to the nightly cap
(reader/night.py, reader/drafting.py), gate every draft (reader/gate.py,
TDD section 3 step 7 — `bundle.json` written here is POST-gate: a gated
draft never reaches it), and write what the night decided to the bucket.
Invoking the Publisher (step 9's "Invoke the Publisher with runId") is the
Publisher story's own wiring, so this entrypoint stops right after writing
the night's bucket objects.

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
from case_scout.reader.night import run_night


def _today_run_date() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


def _persist(bucket: CaseScoutBucket, run_date: str, draft_run) -> None:
    bucket.write_run_bundle(draft_run.run_id, draft_run.bundle)
    bucket.write_run_sources(draft_run.run_id, draft_run.sources)
    # Every candidate's line lands in the ledger for the month its own
    # night falls in — run_date is a single calendar day (YYYY-MM-DD), so
    # every line one run produces shares one yyyy-mm key.
    yyyymm = run_date[:7]
    for line in draft_run.ledger_lines:
        bucket.append_ledger_line(yyyymm, line)


def main() -> None:
    environment = os.environ.get("ENVIRONMENT", "unknown")
    run_date = os.environ.get("CASE_SCOUT_RUN_DATE") or _today_run_date()
    now = datetime.now(UTC)

    bucket = CaseScoutBucket()
    result = run_night(
        run_date=run_date,
        bucket=bucket,
        message_reader=DatabricksCaseScoutMessageReader(environment),
        environment=environment,
        now=now,
    )

    if not result.reader_run.claimed:
        print(f"case_scout Reader ({environment}): {run_date} already claimed; no-op")
        return

    draft_run = result.draft_run
    assert draft_run is not None  # claimed=True always produces a draft_run (run_night's contract)
    _persist(bucket, run_date, draft_run)

    print(
        f"case_scout Reader ({environment}): {run_date} claimed, "
        f"{len(result.reader_run.sessions)} new session(s) "
        f"(excluded {result.reader_run.excluded_processed_count} already-processed, "
        f"session-capped {result.reader_run.capped_count}, "
        f"is_internal filter={result.reader_run.is_internal_filter}, "
        f"{len(result.scoring_errors)} scoring error(s)). "
        f"Drafted {len(draft_run.bundle['drafts'])} case(s), "
        f"{len(draft_run.bundle['needsSetup'])} needs-setup, "
        f"{len(draft_run.bundle['listFull'])} list-full. "
        "Publishing is not wired yet."
    )


if __name__ == "__main__":
    main()
