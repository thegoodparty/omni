from datetime import UTC, datetime, timedelta

from case_scout.bucket import CaseScoutBucket, Marker
from case_scout.reader.messages import FakeCaseScoutMessageReader, Message
from case_scout.reader.pipeline import (
    is_internal_filter_for_environment,
    run_reader,
    session_cap_from_env,
)
from case_scout.reader.sessions import segment_into_sessions

from .conftest import TEST_BUCKET


def _msg(conversation_id, role, minute, is_internal=False, scope="chief_of_staff"):
    return Message(
        conversation_id=conversation_id,
        scope=scope,
        message_id=f"{conversation_id}-{minute}",
        role=role,
        content="hello",
        created_at=datetime(2026, 11, 5, 0, 0, tzinfo=UTC) + timedelta(minutes=minute),
        is_internal=is_internal,
    )


def _store(s3_bucket) -> CaseScoutBucket:
    return CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)


class TestClaimIdempotency:
    def test_second_run_for_the_same_night_is_a_no_op(self, s3_bucket):
        store = _store(s3_bucket)
        reader = FakeCaseScoutMessageReader([])

        first = run_reader("2026-11-05", store, reader, environment="dev")
        second = run_reader("2026-11-05", store, reader, environment="dev")

        assert first.claimed is True
        assert second.claimed is False
        assert second.sessions == ()

    def test_different_nights_both_run(self, s3_bucket):
        store = _store(s3_bucket)
        reader = FakeCaseScoutMessageReader([])

        first = run_reader("2026-11-05", store, reader, environment="dev")
        second = run_reader("2026-11-06", store, reader, environment="dev")

        assert first.claimed is True
        assert second.claimed is True


class TestSegmentation:
    def test_messages_within_sixty_minutes_stay_one_session(self):
        messages = [_msg("conv-1", "user", 0), _msg("conv-1", "assistant", 5), _msg("conv-1", "user", 59)]

        sessions = segment_into_sessions(messages)

        assert len(sessions) == 1
        assert sessions[0].session_id == "conv-1:0"
        assert len(sessions[0].messages) == 3

    def test_a_gap_over_sixty_minutes_before_a_user_message_splits_the_session(self):
        messages = [_msg("conv-1", "user", 0), _msg("conv-1", "assistant", 5), _msg("conv-1", "user", 70)]

        sessions = segment_into_sessions(messages)

        assert [s.session_id for s in sessions] == ["conv-1:0", "conv-1:1"]
        assert len(sessions[0].messages) == 2
        assert len(sessions[1].messages) == 1

    def test_an_assistant_message_after_a_long_gap_does_not_start_a_new_session(self):
        # Samuel's starts_session SQL only ever opens a new session on a
        # user message — an assistant reply arriving after a long silence
        # (e.g. a delayed async job) must not split the session on its own.
        messages = [_msg("conv-1", "user", 0), _msg("conv-1", "assistant", 200)]

        sessions = segment_into_sessions(messages)

        assert len(sessions) == 1
        assert len(sessions[0].messages) == 2

    def test_separate_conversations_segment_independently(self):
        messages = [_msg("conv-1", "user", 0), _msg("conv-2", "user", 0)]

        sessions = segment_into_sessions(messages)

        assert {s.session_id for s in sessions} == {"conv-1:0", "conv-2:0"}


