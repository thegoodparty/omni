"""Behavioral contract for eval_trajectory — the measurement primitive every gate imports.

If score() miscounts turns/cost/errors, every downstream verdict (perf_gate, derive,
monitor, ab_savings) is wrong, so these tests lock the parsing contract for BOTH trace
dialects: the Fargate harness writes flat {"type":"tool_result"} records; local
Claude-Code runs nest tool results inside {"type":"user"} records.
"""
import json

import pytest

from eval_trajectory import categorize, exact_dup_count, parse_trace, score


def _assistant(*tool_uses):
    return json.dumps({
        "type": "assistant",
        "message": {"content": [
            {"type": "tool_use", "name": n, "input": i} for n, i in tool_uses
        ]},
    })


def _result(num_turns, cost):
    return json.dumps({"type": "result", "num_turns": num_turns, "total_cost_usd": cost})


def _fargate_tool_result(is_error=False):
    return json.dumps({"type": "tool_result", "is_error": is_error})


def _cli_tool_result(is_error=False):
    return json.dumps({
        "type": "user",
        "message": {"content": [{"type": "tool_result", "is_error": is_error}]},
    })


def test_parse_trace_fargate_dialect_counts_calls_errors_turns_cost():
    # Two errors, not one: a count of one cannot tell `n_err += 1` from `n_err = 1`.
    trace = "\n".join([
        _assistant(("Bash", {"command": "ls"}), ("WebSearch", {"query": "x"})),
        _fargate_tool_result(is_error=False),
        _fargate_tool_result(is_error=True),
        _fargate_tool_result(is_error=True),
        _result(num_turns=7, cost=1.234),
    ])
    p = parse_trace(trace)
    assert [n for n, _ in p["calls"]] == ["Bash", "WebSearch"]
    assert p["tool_errors"] == 2
    assert p["num_turns"] == 7
    assert p["cost_usd"] == 1.234


def test_parse_trace_cli_dialect_counts_nested_tool_result_errors():
    # Two errors, not one: a count of one cannot tell `n_err += 1` from `n_err = 1`.
    trace = "\n".join([
        _assistant(("Bash", {"command": "ls"})),
        _cli_tool_result(is_error=True),
        _cli_tool_result(is_error=False),
        _cli_tool_result(is_error=True),
    ])
    p = parse_trace(trace)
    assert p["tool_errors"] == 2


def test_parse_trace_without_result_record_reports_no_turns_and_zero_cost():
    trace = _assistant(("Bash", {"command": "ls"}))
    p = parse_trace(trace)
    assert p["num_turns"] is None  # killed/truncated run: turns unknown, not 0
    assert p["cost_usd"] == 0.0


def test_parse_trace_skips_malformed_lines_instead_of_crashing():
    trace = "\n".join(["not json {{{", "", _result(3, 0.5)])
    p = parse_trace(trace)
    assert p["num_turns"] == 3


def test_exact_dup_counts_only_verbatim_repeats():
    # Two dups, not one: a count of one cannot tell `dups += 1` from `dups = 1`.
    calls = [
        ("Bash", {"command": "ls"}),
        ("Bash", {"command": "ls"}),       # dup 1
        ("Bash", {"command": "ls"}),       # dup 2 (first occurrence is never a dup)
        ("Bash", {"command": "ls -la"}),   # different input: not a dup
        ("Read", {"command": "ls"}),       # different tool: not a dup
    ]
    assert exact_dup_count(calls) == 2


def test_categorize_planning_tools_win_over_rules():
    rules = [{"pattern": ".", "label": "everything"}]
    assert categorize("TodoWrite", {"command": "anything"}, rules) == "planning"
    assert categorize("Bash", {"command": "psql -c select"}, rules) == "everything"


def test_categorize_falls_back_to_tool_name_without_matching_rule():
    assert categorize("Bash", {"command": "ls"}, []) == "tool:Bash"


def test_planning_tools_membership_is_pinned():
    # Pin the exact set: dropping a member would silently reclassify its calls
    # as tool:<name> and skew planning_pct everywhere.
    from eval_trajectory import PLANNING_TOOLS
    expected = {"TaskCreate", "TaskUpdate", "TaskStop", "TaskOutput", "TodoWrite"}
    assert PLANNING_TOOLS == expected
    for tool in sorted(expected):
        assert categorize(tool, {"command": "anything"}, [{"pattern": ".", "label": "everything"}]) == "planning"


