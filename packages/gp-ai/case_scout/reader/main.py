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

**Publisher story addition:** also writes `runs/<runId>/record.json`
(Implementation Notes 2.2: "counts and spend by stage"), extended with one
field the spec doesn't name a home for — `newMarker`, the candidate
`lastSessionStart`/`processedSessionIds` the Publisher applies via
`bucket.write_marker` once its own PR-and-note steps succeed (TDD: "The
marker moves only after the publish succeeds"). Nothing else in this
codebase ever persists a session's `started_at` or id outside this
process's memory, so the Publisher — a separate Lambda invocation, possibly
on a separate night — has no other way to know what the marker should
become. Neither value is a transcript or message content (ticket
Implementation Details: the Publisher "never sees a transcript; it reads
only already-gated, already-fictional case fields" plus, as of this change,
this one piece of bookkeeping), so handing it across the process boundary
through the bucket doesn't cross the TDD's isolation line.
"""

import os
from datetime import UTC, datetime

from case_scout.bucket import CaseScoutBucket
from case_scout.reader.messages import DatabricksCaseScoutMessageReader
from case_scout.reader.night import NightResult, run_night
from case_scout.reader.pipeline import QUERY_OVERLAP
from case_scout.reader.scoring import MODEL


def _today_run_date() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


def _new_marker_candidate(old_marker, sessions) -> dict:
    """The marker the Publisher should apply once tonight's publish succeeds.

    `lastSessionStart` becomes the latest session this run actually read;
    `processedSessionIds` keeps only ids within one query-overlap window of
    that new cutoff — anything older will never be re-fetched anyway (the
    next run's query starts at `lastSessionStart - QUERY_OVERLAP`), so
    carrying it forward would only grow the list forever for no benefit.

    `sessions` is `pipeline.run_reader`'s already-NEW sessions — it has
    already dropped every id `select_new_sessions` found in
    `old_marker.processed_session_ids` (pipeline.py's own job: don't re-score
    what's already processed). That means the old marker's ids for sessions
    still inside the NEW overlap window must be merged back in here, or
    they're gone for good: nothing else ever re-adds them, and the next run's
    query window can still re-fetch a session whose id was dropped — this
    story's PR review caught exactly that regression (a session processed
    two nights ago, still inside tonight's overlap window, silently losing
    its "already processed" status and getting drafted a second time).

    A run with no new sessions (claimed, but nothing since the marker)
    leaves both fields exactly as they were — there is nothing to advance
    past. This still under-covers one case, by design: a night whose
    sessions all scored severity 0-1 (never became candidates) still moves
    the cutoff forward correctly here, in `main.py` — the gap this module
    does NOT try to close is a quieter one inside drafting's own
    ledger-dedup math, not this function's concern.
    """
    if not sessions:
        return {
            "lastSessionStart": old_marker.last_session_start,
            "processedSessionIds": list(old_marker.processed_session_ids),
        }
    new_last_session_start = max(s.started_at for s in sessions)
    cutoff = new_last_session_start - QUERY_OVERLAP
    kept_ids = [s.session_id for s in sessions if s.started_at >= cutoff]

    old_last_session_start = old_marker.last_session_start
    if old_last_session_start is not None and datetime.fromisoformat(old_last_session_start) >= cutoff:
        # The old cutoff is still inside the new overlap window, so some of
        # the old ids could still be re-fetched tonight's window didn't
        # cover — carry all of them forward rather than guessing which
        # (we only have ids, never their individual timestamps, to tell).
        kept_ids = list(dict.fromkeys([*old_marker.processed_session_ids, *kept_ids]))

    return {"lastSessionStart": new_last_session_start.isoformat(), "processedSessionIds": kept_ids}


def _build_record(run_date: str, now: datetime, result: NightResult, new_marker: dict) -> dict:
    draft_run = result.draft_run
    assert draft_run is not None
    outcome_counts: dict[str, int] = {}
    for line in draft_run.ledger_lines:
        outcome = line.get("outcome", "unknown")
        outcome_counts[outcome] = outcome_counts.get(outcome, 0) + 1

    return {
        "runId": draft_run.run_id,
        "startedAt": now.isoformat(),
        "finishedAt": now.isoformat(),
        "counts": {
            "sessions": len(result.reader_run.sessions),
            "scored": len(result.reader_run.sessions) - len(result.scoring_errors),
            "candidates": len(draft_run.ledger_lines),
            "proposed": outcome_counts.get("proposed", 0),
            "covered": outcome_counts.get("covered", 0),
            "needsSetup": outcome_counts.get("needsSetup", 0),
            "gated": outcome_counts.get("gated", 0),
            "capped": outcome_counts.get("capped", 0),
            "listFull": outcome_counts.get("listFull", 0),
        },
        # Real per-call cost metering doesn't exist yet anywhere in this
        # package (scoring.py/drafting.py/gate.py make their Anthropic calls
        # without recording a price) — that's the epic's own open item
        # ("the scout's per-run dollar cap... gets set once Samuel's spend
        # data arrives"), not something this story invents. Zero here is
        # honest about what isn't tracked yet, not a guess.
        "spendUsd": {"score": 0.0, "draft": 0.0, "gate": 0.0, "total": 0.0},
        "model": MODEL,
        "errors": list(result.scoring_errors),
        "newMarker": new_marker,
    }


def _persist(bucket: CaseScoutBucket, run_date: str, now: datetime, old_marker, result: NightResult) -> None:
    draft_run = result.draft_run
    assert draft_run is not None
    bucket.write_run_bundle(draft_run.run_id, draft_run.bundle)
    bucket.write_run_sources(draft_run.run_id, draft_run.sources)
    # Every candidate's line lands in the ledger for the month its own
    # night falls in — run_date is a single calendar day (YYYY-MM-DD), so
    # every line one run produces shares one yyyy-mm key.
    yyyymm = run_date[:7]
    for line in draft_run.ledger_lines:
        bucket.append_ledger_line(yyyymm, line)

    new_marker = _new_marker_candidate(old_marker, result.reader_run.sessions)
    bucket.write_run_record(draft_run.run_id, _build_record(run_date, now, result, new_marker))


def main() -> None:
    environment = os.environ.get("ENVIRONMENT", "unknown")
    run_date = os.environ.get("CASE_SCOUT_RUN_DATE") or _today_run_date()
    now = datetime.now(UTC)

    bucket = CaseScoutBucket()
    # Read before run_night (which re-reads the same marker internally to
    # compute its own query window) rather than threading it back out of
    # ReaderRun — claim_run's mutex already guarantees one Reader per night,
    # so nothing else can write marker.json between these two reads, and a
    # second GET is cheaper than widening pipeline.py's return type for a
    # value only this module's record-building needs.
    old_marker = bucket.read_marker()
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
    _persist(bucket, run_date, now, old_marker, result)

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