class TestOverlapAcrossTheMarkerCutoff:
    def test_a_session_straddling_the_cutoff_is_read_exactly_once(self, s3_bucket):
        store = _store(s3_bucket)
        cutoff = datetime(2026, 11, 5, 22, 0, tzinfo=UTC)
        # Seed a marker whose lastSessionStart sits in the middle of an
        # in-progress session: messages at -30min and -25min (before the
        # cutoff) and +10min (after it), all within 60 minutes of each
        # other, so the conversation never actually closed.
        first = store.read_marker()
        store.write_marker(
            Marker(
                last_session_start=cutoff.isoformat(),
                processed_session_ids=[],
                updated_by_run="seed",
                etag=first.etag,
            )
        )
        messages = [
            Message(
                conversation_id="conv-1",
                scope="chief_of_staff",
                message_id="m1",
                role="user",
                content="before midnight",
                created_at=cutoff - timedelta(minutes=30),
            ),
            Message(
                conversation_id="conv-1",
                scope="chief_of_staff",
                message_id="m2",
                role="assistant",
                content="still going",
                created_at=cutoff - timedelta(minutes=25),
            ),
            Message(
                conversation_id="conv-1",
                scope="chief_of_staff",
                message_id="m3",
                role="user",
                content="after midnight",
                created_at=cutoff + timedelta(minutes=10),
            ),
        ]
        reader = FakeCaseScoutMessageReader(messages)

        result = run_reader("2026-11-05", store, reader, environment="dev")

        assert len(result.sessions) == 1
        assert len(result.sessions[0].messages) == 3
        assert result.window_start == cutoff - timedelta(minutes=60)


class TestProcessedSessionIdsExclusion:
    def test_a_session_id_already_recorded_is_skipped(self, s3_bucket):
        store = _store(s3_bucket)
        # Two sessions in one conversation: the old one is already recorded
        # as processed, the new one isn't.
        old_session = [_msg("conv-1", "user", 0), _msg("conv-1", "assistant", 5)]
        new_session = [_msg("conv-1", "user", 70)]
        first = store.read_marker()
        store.write_marker(
            Marker(
                last_session_start=datetime(2026, 11, 4, tzinfo=UTC).isoformat(),
                processed_session_ids=["conv-1:0"],
                updated_by_run="seed",
                etag=first.etag,
            )
        )
        reader = FakeCaseScoutMessageReader(old_session + new_session)

        result = run_reader("2026-11-05", store, reader, environment="dev")

        assert [s.session_id for s in result.sessions] == ["conv-1:1"]
        assert result.excluded_processed_count == 1


class TestSessionCap:
    def test_the_cap_truncates_the_batch_and_records_how_much_was_capped(self, s3_bucket):
        store = _store(s3_bucket)
        messages = [
            _msg("conv-1", "user", 0),
            _msg("conv-2", "user", 0),
            _msg("conv-3", "user", 0),
        ]
        reader = FakeCaseScoutMessageReader(messages)

        result = run_reader("2026-11-05", store, reader, environment="dev", session_cap=2)

        assert len(result.sessions) == 2
        assert result.capped_count == 1

    def test_cap_is_configurable_via_env(self, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_SESSION_CAP", "5")
        assert session_cap_from_env() == 5

    def test_cap_falls_back_to_the_default_when_unset_or_invalid(self, monkeypatch):
        monkeypatch.delenv("CASE_SCOUT_SESSION_CAP", raising=False)
        assert session_cap_from_env() > 0

        monkeypatch.setenv("CASE_SCOUT_SESSION_CAP", "not-a-number")
        assert session_cap_from_env() > 0


class TestIsInternalFiltering:
    def test_dev_does_not_filter_internal_messages(self, s3_bucket):
        store = _store(s3_bucket)
        reader = FakeCaseScoutMessageReader([_msg("conv-1", "user", 0, is_internal=True)])

        result = run_reader("2026-11-05", store, reader, environment="dev")

        assert len(result.sessions) == 1
        assert result.is_internal_filter is False

    def test_prod_filters_internal_messages(self, s3_bucket):
        store = _store(s3_bucket)
        reader = FakeCaseScoutMessageReader([_msg("conv-1", "user", 0, is_internal=True)])

        result = run_reader("2026-11-05", store, reader, environment="prod")

        assert len(result.sessions) == 0
        assert result.is_internal_filter is True

    def test_is_internal_filter_for_environment(self):
        assert is_internal_filter_for_environment("prod") is True
        assert is_internal_filter_for_environment("dev") is False
        assert is_internal_filter_for_environment("unknown") is False
