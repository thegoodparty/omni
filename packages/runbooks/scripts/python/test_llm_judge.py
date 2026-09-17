import pytest

import llm_judge as lj


class _Block:
    def __init__(self, payload):
        self.type = "tool_use"
        self.input = payload


class _Resp:
    def __init__(self, payload, stop_reason="tool_use"):
        self.content = [_Block(payload)]
        self.stop_reason = stop_reason


def test_max_tokens_scales_with_count_between_floor_and_ceiling():
    assert lj.max_tokens_for(0) == 1024
    assert lj.max_tokens_for(10) == 1024 + 400 * 10
    assert lj.max_tokens_for(10_000) == 32_000


def test_parse_tool_response_keys_verdicts_by_id():
    resp = _Resp({"verdicts": [{"id": "a", "v": 1}, {"id": "b", "v": 2}]})
    assert lj.parse_tool_response(resp, ["a", "b"]) == {
        "a": {"id": "a", "v": 1},
        "b": {"id": "b", "v": 2},
    }


def test_parse_tool_response_names_truncation_before_schema_problems():
    # A max_tokens stop leaves the tool input incomplete. Reporting a schema error here
    # points the reader at the wrong thing and once hid a month of un-judged candidates.
    resp = _Resp({"verdicts": []}, stop_reason="max_tokens")
    with pytest.raises(RuntimeError, match="truncated at max_tokens"):
        lj.parse_tool_response(resp, ["a", "b"])


def test_parse_tool_response_raises_when_no_tool_use_block():
    resp = _Resp({"verdicts": []})
    resp.content = []
    with pytest.raises(RuntimeError, match="no tool_use block"):
        lj.parse_tool_response(resp, ["a"])


def test_run_graceful_never_raises_and_names_each_failure():
    tool = {"name": "t", "description": "d", "input_schema": {}}
    kw = dict(tool=tool, message_builder=lambda items: [],
              system_factory=lambda: "sys", unavailable_status="skipped: source unavailable")

    assert lj.run_graceful([], api_key="k", model="m", **kw) == ({}, "no-candidates")
    assert lj.run_graceful([{"id": "a"}], api_key=None, model="m", **kw) == (
        {}, "skipped: ANTHROPIC_API_KEY unset")

    def boom():
        raise OSError("gone")

    verdicts, status = lj.run_graceful(
        [{"id": "a"}], api_key="k", model="m",
        **{**kw, "system_factory": boom})
    assert (verdicts, status) == ({}, "skipped: source unavailable")

    def bad_client(_key):
        raise RuntimeError("network down")

    verdicts, status = lj.run_graceful(
        [{"id": "a"}], api_key="k", model="m", client_factory=bad_client, **kw)
    assert verdicts == {}
    assert status.startswith("failed: ")


def test_judge_batch_forces_the_tool_and_sizes_the_budget():
    seen = {}

    class _Client:
        class messages:
            @staticmethod
            def create(**kwargs):
                seen.update(kwargs)
                return _Resp({"verdicts": [{"id": "a"}]})

    tool = {"name": "report", "description": "d", "input_schema": {}}
    out = lj.judge_batch([{"id": "a"}], system="sys", tool=tool, client=_Client(),
                         model="m", message_builder=lambda items: [{"role": "user", "content": "x"}])
    assert out == {"a": {"id": "a"}}
    assert seen["tool_choice"] == {"type": "tool", "name": "report"}
    assert seen["max_tokens"] == lj.max_tokens_for(1)
    assert seen["system"] == "sys"
