"""Validate that every experiment manifest under runbooks/experiments/ conforms
to the meta-schema, and that the meta-schema rejects ill-formed manifests.

Run: cd ~/work/runbooks/scripts/python && uv run pytest test_experiment_manifests.py -v
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator, ValidationError

REPO_ROOT = Path(__file__).resolve().parents[2]
EXPERIMENTS_DIR = REPO_ROOT / "experiments"
META_SCHEMA_PATH = EXPERIMENTS_DIR / "_schema" / "manifest.schema.json"
QA_META_SCHEMA_PATH = EXPERIMENTS_DIR / "_schema" / "qa.schema.json"


def _load_meta_schema() -> dict:
    return json.loads(META_SCHEMA_PATH.read_text())


def _load_qa_meta_schema() -> dict:
    return json.loads(QA_META_SCHEMA_PATH.read_text())


def _all_manifest_paths() -> list[Path]:
    return sorted(p for p in EXPERIMENTS_DIR.glob("*/manifest.json") if "_schema" not in p.parts)


def _all_qa_manifest_paths() -> list[Path]:
    return sorted(p for p in EXPERIMENTS_DIR.glob("*/qa/manifest.json") if "_schema" not in p.parts)


def test_meta_schema_is_valid_draft7():
    meta = _load_meta_schema()
    Draft7Validator.check_schema(meta)


def test_qa_meta_schema_is_valid_draft7():
    """`_schema/qa.schema.json` must itself be a well-formed Draft-07 schema —
    Draft7Validator.check_schema raises on a malformed meta-schema."""
    Draft7Validator.check_schema(_load_qa_meta_schema())


@pytest.mark.parametrize(
    "qa_manifest_path",
    _all_qa_manifest_paths(),
    ids=lambda p: p.parent.parent.name,
)
def test_qa_manifest_validates_against_qa_schema(qa_manifest_path: Path):
    """Every checked-in experiments/*/qa/manifest.json must validate against
    the qa meta-schema. Parametrization is empty until the first qa folder
    lands, in which case this test is a no-op (pytest collects zero params)."""
    qa_meta = _load_qa_meta_schema()
    manifest = json.loads(qa_manifest_path.read_text())
    errors = sorted(
        Draft7Validator(qa_meta).iter_errors(manifest),
        key=lambda e: [str(p) for p in e.absolute_path],
    )
    if errors:
        msgs = [f"  - {'.'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}" for e in errors]
        pytest.fail(f"{qa_manifest_path.relative_to(REPO_ROOT)} fails qa meta-schema:\n" + "\n".join(msgs))


def test_at_least_one_experiment_exists():
    assert _all_manifest_paths(), "no experiment manifests found under experiments/*/manifest.json"


@pytest.mark.parametrize("manifest_path", _all_manifest_paths(), ids=lambda p: p.parent.name)
def test_manifest_validates_against_meta_schema(manifest_path: Path):
    meta = _load_meta_schema()
    manifest = json.loads(manifest_path.read_text())
    errors = sorted(
        Draft7Validator(meta).iter_errors(manifest),
        key=lambda e: [str(p) for p in e.absolute_path],
    )
    if errors:
        msgs = [f"  - {'.'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}" for e in errors]
        pytest.fail(f"{manifest_path.relative_to(REPO_ROOT)} fails meta-schema:\n" + "\n".join(msgs))


@pytest.mark.parametrize("manifest_path", _all_manifest_paths(), ids=lambda p: p.parent.name)
def test_manifest_id_matches_directory(manifest_path: Path):
    manifest = json.loads(manifest_path.read_text())
    assert manifest["id"] == manifest_path.parent.name, (
        f"manifest id '{manifest['id']}' must match dir name '{manifest_path.parent.name}'"
    )


@pytest.mark.parametrize("manifest_path", _all_manifest_paths(), ids=lambda p: p.parent.name)
def test_each_manifest_has_instruction(manifest_path: Path):
    instruction = manifest_path.parent / "instruction.md"
    assert instruction.exists(), f"missing {instruction.relative_to(REPO_ROOT)}"
    assert instruction.read_text().strip(), f"{instruction.relative_to(REPO_ROOT)} is empty"


@pytest.mark.parametrize("manifest_path", _all_manifest_paths(), ids=lambda p: p.parent.name)
def test_input_schema_is_valid_jsonschema_draft7(manifest_path: Path):
    """The agent's input contract is itself JSON Schema Draft-07. gp-api validates dispatch params against this."""
    manifest = json.loads(manifest_path.read_text())
    Draft7Validator.check_schema(manifest["input_schema"])