def test_score_aggregates_steps_cost_rounding_planning_pct():
    # 2 planning calls of 4: pct 50.0 can't be faked by a presence check (1-of-2
    # would also give 50.0; 2-of-4 forces a real count in both numerator and total).
    trace = "\n".join([
        _assistant(("TodoWrite", {"todos": []}), ("TaskCreate", {"subject": "plan"}),
                   ("Bash", {"command": "ls"}), ("Bash", {"command": "pwd"})),
        _fargate_tool_result(is_error=True),
        _result(num_turns=5, cost=1.234),
    ])
    s = score(trace, [], None)
    assert s["turns"] == 5
    assert s["steps"] == 4
    assert s["cost"] == 1.23  # rounded to cents (1.234 has no float-repr knife edge)
    assert s["tool_errors"] == 1
    assert s["exact_dups"] == 0
    assert s["planning"] == 2
    assert s["planning_pct"] == 50.0
    assert s["cats"] == {"planning": 2, "tool:Bash": 2}


def test_score_status_regex_takes_last_match():
    # Three distinct matches: with only two, m[-1] == m[1] and a mutant indexing
    # m[1] would pass. The third value must win.
    trace = "\n".join([
        json.dumps({"type": "x", "note": "briefing_ready mentioned early"}),
        json.dumps({"type": "y", "note": "no_meeting_found midway"}),
        json.dumps({"type": "z", "note": "final state awaiting_agenda"}),
    ])
    s = score(trace, [], "awaiting_agenda|briefing_ready|no_meeting_found")
    assert s["status"] == "awaiting_agenda"


def test_score_empty_trace_is_zeroed_not_crash():
    s = score("", [], None)
    assert s["steps"] == 0
    assert s["turns"] is None
    assert s["cost"] == 0.0
    assert s["planning_pct"] == 0.0


def test_ab_label_pairs_arms_by_trailing_input_label():
    from eval_trajectory import ab_label
    assert ab_label("ctrl__methuen-ma") == "methuen-ma"
    assert ab_label("treat__v2__methuen-ma") == "methuen-ma"  # last __ wins
    assert ab_label("0197a1b2-raw-run-id") == "0197a1b2-raw-run-id"  # no convention: full name


def test_shipped_rules_file_is_valid_and_compilable():
    # meeting_briefing_eval_rules.json is loaded at runtime and each pattern is
    # fed to re.search; a malformed entry or regex would crash mid-eval.
    import re as _re
    from pathlib import Path
    rules = json.loads((Path(__file__).parent / "meeting_briefing_eval_rules.json").read_text())
    assert isinstance(rules, list) and rules, "rules file must be a non-empty list"
    for rule in rules:
        assert set(rule) == {"pattern", "label"}, f"bad rule shape: {rule}"
        _re.compile(rule["pattern"])  # raises on an invalid regex
        assert rule["label"].strip()


def test_ab_pair_with_mismatched_outcome_is_excluded_from_totals():
    # A pair whose status diverges did different work; its delta is confounded and
    # must not enter the aggregate (parity warning alone is not enough).
    from eval_trajectory import ab_pair_includable
    ok, why = ab_pair_includable({"turns": 5, "status": "ready"}, {"turns": 4, "status": "ready"})
    assert ok and why is None
    ok, why = ab_pair_includable({"turns": 5, "status": "ready"}, {"turns": 4, "status": "awaiting"})
    assert not ok and "mismatch" in why
    ok, why = ab_pair_includable({"turns": None, "status": "ready"}, {"turns": 4, "status": "ready"})
    assert not ok and "incomplete" in why


def test_ab_maps_happy_path_pairs_arms_by_label():
    from eval_trajectory import ab_maps
    cmap, tmap, only_ctrl, only_treat = ab_maps(
        {"ctrl__a": {"turns": 1}, "ctrl__b": {"turns": 2}},
        {"treat__a": {"turns": 3}, "treat__b": {"turns": 4}},
    )
    assert cmap == {"a": {"turns": 1}, "b": {"turns": 2}}
    assert tmap == {"a": {"turns": 3}, "b": {"turns": 4}}
    assert only_ctrl == set()
    assert only_treat == set()


