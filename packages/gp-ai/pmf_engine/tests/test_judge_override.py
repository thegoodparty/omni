"""Judge override (Universal Judge v1, Runner 2) on the dispatch Lambda.

Two things are being protected here.

1. THE NO-OVERRIDE PATH IS UNCHANGED. This code cannot be deployed from a
   branch (`gp-ai.yml` gates deploy on `ref_name == 'main'`), so the first
   deploy after merge must be a behavioral no-op for every product dispatch.
   `TestNoOverrideIsUnchanged` asserts the three outbound payloads whole —
   the enqueued job, the mint body on the wire, and the ECS RunTask
   overrides — rather than spot-checking one field.

2. THE SECURITY INVARIANT. A judge run can change what the agent is told to
   do, never what it is allowed to touch. The scope ticket, ECS routing and
   input_schema always come from the PUBLISHED manifest; the override may set
   only allowlisted behavior fields.
"""

from __future__ import annotations

import copy
import json
from unittest.mock import MagicMock, patch

import httpx
import pytest

from pmf_engine.control_plane.broker_client import BrokerClient
from pmf_engine.control_plane.dispatch_handler import (
    _judge_override_behavior,
    build_container_overrides,
    handler,
    launch_run,
    parse_dispatch_message,
)
from pmf_engine.control_plane.job_store import JobStore, QueuedJob
from pmf_engine.control_plane.scope_derivation import derive_scope
from pmf_engine.tests.conftest import synthetic_manifest

EXPERIMENT_ID = "smoke_test"
DIGEST = "a1b2c3d4e5f6"
MANIFEST_KEY = f"_judge/{EXPERIMENT_ID}/{DIGEST}/manifest.json"
INSTRUCTION_KEY = f"_judge/{EXPERIMENT_ID}/{DIGEST}/instruction.md"

PUBLISHED_MANIFEST_VERSION_ID = "published-manifest-v1"
PUBLISHED_INSTRUCTION_VERSION_ID = "published-instruction-v1"
OVERRIDE_MANIFEST_VERSION_ID = "override-manifest-v9"
OVERRIDE_INSTRUCTION_VERSION_ID = "override-instruction-v9"

VALID_PARAMS = {"state": "WI"}

# The candidate's staged manifest. Exactly the four allowlisted behavior
# fields — which is also exactly the set `runner/config.py` reads, so the
# broker can serve this document verbatim.
OVERRIDE_MANIFEST: dict = {
    "model": "opus",
    "max_turns": 42,
    "timeout_seconds": 900,
    "output_schema": {"type": "object", "properties": {"headline": {"type": "string"}}},
}


def _published_routing() -> dict:
    """What `ManifestRoutingLoader.routing_for('smoke_test')` returns."""
    manifest = synthetic_manifest()
    return {
        "model": manifest["model"],
        "timeout_seconds": manifest["timeout_seconds"],
        "input_schema": manifest["input_schema"],
        "scope": manifest["scope"],
        "manifest_version_id": PUBLISHED_MANIFEST_VERSION_ID,
        "instruction_version_id": PUBLISHED_INSTRUCTION_VERSION_ID,
        "attachment_version_ids": {},
        "qa_version_ids": {},
    }


