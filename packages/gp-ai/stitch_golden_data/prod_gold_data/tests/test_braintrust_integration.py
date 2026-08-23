import asyncio
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from stitch_golden_data.prod_gold_data.l2_br_matcher import (
    ABSTAINED,
    MATCHED,
    DistrictCandidate,
    L2BrMatcher,
    _district_embedding_text,
    _selection_from_response,
    _StateUniverse,
)
from stitch_golden_data.prod_gold_data.vector_store_generator import VectorStoreGenerator


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
                l2_state="DE", l2_district_type="CITY_COUNCIL", l2_district_name="City Council District 1"
            ),
            DistrictCandidate(
                l2_state="DE", l2_district_type="COUNTY_BOARD", l2_district_name="County Board District 2"
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
            DistrictCandidate(l2_state="NY", l2_district_type="SCHOOL_BOARD", l2_district_name="School Board"),
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
    def test_district_embedding_text_matches_the_producer(self):
        """Failure this catches: if the embedding text format drifts, every
        cosine similarity score changes and the menu silently differs from
        January's, making the holdout comparison meaningless. Compares
        against vector_store_generator.create_embedding_texts's own output
        rather than a hand-typed literal, so a drift in either copy fails --
        `self` is unused inside that method, so it is safe to call unbound.
        """
        df = pd.DataFrame({"l2_district_name": ["District 5"], "l2_district_type": ["House"], "state": ["DE"]})
        producer_texts, _ = VectorStoreGenerator.create_embedding_texts(None, df, "DE")

        text = _district_embedding_text("DE", "House", "District 5")

        assert text == producer_texts[0]


class TestSelectionValidation:
    """C: the response schema declares selected_candidate_number as a bare
    number, and shared/llm_gemini_3.py returns bare json.loads with no
    client-side validation, so a non-integral, boolean, or out-of-range
    value must raise rather than be silently truncated or coerced.
    """

    @pytest.mark.parametrize(
        "response",
        [
            {"selected_candidate_number": 3.9, "selection_confidence": 90},
            {"selected_candidate_number": True, "selection_confidence": 90},
            {"selected_candidate_number": 1, "selection_confidence": "95"},
            {"selected_candidate_number": 1, "selection_confidence": 950},
            {"selected_candidate_number": 1, "selection_confidence": 87.5},
        ],
        ids=[
            "fractional-index",
            "boolean-index",
            "string-confidence",
            "out-of-range-confidence",
            "fractional-confidence",
        ],
    )
    def test_malformed_selection_or_confidence_raises(self, response):
        """Failure this catches: `int(float(3.9)) == 3` silently records the
        model's 4th choice as its 3rd, `int(float(True)) == 1` lets a
        boolean select candidate 1, and a string/out-of-range/fractional
        confidence writes cleanly into a `confidence bigint` column that
        expects an integer 0-100.
        """
        with pytest.raises(ValueError):
            _selection_from_response(response, num_candidates=5)


class TestTaskTypeInvariant:
    """K: create_embeddings dispatches on `len(texts) == 1` to decide task
    type. A mock stubbed with a bare `return_value` is insensitive to its
    call arguments, so batching the two query embeddings into one call would
    stay green even though it moves both into RETRIEVAL_DOCUMENT space.
    """

    def test_query_embeddings_are_never_batched_together(self, mock_dependencies):
        """Failure this catches: queries batched into one call move into
        RETRIEVAL_DOCUMENT space, changing every similarity score, and
        nothing raises.
        """
        matcher = L2BrMatcher()
        matcher._universe_by_state["DE"] = _StateUniverse(
            embeddings=np.array([[1.0, 0.0]]), states=["DE"], district_types=["House"], district_names=["District 5"]
        )
        # Size-aware, not a flat return_value: a flat return would make a
        # wrongly-batched call still unpack cleanly (a false negative), so
        # the call-count/call-shape assertions below are what would ever
        # fail rather than an incidental unpacking crash.
        mock_dependencies["embedding"].create_embeddings.side_effect = lambda texts, **kwargs: np.array(
            [[1.0, 0.0]] * len(texts)
        )
        mock_dependencies["llm"].generate_structured_content.return_value = {
            "selected_candidate_number": 1,
            "selection_confidence": 90,
            "reasoning": "Clean match",
            "is_exact_district_match": True,
        }

        with patch("stitch_golden_data.prod_gold_data.l2_br_matcher.build_cached_prompt", return_value="prompt"):
            asyncio.run(matcher.match_office(br_database_id=1, br_name="Test Race", state="DE"))

        calls = mock_dependencies["embedding"].create_embeddings.call_args_list
        assert len(calls) == 2, f"expected one create_embeddings call per query, got {len(calls)}"
        for call in calls:
            texts = call.args[0]
            assert len(texts) == 1, (
                "a query embedding call must carry exactly one text or it moves into RETRIEVAL_DOCUMENT space"
            )


class TestTerminalStatusContract:
    """A run persists only MATCHED and ABSTAINED. A technical error fails
    the run instead of being delivered as a match.
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
            "selection_confidence": 95.0,
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
        assert isinstance(result.confidence, int)


class TestRunEndToEnd:
    """A: build_universe is called from run()'s own event loop, and
    create_embeddings does `asyncio.run(...)` internally for any multi-text
    input (shared/llm_gemini.py:941) -- calling it directly, not through a
    thread, raises `RuntimeError: asyncio.run() cannot be called from a
    running event loop`. Every state's real universe has at least two rows
    (real districts plus the synthetic 'State' row), so the single-text
    escape never applies. This drives run() end to end with the Databricks
    reads mocked but the universe built through the real code path -- the
    other tests in this file all pre-seed `_universe_by_state` by hand and
    never exercise it.
    """

    @staticmethod
    def _create_embeddings_side_effect(texts, **kwargs):
        if len(texts) != 1:
            # Reproduce the real client's behavior for a multi-text call:
            # asyncio.run(...) internally. This raises if called directly
            # from a running event loop, which is exactly the crash this
            # test exists to catch, without needing the real Gemini client.
            asyncio.run(asyncio.sleep(0))
        return np.array([[1.0, 0.0]] * len(texts))

    def test_run_builds_the_universe_and_reaches_office_matching(self, mock_dependencies):
        pending_df = pd.DataFrame({"br_database_id": [1], "name": ["Test Race"], "state": ["DE"]})
        universe_df = pd.DataFrame(
            {
                # Lower case on purpose: the worklist side is normalized, so if the
                # universe key is not, this state goes missing and run() raises.
                "state_postal_code": ["de", "de"],
                "district_type": ["House", "State"],
                "district_name": ["District 5", "Delaware"],
            }
        )
        mock_dependencies["databricks"].return_value.execute_query.side_effect = [pending_df, universe_df]
        mock_dependencies["embedding"].create_embeddings.side_effect = self._create_embeddings_side_effect
        # Realistic (not auto-MagicMock) cost-stat returns: run() reads these
        # for its cost baseline regardless of outcome, and a failure logs a
        # delta against them, so an unconfigured mock would fail on a
        # MagicMock-minus-MagicMock format string rather than on the actual
        # assertion.
        mock_dependencies["embedding"].get_cost_stats.return_value = {"total_cost": 0.0}
        mock_dependencies["llm"].get_usage_stats.return_value = {"total_cost": 0.0}
        mock_dependencies["llm"].generate_structured_content.return_value = {
            "selected_candidate_number": 1,
            "selection_confidence": 90,
            "reasoning": "Clean match",
            "is_exact_district_match": True,
        }

        matcher = L2BrMatcher()
        with patch("stitch_golden_data.prod_gold_data.l2_br_matcher.build_cached_prompt", return_value="prompt"):
            results = asyncio.run(matcher.run())

        assert len(results) == 1
        assert results[0].match_status == MATCHED
        assert results[0].br_database_id == 1