def test_ab_maps_returns_unpaired_keys_per_arm():
    # Traces present in only one arm must be surfaced, not silently dropped
    # by the pairing intersection.
    from eval_trajectory import ab_maps
    cmap, tmap, only_ctrl, only_treat = ab_maps(
        {"ctrl__a": {"turns": 1}, "ctrl__orphan": {"turns": 9}},
        {"treat__a": {"turns": 3}, "treat__extra": {"turns": 8}},
    )
    assert only_ctrl == {"orphan"}
    assert only_treat == {"extra"}
    assert set(cmap) == {"a", "orphan"}
    assert set(tmap) == {"a", "extra"}


def test_ab_maps_label_collision_within_an_arm_raises_with_both_names():
    # Two files in one arm collapsing to the same ab_label would last-write-win
    # and score the wrong run — the exact hazard ab_savings.group_runs rejects.
    from eval_trajectory import ab_maps
    with pytest.raises(ValueError) as e:
        ab_maps({"run1__methuen-ma": {}, "run2__methuen-ma": {}}, {})
    msg = str(e.value)
    assert "collision" in msg
    assert "run1__methuen-ma" in msg and "run2__methuen-ma" in msg

    with pytest.raises(ValueError) as e:
        ab_maps({}, {"t1__derry-nh": {}, "t2__derry-nh": {}})
    msg = str(e.value)
    assert "collision" in msg
    assert "t1__derry-nh" in msg and "t2__derry-nh" in msg


def test_ab_mode_prints_unpaired_traces_instead_of_silent_drop(tmp_path, capsys, monkeypatch):
    import sys
    from eval_trajectory import main
    trace = "\n".join([_assistant(("Bash", {"command": "ls"})), _result(num_turns=3, cost=0.5)])
    ctrl, treat = tmp_path / "ctrl", tmp_path / "treat"
    ctrl.mkdir()
    treat.mkdir()
    (ctrl / "ctrl__a.jsonl").write_text(trace)
    (ctrl / "ctrl__orphan.jsonl").write_text(trace)
    (treat / "treat__a.jsonl").write_text(trace)
    monkeypatch.setattr(sys, "argv", ["eval_trajectory.py", str(ctrl), str(treat), "--ab"])
    main()
    out = capsys.readouterr().out
    assert "!! unpaired (excluded): " in out
    assert "orphan" in out
    assert "clean paired inputs (parity + complete): 1/1" in out


def test_ab_parity_line_says_not_checked_without_status_regex(tmp_path, capsys):
    # Without --status-regex every status is None; printing "OK (all inputs match)"
    # would claim a check that never ran.
    import sys
    import eval_trajectory as et
    for d, turns in (("ctrl", 5), ("treat", 4)):
        (tmp_path / d).mkdir()
        (tmp_path / d / f"{d}__city-a.jsonl").write_text(
            json.dumps({"type": "result", "num_turns": turns, "total_cost_usd": 1.0}) + "\n")
    sys_argv = ["eval_trajectory.py", "--ab", str(tmp_path / "ctrl"), str(tmp_path / "treat")]
    old = sys.argv
    try:
        sys.argv = sys_argv
        et.main()
    finally:
        sys.argv = old
    out = capsys.readouterr().out
    assert "OK (all inputs match)" not in out
    assert "not checked" in out.lower()


def test_parity_line_broken_on_outcome_mismatch():
    from eval_trajectory import parity_line
    assert "BROKEN" in parity_line(mismatch_seen=True, n_complete=3)


def test_parity_line_not_validated_when_no_complete_pairs():
    # No complete, outcome-matched pair was ever checked (all excluded as incomplete).
    # Claiming "OK (all inputs match)" would be a false all-clear.
    from eval_trajectory import parity_line
    line = parity_line(mismatch_seen=False, n_complete=0)
    assert "OK" not in line
    assert "NOT VALIDATED" in line


def test_parity_line_ok_only_with_complete_matched_pairs():
    from eval_trajectory import parity_line
    line = parity_line(mismatch_seen=False, n_complete=2)
    assert "OK" in line and "2" in line