@pytest.fixture
def dispatch_env(monkeypatch):
    """Dispatch-handler module state with S3, Secrets Manager, DynamoDB and the
    manifest loader stubbed. Yields the stubs the tests assert against."""
    import pmf_engine.control_plane.dispatch_handler as dh

    monkeypatch.setattr(dh, "ECS_CLUSTER_ARN", "arn:aws:ecs:us-west-2:123:cluster/pmf", raising=False)
    monkeypatch.setattr(dh, "ECS_TASK_DEFINITION", "pmf-engine:1", raising=False)
    monkeypatch.setattr(dh, "ECS_SUBNET_IDS", ["subnet-aaa"], raising=False)
    monkeypatch.setattr(dh, "ECS_SECURITY_GROUP_ID", "sg-abc", raising=False)
    monkeypatch.setattr(dh, "RESULTS_QUEUE_URL", "https://sqs.example.com/callback.fifo", raising=False)
    monkeypatch.setattr(dh, "BROKER_URL", "https://broker.example.com", raising=False)
    monkeypatch.setattr(
        dh, "SERVICE_TOKENS_SECRET_ARN", "arn:aws:secretsmanager:us-west-2:123:secret:svc", raising=False
    )
    fake_secrets = MagicMock()
    fake_secrets.get_secret_value.return_value = {"SecretString": json.dumps({"SERVICE_TOKEN": "svc-token-xyz"})}
    monkeypatch.setattr(dh, "_get_secrets_client", lambda: fake_secrets)
    monkeypatch.setenv("EXPERIMENT_METADATA_BUCKET", "agent-experiment-metadata-dev")
    monkeypatch.setenv("ENVIRONMENT", "dev")
    monkeypatch.setattr(dh, "JOB_TABLE_NAME", "agent-job-queue-test", raising=False)

    loader = MagicMock()
    routing = _published_routing()
    loader.routing_for.side_effect = lambda eid: copy.deepcopy(routing) if eid == EXPERIMENT_ID else None
    loader.known_experiments.return_value = [EXPERIMENT_ID]
    loader.fetch_judge_override.return_value = (
        copy.deepcopy(OVERRIDE_MANIFEST),
        OVERRIDE_MANIFEST_VERSION_ID,
        OVERRIDE_INSTRUCTION_VERSION_ID,
    )
    monkeypatch.setattr(dh, "get_manifest_loader", lambda: loader)
    monkeypatch.setattr(dh, "_manifest_loader", loader, raising=False)

    store = MagicMock()
    monkeypatch.setattr(dh, "get_job_store", lambda: store)
    sqs = MagicMock()
    monkeypatch.setattr(dh, "get_sqs_client", lambda: sqs)
    monkeypatch.setattr(dh, "get_cw_client", lambda: MagicMock())
    dh.reset_validator_cache_for_tests()
    dh.reset_broker_client_for_tests()
    dh.reset_job_store_for_tests()
    dh.reset_service_token_for_tests()

    return {"loader": loader, "store": store, "sqs": sqs}


def _message(*, override: object = None, params: dict | None = None) -> dict:
    body: dict = {
        "experiment_type": EXPERIMENT_ID,
        "organization_slug": "org-123",
        "run_id": "run-judge-001",
        "clerk_user_id": "user_judge",
        "params": dict(VALID_PARAMS) if params is None else params,
    }
    if override is not None:
        body["_judge_override"] = override
    return body


def _sqs_event(body: dict) -> dict:
    return {"Records": [{"messageId": "msg-001", "body": json.dumps(body)}]}


def _enqueued_job(store: MagicMock):
    assert store.put_queued_job.call_count == 1
    return store.put_queued_job.call_args.args[0]


VALID_OVERRIDE = {"manifest_key": MANIFEST_KEY, "instruction_key": INSTRUCTION_KEY}


def _capturing_post(captured: dict):
    """Stand-in for `httpx.post` that records the JSON body it was handed."""

    def fake_post(url, **kwargs):
        captured["body"] = kwargs["json"]
        return httpx.Response(
            200,
            json={"broker_token": "tok", "exp": 1, "params_clean": {}},
            request=httpx.Request("POST", url),
        )

    return fake_post


def _container_env(ecs: MagicMock) -> dict:
    overrides = ecs.run_task.call_args.kwargs["overrides"]
    return {e["name"]: e["value"] for e in overrides["containerOverrides"][0]["environment"]}


# ---------------------------------------------------------------------------
# The test that matters most: no `_judge_override` means nothing changed.
# ---------------------------------------------------------------------------