@pytest.mark.parametrize("manifest_path", _all_manifest_paths(), ids=lambda p: p.parent.name)
def test_output_schema_is_valid_jsonschema_draft7(manifest_path: Path):
    """The artifact contract is itself JSON Schema Draft-07. Codegen depends on this."""
    manifest = json.loads(manifest_path.read_text())
    Draft7Validator.check_schema(manifest["output_schema"])


def _good_manifest() -> dict:
    paths = _all_manifest_paths()
    assert paths, "need at least one manifest as a starting point for negative tests"
    return json.loads(paths[0].read_text())


@pytest.mark.parametrize(
    "mutation,expected_message_fragment",
    [
        pytest.param(
            lambda m: m.pop("id"),
            "'id' is a required property",
            id="missing-id",
        ),
        pytest.param(
            lambda m: m.update({"id": "Voter Targeting"}),
            "does not match",
            id="id-with-spaces",
        ),
        pytest.param(
            lambda m: m.update({"timeout_seconds": 30}),
            "less than the minimum",
            id="timeout-too-low",
        ),
        pytest.param(
            lambda m: m.pop("output_schema"),
            "'output_schema' is a required property",
            id="missing-output-schema",
        ),
        pytest.param(
            lambda m: m.pop("input_schema"),
            "'input_schema' is a required property",
            id="missing-input-schema",
        ),
        pytest.param(
            lambda m: m.update({"unknown_field": "x"}),
            "Additional properties are not allowed",
            id="extra-top-level-field",
        ),
        pytest.param(
            lambda m: m.update({"scope": {"allowed_tables": ["FOO.bar.baz"], "max_rows": 100}}),
            "does not match",
            id="scope-table-uppercase-rejected",
        ),
        pytest.param(
            lambda m: m.update({"scope": {"allowed_tables": ["a.b.c"], "max_rows": 2_000_000}}),
            "is greater than the maximum",
            id="scope-max-rows-over-cap-rejected",
        ),
        pytest.param(
            lambda m: m.update({"version": "1"}),
            "is not of type 'integer'",
            id="version-not-integer",
        ),
        pytest.param(
            lambda m: m.update(
                {
                    "scope": {
                        "allowed_tables": ["a.b.c"],
                        "max_rows": 100,
                        "data_required_unless": {"values": ["x"]},
                    }
                }
            ),
            "'field' is a required property",
            id="data-required-unless-missing-field",
        ),
        pytest.param(
            lambda m: m.update(
                {
                    "scope": {
                        "allowed_tables": ["a.b.c"],
                        "max_rows": 100,
                        "data_required_unless": {
                            "field": "briefing_status",
                            "values": [],
                        },
                    }
                }
            ),
            "should be non-empty",
            id="data-required-unless-empty-values",
        ),
        pytest.param(
            lambda m: m.update({"permission_mode": "acceptEdits"}),
            "is not one of",
            id="permission-mode-outside-allowlist",
        ),
        pytest.param(
            lambda m: m.update({"system_prompt": ""}),
            "should be non-empty",
            id="system-prompt-empty",
        ),
        pytest.param(
            lambda m: m.update({"system_prompt": "x" * 50_001}),
            "is too long",
            id="system-prompt-over-max-length",
        ),
        pytest.param(
            lambda m: m.update({"allowed_external_tools": ["WebFetch", "WebFetch"]}),
            "has non-unique elements",
            id="allowed-external-tools-duplicates",
        ),
        pytest.param(
            lambda m: m.update({"allowed_external_tools": ["x" * 65]}),
            "is too long",
            id="allowed-external-tools-name-too-long",
        ),
    ],
)
def test_meta_schema_rejects_bad_manifests(mutation, expected_message_fragment):
    meta = _load_meta_schema()
    bad = copy.deepcopy(_good_manifest())
    mutation(bad)
    errors = list(Draft7Validator(meta).iter_errors(bad))
    assert errors, f"expected validation error containing '{expected_message_fragment}' but manifest validated"
    messages = " | ".join(e.message for e in errors)
    assert expected_message_fragment in messages, (
        f"expected '{expected_message_fragment}' in errors but got: {messages}"
    )


