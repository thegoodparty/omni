"""Label-echo stand-ins for the three model calls: each answers with what
the fixture's own label says should happen. `--stub` runs the whole bench
with these, for free, to check the plumbing and preview report.html. A stub
run says nothing about the scout's quality; only a live run does.
"""

import json
import re
from collections.abc import Callable

from case_scout.bench.loader import CONVERSATION_PREFIX, BenchFixture

_SESSION_HEADER = re.compile(r"^# session (\S+)", re.M)


def _fixture_for(transcript: str, fixtures: dict[str, BenchFixture]) -> BenchFixture:
    match = _SESSION_HEADER.search(transcript)
    if match is None:
        raise ValueError("transcript has no session header")
    conversation_id = match.group(1).split(":", 1)[0]
    return fixtures[conversation_id.removeprefix(CONVERSATION_PREFIX)]


def label_echo_calls(
    fixtures: list[BenchFixture],
) -> tuple[Callable[[str, str], str], Callable[[str, str], str], Callable[[str], str]]:
    by_id = {f.id: f for f in fixtures}

    def score(system: str, transcript: str) -> str:
        fixture = _fixture_for(transcript, by_id)
        failing = fixture.expect.should_draft or fixture.expect.covered_by is not None
        severity = 3 if failing else 1 if fixture.category == "borderline" else 0
        return json.dumps(
            {
                "session_id": "stub",
                "requests": [
                    {
                        "request_ordinal": 1,
                        "primary_use_case": "other",
                        "answered_request": "no" if failing else "yes",
                        "overall_rating": "bad" if failing else "good",
                        "major_failure_type": "wrong_or_invented" if failing else "none",
                        "known_pattern": fixture.expect.pattern or "none",
                        "severity": severity,
                        "confidence": "high",
                        "human_review_needed": "no",
                        "worth_quoting_anonymized": "no",
                        "summary_nonidentifying": "stub score from the fixture label",
                        "reason_nonidentifying": "stub score from the fixture label",
                    }
                ],
            }
        )

    def draft(system: str, transcript: str) -> str:
        fixture = _fixture_for(transcript, by_id)
        if fixture.expect.covered_by is not None:
            return json.dumps(
                {"outcome": "coveredBy", "failureSummary": f"stub {fixture.id}", "caseId": fixture.expect.covered_by}
            )
        return json.dumps(
            {
                "outcome": "newCase",
                "failureSummary": f"stub {fixture.id}",
                "case": {
                    "caseId": f"bench-stub-{fixture.id}",
                    "question": "A stub question standing in for the drafted one.",
                    "condition": "A stub condition. A live run replaces this with the scout's own draft.",
                    "handledWhen": "the reply does the stub thing; a failing reply does not.",
                },
            }
        )

    def second_read(draft_text: str) -> str:
        return "[]"

    return score, draft, second_read