class TestNoOverrideIsUnchanged:
    def test_parse_leaves_no_judge_key_on_the_message(self):
        parsed = parse_dispatch_message(json.dumps(_message()))

        assert "_judge_override" not in parsed

    def test_enqueued_routing_is_exactly_the_published_routing(self, dispatch_env):
        handler(_sqs_event(_message()), None)

        job = _enqueued_job(dispatch_env["store"])
        published = _published_routing()
        assert job.routing == {
            "model": published["model"],
            "timeout_seconds": published["timeout_seconds"],
            "manifest_version_id": PUBLISHED_MANIFEST_VERSION_ID,
            "instruction_version_id": PUBLISHED_INSTRUCTION_VERSION_ID,
            "attachment_version_ids": {},
            "scope": derive_scope(EXPERIMENT_ID, VALID_PARAMS, manifest_scope=published["scope"]),
        }
        assert "judge_override" not in job.routing

    def test_override_manifest_is_never_fetched(self, dispatch_env):
        handler(_sqs_event(_message()), None)

        dispatch_env["loader"].fetch_judge_override.assert_not_called()

    def test_mint_body_on_the_wire_omits_experiment_override(self):
        """Exact-equality on the posted JSON. A judge field leaking into a
        product mint body would fail here, not in review."""
        captured: dict = {}

        client = BrokerClient("https://broker.example.com", "svc-token")
        with patch("httpx.post", side_effect=_capturing_post(captured)):
            client.mint_run_token(
                run_id="run-1",
                organization_slug="org-1",
                experiment_id=EXPERIMENT_ID,
                scope={"state": "WI"},
                params=dict(VALID_PARAMS),
                clerk_user_id="user_1",
            )

        assert captured["body"] == {
            "run_id": "run-1",
            "organization_slug": "org-1",
            "experiment_id": EXPERIMENT_ID,
            "scope": {"state": "WI"},
            "params": VALID_PARAMS,
            "clerk_user_id": "user_1",
            "exp_ttl_seconds": 3600,
            "prior_artifact_versions": None,
            "input_files": None,
        }

    def test_mint_call_passes_none_and_container_env_is_the_published_pin(self, dispatch_env):
        """The scheduler's launch path with no override: mint is handed
        experiment_override=None and the runner is pinned to the published
        manifest + instruction VersionIds."""
        broker = MagicMock()
        broker.mint_run_token.return_value = {"broker_token": "tok-abc", "exp": 1, "params_clean": {}}
        ecs = MagicMock()
        ecs.run_task.return_value = {"tasks": [{"taskArn": "arn:task/1"}], "failures": []}

        routing = _published_routing()
        message = _message()
        message["params"] = dict(VALID_PARAMS)

        with (
            patch("pmf_engine.control_plane.dispatch_handler.get_broker_client", return_value=broker),
            patch("pmf_engine.control_plane.dispatch_handler.get_ecs_client", return_value=ecs),
        ):
            result = launch_run(
                experiment=routing,
                message=message,
                scope=routing["scope"],
                params_json=json.dumps(VALID_PARAMS),
            )

        assert result["status"] == "launched"
        assert broker.mint_run_token.call_args.kwargs["experiment_override"] is None
        env = _container_env(ecs)
        assert env["MANIFEST_VERSION_ID"] == PUBLISHED_MANIFEST_VERSION_ID
        assert env["INSTRUCTION_VERSION_ID"] == PUBLISHED_INSTRUCTION_VERSION_ID
        assert env["AGENT_MODEL"] == synthetic_manifest()["model"]

    def test_container_overrides_are_byte_identical_without_an_override(self):
        """The env builder takes no judge input at all: a routing dict that
        happens to carry a judge_override key must not change the env."""
        routing = _published_routing()
        plain = build_container_overrides(
            experiment=routing,
            message=_message(),
            broker_token="tok",
            broker_url="https://broker.example.com",
            container_name="pmf-engine",
            params_json=json.dumps(VALID_PARAMS),
        )
        with_key = build_container_overrides(
            experiment={**routing, "judge_override": VALID_OVERRIDE},
            message=_message(),
            broker_token="tok",
            broker_url="https://broker.example.com",
            container_name="pmf-engine",
            params_json=json.dumps(VALID_PARAMS),
        )

        assert plain == with_key


# ---------------------------------------------------------------------------
# Key shape: pinned segment by segment, never by prefix.
# ---------------------------------------------------------------------------