# ---------------------------------------------------------------------------
# compliance_setup dispatch-resolution smoke test (ENG-7535)
#
# Mirrors the AC item "smoke test resolves it from a fixture SQS event and
# validates input." Lives in runbooks rather than pmf_engine because
# pmf_engine/tests/conftest.py explicitly forbids reaching for real experiment
# fixtures from engine tests ("if you find yourself reaching for a real
# experiment fixture here, that's a smell — the test belongs in runbooks").
#
# Asserts the dispatch-time contract from the runbooks side:
#   1. Write-action discriminator is set (system_prompt OR permission_mode
#      present — what dispatch_handler._is_write_action keys on).
#   2. No `scope` block — write-action experiments use {} scope post-ENG-10128
#      (Architecture Note 5: no per-experiment gp-api endpoint allowlist;
#      derive_gp_api_scope and allowed_gp_api_endpoints were removed).
#   3. A representative SQS-message params payload validates against
#      input_schema — what dispatch_handler validates before launching ECS.
#   4. A representative agent artifact validates against output_schema —
#      what /workspace/validate_output.py enforces before publish.
# ---------------------------------------------------------------------------


def _compliance_setup_manifest() -> dict:
    return json.loads((EXPERIMENTS_DIR / "compliance_setup" / "manifest.json").read_text())


def test_compliance_setup_carries_write_action_discriminator():
    manifest = _compliance_setup_manifest()
    has_discriminator = manifest.get("system_prompt") is not None or manifest.get("permission_mode") is not None
    assert has_discriminator, (
        "compliance_setup is a write-action experiment but neither system_prompt nor "
        "permission_mode is set — dispatch_handler._is_write_action will misroute it "
        "through derive_scope (Databricks shape) instead of empty-scope MintRequest."
    )


def test_compliance_setup_permission_mode_is_bypass():
    """compliance_setup runs unattended in a headless Fargate container. The
    Claude SDK's `default` permission_mode pauses for human confirmation on
    tool calls — with no tty in Fargate, that hangs every run until
    timeout_seconds fires. The meta-schema allows both `default` and
    `bypassPermissions` (some future experiment may want `default`), so the
    value has to be pinned at the per-experiment level here."""
    manifest = _compliance_setup_manifest()
    assert manifest.get("permission_mode") == "bypassPermissions", (
        f"compliance_setup must use permission_mode='bypassPermissions' for "
        f"unattended Fargate execution. Got: {manifest.get('permission_mode')!r}"
    )


def test_compliance_setup_has_no_databricks_scope():
    """Write-action experiments use {} scope (Architecture Note 5). A scope
    block here would route the dispatch through derive_scope, which only
    knows the Databricks shape."""
    manifest = _compliance_setup_manifest()
    assert not manifest.get("scope"), (
        f"compliance_setup must not declare a `scope` block — write-action experiments "
        f"use empty scope. Got: {manifest.get('scope')!r}"
    )


def test_compliance_setup_validates_representative_dispatch_params():
    """Lambda's dispatch_handler validates message['params'] against
    input_schema before launching Fargate. A valid SQS event must pass."""
    manifest = _compliance_setup_manifest()
    valid_params = {
        "campaign_id": 12345,
        "clerk_user_id": "user_2abc123",
        "election_date": "2026-11-03",
        "trigger": "initial",
        "candidate_first_name": "Jane",
        "candidate_last_name": "Doe",
        "domain_budget_cap_usd": 10,
    }
    errors = list(Draft7Validator(manifest["input_schema"]).iter_errors(valid_params))
    assert errors == [], f"valid params rejected: {[e.message for e in errors]}"


def test_compliance_setup_accepts_empty_first_name():
    """candidate_first_name is accepted-but-unused: the initials-based domain
    patterns that consumed it were removed, but the dispatcher still includes the
    field in the params payload. The schema must tolerate it (including empty
    string) so dispatch validation does not reject a real SQS event."""
    manifest = _compliance_setup_manifest()
    params = {
        "campaign_id": 12345,
        "clerk_user_id": "user_2abc123",
        "election_date": "2026-11-03",
        "trigger": "initial",
        "candidate_first_name": "",
        "candidate_last_name": "Doe",
    }
    errors = list(Draft7Validator(manifest["input_schema"]).iter_errors(params))
    assert errors == [], f"empty candidate_first_name rejected: {[e.message for e in errors]}"


