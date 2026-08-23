"""Tests for the two matcher fixes routed into the write-path PR from PR 1:
quota-exhaustion detection (a log line naming the cause, since
shared/llm_gemini_3.py and shared/llm_gemini.py retry every exception
identically and blindly) and the thread-pool/connection context manager.
"""

import asyncio
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from stitch_golden_data.prod_gold_data.l2_br_matcher import L2BrMatcher, _is_quota_exhausted


@pytest.fixture
def mock_dependencies():
    with (
        patch("stitch_golden_data.prod_gold_data.l2_br_matcher.DatabricksClient") as mock_db,
        patch("stitch_golden_data.prod_gold_data.l2_br_matcher.Gemini3Client") as mock_llm_cls,
        patch("stitch_golden_data.prod_gold_data.l2_br_matcher.GeminiEmbeddingClient") as mock_emb_cls,
        patch("stitch_golden_data.prod_gold_data.l2_br_matcher.init_braintrust"),
        patch("stitch_golden_data.prod_gold_data.l2_br_matcher.cache_prompt"),
    ):
        mock_llm = MagicMock()
        mock_llm_cls.return_value = mock_llm
        mock_emb = MagicMock()
        mock_emb_cls.return_value = mock_emb
        mock_emb.get_cost_stats.return_value = {"total_cost": 0.0}
        mock_llm.get_usage_stats.return_value = {"total_cost": 0.0}
        yield {"databricks": mock_db, "llm": mock_llm, "embedding": mock_emb}


def _one_office_universe_and_pending():
    pending_df = pd.DataFrame({"br_database_id": [1], "name": ["Test Race"], "state": ["DE"]})
    universe_df = pd.DataFrame(
        {
            "state_postal_code": ["DE", "DE"],
            "district_type": ["House", "State"],
            "district_name": ["District 5", "Delaware"],
        }
    )
    return pending_df, universe_df