class TestOverrideKeyShape:
    def test_accepts_the_canonical_pair(self):
        parsed = parse_dispatch_message(json.dumps(_message(override=dict(VALID_OVERRIDE))))

        assert parsed["_judge_override"] == VALID_OVERRIDE

    @pytest.mark.parametrize(
        "manifest_key",
        [
            # Starts with `_judge/` and addresses something else entirely —
            # the exact hole a prefix-only check would leave open.
            f"_judge/../compliance_setup/{DIGEST}/manifest.json",
            "_judge/../compliance_setup/manifest.json",
            f"_judge/{EXPERIMENT_ID}/../compliance_setup/manifest.json",
            f"/_judge/{EXPERIMENT_ID}/{DIGEST}/manifest.json",
            f"s3://bucket/_judge/{EXPERIMENT_ID}/{DIGEST}/manifest.json",
            f"_judge//{DIGEST}/manifest.json",
            f"_judge/{EXPERIMENT_ID}//manifest.json",
            f"_judge/{EXPERIMENT_ID}/{DIGEST}/nested/manifest.json",
            f"_judge/{EXPERIMENT_ID}/{DIGEST}/manifest.json/",
            f"_judgex/{EXPERIMENT_ID}/{DIGEST}/manifest.json",
            f"{EXPERIMENT_ID}/manifest.json",
            f"_judge/{EXPERIMENT_ID}/{DIGEST}/instruction.md",
            f"_judge/{EXPERIMENT_ID}/{DIGEST}/manifest.JSON",
            f"_judge/{EXPERIMENT_ID}/{DIGEST}/manifest.json\n",
            "",
        ],
    )
    def test_rejects_non_canonical_manifest_key(self, manifest_key):
        override = {"manifest_key": manifest_key, "instruction_key": INSTRUCTION_KEY}

        with pytest.raises(ValueError, match="manifest_key"):
            parse_dispatch_message(json.dumps(_message(override=override)))

    @pytest.mark.parametrize(
        "instruction_key",
        [
            f"_judge/{EXPERIMENT_ID}/{DIGEST}/manifest.json",
            f"_judge/{EXPERIMENT_ID}/../{DIGEST}/instruction.md",
            f"_judge/{EXPERIMENT_ID}/{DIGEST}/instruction.md.bak",
            f"{EXPERIMENT_ID}/instruction.md",
        ],
    )
    def test_rejects_non_canonical_instruction_key(self, instruction_key):
        override = {"manifest_key": MANIFEST_KEY, "instruction_key": instruction_key}

        with pytest.raises(ValueError, match="instruction_key"):
            parse_dispatch_message(json.dumps(_message(override=override)))

    def test_rejects_key_for_another_agent(self):
        override = {
            "manifest_key": f"_judge/compliance_setup/{DIGEST}/manifest.json",
            "instruction_key": f"_judge/compliance_setup/{DIGEST}/instruction.md",
        }

        with pytest.raises(ValueError, match="does not match experiment_type"):
            parse_dispatch_message(json.dumps(_message(override=override)))

    def test_rejects_mismatched_digests(self):
        override = {
            "manifest_key": MANIFEST_KEY,
            "instruction_key": f"_judge/{EXPERIMENT_ID}/deadbeef/instruction.md",
        }

        with pytest.raises(ValueError, match="same"):
            parse_dispatch_message(json.dumps(_message(override=override)))

    @pytest.mark.parametrize("value", ["a string", 7, [MANIFEST_KEY], True])
    def test_rejects_non_object_override(self, value):
        with pytest.raises(ValueError, match="_judge_override must be an object"):
            parse_dispatch_message(json.dumps(_message(override=value)))

    def test_rejects_missing_instruction_key(self):
        with pytest.raises(ValueError, match="missing required keys"):
            parse_dispatch_message(json.dumps(_message(override={"manifest_key": MANIFEST_KEY})))

    def test_rejects_unknown_field(self):
        override = {**VALID_OVERRIDE, "scope": {"allowed_tables": ["a.b.c"]}}

        with pytest.raises(ValueError, match="unknown key"):
            parse_dispatch_message(json.dumps(_message(override=override)))

    def test_rejects_non_string_key(self):
        override = {"manifest_key": 12, "instruction_key": INSTRUCTION_KEY}

        with pytest.raises(ValueError, match="must be a string"):
            parse_dispatch_message(json.dumps(_message(override=override)))

    def test_judge_override_inside_params_is_rejected(self):
        """`params` already refuses unknown `_`-prefixed keys, so a caller who
        puts the override in the wrong place is told rather than ignored."""
        body = _message(params={**VALID_PARAMS, "_judge_override": VALID_OVERRIDE})

        with pytest.raises(ValueError, match="unknown _-prefixed key"):
            parse_dispatch_message(json.dumps(body))