def test_compliance_setup_rejects_invalid_dispatch_params():
    """Dispatch validation must catch obviously-wrong params (type mismatch,
    out-of-range budget). Otherwise the agent boots with garbage."""
    manifest = _compliance_setup_manifest()
    bad_cases = [
        {"campaign_id": "not_a_number", "clerk_user_id": "u", "election_date": "2026-11-03",
         "trigger": "initial", "candidate_first_name": "J", "candidate_last_name": "D"},
        {"campaign_id": 1, "clerk_user_id": "u", "election_date": "2026-11-03",
         "trigger": "unknown_trigger_value", "candidate_first_name": "J", "candidate_last_name": "D"},
        {"campaign_id": 1, "clerk_user_id": "u", "election_date": "2026-11-03",
         "trigger": "initial", "candidate_first_name": "J", "candidate_last_name": "D",
         "domain_budget_cap_usd": 50},
        {"campaign_id": 1, "clerk_user_id": "u",
         "trigger": "initial", "candidate_first_name": "J", "candidate_last_name": "D"},
    ]
    validator = Draft7Validator(manifest["input_schema"])
    for params in bad_cases:
        assert list(validator.iter_errors(params)), f"expected rejection but params validated: {params}"


def _empty_subobjects() -> dict:
    """Zero-value blocks for artifact shapes that haven't reached the stage
    that populates them. Centralized so the enum-coverage tests below don't
    drift from each other."""
    return {
        "domain": {"name": "", "registrar": "", "purchased_at": "",
                   "auto_renew": False, "price_usd": 0},
        "website": {"url": "", "vanity_path": "", "published_at": "", "verified_live_at": ""},
        "tcr_submission": {"peerly_request_id": "", "submitted_at": "", "verified_url": ""},
    }


def test_compliance_setup_output_schema_accepts_terminal_artifact():
    """The agent's /workspace/output/compliance_setup.json must validate against
    output_schema. A minimal happy-path artifact (stage=tcr_submitted) is the
    canonical post-run shape — if this rejects it, the platform-generated
    validate_output.py will reject every real run."""
    manifest = _compliance_setup_manifest()
    artifact = {
        "stage": "tcr_submitted",
        "campaign_id": 12345,
        "run_id": "run-abc",
        "started_at": "2026-05-23T10:00:00Z",
        "ended_at": "2026-05-23T10:05:00Z",
        "domain": {"name": "votedoeNov2026.run", "registrar": "route53",
                   "purchased_at": "2026-05-23T10:01:00Z", "auto_renew": True, "price_usd": 10},
        "website": {"url": "https://votedoeNov2026.run", "vanity_path": "jane-doe",
                    "published_at": "2026-05-23T10:02:00Z", "verified_live_at": "2026-05-23T10:03:00Z"},
        "tcr_submission": {"peerly_request_id": "pr_abc123",
                           "submitted_at": "2026-05-23T10:04:00Z", "verified_url": ""},
        "completed_steps": ["compliance_state_read", "domain_search", "domain_purchase",
                            "publish_website", "verify_website_live", "submit_tcr"],
        "skipped_steps": [],
        "blockers_encountered": [],
        "errors": [],
        "next_action": {"kind": "", "scheduled_for": ""},
        "metrics": {"num_turns": 18, "model_cost_usd": 0.34, "wall_time_seconds": 245},
        "data_quality": {"overall": "ok"},
    }
    errors = list(Draft7Validator(manifest["output_schema"]).iter_errors(artifact))
    assert errors == [], f"terminal artifact rejected: {[e.message for e in errors]}"


def test_compliance_setup_output_schema_accepts_recovery_loop_exits():
    """Non-terminal artifacts written when the agent exits cleanly into the
    recovery loop must validate. Covers both `next_action.kind` enum values
    (wait_dns_propagation, wait_vercel_verify) and `data_quality.overall =
    'partial'`. A schema regression that drops any of these enum entries
    would break validate_output.py on every real recovery-loop run."""
    manifest = _compliance_setup_manifest()
    validator = Draft7Validator(manifest["output_schema"])

    base_dns_wait = {
        "stage": "pending_website_live",
        "campaign_id": 12345,
        "run_id": "run-abc",
        "started_at": "2026-05-23T10:00:00Z",
        "ended_at": "2026-05-23T10:02:00Z",
        **_empty_subobjects(),
        "domain": {"name": "votedoeNov2026.run", "registrar": "route53",
                   "purchased_at": "2026-05-23T10:01:00Z", "auto_renew": True, "price_usd": 10},
        "website": {"url": "https://votedoeNov2026.run", "vanity_path": "votedoe",
                    "published_at": "2026-05-23T10:01:30Z", "verified_live_at": ""},
        "completed_steps": ["compliance_state_read", "domain_search", "domain_purchase",
                            "publish_website"],
        "skipped_steps": [],
        "blockers_encountered": [],
        "errors": [],
        "next_action": {"kind": "wait_dns_propagation",
                        "scheduled_for": "2026-05-23T10:32:00Z"},
        "metrics": {"num_turns": 8, "model_cost_usd": 0.12, "wall_time_seconds": 90},
        "data_quality": {"overall": "partial"},
    }
    errors = list(validator.iter_errors(base_dns_wait))
    assert errors == [], f"wait_dns_propagation artifact rejected: {[e.message for e in errors]}"

    vercel_wait = {**base_dns_wait,
                   "next_action": {"kind": "wait_vercel_verify",
                                   "scheduled_for": "2026-05-23T10:17:00Z"}}
    errors = list(validator.iter_errors(vercel_wait))
    assert errors == [], f"wait_vercel_verify artifact rejected: {[e.message for e in errors]}"


