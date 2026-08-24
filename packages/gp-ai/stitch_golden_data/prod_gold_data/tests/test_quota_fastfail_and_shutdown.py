"""Tests for the matcher fixes routed into the write-path PR from PR 1
(quota/rate-limit detection, the thread-pool/connection context manager)
and the fix-round hardening on top of them (scoping the detection to the
Gemini call sites, closed-matcher guard, close()/__exit__ robustness).
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from stitch_golden_data.prod_gold_data.l2_br_matcher import (
    L2BrMatcher,
    _GeminiRateLimitOrQuotaSignal,
    _is_quota_exhausted,
)


@pytest.fixture
def mock_dependencies():
    with (
        patch("stitch_golden_data.prod_gold_data.l2_br_matcher.DatabricksClient") as mock_db,
        patch("stitch_golden_data.prod_gold_data.l2_br_matcher.Gemini3Client") as mock_llm_cls,
        patch("stitch_golden_data.prod_gold_data.l2_br_matcher.GeminiEmbeddingClient") as mock_emb_cls,
        # A real, but tiny, pool -- not a bare MagicMock: run()'s real
        # dispatch-and-await mechanics (loop.run_in_executor) need a genuine
        # Executor, and the matcher's own THREAD_POOL_SIZE=1500 is real
        # resource waste for a unit test with at most one office in flight.
        patch(
            "stitch_golden_data.prod_gold_data.l2_br_matcher.ThreadPoolExecutor",
            side_effect=lambda max_workers: ThreadPoolExecutor(max_workers=2),
        ),
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
        """Failure this catches: every run failure gets mislabeled,
        training the operator to ignore the label.
        """
        assert _is_quota_exhausted(RuntimeError(message)) is False

    def test_run_names_the_cause_when_a_query_embedding_hits_a_quota_wall(self, mock_dependencies):
        """Failure this catches: a 429 reaches the operator as a bare "Run
        failed" line indistinguishable from any other exception, with
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
        try:
            with (
                patch.object(matcher.logger, "error") as mock_error,
                pytest.raises(RuntimeError, match="RESOURCE_EXHAUSTED"),
            ):
                asyncio.run(matcher.run())

            assert any("RATE LIMITED" in str(call.args[0]) for call in mock_error.call_args_list)
        finally:
            matcher.close()

    def test_run_does_not_mislabel_an_unrelated_failure(self, mock_dependencies):
        """Failure this catches: every run failure gets the RATE LIMITED
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
        try:
            with (
                patch.object(matcher.logger, "error") as mock_error,
                pytest.raises(RuntimeError, match="Empty response"),
            ):
                asyncio.run(matcher.run())

            assert not any("RATE LIMITED" in str(call.args[0]) for call in mock_error.call_args_list)
        finally:
            matcher.close()

    def test_run_in_pool_tags_only_a_quota_shaped_failure_from_the_wrapped_call(self, mock_dependencies):
        """Failure this catches (fix-round 2.4): tagging generically in
        run()'s except block would also catch a Databricks read that
        happens to mention "quota" or "Too Many Requests" -- reads sit
        inside the same broad try today. _run_in_pool is the one place
        every Gemini call (and ONLY a Gemini call) passes through, so
        tagging there cannot see anything else.
        """

        def _raise(exc: Exception) -> None:
            raise exc

        matcher = L2BrMatcher()
        try:
            with pytest.raises(_GeminiRateLimitOrQuotaSignal):
                asyncio.run(matcher._run_in_pool(_raise, RuntimeError("429 quota")))

            with pytest.raises(RuntimeError, match="boom"):
                asyncio.run(matcher._run_in_pool(_raise, RuntimeError("boom")))
        finally:
            matcher.close()

    def test_a_malformed_response_echoing_the_word_quota_is_not_mislabeled(self, mock_dependencies):
        """Failure this catches (fix-round 2.4): _selection_from_response
        interpolates the model's own {response!r} into its ValueError
        message; that error is raised by match_office AFTER
        _select_candidate (and therefore _run_in_pool) has already
        returned successfully, so it can never carry the tag even if the
        model's own echoed text happens to contain "quota".
        """
        pending_df, universe_df = _one_office_universe_and_pending()
        mock_dependencies["databricks"].return_value.execute_query.side_effect = [pending_df, universe_df]
        mock_dependencies["embedding"].create_embeddings.return_value = np.array([[1.0, 0.0]])
        # selected_candidate_number is a string, not a number: _require_integral
        # raises, and _selection_from_response wraps it with the whole
        # response (including this reasoning text) interpolated in.
        mock_dependencies["llm"].generate_structured_content.return_value = {
            "selected_candidate_number": "not-a-number",
            "selection_confidence": 90,
            "reasoning": "This office administers the state's water quota board",
        }

        matcher = L2BrMatcher()
        try:
            with (
                patch.object(matcher.logger, "error") as mock_error,
                patch("stitch_golden_data.prod_gold_data.l2_br_matcher.build_cached_prompt", return_value="prompt"),
                pytest.raises(ValueError, match="Malformed LLM response"),
            ):
                asyncio.run(matcher.run())

            assert not any("RATE LIMITED" in str(call.args[0]) for call in mock_error.call_args_list)
        finally:
            matcher.close()


class TestClosedMatcherRefusesNewWork:
    """fix-round 2.2: close() sets DatabricksClient.connection to None, so
    connect() would otherwise silently reopen a session behind an executor
    that can never un-shut-down, and a second run() would fail confusingly
    deep inside dispatch instead of clearly at its own top.
    """

    def test_run_refuses_after_close(self, mock_dependencies):
        matcher = L2BrMatcher()
        matcher.close()

        with pytest.raises(RuntimeError, match="closed"):
            asyncio.run(matcher.run())


class TestMatcherContextManager:
    """L2BrMatcher creates a thread pool in __init__ and exposed no way to
    close it or the Databricks connection; DatabricksClient's own
    close()/__enter__/__exit__ already existed but nothing called them.
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

    def test_close_still_closes_the_connection_if_the_executor_shutdown_raises(self, mock_dependencies):
        """Failure this catches (fix-round 2.2): close() ran both cleanups
        as bare sequential statements, so a raise from the executor
        shutdown skipped the Databricks close -- exactly the leak this
        method exists to prevent.
        """
        matcher = L2BrMatcher()
        with patch.object(matcher._executor, "shutdown", side_effect=RuntimeError("boom")):
            with pytest.raises(RuntimeError, match="boom"):
                matcher.close()

        matcher.databricks.close.assert_called_once()

    def test_close_is_idempotent(self, mock_dependencies):
        """Failure this catches: a second close() call (e.g. from __exit__
        after an explicit close()) re-invokes shutdown on an
        already-shut-down executor or the Databricks close a second time,
        instead of being a clean no-op.
        """
        matcher = L2BrMatcher()
        matcher.close()

        matcher.close()

        matcher.databricks.close.assert_called_once()

    def test_context_manager_exit_calls_close(self, mock_dependencies):
        """Failure this catches: __exit__ is defined but does not actually
        invoke real cleanup on the way out of a `with` block -- patching
        out close() itself would hide exactly that regression.
        """
        with L2BrMatcher() as matcher:
            pass

        matcher.databricks.close.assert_called_once()
        with pytest.raises(RuntimeError, match="cannot schedule new futures after shutdown"):
            matcher._executor.submit(lambda: None)

    def test_context_manager_returns_the_matcher_itself(self, mock_dependencies):
        with L2BrMatcher() as matcher:
            assert isinstance(matcher, L2BrMatcher)

    def test_exit_swallows_a_close_failure_and_does_not_mask_the_original_exception(self, mock_dependencies):
        """Failure this catches (fix-round 2.2): DatabricksClient.close()
        can raise on exactly the dead-session conditions under which a run
        just failed; letting that propagate from __exit__ replaces the
        operator's real exception -- the one they actually need to see --
        with an unrelated cleanup error.

        The patch on close() has to stay active THROUGH __exit__'s own
        call to it, so it wraps the `with matcher:` block itself rather
        than sitting inside it -- nested the other way, the patch unwinds
        (restoring the real, working close()) before __exit__ ever runs,
        and the mutation this test exists to catch stops being reachable.
        """
        matcher = L2BrMatcher()
        with patch.object(matcher, "close", side_effect=RuntimeError("dead session")):
            with pytest.raises(ValueError, match="the real failure"):
                with matcher:
                    raise ValueError("the real failure")