# ---------------------------------------------------------------------------
# Behavior allowlist on the override manifest.
# ---------------------------------------------------------------------------


def _handle_with_override_manifest(dispatch_env, manifest: dict):
    dispatch_env["loader"].fetch_judge_override.return_value = (
        manifest,
        OVERRIDE_MANIFEST_VERSION_ID,
        OVERRIDE_INSTRUCTION_VERSION_ID,
    )
    return handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)


class TestOverrideManifestAllowlist:
    def test_accepts_the_four_behavior_fields(self, dispatch_env):
        result = _handle_with_override_manifest(dispatch_env, copy.deepcopy(OVERRIDE_MANIFEST))

        assert result == {"batchItemFailures": []}
        assert dispatch_env["store"].put_queued_job.call_count == 1

    def test_timeout_seconds_is_optional(self, dispatch_env):
        manifest = {k: v for k, v in OVERRIDE_MANIFEST.items() if k != "timeout_seconds"}

        _handle_with_override_manifest(dispatch_env, manifest)

        job = _enqueued_job(dispatch_env["store"])
        assert job.routing["timeout_seconds"] == synthetic_manifest()["timeout_seconds"]

    @pytest.mark.parametrize(
        "extra",
        [
            {"scope": {"allowed_tables": ["goodparty_data_catalog.dbt.people"], "max_rows": 1000000}},
            {"scope": {}},
            {"input_schema": {"type": "object"}},
            {"system_prompt": "you are helpful"},
            {"permission_mode": "bypassPermissions"},
            {"allowed_external_tools": ["WebFetch"]},
            {"runtime": {"max_parallel_subagents": 8}},
            {"id": "compliance_setup"},
            {"version": 3},
            {"output_constraints": {}},
            {"$schema": "../_schema/manifest.schema.json"},
            {"Model": "opus"},
        ],
    )
    def test_rejects_any_non_behavior_field(self, dispatch_env, extra):
        """Rejected loudly rather than ignored: the job is never enqueued and
        the message goes to the DLQ."""
        result = _handle_with_override_manifest(dispatch_env, {**copy.deepcopy(OVERRIDE_MANIFEST), **extra})

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["store"].put_queued_job.assert_not_called()

    def test_scope_rejection_names_the_invariant(self):
        """A `scope` key fails with the invariant it broke, not as a typo."""
        manifest = {**copy.deepcopy(OVERRIDE_MANIFEST), "scope": {"allowed_tables": ["a.b.c"]}}

        with pytest.raises(ValueError, match="never what it is allowed to touch"):
            _judge_override_behavior(manifest, MANIFEST_KEY)

    @pytest.mark.parametrize("missing", ["model", "max_turns", "output_schema"])
    def test_rejects_missing_runner_required_field(self, dispatch_env, missing):
        manifest = {k: v for k, v in OVERRIDE_MANIFEST.items() if k != missing}

        result = _handle_with_override_manifest(dispatch_env, manifest)

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["store"].put_queued_job.assert_not_called()

    @pytest.mark.parametrize(
        "field,value",
        [
            ("model", ""),
            ("model", "opus sonnet"),
            ("model", "opus\nAGENT_MODEL=haiku"),
            ("model", "../../etc/passwd"),
            ("model", 7),
            ("max_turns", 0),
            ("max_turns", 201),
            ("max_turns", True),
            ("max_turns", "50"),
            ("max_turns", 1.5),
            ("timeout_seconds", 59),
            ("timeout_seconds", 14401),
            ("timeout_seconds", None),
            ("output_schema", {}),
            ("output_schema", "object"),
            ("output_schema", None),
        ],
    )
    def test_rejects_malformed_behavior_value(self, dispatch_env, field, value):
        result = _handle_with_override_manifest(dispatch_env, {**copy.deepcopy(OVERRIDE_MANIFEST), field: value})

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["store"].put_queued_job.assert_not_called()


# ---------------------------------------------------------------------------
# The security invariant, end to end through the handler.
# ---------------------------------------------------------------------------


