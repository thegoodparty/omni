import pytest

from serve.hierarchical_discovery.models import PipelineConfig
from serve.hierarchical_discovery.stages.cluster_analyzer import (
    CLUSTER_ANALYSIS_PROMPT_NAME,
    FEEDBACK_CLUSTER_ANALYSIS_PROMPT_NAME,
    FEEDBACK_SYSTEM_INSTRUCTION,
    POLL_SYSTEM_INSTRUCTION,
    ClusterAnalyzer,
)

# Feedback runs record what a canvasser heard, not what a constituent/voter sent in;
# the wording in docs/product-vocabulary.md's sense ("Win and Serve do not share
# nouns") plus the brief's own banned-word list for this prompt.
BANNED_FEEDBACK_WORDS = [
    "constituents",
    "voters",
    "citizens",
    "respondents",
    "survey",
    "messages",
    "reached out",
]


def _make_analyzer(monkeypatch: pytest.MonkeyPatch, theme_prompt_name: str | None = None) -> ClusterAnalyzer:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    config = PipelineConfig()
    if theme_prompt_name:
        config.analysis = {**config.analysis, "theme_prompt_name": theme_prompt_name}
    return ClusterAnalyzer(config)


class TestThemePromptSelection:
    def test_defaults_to_the_poll_slug_and_instruction(self, monkeypatch: pytest.MonkeyPatch) -> None:
        analyzer = _make_analyzer(monkeypatch)

        assert analyzer.theme_prompt_name == CLUSTER_ANALYSIS_PROMPT_NAME
        assert analyzer._theme_system_instruction() == POLL_SYSTEM_INSTRUCTION

    def test_feedback_runs_pick_the_feedback_slug_and_instruction(self, monkeypatch: pytest.MonkeyPatch) -> None:
        analyzer = _make_analyzer(monkeypatch, theme_prompt_name=FEEDBACK_CLUSTER_ANALYSIS_PROMPT_NAME)

        assert analyzer.theme_prompt_name == FEEDBACK_CLUSTER_ANALYSIS_PROMPT_NAME
        assert analyzer._theme_system_instruction() == FEEDBACK_SYSTEM_INSTRUCTION


class TestFeedbackFallbackPrompt:
    def test_renders_with_the_analyzers_variables(self, monkeypatch: pytest.MonkeyPatch) -> None:
        analyzer = _make_analyzer(monkeypatch, theme_prompt_name=FEEDBACK_CLUSTER_ANALYSIS_PROMPT_NAME)

        prompt = analyzer._create_analysis_prompt(
            cluster_id=1,
            example_texts=["The road is cracked", "Potholes everywhere"],
            cluster_size=2,
            total_clusters=5,
            person_metrics={
                "unique_respondents": 2,
                "avg_mentions_per_respondent": 1.0,
                "respondent_coverage_pct": 40.0,
            },
        )

        assert "2 notes from 2 people" in prompt
        assert "40.0% of everyone who answered" in prompt
        assert "The road is cracked" in prompt
        assert "Potholes everywhere" in prompt

    def test_instruction_text_has_none_of_the_banned_words(self) -> None:
        # The fallback prompt template itself legitimately mentions these words --
        # it's telling the LLM not to use them in its output. What must stay clean
        # is the system instruction, which is what actually frames the call.
        lowered = FEEDBACK_SYSTEM_INSTRUCTION.lower()

        for banned in BANNED_FEEDBACK_WORDS:
            assert banned not in lowered, f"feedback system instruction must not contain '{banned}'"
