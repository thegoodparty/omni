"""Behavioral contract for derive_perf_thresholds: the percentile used for FLAG
ceilings, status-field discovery, fail-value inference, S3-failure classification
(404-absent vs infra error), and the no-artifact population definition. These decide
every derived perf.json, so they must be testable without S3 — main() is exercised
with a monkeypatched aws wrapper, never a subprocess."""
import glob
import json
import subprocess as sp
import sys
from collections import Counter

import pytest

from derive_perf_thresholds import discover_status_field, infer_fail_values, pct

RID = [f"01970000-0000-7000-8000-{i:012d}" for i in range(1, 7)]
TRACE_LINE = '{"type":"result","num_turns":12,"total_cost_usd":1.5}\n'
ART_OK = '{"status": "found"}'
ERR_404 = 'fatal error: An error occurred (404) when calling the HeadObject operation: Key "x" does not exist'
ERR_DENIED = 'fatal error: An error occurred (AccessDenied) when calling the GetObject operation: Access Denied'


def fake_aws_factory(plan):
    """plan: {(rid, "trace"|"artifact"): "ok"|"absent"|"error"} — an in-memory S3."""
    def fake_aws(*args):
        assert args[:2] == ("s3", "cp"), f"unexpected aws call: {args}"
        src, dst = args[2], args[3]
        rid, kind = src.split("/")[4], ("trace" if src.endswith(".jsonl") else "artifact")
        outcome = plan[(rid, kind)]
        if outcome == "ok":
            with open(dst, "w") as f:
                f.write(TRACE_LINE if kind == "trace" else ART_OK)
            return sp.CompletedProcess(args, 0, "", "")
        return sp.CompletedProcess(args, 1, "", ERR_404 if outcome == "absent" else ERR_DENIED)
    return fake_aws


def run_main(monkeypatch, tmp_path, rids, plan, argv_extra=()):
    import derive_perf_thresholds as dpt
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(dpt, "_list_runs", lambda bucket, exp, n: list(rids))
    monkeypatch.setattr(dpt, "_aws", fake_aws_factory(plan))
    monkeypatch.setattr(sys, "argv", ["derive_perf_thresholds.py", "myexp", *argv_extra])
    dpt.main()


def read_cfg(tmp_path):
    paths = glob.glob(str(tmp_path / "outputs/perf-eval/myexp/*.perf.json"))
    assert len(paths) == 1, f"expected exactly one written config, got {paths}"
    return json.load(open(paths[0]))


def test_pct_nearest_rank_p95_on_small_sample():
    vals = list(range(1, 21))  # 1..20
    assert pct(vals, 95) == 19  # round(0.95*19)=18 -> index 18 -> value 19


def test_pct_ignores_none_and_handles_empty():
    assert pct([None, 4.0, 2.0, None], 50) == 2.0  # median of [2,4] by nearest-rank
    assert pct([], 95) is None
    assert pct([None, None], 95) is None


def test_pct_single_value_is_every_percentile():
    assert pct([7], 5) == 7
    assert pct([7], 95) == 7


def test_discover_status_field_picks_most_common_status_key():
    arts = [
        {"briefing_status": "ready", "title": "a"},
        {"briefing_status": "ready"},
        {"status": "found"},
        None,            # no artifact
        "BAD",           # unparseable artifact
    ]
    assert discover_status_field(arts) == "briefing_status"


def test_discover_status_field_none_when_no_status_like_key():
    assert discover_status_field([{"opponents": []}, {"items": [1]}]) is None
    assert discover_status_field([]) is None


def test_infer_fail_values_from_observed_failure_words():
    statuses = Counter({"found": 10, "lookup_failed": 1, "error": 2})
    assert infer_fail_values(statuses, "status") == ["error", "lookup_failed"]


def test_infer_fail_values_always_includes_error_when_field_exists():
    # failures are rare; a small sample often misses them, so "error" is presumed
    statuses = Counter({"briefing_ready": 12, "awaiting_agenda": 30})
    assert infer_fail_values(statuses, "briefing_status") == ["error"]


def test_infer_fail_values_no_error_presumption_without_status_field():
    # no status field -> nothing to presume; only observed failure words survive
    assert infer_fail_values(Counter(), None) == []
    assert infer_fail_values(Counter({"error": 3}), None) == ["error"]


def test_corrupt_artifact_counts_as_no_valid_artifact():
    # A run whose artifact.json does not parse must count toward the no-artifact
    # baseline (it produced no VALID artifact) and stay out of the distribution.
    from derive_perf_thresholds import no_valid_artifact
    assert no_valid_artifact(None) is True
    assert no_valid_artifact("BAD") is True
    assert no_valid_artifact([1, 2]) is True      # array artifact: no usable status/fields
    assert no_valid_artifact("null") is True       # any non-dict parse result
    assert no_valid_artifact({"status": "found"}) is False
    assert no_valid_artifact({}) is False          # empty object is still an object