class TestOverrideCannotWidenScope:
    def test_scope_comes_from_the_published_manifest(self, dispatch_env):
        handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)

        job = _enqueued_job(dispatch_env["store"])
        published_scope = synthetic_manifest()["scope"]
        assert job.routing["scope"]["allowed_tables"] == published_scope["allowed_tables"]
        assert job.routing["scope"]["max_rows"] == published_scope["max_rows"]

    def test_params_are_validated_against_the_published_input_schema(self, dispatch_env):
        """The override cannot loosen its own input validation: it may not
        carry an input_schema at all, and params still fail the published one."""
        result = handler(
            _sqs_event(_message(override=dict(VALID_OVERRIDE), params={"state": "not-a-state-code"})),
            None,
        )

        assert result == {"batchItemFailures": []}  # client fault, notified via callback
        dispatch_env["store"].put_queued_job.assert_not_called()
        dispatch_env["loader"].fetch_judge_override.assert_not_called()

    @pytest.mark.parametrize("environment", ["prod", "PROD", "production", "qa", "test"])
    def test_refused_outside_dev(self, dispatch_env, monkeypatch, environment):
        """An allowlist, not a deny-prod check: an unexpected ENVIRONMENT value
        refuses rather than slipping through."""
        monkeypatch.setenv("ENVIRONMENT", environment)

        result = handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["loader"].fetch_judge_override.assert_not_called()
        dispatch_env["store"].put_queued_job.assert_not_called()

    def test_refused_for_a_write_action_experiment(self, dispatch_env):
        routing = {**_published_routing(), "system_prompt": "you write ordinances", "scope": {}}
        dispatch_env["loader"].routing_for.side_effect = lambda eid: copy.deepcopy(routing)

        result = handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["loader"].fetch_judge_override.assert_not_called()

    def test_rejection_sends_no_gp_api_callback(self, dispatch_env, monkeypatch):
        """A judge dispatch has no experiment_run row, so a callback would only
        log 'Experiment run not found' once per rejected run."""
        monkeypatch.setenv("ENVIRONMENT", "prod")

        handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)

        dispatch_env["sqs"].send_message.assert_not_called()


class TestOverrideBehaviorReachesTheRun:
    def test_routing_carries_the_override_behavior_and_pins(self, dispatch_env):
        handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)

        job = _enqueued_job(dispatch_env["store"])
        assert job.routing["model"] == OVERRIDE_MANIFEST["model"]
        assert job.routing["timeout_seconds"] == OVERRIDE_MANIFEST["timeout_seconds"]
        # The pins move to the override objects because those are the bytes the
        # broker will serve; the published VersionIds would not exist on them.
        assert job.routing["manifest_version_id"] == OVERRIDE_MANIFEST_VERSION_ID
        assert job.routing["instruction_version_id"] == OVERRIDE_INSTRUCTION_VERSION_ID
        assert job.routing["judge_override"] == {
            "manifest_key": MANIFEST_KEY,
            "instruction_key": INSTRUCTION_KEY,
            "manifest_version_id": OVERRIDE_MANIFEST_VERSION_ID,
            "instruction_version_id": OVERRIDE_INSTRUCTION_VERSION_ID,
        }

    def test_fetch_is_version_pinned_by_the_keys_it_was_given(self, dispatch_env):
        handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)

        dispatch_env["loader"].fetch_judge_override.assert_called_once_with(
            manifest_key=MANIFEST_KEY,
            instruction_key=INSTRUCTION_KEY,
        )

    def test_mint_receives_the_override_allowlist(self, dispatch_env):
        handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)
        routing = _enqueued_job(dispatch_env["store"]).routing

        broker = MagicMock()
        broker.mint_run_token.return_value = {"broker_token": "tok", "exp": 1, "params_clean": {}}
        ecs = MagicMock()
        ecs.run_task.return_value = {"tasks": [{"taskArn": "arn:task/1"}], "failures": []}
        with (
            patch("pmf_engine.control_plane.dispatch_handler.get_broker_client", return_value=broker),
            patch("pmf_engine.control_plane.dispatch_handler.get_ecs_client", return_value=ecs),
        ):
            launch_run(
                experiment=routing,
                message=_message(override=dict(VALID_OVERRIDE)),
                scope=routing["scope"],
                params_json=json.dumps(VALID_PARAMS),
            )

        assert broker.mint_run_token.call_args.kwargs["experiment_override"] == routing["judge_override"]
        env = _container_env(ecs)
        assert env["AGENT_MODEL"] == OVERRIDE_MANIFEST["model"]
        assert env["MANIFEST_VERSION_ID"] == OVERRIDE_MANIFEST_VERSION_ID
        assert env["INSTRUCTION_VERSION_ID"] == OVERRIDE_INSTRUCTION_VERSION_ID
        # The real experiment id stays real — the artifact and the ticket are
        # still the published experiment's.
        assert env["EXPERIMENT_ID"] == EXPERIMENT_ID

    def test_mint_body_carries_the_override_on_the_wire(self):
        captured: dict = {}

        client = BrokerClient("https://broker.example.com", "svc-token")
        with patch("httpx.post", side_effect=_capturing_post(captured)):
            client.mint_run_token(
                run_id="run-1",
                organization_slug="org-1",
                experiment_id=EXPERIMENT_ID,
                scope={},
                params={},
                clerk_user_id=None,
                experiment_override=dict(VALID_OVERRIDE),
            )

        assert captured["body"]["experiment_override"] == VALID_OVERRIDE