def test_compliance_setup_output_schema_accepts_failed_artifact():
    """`stage=failed` + `data_quality.overall='failed'` + a recoverable=false
    blocker is the canonical unrecoverable-blocker artifact. Must validate so
    the recovery loop can read it and decide not to re-dispatch."""
    manifest = _compliance_setup_manifest()
    artifact = {
        "stage": "failed",
        "campaign_id": 12345,
        "run_id": "run-abc",
        "started_at": "2026-05-23T10:00:00Z",
        "ended_at": "2026-05-23T10:01:00Z",
        **_empty_subobjects(),
        "completed_steps": ["compliance_state_read"],
        "skipped_steps": [],
        "blockers_encountered": [
            {"step": "domain_search", "code": "budget_exceeded",
             "detail": "no domain under $10", "first_seen_at": "2026-05-23T10:00:30Z",
             "retry_count": 0, "is_recoverable": False}
        ],
        "errors": [],
        "next_action": {"kind": "", "scheduled_for": ""},
        "metrics": {"num_turns": 3, "model_cost_usd": 0.04, "wall_time_seconds": 40},
        "data_quality": {"overall": "failed"},
    }
    errors = list(Draft7Validator(manifest["output_schema"]).iter_errors(artifact))
    assert errors == [], f"failed artifact rejected: {[e.message for e in errors]}"


def test_compliance_setup_output_schema_rejects_stage_quality_mismatch():
    """The schema description documents a strict stage<->data_quality.overall
    invariant. An agent bug that writes a mismatched pair (e.g. stage=failed
    with overall=partial) would silently bypass Slack alerting (ENG-7555
    routes on overall=failed). The output_schema's allOf block enforces the
    pairing so validate_output.py catches it before publish."""
    manifest = _compliance_setup_manifest()
    validator = Draft7Validator(manifest["output_schema"])

    base = {
        "campaign_id": 12345,
        "run_id": "run-abc",
        "started_at": "2026-05-23T10:00:00Z",
        "ended_at": "2026-05-23T10:01:00Z",
        **_empty_subobjects(),
        "completed_steps": [],
        "skipped_steps": [],
        "blockers_encountered": [],
        "errors": [],
        "next_action": {"kind": "", "scheduled_for": ""},
        "metrics": {"num_turns": 1, "model_cost_usd": 0.01, "wall_time_seconds": 5},
    }

    bad_cases = [
        # stage=failed but overall is not failed
        {**base, "stage": "failed", "data_quality": {"overall": "partial"}},
        {**base, "stage": "failed", "data_quality": {"overall": "ok"}},
        # stage=tcr_submitted but overall is not ok/degraded
        {**base, "stage": "tcr_submitted", "data_quality": {"overall": "partial"}},
        {**base, "stage": "tcr_submitted", "data_quality": {"overall": "failed"}},
        # overall=failed but stage is not failed
        {**base, "stage": "pending_website_live", "data_quality": {"overall": "failed"}},
        # overall=ok/degraded but stage is not tcr_submitted
        {**base, "stage": "domain_purchased", "data_quality": {"overall": "ok"}},
        {**base, "stage": "domain_purchased", "data_quality": {"overall": "degraded"}},
    ]
    for artifact in bad_cases:
        errors = list(validator.iter_errors(artifact))
        assert errors, (
            f"expected stage<->overall mismatch rejection but artifact validated: "
            f"stage={artifact['stage']!r} overall={artifact['data_quality']['overall']!r}"
        )


