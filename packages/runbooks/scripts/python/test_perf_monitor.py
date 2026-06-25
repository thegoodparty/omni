"""Red/green tests for the real-time performance monitor's drift alarm.

The monitor gates the latest deployed dev runs and alarms when execution health drifts above
the experiment's derived baseline: the no-artifact failure rate climbs, or the FLAG rate
spikes. Pure decision so it's testable without S3.
"""
import json
import sys

import pytest

import perf_monitor
from perf_monitor import drift_alarm


def _write_cfg(tmp_path, **overrides):
    cfg = {"experiment": "test_exp", "status_field": None, "fail_values": [],
           "thresholds": {"cost_max": 6.0, "turns_max": 80, "tool_errors_max": 2},
           "no_artifact_rate": 0.15}
    cfg.update(overrides)
    p = tmp_path / "perf.json"
    p.write_text(json.dumps(cfg))
    return str(p)


def _run_main(monkeypatch, cfg_path, env="dev"):
    monkeypatch.setattr(sys, "argv",
                        ["perf_monitor.py", "--config", cfg_path, "--env", env, "-n", "30"])
    return perf_monitor.main()


def test_no_drift_no_alarm():
    r = drift_alarm(live_no_artifact_rate=0.15, live_flag_rate=0.10, baseline_no_artifact_rate=0.15)
    assert r["alarm"] is False
    assert r["reasons"] == []


def test_no_artifact_spike_alarms():
    r = drift_alarm(live_no_artifact_rate=0.40, live_flag_rate=0.05, baseline_no_artifact_rate=0.15)
    assert r["alarm"] is True
    assert any("no-artifact" in x.lower() for x in r["reasons"])


def test_flag_spike_alarms():
    r = drift_alarm(live_no_artifact_rate=0.05, live_flag_rate=0.60, baseline_no_artifact_rate=0.05)
    assert r["alarm"] is True
    assert any("flag" in x.lower() for x in r["reasons"])


def test_baseline_none_treated_as_zero():
    # A no-status experiment with no recorded baseline: any material no-artifact rate alarms.
    r = drift_alarm(live_no_artifact_rate=0.30, live_flag_rate=0.0, baseline_no_artifact_rate=None)
    assert r["alarm"] is True


def test_small_rise_within_tolerance_is_ok():
    r = drift_alarm(live_no_artifact_rate=0.20, live_flag_rate=0.10, baseline_no_artifact_rate=0.15)
    assert r["alarm"] is False  # 0.20 <= 0.15 + 0.10 tolerance


def test_drift_exactly_at_tolerance_does_not_alarm():
    # Both comparisons are strict >: live exactly AT baseline+tolerance (0.15+0.10=0.25)
    # and FLAG rate exactly AT its ceiling (0.20) must NOT alarm.
    r = drift_alarm(live_no_artifact_rate=0.25, live_flag_rate=0.20, baseline_no_artifact_rate=0.15)
    assert r["alarm"] is False
    assert r["reasons"] == []


def test_both_drift_conditions_fire_with_both_reasons():
    r = drift_alarm(
        live_no_artifact_rate=0.5, live_flag_rate=0.5,
        baseline_no_artifact_rate=0.1,
    )
    assert r["alarm"] is True
    assert len(r["reasons"]) == 2
    assert any("no-artifact" in x for x in r["reasons"])
    assert any("FLAG rate" in x for x in r["reasons"])


def test_main_exits_2_loudly_when_no_runs_found(tmp_path, monkeypatch, capsys):
    # FAIL-OPEN guard: an empty run list means the monitor has NOTHING to assess.
    # Printing "OK" and exiting 0 here is exactly how an auth failure hides an outage.
    # Exit 2 is distinct from the drift-ALARM exit 1.
    monkeypatch.setattr(perf_monitor, "list_run_ids", lambda bucket, exp: [], raising=False)
    rc = _run_main(monkeypatch, _write_cfg(tmp_path))
    assert rc == 2
    err = capsys.readouterr().err
    assert "no runs found under s3://" in err
    assert "cannot assess health" in err


def test_latest_run_ids_delegates_to_list_run_ids_and_keeps_newest_tail(monkeypatch):
    # Listing comes from perf_gate.list_run_ids (which raises on listing failure);
    # the monitor keeps only the newest-tail selection: UUIDv7 is time-ordered, so
    # the n lexically-latest ids, in sorted order, are the newest runs.
    ids = ["0190cccc-0000-7000-8000-000000000003",
           "0190aaaa-0000-7000-8000-000000000001",
           "0190bbbb-0000-7000-8000-000000000002"]
    monkeypatch.setattr(perf_monitor, "list_run_ids", lambda bucket, exp: list(ids), raising=False)
    got = perf_monitor._latest_run_ids("any-bucket", "any-exp", 2)
    assert got == ["0190bbbb-0000-7000-8000-000000000002",
                   "0190cccc-0000-7000-8000-000000000003"]


def test_lacks_valid_artifact_matches_derives_baseline_definition():
    # Agreed metric: no_artifact_rate = fraction of sampled run ids whose artifact is
    # absent OR unparseable (BAD_JSON) — a corrupt artifact is no valid artifact. The
    # live numerator must use the same definition as derive's baseline, or the drift
    # comparison is apples-to-oranges.
    from perf_gate import NO_ARTIFACT
    from perf_monitor import lacks_valid_artifact
    assert lacks_valid_artifact(NO_ARTIFACT) is True
    assert lacks_valid_artifact("BAD_JSON") is True
    assert lacks_valid_artifact("found") is False
    assert lacks_valid_artifact(None) is False


