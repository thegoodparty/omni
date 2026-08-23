import asyncio
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from stitch_golden_data.prod_gold_data.l2_br_matcher import (
    ABSTAINED,
    MATCHED,
    DistrictCandidate,
    L2BrMatcher,
    _district_embedding_text,
    _StateUniverse,
)


@pytest.fixture(autouse=True)
def reset_braintrust_singleton():
    from shared.braintrust import BraintrustClient

    BraintrustClient.reset_instance()
    yield
    BraintrustClient.reset_instance()


@pytest.fixture
def mock_dependencies():
    with (
        patch("stitch_golden_data.prod_gold_data.l2_br_matcher.DatabricksClient") as mock_db,
        patch("stitch_golden_data.prod_gold_data.l2_br_matcher.Gemini3Client") as mock_llm_cls,
        patch("stitch_golden_data.prod_gold_data.l2_br_matcher.GeminiEmbeddingClient") as mock_emb_cls,
        patch("stitch_golden_data.prod_gold_data.l2_br_matcher.init_braintrust") as mock_init_bt,
        patch("stitch_golden_data.prod_gold_data.l2_br_matcher.cache_prompt") as mock_cache,
    ):
        mock_llm = MagicMock()
        mock_llm_cls.return_value = mock_llm
        mock_emb = MagicMock()
        mock_emb_cls.return_value = mock_emb

        yield {
            "databricks": mock_db,
            "llm_cls": mock_llm_cls,
            "llm": mock_llm,
            "embedding_cls": mock_emb_cls,
            "embedding": mock_emb,
            "init_braintrust": mock_init_bt,
            "cache_prompt": mock_cache,
        }


class TestBraintrustInit:
    def test_init_braintrust_called_on_construction(self, mock_dependencies):
        L2BrMatcher()

        mock_dependencies["init_braintrust"].assert_called_once_with(project="stitch-golden-data")

    def test_cache_prompt_called_on_construction(self, mock_dependencies):
        L2BrMatcher()

        mock_dependencies["cache_prompt"].assert_called_once_with(
            "stitch-golden-data-matcher",
        )


class TestPromptBuilding:
    def test_build_cached_prompt_called_with_correct_variables(self, mock_dependencies):
        matcher = L2BrMatcher()

        candidates = [
            DistrictCandidate(
                l2_state="DE",
                l2_district_type="CITY_COUNCIL",
                l2_district_name="City Council District 1",
                similarity_score=0.95,
            ),
            DistrictCandidate(
                l2_state="DE",
                l2_district_type="COUNTY_BOARD",
                l2_district_name="County Board District 2",
                similarity_score=0.85,
            ),
        ]

        mock_dependencies["llm"].generate_structured_content.return_value = {
            "selected_candidate_number": 1,
            "selection_confidence": 90,
            "reasoning": "Best geographic match",
        }

        with patch("stitch_golden_data.prod_gold_data.l2_br_matcher.build_cached_prompt") as mock_build:
            mock_build.return_value = "rendered prompt"

            asyncio.run(matcher._select_candidate("Wilmington City Council", candidates))

            mock_build.assert_called_once()
            call_args = mock_build.call_args
            assert call_args[0][0] == "stitch-golden-data-matcher"

            variables = call_args[0][1]
            assert variables["br_name"] == "Wilmington City Council"
            assert variables["state"] == "DE"
            assert variables["num_districts"] == "2"
            assert "City Council District 1" in variables["districts_text"]
            assert "County Board District 2" in variables["districts_text"]

            assert call_args[1]["fallback_prompt"] is not None
            assert len(call_args[1]["fallback_prompt"]) > 0


class TestTraceNamePassthrough:
    def test_trace_name_passed_to_generate_structured_content(self, mock_dependencies):
        matcher = L2BrMatcher()

        candidates = [
            DistrictCandidate(
                l2_state="NY",
                l2_district_type="SCHOOL_BOARD",
                l2_district_name="School Board",
                similarity_score=0.88,
            ),
        ]

        mock_dependencies["llm"].generate_structured_content.return_value = {
            "selected_candidate_number": 1,
            "selection_confidence": 92,
            "reasoning": "Exact match",
        }

        with patch("stitch_golden_data.prod_gold_data.l2_br_matcher.build_cached_prompt", return_value="prompt"):
            asyncio.run(matcher._select_candidate("School Board", candidates))

        call_kwargs = mock_dependencies["llm"].generate_structured_content.call_args[1]
        assert call_kwargs["trace_name"] == "stitch-match-selection"


