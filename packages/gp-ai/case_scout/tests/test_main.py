"""reader/main.py's own additions for this story: the record.json write
(counts tallied from tonight's ledger lines) and the marker candidate it
stashes there for the Publisher (see that module's docstring for why the
value has to be computed here, in the Reader, rather than in publisher.py)."""

from datetime import UTC, datetime, timedelta

from case_scout.bucket import Marker
from case_scout.reader.drafting import DraftRun
from case_scout.reader.main import _build_record, _new_marker_candidate
from case_scout.reader.night import NightResult
from case_scout.reader.pipeline import ReaderRun
from case_scout.reader.sessions import Session
from case_scout.reader.spend import SpendTracker

NO_OLD_MARKER = Marker(last_session_start=None, processed_session_ids=[], updated_by_run=None, etag=None)


def _session(session_id, conversation_id, minute):
    from case_scout.reader.messages import Message

    return Session(
        session_id=session_id,
        conversation_id=conversation_id,
        scope="chief_of_staff",
        messages=(
            Message(
                conversation_id=conversation_id,
                scope="chief_of_staff",
                message_id=session_id.split(":")[-1],
                role="user",
                content="hi",
                created_at=datetime(2026, 11, 5, 0, 0, tzinfo=UTC) + timedelta(minutes=minute),
            ),
        ),
    )


class TestNewMarkerCandidate:
    def test_no_new_sessions_leaves_the_old_marker_unchanged(self):
        old = Marker(last_session_start="t0", processed_session_ids=["a"], updated_by_run="prior", etag="e")

        candidate = _new_marker_candidate(old, [])

        assert candidate == {"lastSessionStart": "t0", "processedSessionIds": ["a"]}

    def test_the_cutoff_moves_to_the_latest_session_read(self):
        sessions = [_session("conv-1:m0", "conv-1", 0), _session("conv-2:m90", "conv-2", 90)]

        candidate = _new_marker_candidate(NO_OLD_MARKER, sessions)

        assert candidate["lastSessionStart"] == sessions[1].started_at.isoformat()

    def test_ids_older_than_one_overlap_window_are_dropped(self):
        # QUERY_OVERLAP is 60 minutes — a session 90 minutes before the new
        # cutoff will never be re-fetched by the next run's query window
        # (which starts at new_cutoff - 60min), so there is no reason to
        # keep remembering its id.
        sessions = [_session("conv-1:old", "conv-1", 0), _session("conv-2:new", "conv-2", 120)]

        candidate = _new_marker_candidate(NO_OLD_MARKER, sessions)

        assert candidate["processedSessionIds"] == ["conv-2:new"]

    def test_a_session_within_the_overlap_window_is_kept(self):
        sessions = [_session("conv-1:recent", "conv-1", 30), _session("conv-2:newest", "conv-2", 60)]

        candidate = _new_marker_candidate(NO_OLD_MARKER, sessions)

        assert set(candidate["processedSessionIds"]) == {"conv-1:recent", "conv-2:newest"}

    def test_old_ids_still_inside_the_new_overlap_window_are_carried_forward(self):
        # Regression (delegate review): run_reader's select_new_sessions
        # already drops every id select_new_sessions found in the OLD
        # marker's processedSessionIds before `sessions` ever reaches this
        # function, so an old id near the boundary has to be merged back in
        # here or it is gone for good — and the next run's query window
        # (new cutoff - QUERY_OVERLAP) can still re-fetch that old session,
        # scoring and drafting it a second time.
        old_marker = Marker(
            last_session_start=datetime(2026, 11, 5, 0, 35, tzinfo=UTC).isoformat(),
            processed_session_ids=["conv-1:old-a", "conv-1:old-b"],
            updated_by_run="prior-run",
            etag="e",
        )
        # New cutoff (latest session minus the 60min overlap) is 00:30 — the
        # old lastSessionStart (00:35) is still past that cutoff, so the old
        # ids are still inside the new overlap window and must be kept.
        sessions = [_session("conv-2:new", "conv-2", 90)]

        candidate = _new_marker_candidate(old_marker, sessions)

        assert set(candidate["processedSessionIds"]) == {"conv-1:old-a", "conv-1:old-b", "conv-2:new"}

    def test_old_ids_outside_the_new_overlap_window_are_dropped(self):
        old_marker = Marker(
            last_session_start=datetime(2026, 11, 4, 0, 0, tzinfo=UTC).isoformat(),  # a full day earlier
            processed_session_ids=["conv-1:ancient"],
            updated_by_run="prior-run",
            etag="e",
        )
        sessions = [_session("conv-2:new", "conv-2", 90)]

        candidate = _new_marker_candidate(old_marker, sessions)

        assert candidate["processedSessionIds"] == ["conv-2:new"]


class TestBuildRecord:
    def test_counts_are_tallied_from_tonights_ledger_lines(self):
        draft_run = DraftRun(
            run_id="2026-11-05",
            bundle={"runId": "2026-11-05", "drafts": [], "needsSetup": [], "listFull": []},
            sources={},
            ledger_lines=(
                {"runId": "2026-11-05", "outcome": "proposed"},
                {"runId": "2026-11-05", "outcome": "covered"},
                {"runId": "2026-11-05", "outcome": "gated"},
                {"runId": "2026-11-05", "outcome": "gated"},
            ),
        )
        reader_run = ReaderRun(run_date="2026-11-05", claimed=True, sessions=())
        result = NightResult(reader_run=reader_run, draft_run=draft_run, scoring_errors=())
        now = datetime(2026, 11, 5, 9, 0, tzinfo=UTC)
        spend_tracker = SpendTracker(cap_usd=50.0)
        spend_tracker.record("score", 1.5)

        record = _build_record(
            "2026-11-05", now, result, {"lastSessionStart": None, "processedSessionIds": []}, spend_tracker
        )

        assert record["counts"]["candidates"] == 4
        assert record["counts"]["proposed"] == 1
        assert record["counts"]["covered"] == 1
        assert record["counts"]["gated"] == 2
        assert record["counts"]["capped"] == 0
        assert record["newMarker"] == {"lastSessionStart": None, "processedSessionIds": []}
        assert record["runId"] == "2026-11-05"
        assert record["spendUsd"] == {"score": 1.5, "draft": 0.0, "gate": 0.0, "total": 1.5}
        assert record["spendCapHit"] is False
