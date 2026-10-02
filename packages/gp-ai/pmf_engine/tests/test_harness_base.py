from pmf_engine.runner.harness.base import AgentHarness, EvaluatorResult, HarnessResult


class FakeHarness:
    async def run(
        self,
        instruction: str,
        model: str,
        max_turns: int,
        workspace_dir: str,
        params: dict,
        contract_schema: dict | None = None,
        parent_span=None,
    ) -> HarnessResult:
        return HarnessResult(
            artifact_bytes=b'{"ok": true}',
            content_type="application/json",
            cost_usd=0.01,
            num_turns=1,
        )


def test_fake_harness_satisfies_protocol():
    harness = FakeHarness()
    assert isinstance(harness, AgentHarness)


def test_harness_result_defaults():
    result = HarnessResult(artifact_bytes=b"data", content_type="text/plain")
    # UNKNOWN, not a measured zero. This default is what a future harness
    # inherits when it does not set a cost, and 0.0 made an unmeasured run
    # indistinguishable from a free one all the way through the broker into
    # gp-api. The broker already treats a missing cost as withheld; this
    # carrier having a number to hand over was the only thing stopping that.
    assert result.cost_usd is None
    assert result.num_turns == 0
    assert result.session_id is None


def test_evaluator_result_defaults_to_an_unknown_cost():
    """Same rule as HarnessResult above, and the gate sums this one: an
    evaluator whose cost defaulted to 0.0 made the gate's total look complete
    when a term was missing."""
    assert EvaluatorResult().cost_usd is None


def test_harness_result_with_all_fields():
    result = HarnessResult(
        artifact_bytes=b"pdf-data",
        content_type="application/pdf",
        cost_usd=1.23,
        num_turns=15,
        session_id="sess-abc",
    )
    assert result.artifact_bytes == b"pdf-data"
    assert result.content_type == "application/pdf"
    assert result.cost_usd == 1.23
    assert result.num_turns == 15
    assert result.session_id == "sess-abc"


class IncompleteHarness:
    pass


def test_incomplete_class_does_not_satisfy_protocol():
    harness = IncompleteHarness()
    assert not isinstance(harness, AgentHarness)