class TestOverrideFetchFailures:
    def test_transient_s3_error_retries_without_a_callback(self, dispatch_env):
        from pmf_engine.control_plane.manifest_loader import ManifestLoaderTransientError

        dispatch_env["loader"].fetch_judge_override.side_effect = ManifestLoaderTransientError("SlowDown")

        result = handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["sqs"].send_message.assert_not_called()
        dispatch_env["store"].put_queued_job.assert_not_called()

    def test_missing_override_object_is_not_retried_forever(self, dispatch_env):
        from pmf_engine.control_plane.manifest_loader import ManifestLoaderMalformedError

        dispatch_env["loader"].fetch_judge_override.side_effect = ManifestLoaderMalformedError("NoSuchKey")

        result = handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["store"].put_queued_job.assert_not_called()


class TestOverrideSurvivesTheQueue:
    """The override rides `routing`, so the DynamoDB round trip and the
    scheduler's launch path need no change. This test is what makes that claim
    honest rather than assumed."""

    def _queued_job(self, routing: dict) -> QueuedJob:
        return QueuedJob(
            run_id="run-judge-001",
            experiment_type=EXPERIMENT_ID,
            organization_slug="org-123",
            clerk_user_id="user_judge",
            priority="DEFAULT",
            params=dict(VALID_PARAMS),
            routing=routing,
            prior_artifact_versions=None,
            created_at_ms=1000,
        )

    def test_dynamodb_round_trip_preserves_the_allowlist(self, dispatch_env):
        handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)
        routing = _enqueued_job(dispatch_env["store"]).routing

        ddb = MagicMock()
        store = JobStore("agent-job-queue-test", dynamodb_client=ddb)
        store.put_queued_job(self._queued_job(routing))
        item = ddb.put_item.call_args.kwargs["Item"]
        item["attempts"] = {"N": "0"}
        revived = store._to_job(item)

        assert revived.routing["judge_override"] == routing["judge_override"]

    def test_scheduler_threads_the_allowlist_into_mint(self, dispatch_env):
        import pmf_engine.control_plane.scheduler_handler as sched

        handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)
        routing = _enqueued_job(dispatch_env["store"]).routing

        broker = MagicMock()
        broker.mint_run_token.return_value = {"broker_token": "tok", "exp": 1, "params_clean": {}}
        ecs = MagicMock()
        ecs.run_task.return_value = {"tasks": [{"taskArn": "arn:task/1"}], "failures": []}
        sched_store = MagicMock()
        with (
            patch("pmf_engine.control_plane.dispatch_handler.get_broker_client", return_value=broker),
            patch("pmf_engine.control_plane.dispatch_handler.get_ecs_client", return_value=ecs),
            patch.object(sched, "_send_callback", return_value=True),
        ):
            assert sched._launch_one(sched_store, self._queued_job(routing)) is True

        assert broker.mint_run_token.call_args.kwargs["experiment_override"] == routing["judge_override"]
        assert _container_env(ecs)["MANIFEST_VERSION_ID"] == OVERRIDE_MANIFEST_VERSION_ID