def test_classify_cp_separates_genuinely_absent_from_infra_error():
    # 404/NoSuchKey/does-not-exist means the object is genuinely missing (expected
    # for many runs); ANYTHING else (auth, network) is infra noise, never "missing".
    from derive_perf_thresholds import classify_cp
    assert classify_cp(0, "") == "ok"
    assert classify_cp(1, ERR_404) == "absent"
    assert classify_cp(1, "An error occurred (NoSuchKey) when calling GetObject") == "absent"
    assert classify_cp(1, ERR_DENIED) == "error"
    assert classify_cp(255, "Could not connect to the endpoint URL") == "error"
    assert classify_cp(1, None) == "error"


def test_list_runs_samples_from_strict_listing_and_propagates_listing_failure(monkeypatch):
    # Listing goes through perf_gate.list_run_ids (strict UUIDs, raises on aws
    # failure) — a failed `s3 ls` must raise, never silently sample zero runs.
    import derive_perf_thresholds as dpt
    ids = [f"01970000-0000-7000-8000-{i:012d}" for i in range(100, 140)]
    monkeypatch.setattr(dpt, "list_run_ids", lambda bucket, exp: list(ids))
    got = dpt._list_runs("b", "e", 10)
    assert len(got) == 10 and set(got) <= set(ids)

    def boom(bucket, exp):
        raise RuntimeError("s3 ls failed (rc=255): Unable to locate credentials")
    monkeypatch.setattr(dpt, "list_run_ids", boom)
    with pytest.raises(RuntimeError, match="s3 ls failed"):
        dpt._list_runs("b", "e", 10)


def test_main_drops_fetch_failures_from_baseline_with_loud_warning(monkeypatch, tmp_path, capsys):
    # A non-404 cp failure is infra noise: the run is dropped from the sample
    # entirely (NOT counted as no-artifact) and a loud stderr warning reports it.
    plan = {
        (RID[0], "trace"): "ok", (RID[0], "artifact"): "ok",
        (RID[1], "trace"): "error", (RID[1], "artifact"): "error",
        (RID[2], "trace"): "ok", (RID[2], "artifact"): "ok",
    }
    run_main(monkeypatch, tmp_path, RID[:3], plan)
    err = capsys.readouterr().err
    assert "WARNING" in err and "1/3" in err and "fetch failure" in err
    cfg = read_cfg(tmp_path)
    assert cfg["n"] == 2
    assert cfg["no_artifact_rate"] == 0.0  # the dropped run must not inflate the baseline


def test_classify_run_population_definition():
    # Agreed definition (perf_monitor implements the same): every sampled run is in
    # the no-artifact denominator. Absent/unparseable artifact = no_valid_artifact
    # (traceless or not); trace + valid artifact = complete (enters the cost/turns
    # distribution); valid artifact without a trace = artifact_only (in the
    # denominator, out of the distribution).
    from derive_perf_thresholds import classify_run
    assert classify_run(False, None) == "no_valid_artifact"
    assert classify_run(True, None) == "no_valid_artifact"
    assert classify_run(True, "BAD") == "no_valid_artifact"
    assert classify_run(False, "BAD") == "no_valid_artifact"
    assert classify_run(True, {"status": "found"}) == "complete"
    assert classify_run(True, [1, 2]) == "no_valid_artifact"   # non-dict JSON: same as perf_gate BAD_JSON
    assert classify_run(False, {"status": "found"}) == "artifact_only"


def test_aggregate_rows_keeps_artifact_only_in_denominator_but_out_of_distribution():
    from derive_perf_thresholds import aggregate_rows
    rows = [
        ("r1", {"cost": 1.0, "turns": 10, "tool_errors": 0}, {"status": "found"}),  # complete
        ("r2", None, None),                                                          # traceless, no artifact
        ("r3", None, {"status": "found"}),                                           # artifact_only
        ("r4", {"cost": 2.0, "turns": 20, "tool_errors": 1}, "BAD"),                 # corrupt artifact
    ]
    present, noart, statuses = aggregate_rows(rows, "status")
    assert [m["cost"] for m in present] == [1.0]   # only the complete run feeds the distribution
    assert noart == 2                              # r2 and r4; r3 is NOT no-artifact
    assert statuses == Counter({"found": 2})       # artifact_only still contributes its status


def test_main_counts_traceless_runs_in_no_artifact_denominator(monkeypatch, tmp_path, capsys):
    # perf_monitor includes traceless runs; the derived baseline must measure the
    # SAME metric or live-vs-baseline comparison permanently false-alarms.
    plan = {
        (RID[0], "trace"): "ok", (RID[0], "artifact"): "ok",          # complete
        (RID[1], "trace"): "absent", (RID[1], "artifact"): "absent",  # traceless + no artifact -> noart
        (RID[2], "trace"): "absent", (RID[2], "artifact"): "ok",      # artifact_only -> denominator only
    }
    run_main(monkeypatch, tmp_path, RID[:3], plan)
    cfg = read_cfg(tmp_path)
    assert cfg["n"] == 3                                  # all attempted runs, traceless included
    assert cfg["no_artifact_rate"] == round(1 / 3, 3)
    assert cfg["distribution"]["cost"]["median"] == 1.5   # only the complete run's cost