class TestQuotaExhaustionDetection:
    """The deleted matcher had three branches naming a quota wall
    explicitly and cancelling remaining work. shared/'s retry loops
    (max_retries=11, base_delay=1.0, ~1023s blocking sleep per call) treat
    every exception identically, so nothing today tells an operator "this
    is quota, waiting will not help" versus a real bug.
    """

    @pytest.mark.parametrize(
        "message",
        [
            "429 RESOURCE_EXHAUSTED. {'error': {'code': 429}}",
            "Failed to create embeddings for batch 1 after 11 attempts. "
            "Last error: Client error '429 Too Many Requests' for url '...'",
            "Quota exceeded for quota metric 'GenerateContent requests'",
        ],
        ids=["llm-client-error-shape", "embedding-wrapped-runtimeerror-shape", "quota-wording-without-a-code"],
    )
    def test_recognizes_known_quota_exhaustion_shapes(self, message):
        """Failure this catches: a real quota error reaches the operator as
        an unlabeled generic failure because the detector only matched one
        of the two call paths' wrapping shapes.
        """
        assert _is_quota_exhausted(RuntimeError(message)) is True

    @pytest.mark.parametrize(
        "message",
        [
            "Empty response from API",
            "Malformed LLM response, expected a numeric selection and confidence: {}",
            # The digits 429 in ordinary data, not a status code. A bare `429`
            # alternative in the pattern matched both of these.
            "No district universe entry for School District 429",
            "1 pending office(s) have a blank or null name: [4290]",
        ],
        ids=["empty-response", "malformed-response", "429-in-a-district-name", "429-inside-an-office-id"],
    )
    def test_does_not_flag_an_unrelated_failure(self, message):
        """Failure this catches: every run failure gets mislabeled QUOTA
        EXHAUSTED, training the operator to ignore the label.
        """
        assert _is_quota_exhausted(RuntimeError(message)) is False

    def test_run_names_the_cause_when_a_query_embedding_hits_a_quota_wall(self, mock_dependencies):
        """Failure this catches: a quota wall reaches the operator as a bare
        "Run failed" line indistinguishable from any other exception, with
        nothing telling them retrying immediately hits the same wall.

        Asserts on matcher.logger.error directly rather than via caplog:
        shared/logger.py sets `logger.propagate = False` on every logger it
        hands out, so a root-attached caplog handler never sees these
        records regardless of `caplog.at_level(..., logger=...)` -- proven
        by running this test against caplog first and watching it fail
        while the line still printed to stdout.
        """
        pending_df, universe_df = _one_office_universe_and_pending()
        mock_dependencies["databricks"].return_value.execute_query.side_effect = [pending_df, universe_df]

        def _embedding_side_effect(texts, **kwargs):
            if len(texts) == 1:  # the per-office query embedding, not the universe build
                raise RuntimeError("429 RESOURCE_EXHAUSTED. quota exceeded")
            return np.array([[1.0, 0.0]] * len(texts))

        mock_dependencies["embedding"].create_embeddings.side_effect = _embedding_side_effect

        matcher = L2BrMatcher()
        with (
            patch.object(matcher.logger, "error") as mock_error,
            pytest.raises(RuntimeError, match="RESOURCE_EXHAUSTED"),
        ):
            asyncio.run(matcher.run())

        assert any("QUOTA EXHAUSTED" in str(call.args[0]) for call in mock_error.call_args_list)

    def test_run_does_not_mislabel_an_unrelated_failure(self, mock_dependencies):
        """Failure this catches: every run failure gets the QUOTA EXHAUSTED
        label regardless of cause, so an operator learns to ignore it.
        """
        pending_df, universe_df = _one_office_universe_and_pending()
        mock_dependencies["databricks"].return_value.execute_query.side_effect = [pending_df, universe_df]

        def _embedding_side_effect(texts, **kwargs):
            if len(texts) == 1:
                raise RuntimeError("Empty response from API")
            return np.array([[1.0, 0.0]] * len(texts))

        mock_dependencies["embedding"].create_embeddings.side_effect = _embedding_side_effect

        matcher = L2BrMatcher()
        with (
            patch.object(matcher.logger, "error") as mock_error,
            pytest.raises(RuntimeError, match="Empty response"),
        ):
            asyncio.run(matcher.run())

        assert not any("QUOTA EXHAUSTED" in str(call.args[0]) for call in mock_error.call_args_list)


class TestMatcherContextManager:
    """L2BrMatcher creates a 1500-worker ThreadPoolExecutor in __init__ and
    exposed no way to close it or the Databricks connection; DatabricksClient's
    own close()/__enter__/__exit__ already existed but nothing called them.
    """

    def test_close_shuts_down_the_thread_pool(self, mock_dependencies):
        """Failure this catches: the executor outlives the matcher, leaving
        non-daemon threads for the interpreter's atexit hook to join before
        the process can exit.
        """
        matcher = L2BrMatcher()

        matcher.close()

        with pytest.raises(RuntimeError, match="cannot schedule new futures after shutdown"):
            matcher._executor.submit(lambda: None)

    def test_close_closes_the_databricks_connection(self, mock_dependencies):
        """Failure this catches: DatabricksClient's own close() exists but
        is never called, leaving the connection open for the life of the
        process.
        """
        matcher = L2BrMatcher()

        matcher.close()

        matcher.databricks.close.assert_called_once()

    def test_context_manager_exit_calls_close(self, mock_dependencies):
        """Failure this catches: __enter__/__exit__ are defined but __exit__
        forgets to actually call close(), so `with L2BrMatcher()` cleans up
        nothing despite looking like it does.
        """
        matcher = L2BrMatcher()
        with patch.object(matcher, "close") as mock_close:
            with matcher:
                pass
            mock_close.assert_called_once()

    def test_context_manager_returns_the_matcher_itself(self, mock_dependencies):
        with L2BrMatcher() as matcher:
            assert isinstance(matcher, L2BrMatcher)
