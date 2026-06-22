"""Red/green tests for the performance gate (config-driven, per-experiment).

Cross-experiment grounding showed there is NO universal status field: meeting_briefing uses
`briefing_status`, meeting_schedule uses `status`, opposition_research and
opportunities_and_challenges have none. So the gate's one universal hard FAIL is "produced no
artifact"; any status-based failure is per-experiment config (`fail_values`), and thresholds
are per-experiment too. A run with no status field is judged on artifact-presence + ceilings.
"""
from perf_gate import evaluate, looks_like_run_id, DEFAULT_THRESHOLDS, NO_ARTIFACT

OK = {"cost": 3.0, "turns": 45, "tool_errors": 0}
BRIEFING_CFG = {"fail_values": ["error"], "thresholds": DEFAULT_THRESHOLDS}


def test_no_artifact_is_the_universal_hard_fail():
    assert evaluate(OK, NO_ARTIFACT)["verdict"] == "FAIL"


def test_configured_fail_value_fails():
    r = evaluate(OK, "error", BRIEFING_CFG)
    assert r["verdict"] == "FAIL"


def test_valid_status_passes_even_if_it_looks_terminal():
    # "found" is meeting_schedule's success; with a config that only fails on "error" it passes.
    assert evaluate(OK, "found", {"fail_values": ["error"], "thresholds": DEFAULT_THRESHOLDS})["verdict"] == "PASS"


def test_status_not_treated_as_failure_without_config():
    # Default config has no fail_values: only NO_ARTIFACT is universal, so a bare "error"
    # string is NOT auto-failed (the gate can't know per-experiment semantics without config).
    assert evaluate(OK, "error")["verdict"] == "PASS"


def test_no_status_field_healthy_run_passes():
    assert evaluate(OK, None)["verdict"] == "PASS"


def test_cost_over_ceiling_flags():
    r = evaluate({"cost": 10.0, "turns": 45, "tool_errors": 0}, None)
    assert r["verdict"] == "FLAG" and any("cost" in x.lower() for x in r["reasons"])


def test_turns_over_ceiling_flags():
    r = evaluate({"cost": 3.0, "turns": 200, "tool_errors": 0}, None)
    assert r["verdict"] == "FLAG" and any("turn" in x.lower() for x in r["reasons"])


def test_tool_errors_over_ceiling_flags():
    r = evaluate({"cost": 3.0, "turns": 45, "tool_errors": 9}, None)
    assert r["verdict"] == "FLAG" and any("error" in x.lower() for x in r["reasons"])


def test_no_artifact_outranks_a_flag():
    r = evaluate({"cost": 99.0, "turns": 999, "tool_errors": 9}, NO_ARTIFACT)
    assert r["verdict"] == "FAIL"


def test_per_experiment_thresholds_apply():
    # meeting_schedule is ~10x cheaper; a $2 run flags only under a tight per-exp ceiling.
    tight = {"fail_values": [], "thresholds": {"cost_max": 1.0, "turns_max": 80, "tool_errors_max": 2}}
    assert evaluate({"cost": 2.0, "turns": 30, "tool_errors": 0}, "found", tight)["verdict"] == "FLAG"


# The gate resolves the artifact by run_id derived from the trace FILENAME. A trace named
# anything other than <run_id>.jsonl makes every S3 lookup miss → a false 100% NO_ARTIFACT.
# looks_like_run_id() lets main() warn instead of silently failing the whole arm.
def test_uuid_run_id_filename_is_recognized():
    assert looks_like_run_id("019ea8a3-bb03-7448-9235-b8616e9bf645")
    assert looks_like_run_id("60ae671b-94ee-4b9d-9cc6-f744348cabe9")


def test_label_named_trace_is_flagged_as_not_a_run_id():
    # this is exactly the mistake that produced a fake 100% NO_ARTIFACT in practice
    assert not looks_like_run_id("briefing_ready-andrew")
    assert not looks_like_run_id("awaiting_agenda-nathan")


# --- the S3 join: absent-vs-infra-failure must never conflate (an auth error must not
# fabricate NO_ARTIFACT hard-FAILs), and the helper must fetch the exact key ---

