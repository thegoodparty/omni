"""Unit tests for the killed-run cost accumulator.

The timeout kill path never sees a ResultMessage, so cost is summed per-turn
from each AssistantMessage's usage. These lock down the pricing math (each
token class priced at its own rate, dollars summed across turns) and the
module-level accumulator helpers.
"""

from __future__ import annotations

import tempfile
from unittest.mock import patch

import pytest
from claude_agent_sdk import AssistantMessage, TextBlock

from pmf_engine.runner.harness import claude_sdk

# The SDK's ResultMessage has eight required fields, five of which are
# irrelevant here. Borrowed from the sibling suite rather than retyped, the
# way test_manifest_loader already borrows from test_lambda_manifest_loader,
# so a new required field lands in one place.
from pmf_engine.tests.test_harness_claude_sdk import _make_result_message


async def _accumulate_over(messages: list[object]) -> float | None:
    """Drive the real `run_agent` loop over a canned message stream and return
    what the kill handlers would bill. Asserting on `_price_turn` alone would
    not catch the loop dropping its answer on the floor, which is the half of
    the defect that actually reaches a report."""

    async def fake_query(prompt, options):
        for message in messages:
            yield message

    with tempfile.TemporaryDirectory() as tmpdir:
        with patch("pmf_engine.runner.harness.claude_sdk.query", side_effect=fake_query):
            try:
                await claude_sdk.run_agent(
                    instruction="Do analysis",
                    model="sonnet",
                    max_turns=5,
                    workspace_dir=tmpdir,
                    params={},
                )
            except claude_sdk.AgentStreamTruncatedError:
                # The timeout-shaped path: the stream dies before a terminal
                # ResultMessage, so the per-turn estimate is all there is.
                pass
    return claude_sdk.get_accumulated_cost()


def _turn(model: str, output_tokens: int) -> AssistantMessage:
    return AssistantMessage(
        model=model,
        content=[TextBlock(text="working")],
        usage={"output_tokens": output_tokens},
    )


class TestPriceTurn:
    def test_prices_each_token_class_at_its_own_rate(self):
        # 1M input @ $3, 1M output @ $15, 1M cache-read @ $0.30, 1M cache-write @ $3.75
        usage = {
            "input_tokens": 1_000_000,
            "output_tokens": 1_000_000,
            "cache_read_input_tokens": 1_000_000,
            "cache_creation_input_tokens": 1_000_000,
        }
        assert claude_sdk._price_turn("claude-sonnet-5", usage) == 3.0 + 15.0 + 0.3 + 3.75

    def test_matches_bedrock_prefixed_model_string(self):
        usage = {"output_tokens": 1_000_000}
        assert claude_sdk._price_turn("anthropic.claude-sonnet-4-6", usage) == 15.0

    def test_opus_and_haiku_priced_distinctly(self):
        usage = {"output_tokens": 1_000_000}
        assert claude_sdk._price_turn("claude-opus-4-8", usage) == 25.0
        assert claude_sdk._price_turn("claude-haiku-4-5", usage) == 5.0

    def test_unknown_model_is_unpriced_not_free(self):
        """A model with no rate on record has an UNKNOWN cost, not a zero one.
        `_price_turn` feeds the figure a timed-out run is billed at, so 0.0
        here prints "$0.00" for the single most expensive kind of failure.
        None is the same omit-rather-than-substitute rule `_usage_counts`
        follows for an unobserved count."""
        assert claude_sdk._price_turn("gemini-3-flash", {"output_tokens": 1_000_000}) is None

    def test_a_priced_model_with_no_tokens_is_still_zero(self):
        """The counterpart: zero is a real, observed cost and stays a float.
        Collapsing it into the unknown case would withhold a figure that was
        measured."""
        assert claude_sdk._price_turn("claude-sonnet-5", {"output_tokens": 0}) == 0.0

    def test_missing_usage_fields_default_to_zero(self):
        assert claude_sdk._price_turn("claude-sonnet-5", {}) == 0.0
        assert claude_sdk._price_turn("claude-sonnet-5", None) == 0.0

    def test_reads_the_key_names_through_the_shared_mapping(self, monkeypatch):
        """`_price_turn` bills a timed-out run and `_usage_counts` logs what the
        judge re-derives from. Two copies of the CLI's key names would let a
        rename silently read 0 on one side, leaving the billed figure and the
        re-derived one disagreeing with nothing to detect it. Renaming the
        shared mapping has to move both.
        """
        monkeypatch.setattr(claude_sdk, "_USAGE_TOKEN_KEYS", {"prompt_tokens": "input"})
        assert claude_sdk._price_turn("claude-sonnet-5", {"prompt_tokens": 1_000_000}) == 3.0
        assert claude_sdk._price_turn("claude-sonnet-5", {"input_tokens": 1_000_000}) == 0.0

    def test_a_garbled_count_is_not_billed_as_zero_tokens_worth_of_others(self):
        """Pricing inherits `_usage_counts`' coercion, so a field the CLI
        garbles drops out of the arithmetic instead of contributing a fabricated
        count. The other classes still bill."""
        priced = claude_sdk._price_turn(
            "claude-sonnet-5",
            {"input_tokens": "not a number", "output_tokens": 1_000_000},
        )
        assert priced == 15.0

    def test_cache_read_is_cheap_relative_to_fresh_input(self):
        # The core reason we sum per-turn dollars instead of summing input
        # tokens: a turn dominated by cache-reads costs ~10x less than the same
        # token count as fresh input.
        cached = claude_sdk._price_turn("claude-sonnet-5", {"cache_read_input_tokens": 1_000_000})
        fresh = claude_sdk._price_turn("claude-sonnet-5", {"input_tokens": 1_000_000})
        assert cached == 0.3 and fresh == 3.0


