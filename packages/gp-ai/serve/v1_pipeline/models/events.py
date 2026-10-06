#!/usr/bin/env python3

from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class PollIssueAnalysisData:
    pollId: str
    rank: int
    clusterId: int
    theme: str
    summary: str
    analysis: str
    quotes: list[dict[str, str]]
    responseCount: int


@dataclass
class PollAnalysisCompleteData:
    pollId: str
    totalResponses: int
    responsesLocation: str
    issues: list[PollIssueAnalysisData]


@dataclass
class PollAnalysisCompleteEvent:
    data: PollAnalysisCompleteData
    type: str = "pollAnalysisComplete"

    def to_json(self) -> dict:
        return {"type": self.type, "data": asdict(self.data)}


@dataclass
class FeedbackIssueData:
    rank: int
    theme: str
    summary: str
    analysis: str
    responseCount: int
    quotes: list[dict[str, str]]
    memberIds: list[str]


@dataclass
class FeedbackSynthesisCompleteData:
    sourceType: str
    sourceId: str
    totalResponses: int
    responsesLocation: str | None
    issues: list[FeedbackIssueData]


@dataclass
class FeedbackSynthesisCompleteEvent:
    data: FeedbackSynthesisCompleteData
    type: str = "feedbackSynthesisComplete"

    def to_json(self) -> dict[str, Any]:
        return {"type": self.type, "data": asdict(self.data)}