class _FakeProc:
    def __init__(self, returncode, stdout, stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class _FakeAws:
    """Records each subprocess command and replays a canned result."""

    def __init__(self, returncode, stdout, stderr=""):
        self.cmds = []
        self._result = _FakeProc(returncode, stdout, stderr)

    def __call__(self, cmd, **_kwargs):
        self.cmds.append(cmd)
        return self._result


def _patch_aws(monkeypatch, returncode, stdout, stderr=""):
    import perf_gate
    fake = _FakeAws(returncode, stdout, stderr)
    monkeypatch.setattr(perf_gate.subprocess, "run", fake)
    return fake


def test_artifact_status_fetches_the_exact_artifact_key(monkeypatch):
    from perf_gate import artifact_status
    fake = _patch_aws(monkeypatch, 0, '{"status": "found"}')
    artifact_status("rid", "bucket", "exp", "status")
    assert fake.cmds[0][:4] == ["aws", "s3", "cp", "s3://bucket/exp/rid/artifact.json"]


def test_artifact_status_genuinely_missing_object_is_no_artifact(monkeypatch):
    from perf_gate import artifact_status, NO_ARTIFACT
    _patch_aws(monkeypatch, 1, "", stderr="fatal error: An error occurred (404) when calling the HeadObject operation: Key \"exp/rid/artifact.json\" does not exist")
    assert artifact_status("rid", "bucket", "exp", "status") == NO_ARTIFACT


def test_artifact_status_auth_failure_raises_instead_of_faking_no_artifact(monkeypatch):
    # An expired token must NOT become a hard FAIL: that fabricates a 100% failure fleet.
    import pytest
    from perf_gate import artifact_status
    _patch_aws(monkeypatch, 1, "", stderr="fatal error: An error occurred (ExpiredToken) when calling the GetObject operation")
    with pytest.raises(RuntimeError, match="NOT a missing object"):
        artifact_status("rid", "bucket", "exp", "status")


def test_artifact_status_empty_body_is_bad_json_not_no_artifact(monkeypatch):
    # A zero-byte artifact.json EXISTS (200, empty body): that is a corrupt artifact,
    # not a missing one — it must not inflate the no-artifact rate as a fake 404.
    from perf_gate import artifact_status
    _patch_aws(monkeypatch, 0, "")
    assert artifact_status("rid", "bucket", "exp", "status") == "BAD_JSON"


def test_artifact_status_unparseable_body_is_bad_json(monkeypatch):
    from perf_gate import artifact_status
    _patch_aws(monkeypatch, 0, "not json at all")
    assert artifact_status("rid", "bucket", "exp", "status") == "BAD_JSON"


def test_artifact_status_extracts_configured_field_or_none(monkeypatch):
    from perf_gate import artifact_status
    _patch_aws(monkeypatch, 0, '{"briefing_status": "briefing_ready"}')
    assert artifact_status("rid", "b", "e", "briefing_status") == "briefing_ready"
    assert artifact_status("rid", "b", "e", None) is None
    assert artifact_status("rid", "b", "e", "missing_field") is None


def test_list_run_ids_parses_ls_output_with_strict_uuid_filter(monkeypatch):
    from perf_gate import list_run_ids
    ls_out = (
        "                           PRE 019e292f-df74-7ddf-9d4e-4b96d080c9b6/\n"
        "                           PRE 0556469a-aaaa-bbbb-cccc-0123456789ab/\n"
        "                           PRE logs/\n"
        "2026-06-09 11:22:33   123 stray-object.json\n"
    )
    _patch_aws(monkeypatch, 0, ls_out)
    assert list_run_ids("bucket", "exp") == [
        "019e292f-df74-7ddf-9d4e-4b96d080c9b6",
        "0556469a-aaaa-bbbb-cccc-0123456789ab",
    ]


def test_list_run_ids_raises_on_listing_failure_never_returns_empty(monkeypatch):
    # An empty return on auth failure is how a monitor fails open.
    import pytest
    from perf_gate import list_run_ids
    _patch_aws(monkeypatch, 254, "", stderr="An error occurred (ExpiredToken)")
    with pytest.raises(RuntimeError, match="ExpiredToken"):
        list_run_ids("bucket", "exp")


def test_evaluate_at_ceiling_is_pass_not_flag():
    # The ceilings are inclusive: a run AT p95 is the distribution's own edge, not over it.
    from perf_gate import evaluate
    cfg = {"status_field": None, "fail_values": [], "thresholds": {"cost_max": 6.0, "turns_max": 80, "tool_errors_max": 2}}
    r = evaluate({"cost": 6.0, "turns": 80, "tool_errors": 2}, None, cfg)
    assert r["verdict"] == "PASS"


def test_bad_json_artifact_is_a_hard_fail_like_no_artifact():
    # A corrupt artifact.json is "no valid artifact": it must not pass on metrics alone
    # (BAD_JSON never appears in fail_values — infer_fail_values only matches error words).
    from perf_gate import evaluate
    r = evaluate({"cost": 0.5, "turns": 10, "tool_errors": 0}, "BAD_JSON")
    assert r["verdict"] == "FAIL"
    assert any("artifact" in x for x in r["reasons"])


def test_lacks_valid_artifact_counts_bad_json_with_no_artifact():
    # One shared definition for "no valid artifact" so the gate summary, derive
    # baseline, and monitor live rate all count the same thing.
    from perf_gate import lacks_valid_artifact
    assert lacks_valid_artifact("NO_ARTIFACT") is True
    assert lacks_valid_artifact("BAD_JSON") is True
    assert lacks_valid_artifact("found") is False
    assert lacks_valid_artifact(None) is False


def test_artifact_status_non_object_json_is_bad_json(monkeypatch):
    # Valid JSON that isn't an object (null, array) must not crash .get() mid-batch.
    from perf_gate import artifact_status
    _patch_aws(monkeypatch, 0, "null")
    assert artifact_status("rid", "b", "e", "status") == "BAD_JSON"
    _patch_aws(monkeypatch, 0, "[1, 2]")
    assert artifact_status("rid", "b", "e", "status") == "BAD_JSON"
