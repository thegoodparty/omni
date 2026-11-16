"""What a live bench run should cost, before it runs and after.

An estimate from character counts, not metering: the scout's call functions
return only the reply text, so token usage never reaches this side.
reader/spend.py's flat per-call figure is a runaway guard priced at old Opus
rates, far above a real call, so it would overstate a bench run several
times over.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from case_scout.bench.judge_loader import JUDGE_CASES_DIR
from case_scout.bench.loader import BenchFixture, fixture_messages
from case_scout.bench.runner import CallRecorder, LocalChatCaseListReader
from case_scout.reader.case_lists import CaseListFetchError, CaseListInfo
from case_scout.reader.drafting import DraftContext, build_system_prompt
from case_scout.reader.gate import SECOND_READ_PROMPT
from case_scout.reader.scoring import MODEL, PROMPT, render_session_transcript, should_score
from case_scout.reader.sessions import segment_into_sessions

# List price for scoring.MODEL (claude-opus-4-7), per million tokens.
INPUT_USD_PER_MTOK = 5.0
OUTPUT_USD_PER_MTOK = 25.0

# Conservative for English prose on the Opus 4.7 tokenizer, which spends more
# tokens per character than earlier Claude models did.
CHARS_PER_TOKEN = 3.0

ASSUMED_OUTPUT_TOKENS = {"score": 700, "draft": 600, "gate": 100}
ASSUMED_GATE_DRAFT_CHARS = 1_500


@dataclass(frozen=True)
class CostEstimate:
    model: str
    expected_usd: float
    worst_usd: float
    expected_calls: dict[str, int]
    worst_calls: dict[str, int]


def _usd(input_chars: float, output_tokens: float) -> float:
    return (input_chars / CHARS_PER_TOKEN) * INPUT_USD_PER_MTOK / 1e6 + output_tokens * OUTPUT_USD_PER_MTOK / 1e6


def estimate_before(fixtures: list[BenchFixture], cases_dir: Path = JUDGE_CASES_DIR) -> CostEstimate:
    """`expected` assumes the scout does what each fixture's label says
    (every should_draft or duplicate fixture reaches drafting, every
    should_draft one reaches the gate). `worst` assumes every covered
    fixture is drafted and gated and every call needs its one retry."""
    by_conversation = {f.conversation_id: f for f in fixtures}
    reader = LocalChatCaseListReader(cases_dir)
    lists: dict[str, CaseListInfo] = {}

    expected = {"score": 0.0, "draft": 0.0, "gate": 0.0}
    worst = {"score": 0.0, "draft": 0.0, "gate": 0.0}
    expected_calls = {"score": 0, "draft": 0, "gate": 0}
    worst_calls = {"score": 0, "draft": 0, "gate": 0}

    for session in segment_into_sessions(fixture_messages(fixtures)):
        if not should_score(session):
            continue
        fixture = by_conversation[session.conversation_id]
        transcript = render_session_transcript(session)
        if session.scope not in lists:
            try:
                lists[session.scope] = reader.read(session.scope)
            except CaseListFetchError:
                lists[session.scope] = CaseListInfo.empty(session.scope)
        case_list = lists[session.scope]
        system = build_system_prompt(
            DraftContext(
                agent_id=session.scope,
                fixture_description=case_list.fixture_description,
                current_conditions=case_list.conditions,
                recent_proposals=(),
            )
        )

        costs = {
            "score": _usd(len(PROMPT) + len(transcript), ASSUMED_OUTPUT_TOKENS["score"]),
            "draft": _usd(len(system) + len(transcript), ASSUMED_OUTPUT_TOKENS["draft"]),
            "gate": _usd(len(SECOND_READ_PROMPT) + ASSUMED_GATE_DRAFT_CHARS, ASSUMED_OUTPUT_TOKENS["gate"]),
        }
        reaches = {
            "score": True,
            "draft": fixture.expect.should_draft or fixture.expect.covered_by is not None,
            "gate": fixture.expect.should_draft,
        }
        for stage, cost in costs.items():
            worst[stage] += 2 * cost
            worst_calls[stage] += 2
            if reaches[stage]:
                expected[stage] += cost
                expected_calls[stage] += 1

    return CostEstimate(
        model=MODEL,
        expected_usd=round(sum(expected.values()), 2),
        worst_usd=round(sum(worst.values()), 2),
        expected_calls=expected_calls,
        worst_calls=worst_calls,
    )


def estimate_after(recorder: CallRecorder) -> dict[str, Any]:
    by_stage: dict[str, float] = {}
    for call in recorder.calls:
        by_stage[call.stage] = by_stage.get(call.stage, 0.0) + _usd(
            call.input_chars, len(call.output) / CHARS_PER_TOKEN
        )
    return {
        "model": MODEL,
        "calls": {stage: sum(1 for c in recorder.calls if c.stage == stage) for stage in ("score", "draft", "gate")},
        "estimatedUsd": round(sum(by_stage.values()), 2),
        "estimatedUsdByStage": {k: round(v, 3) for k, v in by_stage.items()},
    }