def test_compliance_setup_output_schema_rejects_next_action_pair_mismatch():
    """next_action.kind ↔ next_action.scheduled_for must agree on emptiness.
    An agent that writes kind=wait_dns_propagation with scheduled_for=''
    would hand the recovery loop a wait signal with no anchor — either
    crashing on parse or hot-retrying immediately. Symmetrically a
    scheduled_for with no kind is meaningless. Enforced via the allOf
    invariant alongside the stage<->data_quality pairing."""
    manifest = _compliance_setup_manifest()
    validator = Draft7Validator(manifest["output_schema"])

    base = {
        "stage": "pending_website_live",
        "campaign_id": 12345,
        "run_id": "run-abc",
        "started_at": "2026-05-23T10:00:00Z",
        "ended_at": "2026-05-23T10:02:00Z",
        **_empty_subobjects(),
        "domain": {"name": "votedoeNov2026.run", "registrar": "route53",
                   "purchased_at": "2026-05-23T10:01:00Z", "auto_renew": True, "price_usd": 10},
        "completed_steps": ["compliance_state_read", "domain_search", "domain_purchase",
                            "publish_website"],
        "skipped_steps": [],
        "blockers_encountered": [],
        "errors": [],
        "metrics": {"num_turns": 8, "model_cost_usd": 0.12, "wall_time_seconds": 90},
        "data_quality": {"overall": "partial"},
    }

    # Note: the schema also declares format: date-time on scheduled_for when
    # kind is set, but Draft7Validator doesn't enforce format strings unless
    # the consumer opts in via format_checker. The minLength+presence pairing
    # below is what catches the realistic agent-bug case (skeleton-default
    # empty string left in place after writing kind).
    bad_cases = [
        # kind set but scheduled_for empty — recovery loop has no anchor
        {**base, "next_action": {"kind": "wait_dns_propagation", "scheduled_for": ""}},
        {**base, "next_action": {"kind": "wait_vercel_verify", "scheduled_for": ""}},
        # scheduled_for set but kind empty — orphan timestamp, nothing for the
        # recovery loop to do
        {**base, "next_action": {"kind": "", "scheduled_for": "2026-05-23T10:30:00Z"}},
    ]
    for artifact in bad_cases:
        errors = list(validator.iter_errors(artifact))
        assert errors, (
            f"expected next_action pair-mismatch rejection but artifact validated: "
            f"next_action={artifact['next_action']!r}"
        )


def test_compliance_setup_output_schema_accepts_degraded_artifact():
    """Terminal-success-with-non-fatal-warning: stage=tcr_submitted but
    errors[] is non-empty (e.g. forward_email_setup_failed). data_quality.overall
    is `degraded`. Dropping `degraded` from the enum would silently break the
    one terminal path that surfaces non-fatal errors to downstream consumers."""
    manifest = _compliance_setup_manifest()
    artifact = {
        "stage": "tcr_submitted",
        "campaign_id": 12345,
        "run_id": "run-abc",
        "started_at": "2026-05-23T10:00:00Z",
        "ended_at": "2026-05-23T10:05:00Z",
        "domain": {"name": "votedoeNov2026.run", "registrar": "route53",
                   "purchased_at": "2026-05-23T10:01:00Z", "auto_renew": True, "price_usd": 10},
        "website": {"url": "https://votedoeNov2026.run", "vanity_path": "jane-doe",
                    "published_at": "2026-05-23T10:02:00Z", "verified_live_at": "2026-05-23T10:03:00Z"},
        "tcr_submission": {"peerly_request_id": "pr_abc123",
                           "submitted_at": "2026-05-23T10:04:00Z", "verified_url": ""},
        "completed_steps": ["compliance_state_read", "domain_search", "domain_purchase",
                            "publish_website", "verify_website_live", "submit_tcr"],
        "skipped_steps": [],
        "blockers_encountered": [],
        "errors": [
            {"code": "forward_email_setup_failed",
             "message": "forward-email alias setup failed (non-fatal)",
             "occurred_at": "2026-05-23T10:01:30Z",
             "tool": "domain_purchase"}
        ],
        "next_action": {"kind": "", "scheduled_for": ""},
        "metrics": {"num_turns": 18, "model_cost_usd": 0.34, "wall_time_seconds": 245},
        "data_quality": {"overall": "degraded"},
    }
    errors = list(Draft7Validator(manifest["output_schema"]).iter_errors(artifact))
    assert errors == [], f"degraded artifact rejected: {[e.message for e in errors]}"