def test_main_refuses_to_write_config_when_no_usable_rows(monkeypatch, tmp_path, capsys):
    # Today a fully-failed pull writes a cost_max:0 garbage config with exit 0;
    # it must instead exit non-zero and write nothing.
    plan = {(rid, kind): "error" for rid in RID[:2] for kind in ("trace", "artifact")}
    with pytest.raises(SystemExit) as ei:
        run_main(monkeypatch, tmp_path, RID[:2], plan)
    assert ei.value.code not in (0, None)
    assert glob.glob(str(tmp_path / "outputs/perf-eval/myexp/*.perf.json")) == []


def test_config_is_env_scoped_and_stamped_with_derived_at(monkeypatch, tmp_path, capsys):
    # A prod re-derive must land beside the dev config, not overwrite it, and every
    # config records when it was derived (UTC ISO-8601, seconds precision).
    plan = {(RID[0], "trace"): "ok", (RID[0], "artifact"): "ok"}
    run_main(monkeypatch, tmp_path, RID[:1], plan, argv_extra=("--env", "dev"))
    run_main(monkeypatch, tmp_path, RID[:1], plan, argv_extra=("--env", "prod"))
    dev_path = tmp_path / "outputs/perf-eval/myexp/myexp.dev.perf.json"
    prod_path = tmp_path / "outputs/perf-eval/myexp/myexp.prod.perf.json"
    assert dev_path.exists() and prod_path.exists()
    dev, prod = json.load(open(dev_path)), json.load(open(prod_path))
    assert dev["env"] == "dev" and prod["env"] == "prod"
    import re
    for cfg in (dev, prod):
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00", cfg["derived_at"])


def test_sample_is_capped_at_requested_n():
    # The 2x oversample exists to survive missing files; the runs that feed the
    # config must be trimmed back to -n or the recorded n is ~2x the operator's intent.
    from derive_perf_thresholds import cap_sample
    rows = [("r%d" % i, {}, {"status": "x"}) for i in range(9)]
    assert len(cap_sample(rows, 5)) == 5
    assert len(cap_sample(rows, 20)) == 9


def test_refuses_ceilings_when_no_run_is_complete():
    # rows exist but none has trace + valid artifact: percentiles would collapse to
    # cost_max 0 and every future healthy run would FLAG. Refuse instead.
    import pytest
    from derive_perf_thresholds import require_complete_runs
    with pytest.raises(SystemExit):
        require_complete_runs(present=[], n_rows=7, exp="x", noart=7)
    require_complete_runs(present=[{"cost": 1}], n_rows=7, exp="x", noart=6)  # ok


def test_status_field_is_discovered_from_the_capped_sample_not_the_oversample(monkeypatch, tmp_path):
    # discover_status_field must run AFTER cap_sample: the emitted status_field has to
    # describe the same n rows that produce status_counts and the thresholds, or a
    # mixed-key population makes the config disagree with its own counts.
    import derive_perf_thresholds as dpt
    rids = ["r1", "r2", "r3", "r4", "r5"]
    bodies = {
        "r1": '{"status": "found"}', "r2": '{"status": "found"}',
        "r3": '{"briefing_status": "x"}', "r4": '{"briefing_status": "x"}', "r5": '{"briefing_status": "x"}',
    }

    def fake_aws(*args):
        src, dst = args[2], args[3]
        rid = src.split("/")[4]
        body = TRACE_LINE if src.endswith(".jsonl") else bodies[rid]
        with open(dst, "w") as f:
            f.write(body)
        return sp.CompletedProcess(args, 0, "", "")

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(dpt, "_list_runs", lambda bucket, exp, n: list(rids))
    monkeypatch.setattr(dpt, "_aws", fake_aws)
    monkeypatch.setattr(sys, "argv", ["derive_perf_thresholds.py", "myexp", "-n", "2"])
    dpt.main()
    cfg = read_cfg(tmp_path)
    assert cfg["n"] == 2
    # capped sample is r1,r2 (both "status"); the 2x oversample majority is briefing_status
    assert cfg["status_field"] == "status"


def test_compute_thresholds_zero_or_missing_p95_falls_back_to_default_not_zero():
    # A 0/None p95 (no result records, or a degenerate all-zero cost distribution)
    # must NOT become a literal 0 ceiling — that would FLAG every future run forever.
    # Fall back to the conservative DEFAULT_THRESHOLDS instead.
    from derive_perf_thresholds import compute_thresholds
    from perf_gate import DEFAULT_THRESHOLDS

    th = compute_thresholds(costs=[0.0, 0.0, 0.0], turns=[], errs=[0, 0, 0])
    assert th["cost_max"] == DEFAULT_THRESHOLDS["cost_max"]
    assert th["turns_max"] == DEFAULT_THRESHOLDS["turns_max"]
    assert th["tool_errors_max"] == 2  # clamped floor preserved


def test_compute_thresholds_uses_real_positive_p95_verbatim():
    from derive_perf_thresholds import compute_thresholds
    th = compute_thresholds(costs=[1.0, 2.0, 3.0], turns=[10, 20, 30], errs=[0, 1, 0])
    assert th["cost_max"] == 3.0
    assert th["turns_max"] == 30
