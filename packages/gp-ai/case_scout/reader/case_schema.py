"""Field-level bounds and the Pydantic mirror of `ChatCaseSchema` (TDD "Data
model and contracts"; Implementation Notes section 1.1,
`packages/gp-api/src/chats/evals/judge/cases.ts`).

Shared by drafting.py (which holds the drafting model's own output to these
bounds while parsing it, `_parse_case`) and gate.py (whose independent
re-check against this same mirror is PII gate layer 5, ticket Implementation
Details' "Schema validation"). Living in its own module — rather than
drafting.py defining these and gate.py importing them from there — breaks
what would otherwise be a circular import (drafting.py calls
`gate.gate_draft`; gate.py would need drafting.py's constants) and keeps both
sides reading one copy of numbers that have already drifted from `cases.ts`
three times (test_drafting.py's `TestFieldBoundsPinnedAgainstCasesTs` pins
these against `cases.ts` directly, by importing them back out of
`drafting.py`, which re-exports them from here).
"""

import re
from typing import Any

from pydantic import BaseModel, ValidationError, model_validator

CASE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
MAX_CASE_ID_LENGTH = 80
MAX_CONDITION_CHARS = 2_000
MAX_HANDLED_WHEN_CHARS = 600
MAX_CASE_TURNS = 10


class ChatCaseSchemaMirror(BaseModel):
    """gate.py's own, independently-coded reconstruction of `ChatCaseSchema`'s
    constraints — a second implementation of the same bounds `_parse_case`
    already enforces while parsing the drafting model's reply, not a call
    into that code. The ticket's own tech-debt note ("The scout's Python
    copy of the case fields can drift from ChatCaseSchema") is about drift
    from the TypeScript source; this mirror's job is to be the gate's own
    independent check against that same source, so a bug in the other
    Python copy (`_parse_case`) is not the only thing standing between a
    malformed draft and the PR.
    """

    caseId: str
    question: str | None = None
    turns: list[str] | None = None
    condition: str
    handledWhen: str
    source: str | None = None
    split: str | None = None

    @model_validator(mode="after")
    def _check_bounds(self) -> "ChatCaseSchemaMirror":
        if not CASE_ID_PATTERN.match(self.caseId):
            raise ValueError("caseId does not match the required pattern")
        if len(self.caseId) > MAX_CASE_ID_LENGTH:
            raise ValueError("caseId exceeds the maximum length")
        has_question = bool(self.question)
        has_turns = bool(self.turns)
        if has_question == has_turns:
            raise ValueError("exactly one of question or turns is required")
        if self.turns is not None and len(self.turns) > MAX_CASE_TURNS:
            raise ValueError("turns exceeds the maximum count")
        if len(self.condition) > MAX_CONDITION_CHARS:
            raise ValueError("condition exceeds the maximum length")
        if len(self.handledWhen) > MAX_HANDLED_WHEN_CHARS:
            raise ValueError("handledWhen exceeds the maximum length")
        return self


def validate_against_schema(case: dict[str, Any]) -> str | None:
    """Validates a draft's case dict (`DraftedCase.to_json()`'s shape)
    against the schema mirror. Returns a short, non-identifying reason
    naming which structural rule failed (ticket Acceptance Criteria: a
    gate-failure reason must never carry the matched text) — every message
    `_check_bounds` raises names a rule, never a field's value — or None
    once the draft passes."""
    try:
        ChatCaseSchemaMirror(**case)
    except ValidationError as e:
        errors = e.errors()
        reason = errors[0].get("msg", "schema validation failed") if errors else "schema validation failed"
        # pydantic wraps a model_validator's ValueError as "Value error, <msg>" —
        # strip that generic wrapper so the ledger gets the clause itself.
        return reason.removeprefix("Value error, ")
    return None
