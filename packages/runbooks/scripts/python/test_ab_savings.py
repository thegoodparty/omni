"""Behavioral tests for ab_savings — the A/B savings table joined to TRUE artifact status.

Covers render_verbatim (apples-to-apples verbatim artifact dump), the clean-pairs
aggregate inclusion rules (sign-flip regression), perf_gate-parity of the S3/artifact
semantics, and label ordering. S3 is faked at the subprocess boundary so the same fake
serves both ab_savings and perf_gate code paths."""
import json
import subprocess
import sys
from collections import Counter

import pytest

import ab_savings
import perf_gate
from ab_savings import render_verbatim


class _Result:
    def __init__(self, returncode, stdout, stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def fake_s3(monkeypatch, objects, fail_auth=False):
    """Fake `aws s3 cp s3://bucket/key -` at the subprocess boundary.

    Absent keys return the 404-shaped stderr that perf_gate.s3_text treats as genuine
    absence; fail_auth simulates an infra failure (credentials). Returns a Counter of
    GETs per key so tests can assert each object is fetched exactly once."""
    counts = Counter()

    def run(cmd, **kwargs):
        assert cmd[:3] == ["aws", "s3", "cp"], f"unexpected aws call: {cmd}"
        key = cmd[3].split("/", 3)[3]
        counts[key] += 1
        if fail_auth:
            return _Result(1, "", "fatal error: Unable to locate credentials")
        if key in objects:
            return _Result(0, objects[key])
        return _Result(1, "", "fatal error: An error occurred (404) when calling the "
                              'HeadObject operation: Key "x" does not exist')

    monkeypatch.setattr(subprocess, "run", run)
    return counts


def trace_key(exp, rid):
    return f"{exp}/{rid}/logs/workspace/conversation.jsonl"


def art_key(exp, rid):
    return f"{exp}/{rid}/artifact.json"


def complete_trace(turns, cost):
    return json.dumps({"type": "result", "num_turns": turns, "total_cost_usd": cost})


TRUNCATED_TRACE = json.dumps({"type": "assistant", "message": {"content": []}})


def run_table(tmp_path, monkeypatch, capsys, runs, objects, extra=()):
    """Drive main() end-to-end: runs-map TSV + fake S3 -> printed table text."""
    tsv = tmp_path / "runs.tsv"
    lines = ["exp\tarm\tpath\tlabel\trun_id"]
    lines += [f"{exp}\t{arm}\t-\t{label}\t{rid}" for exp, arm, label, rid in runs]
    tsv.write_text("\n".join(lines) + "\n")
    counts = fake_s3(monkeypatch, objects)
    monkeypatch.setattr(sys, "argv", ["ab_savings.py", str(tsv), "--bucket", "b", *extra])
    ab_savings.main()
    return capsys.readouterr().out, counts


def test_truncated_trace_with_matching_status_is_excluded_from_clean_pairs(tmp_path, monkeypatch, capsys):
    # Reviewer repro: the genuine pair saves 20% ($5 -> $4). The other pair's control
    # trace is truncated (turns=None, cost 0.0) but its artifact status MATCHES — if it
    # enters CLEAN PAIRS it contributes $0 to control and $4 to treatment, flipping the
    # headline from "-20% saves" to "+60% regresses".
    art = json.dumps({"briefing_status": "ok_complete"})
    out, _ = run_table(
        tmp_path, monkeypatch, capsys,
        runs=[("e", "ctrl", "good", "c1"), ("e", "treat", "good", "t1"),
              ("e", "ctrl", "trunc", "c2"), ("e", "treat", "trunc", "t2")],
        objects={
            trace_key("e", "c1"): complete_trace(20, 5.0), art_key("e", "c1"): art,
            trace_key("e", "t1"): complete_trace(16, 4.0), art_key("e", "t1"): art,
            trace_key("e", "c2"): TRUNCATED_TRACE, art_key("e", "c2"): art,
            trace_key("e", "t2"): complete_trace(38, 4.0), art_key("e", "t2"): art,
        },
    )
    assert "CLEAN PAIRS (1)" in out
    assert "cost -20%" in out
    assert "+60%" not in out
    assert "incomplete" in out and "excluded" in out


def test_double_no_artifact_pair_is_excluded(tmp_path, monkeypatch, capsys):
    # Both arms completed a trace but neither produced an artifact: statuses "match"
    # on NO_ARTIFACT, yet the pair measured nothing — it must not enter the aggregate.
    out, _ = run_table(
        tmp_path, monkeypatch, capsys,
        runs=[("e", "ctrl", "city-a", "c1"), ("e", "treat", "city-a", "t1")],
        objects={
            trace_key("e", "c1"): complete_trace(20, 5.0),
            trace_key("e", "t1"): complete_trace(16, 4.0),
        },
    )
    assert "CLEAN PAIRS" not in out
    assert "no valid artifact" in out and "excluded" in out


def test_double_bad_json_pair_is_excluded(tmp_path, monkeypatch, capsys):
    out, _ = run_table(
        tmp_path, monkeypatch, capsys,
        runs=[("e", "ctrl", "city-a", "c1"), ("e", "treat", "city-a", "t1")],
        objects={
            trace_key("e", "c1"): complete_trace(20, 5.0), art_key("e", "c1"): "{nope",
            trace_key("e", "t1"): complete_trace(16, 4.0), art_key("e", "t1"): "{nope",
        },
    )
    assert "CLEAN PAIRS" not in out
    assert "no valid artifact" in out and "excluded" in out


def test_treat_only_label_renders_as_waiting(tmp_path, monkeypatch, capsys):
    # A label whose ctrl run hasn't been mapped yet (treat-only row) must still print
    # as waiting — ordering by ctrl rows alone silently drops it from the table.
    art = json.dumps({"briefing_status": "ok_complete"})
    out, _ = run_table(
        tmp_path, monkeypatch, capsys,
        runs=[("e", "ctrl", "paired", "c1"), ("e", "treat", "paired", "t1"),
              ("e", "treat", "solo", "t2")],
        objects={
            trace_key("e", "c1"): complete_trace(20, 5.0), art_key("e", "c1"): art,
            trace_key("e", "t1"): complete_trace(16, 4.0), art_key("e", "t1"): art,
            trace_key("e", "t2"): complete_trace(30, 3.0), art_key("e", "t2"): art,
        },
    )
    assert "solo" in out
    assert "waiting (v1)" in out
    assert out.index("paired") < out.index("solo")


def test_run_metrics_raises_on_s3_auth_failure(monkeypatch):
    # An infra failure (credentials, network) must raise loudly — it must never
    # masquerade as "waiting", which is how a dead A/B watches forever.
    fake_s3(monkeypatch, {}, fail_auth=True)
    with pytest.raises(RuntimeError):
        ab_savings.run_metrics("b", "e", "r1", "briefing_status")


def test_artifact_status_semantics_match_perf_gate(monkeypatch):
    # The status ab_savings reports for a run must be EXACTLY what
    # perf_gate.artifact_status reports for the same S3 state — including None
    # (not "ok") when no status field is configured. This is the anti-divergence lock.
    cases = [
        ("absent artifact", {}, "sf"),
        ("corrupt artifact", {art_key("e", "r1"): "{nope"}, "sf"),
        ("status field present", {art_key("e", "r1"): json.dumps({"sf": "done"})}, "sf"),
        ("status field missing", {art_key("e", "r1"): json.dumps({"other": 1})}, "sf"),
        ("no status field configured", {art_key("e", "r1"): json.dumps({"sf": "done"})}, None),
    ]
    for name, artifacts, field in cases:
        objects = {trace_key("e", "r1"): complete_trace(10, 1.0), **artifacts}
        fake_s3(monkeypatch, objects)
        expected = perf_gate.artifact_status("r1", "b", "e", field)
        fake_s3(monkeypatch, objects)
        got = ab_savings.run_metrics("b", "e", "r1", field)[0]
        assert got == expected, f"{name}: ab_savings={got!r} perf_gate={expected!r}"


def test_local_s3_duplication_is_deleted(monkeypatch):
    # The divergent local fetch layer is gone: ab_savings uses perf_gate's s3_text
    # and NO_ARTIFACT, not private re-implementations with different error semantics.
    assert not hasattr(ab_savings, "_s3_text")
    assert ab_savings.s3_text is perf_gate.s3_text
    assert ab_savings.NO_ARTIFACT == perf_gate.NO_ARTIFACT


def test_unused_parse_trace_import_dropped():
    # ab_savings never parses traces itself (score() does) — the stray re-export
    # invites callers to bypass the scoring layer.
    assert not hasattr(ab_savings, "parse_trace")


def test_no_status_field_pair_still_counts_clean(tmp_path, monkeypatch, capsys):
    # Pinning test (green before the refactor, must survive it): with --status-field ""
    # two artifact-producing arms still pair cleanly — the None -> "ok" label mapping
    # lives at the display layer and must not break parity.
    out, _ = run_table(
        tmp_path, monkeypatch, capsys,
        runs=[("e", "ctrl", "city-a", "c1"), ("e", "treat", "city-a", "t1")],
        objects={
            trace_key("e", "c1"): complete_trace(20, 5.0),
            art_key("e", "c1"): json.dumps({"anything": 1}),
            trace_key("e", "t1"): complete_trace(16, 4.0),
            art_key("e", "t1"): json.dumps({"anything": 2}),
        },
        extra=("--status-field", ""),
    )
    assert "CLEAN PAIRS (1)" in out


def test_mismatch_note_prints_exclusion_reason_with_ok_label(tmp_path, monkeypatch, capsys):
    # No status field configured: an artifact-producing arm reads "ok" at the display
    # layer, and a mismatched pair's row note states the exclusion reason.
    out, _ = run_table(
        tmp_path, monkeypatch, capsys,
        runs=[("e", "ctrl", "city-a", "c1"), ("e", "treat", "city-a", "t1")],
        objects={
            trace_key("e", "c1"): complete_trace(20, 5.0),
            art_key("e", "c1"): json.dumps({"anything": 1}),
            trace_key("e", "t1"): complete_trace(16, 4.0),
        },
        extra=("--status-field", ""),
    )
    assert "ctrl=ok" in out and "treat=NO_ARTIFACT" in out
    assert "excluded" in out
    assert "CLEAN PAIRS" not in out


def test_verbatim_preserves_full_content_for_both_arms():
    ctrl = {"opportunities": ["Low win number of 739 ([Taylor County](http://x))"],
            "challenges": ["Short runway to November 3, 2026"]}
    treat = {"opportunities": ["Low win number of 739 (GoodParty.org Data)"],
             "challenges": ["Short runway to November 3, 2026"]}
    md = render_verbatim([("taylor_school", ctrl, treat)])

    # the input label heads its own section
    assert "taylor_school" in md
    # both arms are present and labeled
    assert "control" in md and "treatment" in md
    # VERBATIM: the exact, untruncated bullet strings from each arm appear
    assert "Low win number of 739 ([Taylor County](http://x))" in md
    assert "Low win number of 739 (GoodParty.org Data)" in md


def test_verbatim_marks_missing_artifact_and_orders_control_first():
    md = render_verbatim([("desoto", None, {"opportunities": ["a"], "challenges": ["b"]})])
    # a waiting/failed arm is shown as missing, not silently dropped
    assert "no artifact" in md.lower()
    # control is rendered before treatment so the diff reads left-to-right
    assert md.lower().index("control") < md.lower().index("treatment")


def test_verbatim_renders_corrupt_artifact_distinctly():
    # A corrupt artifact (present but unparseable) is a different failure than a run
    # that produced nothing — the verbatim read must say which one happened.
    md = render_verbatim([("x", "BAD_JSON", {"opportunities": ["a"]})])
    assert "artifact present but unparseable" in md
    assert "no artifact produced" not in md


def test_verbatim_reuses_fetched_artifacts_and_marks_corrupt(tmp_path, monkeypatch, capsys):
    # --verbatim must reuse the artifacts run_metrics already pulled (one S3 GET per
    # artifact, total) and render the corrupt control arm distinctly.
    out, counts = run_table(
        tmp_path, monkeypatch, capsys,
        runs=[("e", "ctrl", "city-a", "c1"), ("e", "treat", "city-a", "t1")],
        objects={
            trace_key("e", "c1"): complete_trace(20, 5.0), art_key("e", "c1"): "{nope",
            trace_key("e", "t1"): complete_trace(16, 4.0),
            art_key("e", "t1"): json.dumps({"briefing_status": "ok_complete",
                                            "summary": "TREAT-CONTENT"}),
        },
        extra=("--verbatim", str(tmp_path / "v.md")),
    )
    md = (tmp_path / "v.md").read_text()
    assert "artifact present but unparseable" in md
    assert "TREAT-CONTENT" in md
    assert counts[art_key("e", "c1")] == 1
    assert counts[art_key("e", "t1")] == 1


def test_verbatim_renders_each_input_in_dispatch_order():
    pairs = [("garland", {"opportunities": ["g"], "challenges": ["g2"]}, {"opportunities": ["G"], "challenges": ["G2"]}),
             ("ec899", {"opportunities": ["e"], "challenges": ["e2"]}, {"opportunities": ["E"], "challenges": ["E2"]})]
    md = render_verbatim(pairs)
    assert md.index("garland") < md.index("ec899")


def test_duplicate_label_arm_rows_are_rejected_loudly():
    # The runs map is hand-built; a duplicate (label, arm) row would silently
    # overwrite the first run and score the wrong run_id.
    import pytest
    from ab_savings import group_runs
    rows = [
        {"label": "city-a", "arm": "ctrl", "run_id": "r1"},
        {"label": "city-a", "arm": "ctrl", "run_id": "r2"},
    ]
    with pytest.raises(ValueError, match="duplicate"):
        group_runs(rows)


def test_group_runs_pairs_arms_by_label():
    from ab_savings import group_runs
    rows = [
        {"label": "city-a", "arm": "ctrl", "run_id": "r1"},
        {"label": "city-a", "arm": "treat", "run_id": "r2"},
    ]
    by = group_runs(rows)
    assert by["city-a"]["ctrl"]["run_id"] == "r1"
    assert by["city-a"]["treat"]["run_id"] == "r2"


def test_pct_delta_guards_zero_denominator():
    from ab_savings import pct_delta
    assert pct_delta(5.0, 0.0) == "n/a"     # zero control: no meaningful %
    assert pct_delta(3.0, 6.0) == "-50%"    # savings
    assert pct_delta(9.0, 6.0) == "+50%"    # regression


def test_fetch_artifact_non_object_json_is_bad_json(monkeypatch):
    import ab_savings
    monkeypatch.setattr(ab_savings, "s3_text", lambda b, k: "[1, 2, 3]")
    status, art = ab_savings.fetch_artifact("b", "e", "rid", "status")
    assert status == "BAD_JSON"
    assert art is None
