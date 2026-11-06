"""Wires the Reader pipeline's steps 1-3 (pipeline.py: claim, read, segment)
to scoring (step 4-5, scoring.py) and drafting (step 6-7, drafting.py — which
now includes the PII gate, gate.py — plus the nightly cap in cap.py and
list/ledger lookups in case_lists.py/ledger.py) into one nightly run. main.py
calls run_night, then writes its outputs to the bucket — this module builds
the DraftRun but never touches S3 itself beyond the read-only ledger history
drafting needs, keeping "what happened tonight" (this module) separate from
"how it's persisted" (main.py), the same split pipeline.py already draws for
steps 1-3.
"""

from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any

from case_scout.bucket import CaseScoutBucket
from case_scout.reader.cap import nightly_cap_for_merge_share, trailing_merge_share
from case_scout.reader.case_lists import ChatCaseListReader, GithubChatCaseListReader
from case_scout.reader.drafting import DraftRun, run_drafting
from case_scout.reader.judge_records import JudgeRecordsReader, S3JudgeRecordsReader
from case_scout.reader.ledger import RECENT_PROPOSALS_WINDOW_DAYS, parse_ledger_lines, yyyymm_keys_covering
from case_scout.reader.messages import CaseScoutMessageReader
from case_scout.reader.noisy_cases import propose_removals
from case_scout.reader.pipeline import ReaderRun, run_reader
from case_scout.reader.scoring import (
    ScoringError,
    SessionScore,
    score_session_if_covered,
    select_candidates,
    should_score,
)
from case_scout.reader.sessions import Session
from case_scout.reader.spend import SpendTracker


@dataclass(frozen=True)
class NightResult:
    """What one night's full run (claim through drafting) produced.
    `draft_run` is None exactly when `reader_run.claimed` is False — a night
    already claimed by an earlier invocation has nothing left to score or
    draft.

    `spend_capped_session_ids` covers both places a session can be dropped by
    the per-run cap: skipped before scoring ever ran (this loop, below), and
    scored but capped before drafting (drafting.run_drafting's own
    "spendCapped" ledger lines). main.py's marker advancement excludes these
    ids and holds the cutoff before them, so a capped session is read again
    on a future night instead of being silently lost — a session this run
    never actually scored or drafted must never count as "processed".
    """

    reader_run: ReaderRun
    draft_run: DraftRun | None
    scoring_errors: tuple[str, ...]
    spend_capped_session_ids: tuple[str, ...] = ()


def _load_recent_ledger_entries(bucket: CaseScoutBucket, now: datetime) -> list[Any]:
    months = yyyymm_keys_covering(now, RECENT_PROPOSALS_WINDOW_DAYS)
    raw_lines: list[dict[str, Any]] = []
    for month in months:
        raw_lines.extend(bucket.read_ledger_lines(month))
    return parse_ledger_lines(raw_lines)


def run_night(
    run_date: str,
    bucket: CaseScoutBucket,
    message_reader: CaseScoutMessageReader,
    environment: str,
    now: datetime,
    case_list_reader: ChatCaseListReader | None = None,
    judge_records_reader: JudgeRecordsReader | None = None,
    session_cap: int | None = None,
    score_call: Any = None,
    draft_call: Any = None,
    second_read_call: Any = None,
    spend_tracker: SpendTracker | None = None,
) -> NightResult:
    reader_run = run_reader(run_date, bucket, message_reader, environment, session_cap=session_cap)
    if not reader_run.claimed:
        return NightResult(reader_run=reader_run, draft_run=None, scoring_errors=())

    resolved_case_list_reader = case_list_reader or GithubChatCaseListReader()

    scored: list[tuple[Session, SessionScore]] = []
    scoring_errors: list[str] = []
    spend_capped_session_ids: list[str] = []
    for session in reader_run.sessions:
        # Spend cap check BEFORE the call, not after: once a prior session's
        # call pushed the running total over the cap, this session's score
        # call must never go out (AC: "stops further spend... when hit").
        if spend_tracker is not None and spend_tracker.cap_hit:
            scoring_errors.append(f"session {session.session_id}: skipped, spend cap reached")
            spend_capped_session_ids.append(session.session_id)
            continue

        # should_score mirrors score_session_if_covered's own internal gate
        # exactly (scoring.py) — only a session that would actually trigger a
        # paid call costs anything to record here.
        charges_for_call = should_score(session)
        try:
            score = score_session_if_covered(session, call=score_call)
        except ScoringError as e:
            scoring_errors.append(str(e))
            if charges_for_call and spend_tracker is not None:
                spend_tracker.record("score")
            continue
        if charges_for_call and spend_tracker is not None:
            spend_tracker.record("score")
        if score is not None:
            scored.append((session, score))

    candidates = select_candidates(scored)

    ledger_entries = _load_recent_ledger_entries(bucket, now)
    nightly_cap = nightly_cap_for_merge_share(trailing_merge_share(ledger_entries, now))

    draft_run = run_drafting(
        run_id=run_date,
        candidates=candidates,
        case_list_reader=resolved_case_list_reader,
        ledger_entries=ledger_entries,
        nightly_cap=nightly_cap,
        now=now,
        draft_call=draft_call,
        second_read_call=second_read_call,
        spend_tracker=spend_tracker,
    )

    # A candidate can also be capped INSIDE drafting (run_drafting's own
    # "spendCapped" outcome, once scoring already spent enough to hit the cap
    # partway through drafting rather than before it) — those sessions were
    # scored but never actually drafted, so they must be excluded from marker
    # advancement the same as the scoring-stage skips above.
    spend_capped_session_ids.extend(
        line["sessionId"] for line in draft_run.ledger_lines if line.get("outcome") == "spendCapped"
    )

    resolved_judge_records_reader = judge_records_reader or S3JudgeRecordsReader()
    removals = _propose_removals_safely(resolved_case_list_reader, resolved_judge_records_reader)
    draft_run = replace(draft_run, bundle={**draft_run.bundle, "removals": removals})

    return NightResult(
        reader_run=reader_run,
        draft_run=draft_run,
        scoring_errors=tuple(scoring_errors),
        spend_capped_session_ids=tuple(dict.fromkeys(spend_capped_session_ids)),
    )


def _propose_removals_safely(
    case_list_reader: ChatCaseListReader, judge_records_reader: JudgeRecordsReader
) -> list[dict[str, str]]:
    """Noisy-case removal proposals (noisy_cases.py, Implementation Notes
    2.8) are advisory-only and run alongside tonight's drafting, not in
    front of it — a failure here (a judge-records read error, an
    unreachable case list) must never cost tonight's real drafts, so it is
    caught and reported as no proposals rather than raised."""
    try:
        return propose_removals(case_list_reader, judge_records_reader)
    except Exception as e:
        print(f"case_scout run_night: removal-proposal detection failed, proceeding with none: {type(e).__name__}: {e}")
        return []
