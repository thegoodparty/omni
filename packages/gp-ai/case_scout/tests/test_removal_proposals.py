"""Ticket Test Plan: noisy-case removal proposals, against fake judge-records
data — no real S3 call anywhere in this file (FakeJudgeRecordsReader)."""

from datetime import UTC, datetime, timedelta

from case_scout.reader.case_lists import CaseListInfo, FakeChatCaseListReader
from case_scout.reader.judge_records import FakeJudgeRecordsReader, SweepAttempt
from case_scout.reader.noisy_cases import (
    ATTEMPTS_PER_CASE,
    SWEEP_WINDOW,
    propose_removal_for_case,
    propose_removals,
)

AGENT = "chief_of_staff"
CASE = "case-noisy"
BASE_TIME = datetime(2026, 11, 1, tzinfo=UTC)


def _sweep(sweep_index: int, handled_count: int, attempts: int = ATTEMPTS_PER_CASE) -> list[SweepAttempt]:
    """One sweep's base-arm attempts at one case: `handled_count` of
    `attempts` are `produced` (handled), the rest `blocked` (not handled).
    Higher `sweep_index` means a more recent sweep."""
    started_at = (BASE_TIME + timedelta(days=sweep_index)).isoformat()
    statuses = ["produced"] * handled_count + ["blocked"] * (attempts - handled_count)
    return [SweepAttempt(sweep_id=f"sweep-{sweep_index}", started_at=started_at, status=status) for status in statuses]


def _attempts(*sweeps: list[SweepAttempt]) -> list[SweepAttempt]:
    flat: list[SweepAttempt] = []
    for sweep in sweeps:
        flat.extend(sweep)
    return flat


def _reader(attempts: list[SweepAttempt], agent: str = AGENT, case: str = CASE) -> FakeJudgeRecordsReader:
    return FakeJudgeRecordsReader({(agent, case): attempts})


class TestProposeRemovalForCase:
    def test_a_split_in_at_least_half_of_the_last_six_sweeps_is_proposed(self):
        # 3 split sweeps (2/3 handled) and 3 clean passes (3/3) — exactly the
        # SWEEP_WINDOW, with split_count == MIN_SPLIT_SWEEPS.
        sweeps = [_sweep(i, 2) for i in range(3)] + [_sweep(i, 3) for i in range(3, 6)]

        proposal = propose_removal_for_case(AGENT, CASE, _reader(_attempts(*sweeps)))

        assert proposal is not None
        assert proposal.case_id == CASE
        assert proposal.agent_id == AGENT
        assert proposal.reason  # non-empty, names the pattern

    def test_a_split_in_only_two_of_the_last_six_sweeps_is_not_proposed(self):
        sweeps = [_sweep(i, 2) for i in range(2)] + [_sweep(i, 3) for i in range(2, 6)]

        proposal = propose_removal_for_case(AGENT, CASE, _reader(_attempts(*sweeps)))

        assert proposal is None

    def test_failing_zero_of_three_on_every_recent_sweep_is_never_proposed(self):
        # Ten sweeps, every one 0/3 handled: this is the TDD's "prod failure"
        # case, and must never be proposed no matter how many sweeps show it
        # — not even by a naive calculation that confuses "0 is unusual" with
        # "0 is a split" (0 is neither 1 nor 2).
        sweeps = [_sweep(i, 0) for i in range(10)]

        proposal = propose_removal_for_case(AGENT, CASE, _reader(_attempts(*sweeps)))

        assert proposal is None

    def test_passing_three_of_three_consistently_is_never_proposed(self):
        sweeps = [_sweep(i, 3) for i in range(8)]

        proposal = propose_removal_for_case(AGENT, CASE, _reader(_attempts(*sweeps)))

        assert proposal is None

    def test_fewer_than_six_sweeps_of_history_degrades_to_no_proposal(self):
        # Only 3 sweeps of history exist at all, and every one is a split —
        # a naive rate calculation (3/3 = 100% split) would propose removal;
        # requiring a full SWEEP_WINDOW of history refuses instead.
        assert SWEEP_WINDOW == 6
        sweeps = [_sweep(i, 2) for i in range(3)]

        proposal = propose_removal_for_case(AGENT, CASE, _reader(_attempts(*sweeps)))

        assert proposal is None

    def test_a_sweep_with_an_incomplete_capture_is_dropped_before_counting(self):
        # One sweep recorded only 2 attempts (an aborted capture) — it must
        # not count as a split, a pass, or toward the six-sweep window.
        incomplete = [SweepAttempt(sweep_id="sweep-incomplete", started_at=BASE_TIME.isoformat(), status="produced")]
        complete_splits = [_sweep(i, 2) for i in range(1, 4)]
        complete_passes = [_sweep(i, 3) for i in range(4, 7)]

        proposal = propose_removal_for_case(
            AGENT, CASE, _reader(incomplete + _attempts(*complete_splits, *complete_passes))
        )

        # Exactly SWEEP_WINDOW complete sweeps exist (the incomplete one is
        # dropped), with 3 splits among them — still proposed.
        assert proposal is not None

    def test_a_case_with_no_recorded_attempts_at_all_is_never_proposed(self):
        proposal = propose_removal_for_case(AGENT, CASE, FakeJudgeRecordsReader())

        assert proposal is None


class TestProposeRemovals:
    def test_aggregates_proposals_across_agents_and_cases(self):
        noisy_sweeps = [_sweep(i, 2) for i in range(3)] + [_sweep(i, 3) for i in range(3, 6)]
        clean_sweeps = [_sweep(i, 3) for i in range(6)]

        case_lists = FakeChatCaseListReader(
            {
                "chief_of_staff": CaseListInfo(
                    agent_id="chief_of_staff",
                    case_count=2,
                    case_ids=frozenset({"noisy-case", "clean-case"}),
                    conditions=(),
                    fixture_description="",
                )
            }
        )
        reader = FakeJudgeRecordsReader(
            {
                ("chief_of_staff", "noisy-case"): _attempts(*noisy_sweeps),
                ("chief_of_staff", "clean-case"): _attempts(*clean_sweeps),
            }
        )

        proposals = propose_removals(case_lists, reader, agent_ids=("chief_of_staff",))

        assert proposals == [
            {
                "caseId": "noisy-case",
                "agentId": "chief_of_staff",
                "reason": proposals[0]["reason"],
            }
        ]

    def test_an_agent_with_no_case_list_entry_contributes_no_proposals(self):
        proposals = propose_removals(FakeChatCaseListReader(), FakeJudgeRecordsReader(), agent_ids=("chief_of_staff",))

        assert proposals == []
