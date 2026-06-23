"""Semantic-invariant tests for the compliance_setup output_schema.

The agent's terminal happy stage `tcr_submitted` must be backed by an actual
Peerly submission. A prod run (campaign 325412) read stage=awaiting_pin on a
resume, wrote stage=tcr_submitted, and never called submit_to_peerly — leaving
no Peerly identity. The output_schema must reject that artifact so the agent's
in-workspace validate_output.py (and the runner's post-validation) force a real
submission.

Run: cd packages/runbooks/scripts/python && uv run pytest \
    test_compliance_setup_output_schema.py -v
"""
from __future__ import annotations

import json
from pathlib import Path

from jsonschema import Draft7Validator

EXPERIMENTS_DIR = Path(__file__).resolve().parents[2] / "experiments"
MANIFEST_PATH = EXPERIMENTS_DIR / "compliance_setup" / "manifest.json"


def _output_schema() -> dict:
    return json.loads(MANIFEST_PATH.read_text())["output_schema"]


def _base_artifact() -> dict:
    """A complete, schema-valid tcr_submitted artifact (submitted this run)."""
    return {
        "stage": "tcr_submitted",
        "campaign_id": 1,
        "run_id": "019ec6a5-9197-75dd-b423-30f92d26393c",
        "started_at": "2026-06-23T00:00:00Z",
        "ended_at": "2026-06-23T00:10:00Z",
        "domain": {
            "name": "vote-x.site",
            "registrar": "Route 53",
            "purchased_at": "2026-06-23T00:05:00Z",
            "auto_renew": False,
            "price_usd": 1.99,
        },
        "website": {
            "url": "https://vote-x.site",
            "vanity_path": "vote-x",
            "published_at": "2026-06-23T00:06:00Z",
            "verified_live_at": "2026-06-23T00:08:00Z",
        },
        "tcr_submission": {
            "peerly_request_id": "req-123",
            "submitted_at": "2026-06-23T00:09:00Z",
            "verified_url": "",
        },
        "completed_steps": ["submit_tcr"],
        "skipped_steps": [],
        "blockers_encountered": [],
        "errors": [],
        "next_action": {"kind": "", "scheduled_for": ""},
        "metrics": {"num_turns": 5, "model_cost_usd": 0.9, "wall_time_seconds": 360},
        "data_quality": {"overall": "ok"},
    }


def _errors(artifact: dict) -> list[str]:
    return [e.message for e in Draft7Validator(_output_schema()).iter_errors(artifact)]


def test_tcr_submitted_with_peerly_request_id_is_valid():
    assert _errors(_base_artifact()) == []


def test_tcr_submitted_via_skipped_submit_is_valid():
    """Recovery run that read tcr_in_review/tcr_approved short-circuits to
    tcr_submitted with submit_tcr skipped and an empty peerly_request_id (it
    did not submit this run). That is legitimate and must stay valid."""
    artifact = _base_artifact()
    artifact["tcr_submission"]["peerly_request_id"] = ""
    artifact["completed_steps"] = ["compliance_state_read"]
    artifact["skipped_steps"] = ["submit_tcr"]
    assert _errors(artifact) == []


def test_tcr_submitted_without_submission_is_rejected():
    """The 325412 bug: claims tcr_submitted but never submitted (empty
    peerly_request_id) and did not skip submit_tcr as already-done."""
    artifact = _base_artifact()
    artifact["tcr_submission"]["peerly_request_id"] = ""
    artifact["completed_steps"] = ["compliance_state_read"]
    artifact["skipped_steps"] = []
    assert _errors(artifact), "expected a validation error for tcr_submitted with no submission"


def _intermediate(stage: str) -> dict:
    """A non-terminal-stage artifact (data_quality=partial so it isn't
    rejected by the ok/degraded->tcr_submitted rule)."""
    artifact = _base_artifact()
    artifact["stage"] = stage
    artifact["completed_steps"] = ["compliance_state_read"]
    artifact["data_quality"] = {"overall": "partial"}
    return artifact


def test_domain_purchased_requires_domain_name():
    """A 'domain purchased' (or later) artifact with an empty domain.name is
    the same looks-done-but-isn't class as the tcr_submitted bug."""
    artifact = _intermediate("domain_purchased")
    artifact["domain"]["name"] = ""
    assert _errors(artifact), "expected an error: domain.name required at domain_purchased"


def test_website_stage_requires_website_url():
    artifact = _intermediate("pending_website_live")
    artifact["website"]["url"] = ""
    assert _errors(artifact), "expected an error: website.url required at pending_website_live"


def test_domain_purchased_without_website_url_is_valid():
    """website.url is only required from website_content_published onward, so
    an empty website.url at domain_purchased must still validate."""
    artifact = _intermediate("domain_purchased")
    artifact["website"]["url"] = ""
    assert _errors(artifact) == []
