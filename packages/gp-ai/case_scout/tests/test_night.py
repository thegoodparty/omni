import json
from datetime import UTC, datetime, timedelta

from case_scout.bucket import CaseScoutBucket
from case_scout.reader.case_lists import CaseListInfo, FakeChatCaseListReader
from case_scout.reader.judge_records import FakeJudgeRecordsReader, SweepAttempt
from case_scout.reader.messages import FakeCaseScoutMessageReader, Message
from case_scout.reader.night import run_night

from .conftest import TEST_BUCKET

NOW = datetime(2026, 11, 5, 6, 0, tzinfo=UTC)


def _store(s3_bucket) -> CaseScoutBucket:
    return CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)


def _msg(conversation_id, minute, scope="chief_of_staff", content="I need help with something real"):
    return Message(
        conversation_id=conversation_id,
        scope=scope,
        message_id=f"{conversation_id}-{minute}",
        role="user",
        content=content,
        created_at=NOW - timedelta(hours=2) + timedelta(minutes=minute),
    )


def _score_response(severity=3):
    return json.dumps(
        {
            "session_id": "ignored",
            "requests": [
                {
                    "request_ordinal": 1,
                    "primary_use_case": "voter_data",
                    "answered_request": "no",
                    "overall_rating": "bad",
                    "major_failure_type": "wrong_or_invented",
                    "known_pattern": "none",
                    "severity": severity,
                    "confidence": "high",
                    "human_review_needed": "yes",
                    "worth_quoting_anonymized": "no",
                    "summary_nonidentifying": "asked something",
                    "reason_nonidentifying": "got it wrong",
                }
            ],
        }
    )


def _draft_response(case_id="case-x"):
    return json.dumps(
        {
            "outcome": "newCase",
            "failureSummary": "a wrong answer",
            "case": {
                "caseId": case_id,
                "question": "a question",
                "condition": "a condition",
                "handledWhen": "a passing reply does X",
            },
        }
    )


class TestRunNight:
    def test_claims_scores_and_drafts_then_the_caller_persists_the_result(self, s3_bucket):
        store = _store(s3_bucket)
        reader = FakeCaseScoutMessageReader([_msg("conv-1", 0)])

        result = run_night(
            "2026-11-05",
            store,
            reader,
            environment="dev",
            now=NOW,
            case_list_reader=FakeChatCaseListReader(),
            judge_records_reader=FakeJudgeRecordsReader(),
            score_call=lambda system, transcript: _score_response(),
            draft_call=lambda system, transcript: _draft_response(),
            second_read_call=lambda draft_text: "[]",
        )

        assert result.reader_run.claimed is True
        assert result.draft_run is not None
        assert len(result.draft_run.bundle["drafts"]) == 1
        assert result.draft_run.bundle["drafts"][0]["case"]["caseId"] == "case-x"
        assert result.scoring_errors == ()
        assert result.draft_run.bundle["removals"] == []

    def test_a_noisy_case_on_an_existing_list_reaches_the_bundles_removals(self, s3_bucket):
        store = _store(s3_bucket)
        reader = FakeCaseScoutMessageReader([])

        split_statuses = ["produced", "produced", "blocked"]
        attempts = [
            SweepAttempt(sweep_id=f"sweep-{i}", started_at=f"2026-10-{i + 1:02d}T00:00:00Z", status=status)
            for i in range(6)
            for status in split_statuses
        ]

        result = run_night(
            "2026-11-05",
            store,
            reader,
            environment="dev",
            now=NOW,
            case_list_reader=FakeChatCaseListReader(
                {
                    "chief_of_staff": CaseListInfo(
                        agent_id="chief_of_staff",
                        case_count=1,
                        case_ids=frozenset({"noisy-case"}),
                        conditions=(),
                        fixture_description="",
                    )
                }
            ),
            judge_records_reader=FakeJudgeRecordsReader({("chief_of_staff", "noisy-case"): attempts}),
        )

        assert result.draft_run is not None
        removals = result.draft_run.bundle["removals"]
        assert len(removals) == 1
        assert removals[0]["caseId"] == "noisy-case"
        assert removals[0]["agentId"] == "chief_of_staff"

    def test_a_night_already_claimed_produces_no_draft_run(self, s3_bucket):
        store = _store(s3_bucket)
        reader = FakeCaseScoutMessageReader([])
        run_night(
            "2026-11-05",
            store,
            reader,
            environment="dev",
            now=NOW,
            case_list_reader=FakeChatCaseListReader(),
            judge_records_reader=FakeJudgeRecordsReader(),
        )

        second = run_night(
            "2026-11-05",
            store,
            reader,
            environment="dev",
            now=NOW,
            case_list_reader=FakeChatCaseListReader(),
            judge_records_reader=FakeJudgeRecordsReader(),
        )

        assert second.reader_run.claimed is False
        assert second.draft_run is None

    def test_a_low_trailing_merge_share_lowers_the_nightly_cap(self, s3_bucket):
        store = _store(s3_bucket)
        # Seed last month's ledger with a low merge share: 10 proposed, only
        # 2 merged — well under the 40% floor (cap.py).
        for i in range(10):
            store.append_ledger_line(
                "2026-10",
                {
                    "conversationId": f"conv-old-{i}",
                    "agentId": "chief_of_staff",
                    "outcome": "proposed",
                    "caseId": f"old-case-{i}",
                    "failureSummary": "an old failure",
                    "createdAt": (NOW - timedelta(days=10)).isoformat(),
                },
            )
        for i in range(2):
            store.append_ledger_line(
                "2026-10",
                {
                    "conversationId": f"conv-old-{i}",
                    "agentId": "chief_of_staff",
                    "outcome": "merged",
                    "caseId": f"old-case-{i}",
                    "failureSummary": "an old failure",
                    "createdAt": (NOW - timedelta(days=5)).isoformat(),
                },
            )

        reader = FakeCaseScoutMessageReader([_msg(f"conv-new-{i}", i) for i in range(6)])

        result = run_night(
            "2026-11-05",
            store,
            reader,
            environment="dev",
            now=NOW,
            case_list_reader=FakeChatCaseListReader(),
            judge_records_reader=FakeJudgeRecordsReader(),
            score_call=lambda system, transcript: _score_response(),
            draft_call=lambda system, transcript: _draft_response(case_id="new-case"),
        )

        # 6 same-conversation... actually 6 distinct conversations, one
        # candidate each; with the cap lowered to 1 or 2, most should be
        # capped rather than proposed.
        outcomes = [line["outcome"] for line in result.draft_run.ledger_lines]
        assert outcomes.count("capped") >= 4