class TestDistrictEmbeddingText:
    def test_district_embedding_text_matches_frozen_format(self):
        """Failure this catches: if the embedding text format drifts, every
        cosine similarity score changes and the menu silently differs from
        January's, making the holdout comparison meaningless.
        """
        text = _district_embedding_text("DE", "House", "District 5")

        assert text == "state: DE, district type: House, district name: District 5"


class TestTerminalStatusContract:
    """SPEC 3.4: a run persists only MATCHED and ABSTAINED. A technical error
    fails the run instead of being delivered as a match.
    """

    @staticmethod
    def _seed_single_candidate_universe(
        matcher: L2BrMatcher, office_state: str, candidate_state: str, district_type: str, district_name: str
    ) -> None:
        """One district in one state's universe, pre-embedded so no network
        call is needed to build it.
        """
        matcher._universe_by_state[office_state] = _StateUniverse(
            embeddings=np.array([[1.0, 0.0]]),
            states=[candidate_state],
            district_types=[district_type],
            district_names=[district_name],
        )

    def test_llm_exception_raises_instead_of_returning_a_result(self, mock_dependencies):
        """Failure this catches: a transport failure delivered as a match to
        a district named LLM_ERROR, which joins nothing.
        """
        matcher = L2BrMatcher()
        self._seed_single_candidate_universe(matcher, "DE", "DE", "House", "District 5")
        mock_dependencies["embedding"].create_embeddings.return_value = np.array([[1.0, 0.0]])
        mock_dependencies["llm"].generate_structured_content.side_effect = RuntimeError("Gemini call failed")

        with (
            patch("stitch_golden_data.prod_gold_data.l2_br_matcher.build_cached_prompt", return_value="prompt"),
            pytest.raises(RuntimeError, match="Gemini call failed"),
        ):
            asyncio.run(matcher.match_office(br_database_id=1, br_name="Test Race", state="DE"))

    def test_selection_index_zero_yields_abstained_with_null_district_fields(self, mock_dependencies):
        """Failure this catches: a no-match verdict recorded as a match
        because status was decided by string-comparing the district name
        instead of the selection index.
        """
        matcher = L2BrMatcher()
        self._seed_single_candidate_universe(matcher, "DE", "DE", "House", "District 5")
        mock_dependencies["embedding"].create_embeddings.return_value = np.array([[1.0, 0.0]])
        mock_dependencies["llm"].generate_structured_content.return_value = {
            "selected_candidate_number": 0,
            "selection_confidence": 15,
            "reasoning": "No good candidate",
            "is_exact_district_match": False,
        }

        with patch("stitch_golden_data.prod_gold_data.l2_br_matcher.build_cached_prompt", return_value="prompt"):
            result = asyncio.run(matcher.match_office(br_database_id=1, br_name="Test Race", state="DE"))

        assert result.match_status == ABSTAINED
        assert result.l2_state is None
        assert result.l2_district_type is None
        assert result.l2_district_name is None

    def test_valid_selection_yields_matched_with_the_candidates_own_state(self, mock_dependencies):
        """Failure this catches: the state dropped from the district key
        (e.g. read from the office instead of the selected candidate), so a
        same-named district in another state would resolve silently.
        """
        matcher = L2BrMatcher()
        # The office's own state ("DE") deliberately differs from the
        # candidate's stored state ("ZZ") so the assertion below only passes
        # if the result reads the candidate's state, not the office's.
        self._seed_single_candidate_universe(matcher, "DE", "ZZ", "House", "District 5")
        mock_dependencies["embedding"].create_embeddings.return_value = np.array([[1.0, 0.0]])
        mock_dependencies["llm"].generate_structured_content.return_value = {
            "selected_candidate_number": 1,
            "selection_confidence": 95,
            "reasoning": "Clean match",
            "is_exact_district_match": True,
        }

        with patch("stitch_golden_data.prod_gold_data.l2_br_matcher.build_cached_prompt", return_value="prompt"):
            result = asyncio.run(matcher.match_office(br_database_id=1, br_name="Test Race", state="DE"))

        assert result.match_status == MATCHED
        assert result.l2_state == "ZZ"
        assert result.l2_district_type == "House"
        assert result.l2_district_name == "District 5"
        assert result.confidence == 95