def test_env_mismatch_pure_decision():
    from perf_monitor import env_mismatch
    assert env_mismatch("prod", "dev") is True
    assert env_mismatch("dev", "dev") is False
    assert env_mismatch(None, "dev") is False  # legacy config without an env stamp: nothing to enforce


def test_main_hard_errors_on_env_mismatch(tmp_path, monkeypatch, capsys):
    # A prod-derived baseline must not gate dev (13% vs 33% no-artifact baselines differ
    # materially). The error must tell the operator to re-derive.
    monkeypatch.setattr(perf_monitor, "list_run_ids",
                        lambda bucket, exp: ["0190aaaa-0000-7000-8000-000000000001"], raising=False)
    monkeypatch.setattr(perf_monitor, "artifact_status", lambda *a, **k: "found")
    rc = _run_main(monkeypatch, _write_cfg(tmp_path, env="prod"), env="dev")
    assert rc == 2
    assert "re-derive" in capsys.readouterr().err


def test_throttled_trace_pull_raises_instead_of_counting_traceless(tmp_path, monkeypatch):
    # A throttled/denied trace pull is an infra error, not a traceless run. Misreading
    # it as "ran traceless" produces a false FLAG. s3_text returns None only on genuine
    # absence and raises otherwise — the monitor must let that raise propagate.
    monkeypatch.setattr(perf_monitor, "list_run_ids",
                        lambda bucket, exp: ["0190aaaa-0000-7000-8000-000000000001"], raising=False)
    monkeypatch.setattr(perf_monitor, "artifact_status", lambda *a, **k: "found")

    def throttled(bucket, key):
        raise RuntimeError("S3 fetch failed (NOT a missing object): ThrottlingException")
    monkeypatch.setattr(perf_monitor, "s3_text", throttled, raising=False)

    with pytest.raises(RuntimeError, match="Throttling"):
        _run_main(monkeypatch, _write_cfg(tmp_path))


def test_genuinely_absent_trace_gates_traceless_and_bad_json_counts_no_artifact(tmp_path, monkeypatch, capsys):
    # Two sampled runs: one truly traceless with a corrupt artifact (FAIL, counts in the
    # no-artifact numerator), one healthy (trace pulled via s3_text, valid artifact -> PASS).
    rid_dead = "0190aaaa-0000-7000-8000-000000000001"
    rid_ok = "0190bbbb-0000-7000-8000-000000000002"
    traces = {rid_dead: None,
              rid_ok: '{"type": "result", "num_turns": 5, "total_cost_usd": 0.50}\n'}
    statuses = {rid_dead: "BAD_JSON", rid_ok: "found"}
    monkeypatch.setattr(perf_monitor, "list_run_ids", lambda bucket, exp: list(traces), raising=False)
    monkeypatch.setattr(perf_monitor, "s3_text",
                        lambda bucket, key: traces[key.split("/")[1]], raising=False)
    monkeypatch.setattr(perf_monitor, "artifact_status",
                        lambda rid, *a, **k: statuses[rid])

    rc = _run_main(monkeypatch, _write_cfg(tmp_path))

    out = capsys.readouterr().out
    assert "PASS=1" in out and "FAIL=1" in out
    assert "no-artifact rate: 50%" in out
    assert rc == 1  # 50% no-artifact over a 15% baseline must alarm


def test_traceless_run_with_no_artifact_is_gated_as_fail_not_skipped():
    # A run with no conversation.jsonl must still count toward the sample —
    # skipping it hides exactly the hard failures the monitor exists to catch.
    from perf_monitor import gate_run
    r = gate_run(None, "NO_ARTIFACT", {"thresholds": {"cost_max": 1, "turns_max": 10, "tool_errors_max": 2}})
    assert r["verdict"] == "FAIL"


def test_traceless_run_with_artifact_flags_incomplete_instead_of_passing():
    from perf_monitor import gate_run
    r = gate_run(None, "found", {"thresholds": {"cost_max": 1, "turns_max": 10, "tool_errors_max": 2}})
    assert r["verdict"] == "FLAG"
    assert any("incomplete" in x or "no result" in x for x in r["reasons"])


def test_latest_run_ids_excludes_v4_and_preserves_v7_time_order(monkeypatch):
    # _latest_run_ids assumes UUIDv7 lexicographic time-ordering, but list_run_ids
    # matches ANY UUID version. A v4 (random) id would sort into an arbitrary
    # position and silently pollute the "latest N" window — restrict to v7.
    import perf_monitor as pm

    v7_old = "01970000-0000-7000-8000-000000000001"
    v7_new = "01990000-0000-7000-8000-000000000002"
    v4 = "ffffffff-ffff-4fff-8fff-ffffffffffff"  # lex-largest; would wrongly sort last
    monkeypatch.setattr(pm, "list_run_ids", lambda b, e: [v7_old, v4, v7_new])

    out = pm._latest_run_ids("bucket", "exp", 2)
    assert v4 not in out
    assert out == [v7_old, v7_new]


def test_latest_run_ids_warns_when_only_v4_ids_present(monkeypatch, capsys):
    # All run ids are UUIDv4 -> v7 filter empties the window. The operator must be
    # told v4 ids were dropped, not left with the same "no runs found" message a
    # genuinely empty bucket produces.
    import perf_monitor as pm

    v4a = "ffffffff-ffff-4fff-8fff-ffffffffffff"
    v4b = "00000000-0000-4000-8000-000000000000"
    monkeypatch.setattr(pm, "list_run_ids", lambda b, e: [v4a, v4b])

    out = pm._latest_run_ids("bucket", "exp", 5)
    assert out == []
    err = capsys.readouterr().err.lower()
    assert "v4" in err or "uuidv7" in err