class TestAccumulator:
    def test_reset_zeroes_the_accumulator(self):
        claude_sdk._accumulated_cost_usd = 4.2
        claude_sdk.reset_accumulated_cost()
        assert claude_sdk.get_accumulated_cost() == 0.0

    def test_getter_reflects_current_state(self):
        claude_sdk.reset_accumulated_cost()
        priced = claude_sdk._price_turn("claude-sonnet-5", {"output_tokens": 2_000_000})
        assert priced is not None
        claude_sdk._accumulated_cost_usd += priced
        assert claude_sdk.get_accumulated_cost() == 30.0

    def test_an_unpriced_turn_withholds_the_total_rather_than_understating_it(self):
        """The accumulator reports one scalar as the whole run's cost, so a sum
        with a turn missing is wrong while looking complete. None is the only
        answer that lets the caller omit cost_usd instead of billing short."""
        claude_sdk.reset_accumulated_cost()
        claude_sdk._accumulated_cost_usd = 7.5
        claude_sdk._unobserved_cost_reasons.add("no rate on record for x")
        assert claude_sdk.get_accumulated_cost() is None

    def test_reset_clears_the_unpriced_marker(self):
        """Module state outlives a run (it mirrors main.py's _current_task), so
        a marker left set would withhold the NEXT run's real cost too."""
        claude_sdk._unobserved_cost_reasons.add("no rate on record for x")
        claude_sdk.reset_accumulated_cost()
        assert claude_sdk.get_accumulated_cost() == 0.0


class TestUnpricedTurnThroughTheHarness:
    """The accumulator is the figure a killed run is billed at, so what the
    loop does with an unpriced turn matters more than what `_price_turn`
    returns."""

    @pytest.mark.asyncio
    async def test_a_turn_on_an_unlisted_model_withholds_the_bill(self):
        billed = await _accumulate_over([_turn("gemini-3-flash", 1_000_000)])
        assert billed is None

    @pytest.mark.asyncio
    async def test_one_unpriced_turn_withholds_the_whole_estimate(self):
        """Not the partial sum of the priced turns. The caller reports a single
        scalar as the run's cost; $15 of a $40 run is a wrong number wearing a
        right number's clothes, and nothing downstream could tell."""
        billed = await _accumulate_over([_turn("claude-sonnet-5", 1_000_000), _turn("gemini-3-flash", 1_000_000)])
        assert billed is None

    @pytest.mark.asyncio
    async def test_a_fully_priced_run_still_bills_its_estimate(self):
        billed = await _accumulate_over([_turn("claude-sonnet-5", 1_000_000)])
        assert billed == 15.0

    @pytest.mark.asyncio
    async def test_a_result_message_with_no_cost_is_unknown_not_free(self):
        """The other door onto the same defect. `total_cost_usd` is optional on
        the SDK's ResultMessage, and the old code overwrote a real per-turn
        estimate with its `or 0.0` fallback — so a run whose every turn WAS
        priced still billed a measured-looking $0.00 the moment the terminal
        message arrived without a figure."""
        billed = await _accumulate_over(
            [
                _turn("claude-sonnet-5", 1_000_000),
                _make_result_message(total_cost_usd=None, num_turns=1),
            ]
        )
        assert billed is None

    @pytest.mark.asyncio
    async def test_a_result_message_with_no_cost_does_not_clear_the_marker(self):
        """An absent authoritative figure supersedes nothing, so it must not
        forgive an unpriced turn either."""
        billed = await _accumulate_over(
            [
                _turn("gemini-3-flash", 1_000_000),
                _make_result_message(total_cost_usd=None, num_turns=1),
            ]
        )
        assert billed is None

    @pytest.mark.asyncio
    async def test_a_result_message_supersedes_the_unpriced_estimate(self):
        """A ResultMessage carries the authoritative figure, which discards the
        estimate entirely — so an unpriced turn inside that estimate no longer
        qualifies anything and must not suppress a real cost."""
        billed = await _accumulate_over(
            [
                _turn("gemini-3-flash", 1_000_000),
                _make_result_message(total_cost_usd=4.25, num_turns=1, session_id="sess-unpriced"),
            ]
        )
        assert billed == 4.25
