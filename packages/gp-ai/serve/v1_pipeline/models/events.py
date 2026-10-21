#!/usr/bin/env python3

from dataclasses import asdict, dataclass
from typing import Any

from shared.braintrust import PromptSource


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
    # Where the cluster-analysis theme prompt came from. None when no
    # analysis ran (e.g. zero messages), in which case the key is left off
    # the wire entirely rather than sent as null — see `to_json`.
    promptSource: PromptSource | None = None


@dataclass
class PollAnalysisCompleteEvent:
    data: PollAnalysisCompleteData
    type: str = "pollAnalysisComplete"

    def to_json(self) -> dict:
        data = asdict(self.data)
        if data["promptSource"] is None:
            del data["promptSource"]
        return {"type": self.type, "data": data}


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
    # Where the cluster-analysis theme prompt came from. None when no
    # analysis ran, in which case the key is left off the wire entirely
    # rather than sent as null — see `to_json`.
    promptSource: PromptSource | None = None


@dataclass
class FeedbackSynthesisCompleteEvent:
    data: FeedbackSynthesisCompleteData
    type: str = "feedbackSynthesisComplete"

    def to_json(self) -> dict[str, Any]:
        data = asdict(self.data)
        if data["promptSource"] is None:
            del data["promptSource"]
        return {"type": self.type, "data": data}
