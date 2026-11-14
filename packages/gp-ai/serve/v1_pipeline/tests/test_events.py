from serve.v1_pipeline.models.events import (
    FeedbackSynthesisCompleteData,
    FeedbackSynthesisCompleteEvent,
    PollAnalysisCompleteData,
    PollAnalysisCompleteEvent,
)


class TestPollAnalysisCompleteEventPromptSource:
    def test_omits_prompt_source_when_unset(self):
        event = PollAnalysisCompleteEvent(
            data=PollAnalysisCompleteData(pollId="poll-1", totalResponses=0, responsesLocation="", issues=[])
        )

        assert "promptSource" not in event.to_json()["data"]

    def test_includes_prompt_source_when_hosted(self):
        event = PollAnalysisCompleteEvent(
            data=PollAnalysisCompleteData(
                pollId="poll-1",
                totalResponses=0,
                responsesLocation="",
                issues=[],
                promptSource="hosted",
            )
        )

        assert event.to_json()["data"]["promptSource"] == "hosted"

    def test_includes_prompt_source_when_fallback(self):
        event = PollAnalysisCompleteEvent(
            data=PollAnalysisCompleteData(
                pollId="poll-1",
                totalResponses=0,
                responsesLocation="",
                issues=[],
                promptSource="fallback",
            )
        )

        assert event.to_json()["data"]["promptSource"] == "fallback"


class TestFeedbackSynthesisCompleteEventPromptSource:
    def test_omits_prompt_source_when_unset(self):
        event = FeedbackSynthesisCompleteEvent(
            data=FeedbackSynthesisCompleteData(
                sourceType="constituent_feedback",
                sourceId="run-1",
                totalResponses=0,
                responsesLocation=None,
                issues=[],
            )
        )

        assert "promptSource" not in event.to_json()["data"]

    def test_includes_prompt_source_when_fallback(self):
        event = FeedbackSynthesisCompleteEvent(
            data=FeedbackSynthesisCompleteData(
                sourceType="constituent_feedback",
                sourceId="run-1",
                totalResponses=0,
                responsesLocation=None,
                issues=[],
                promptSource="fallback",
            )
        )

        assert event.to_json()["data"]["promptSource"] == "fallback"


class TestPollAnalysisCompleteEventPromptFallbackReason:
    def test_omits_the_reason_when_unset(self):
        event = PollAnalysisCompleteEvent(
            data=PollAnalysisCompleteData(
                pollId="poll-1",
                totalResponses=0,
                responsesLocation="",
                issues=[],
                promptSource="hosted",
            )
        )

        assert "promptFallbackReason" not in event.to_json()["data"]

    def test_includes_the_reason_alongside_the_fallback_source(self):
        event = PollAnalysisCompleteEvent(
            data=PollAnalysisCompleteData(
                pollId="poll-1",
                totalResponses=0,
                responsesLocation="",
                issues=[],
                promptSource="fallback",
                promptFallbackReason="unavailable",
            )
        )

        data = event.to_json()["data"]
        assert data["promptSource"] == "fallback"
        assert data["promptFallbackReason"] == "unavailable"


class TestFeedbackSynthesisCompleteEventPromptFallbackReason:
    def test_omits_the_reason_when_unset(self):
        event = FeedbackSynthesisCompleteEvent(
            data=FeedbackSynthesisCompleteData(
                sourceType="constituent_feedback",
                sourceId="run-1",
                totalResponses=0,
                responsesLocation=None,
                issues=[],
                promptSource="hosted",
            )
        )

        assert "promptFallbackReason" not in event.to_json()["data"]

    def test_includes_the_reason_alongside_the_fallback_source(self):
        event = FeedbackSynthesisCompleteEvent(
            data=FeedbackSynthesisCompleteData(
                sourceType="constituent_feedback",
                sourceId="run-1",
                totalResponses=0,
                responsesLocation=None,
                issues=[],
                promptSource="fallback",
                promptFallbackReason="mismatch",
            )
        )

        data = event.to_json()["data"]
        assert data["promptSource"] == "fallback"
        assert data["promptFallbackReason"] == "mismatch"
