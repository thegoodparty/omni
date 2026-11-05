"""The Reader pipeline, steps 1-3 (Implementation Notes section 3):

    1. Claim claims/<runDate>. If the claim exists, exit cleanly.
    2. Read marker.json and query the view for messages since
       lastSessionStart minus the 60-minute overlap, with is_internal=false
       in prod (no filter in dev).
    3. Segment into sessions on gaps over 60 minutes, drop ids already in
       processedSessionIds, and cap the sessions per run (the runaway
       guard).

Scoring, drafting and the PII gate (steps 4 onward) are later Reader
stories — this module stops exactly where this ticket's acceptance criteria
stop, and hands back the sessions a later story will score.
"""

import os
from dataclasses import dataclass
from datetime import datetime, timedelta

from case_scout.bucket import CaseScoutBucket
from case_scout.reader.messages import CaseScoutMessageReader
from case_scout.reader.sessions import Session, segment_into_sessions

# The 60-minute query overlap (Implementation Notes section 3 step 2 /
# section 7's midnight-spanning edge case) must match SESSION_GAP
# (sessions.py): fetching anything less risks starting the window in the
# MIDDLE of an in-progress session, which would make segment_into_sessions
# treat that session's tail as if it had no prior history — wrongly reading
# a continuing session as a brand-new one starting mid-conversation.
QUERY_OVERLAP = timedelta(minutes=60)

# "Make the cap a config value; the exact number isn't decided, so pick a
# conservative default and make it easy to raise, since production spend
# data isn't in yet" (ticket Implementation Details, point 3). The digest's
# own volume (Implementation Notes 10.7) runs 28-52 conversations a day, so a
# default comfortably above that lets a normal night through uncapped while
# still bounding a genuine runaway (e.g. a marker that regressed and is
# suddenly re-reading weeks of backlog).
DEFAULT_SESSION_CAP = 75
SESSION_CAP_ENV = "CASE_SCOUT_SESSION_CAP"


def session_cap_from_env(environ: dict[str, str] | None = None) -> int:
    """The per-run session cap, overridable via CASE_SCOUT_SESSION_CAP
    (AC: "configurable"). Falls back to DEFAULT_SESSION_CAP on anything
    unset, blank, or not a positive integer, rather than letting a typo'd
    env var silently disable the runaway guard."""
    env = environ if environ is not None else os.environ
    raw = env.get(SESSION_CAP_ENV, "")
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_SESSION_CAP
    return value if value > 0 else DEFAULT_SESSION_CAP


def is_internal_filter_for_environment(environment: str) -> bool:
    """ "In dev, the is_internal filter is not applied; in prod, it is" (AC;
    Implementation Notes 10.1: "nearly every dev chat is staff"). Anything
    that isn't literally "prod" gets the permissive (unfiltered) behavior,
    so a missing/misconfigured ENVIRONMENT fails toward reading more, never
    toward silently dropping every dev session."""
    return environment == "prod"


@dataclass(frozen=True)
class ReaderRun:
    """What one invocation of the Reader pipeline produced, for the caller
    (main.py today; a later story's scoring step) to act on."""

    run_date: str
    claimed: bool
    sessions: tuple[Session, ...] = ()
    capped_count: int = 0
    excluded_processed_count: int = 0
    is_internal_filter: bool = False
    window_start: datetime | None = None


def _parse_marker_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)


def select_new_sessions(
    sessions: list[Session],
    processed_session_ids: list[str],
    cap: int,
) -> tuple[list[Session], int, int]:
    """Drops sessions already recorded in the marker's processedSessionIds,
    orders the rest oldest-first, and applies the per-run cap.

    Returns (kept, excluded_processed_count, capped_count). Ordering by
    session start (rather than, say, insertion order) matters once scoring
    exists (Implementation Notes section 3 step 5 orders by severity, then
    session start) — this story has no severity yet, so session start alone
    is the stable, deterministic ordering a later story's severity sort can
    be layered on top of."""
    already_processed = set(processed_session_ids)
    new_sessions = [s for s in sessions if s.session_id not in already_processed]
    excluded_processed_count = len(sessions) - len(new_sessions)

    new_sessions.sort(key=lambda s: s.started_at)
    kept = new_sessions[:cap]
    capped_count = len(new_sessions) - len(kept)
    return kept, excluded_processed_count, capped_count


def run_reader(
    run_date: str,
    bucket: CaseScoutBucket,
    message_reader: CaseScoutMessageReader,
    environment: str,
    session_cap: int | None = None,
) -> ReaderRun:
    """Runs Reader pipeline steps 1-3 for one night. Idempotent: a second
    call for a `run_date` already claimed (by this call or an earlier one)
    returns immediately with `claimed=False` and no sessions — the AC's "a
    second concurrent claim attempt... is a no-op, not an error"."""
    if not bucket.claim_run(run_date):
        return ReaderRun(run_date=run_date, claimed=False)

    cap = session_cap if session_cap is not None else session_cap_from_env()
    is_internal_filter = is_internal_filter_for_environment(environment)

    marker = bucket.read_marker()
    last_session_start = _parse_marker_timestamp(marker.last_session_start)
    window_start = last_session_start - QUERY_OVERLAP if last_session_start is not None else None

    messages = message_reader.fetch_since(window_start, is_internal_filter)
    all_sessions = segment_into_sessions(messages)
    kept, excluded_processed_count, capped_count = select_new_sessions(all_sessions, marker.processed_session_ids, cap)

    return ReaderRun(
        run_date=run_date,
        claimed=True,
        sessions=tuple(kept),
        capped_count=capped_count,
        excluded_processed_count=excluded_processed_count,
        is_internal_filter=is_internal_filter,
        window_start=window_start,
    )
