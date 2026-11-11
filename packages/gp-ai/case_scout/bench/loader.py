"""Reads the bench fixtures and turns each into the rows the real
`case_scout_messages` view returns, then into `Message` values through the
Databricks reader's own row converter, so a fixture reaches session
splitting exactly the way a production chat does.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from case_scout.reader.messages import Message, _row_to_message
from case_scout.reader.scoring import KNOWN_PATTERNS

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

CONVERSATION_PREFIX = "bench-"

Category = Literal["known_pattern", "good", "borderline", "planted_pii", "duplicate", "uncovered_agent"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class FixtureToolCall(_Strict):
    tool: str = Field(min_length=1)
    input: dict[str, Any] | str


class FixtureMessage(_Strict):
    at: datetime
    role: Literal["user", "assistant"]
    content: str
    tool_calls: list[FixtureToolCall] = Field(default_factory=list)

    @field_validator("at")
    @classmethod
    def _needs_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("a fixture timestamp needs a UTC offset, like the view's timestamps")
        return value


class Expectation(_Strict):
    should_draft: bool
    pattern: str | None = None
    drop_ok: bool = False
    covered_by: str | None = None
    also_pass_if_covered_by: list[str] = Field(default_factory=list)
    scored: bool = True

    @field_validator("pattern")
    @classmethod
    def _known_pattern(cls, value: str | None) -> str | None:
        if value is not None and value not in KNOWN_PATTERNS:
            raise ValueError(f"{value!r} is not one of scoring.KNOWN_PATTERNS")
        return value


class BenchFixture(_Strict):
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    agent: str = Field(min_length=1)
    category: Category
    summary: str = Field(min_length=1)
    notes: str = ""
    expect: Expectation
    planted_pii: list[str] = Field(default_factory=list)
    denylist: list[str] = Field(default_factory=list)
    messages: list[FixtureMessage] = Field(min_length=1)

    @model_validator(mode="after")
    def _label_is_coherent(self) -> "BenchFixture":
        if self.category == "planted_pii" and not self.planted_pii:
            raise ValueError("a planted_pii fixture must list the PII it plants")
        if self.category != "planted_pii" and self.planted_pii:
            raise ValueError("only a planted_pii fixture plants PII")
        if self.expect.drop_ok and not self.expect.should_draft:
            raise ValueError("drop_ok only means something when should_draft is true")
        if self.expect.covered_by is not None and self.expect.should_draft:
            raise ValueError("a fixture with covered_by must not also expect a draft")
        if self.messages[0].role != "user":
            raise ValueError("a fixture opens on a user turn")
        return self

    @property
    def conversation_id(self) -> str:
        return f"{CONVERSATION_PREFIX}{self.id}"


def load_fixtures(directory: Path = FIXTURES_DIR) -> list[BenchFixture]:
    fixtures = [BenchFixture(**json.loads(path.read_text())) for path in sorted(directory.glob("*.json"))]
    ids = [f.id for f in fixtures]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    if duplicates:
        raise ValueError(f"duplicate fixture ids: {duplicates}")
    return fixtures


def fixture_rows(fixture: BenchFixture) -> list[dict[str, Any]]:
    """The view's column set (messages.DatabricksCaseScoutMessageReader's
    SELECT), one row per message. Tool inputs reach the view as text, so an
    object input is serialized here the way a JSON column would arrive."""
    return [
        {
            "conversation_id": fixture.conversation_id,
            "scope": fixture.agent,
            "message_id": f"{fixture.id}-m{index:02d}",
            "role": message.role,
            "content": message.content,
            "created_at": message.at,
            "tool_calls": [
                {
                    "tool": call.tool,
                    "input": call.input if isinstance(call.input, str) else json.dumps(call.input, sort_keys=True),
                }
                for call in message.tool_calls
            ],
            "is_internal": False,
            "denylist": list(fixture.denylist),
        }
        for index, message in enumerate(fixture.messages, start=1)
    ]


def fixture_messages(fixtures: list[BenchFixture]) -> list[Message]:
    return [_row_to_message(row) for fixture in fixtures for row in fixture_rows(fixture)]
