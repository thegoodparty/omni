"""Judge override (Universal Judge v1, Runner 2) on the dispatch Lambda.

Two things are being protected here.

1. THE NO-OVERRIDE PATH IS UNCHANGED. This code cannot be deployed from a
   branch (`gp-ai.yml` gates deploy on `ref_name == 'main'`), so the first
   deploy after merge must be a behavioral no-op for every product dispatch.
   `TestNoOverrideIsUnchanged` asserts the two outbound payloads a product
   dispatch actually produces whole, rather than spot-checking one field:
   the enqueued job's routing dict, and the mint body as posted on the wire.
   The ECS container env is covered only to the extent of its judge-relevant
   values (the published version pins and AGENT_MODEL) — `build_container_overrides`
   was not changed and reads no judge input, so no test here can prove the
   whole env byte-identical; that would need a golden fixture the rest of the
   suite does not keep.

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
from pmf_engine.control_plane.manifest_loader import JUDGE_RUN_ID_MAX_LENGTH, JUDGE_RUN_ID_PREFIX
from pmf_engine.control_plane.scope_derivation import derive_scope
from pmf_engine.tests.conftest import synthetic_manifest

EXPERIMENT_ID = "smoke_test"
DIGEST = "a1b2c3d4e5f6"
# A judge sweep's run ids carry JUDGE_RUN_ID_PREFIX, and dispatch refuses an
# override on any run id that does not: everything downstream that has to tell
# a judge dispatch from a product one keys on that prefix. Kept short because
# ECS caps `startedBy` (= the run id) at 36 characters.
JUDGE_RUN_ID = f"{JUDGE_RUN_ID_PREFIX}run-001"
# What gp-api mints for a product run: a UUIDv7, which can never collide with
# the judge prefix.
PRODUCT_RUN_ID = "0199b4c0-7b1e-7000-8000-0123456789ab"
MANIFEST_KEY = f"_judge/{EXPERIMENT_ID}/{DIGEST}/manifest.json"
INSTRUCTION_KEY = f"_judge/{EXPERIMENT_ID}/{DIGEST}/instruction.md"

PUBLISHED_MANIFEST_VERSION_ID = "published-manifest-v1"
PUBLISHED_INSTRUCTION_VERSION_ID = "published-instruction-v1"
OVERRIDE_MANIFEST_VERSION_ID = "override-manifest-v9"
OVERRIDE_INSTRUCTION_VERSION_ID = "override-instruction-v9"

VALID_PARAMS = {"state": "WI"}

# The candidate's staged manifest. Exactly the allowlisted behavior fields —
# which is also exactly the set `runner/config.py` reads, so the broker can
# serve this document verbatim. `runtime` is present because a real staged
# manifest will have it: 11 of the 16 published experiments declare one.
OVERRIDE_MANIFEST: dict = {
    "model": "opus",
    "max_turns": 42,
    "timeout_seconds": 900,
    "output_schema": {"type": "object", "properties": {"headline": {"type": "string"}}},
    "runtime": {"max_thinking_tokens": 0, "max_parallel_subagents": 3},
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


@pytest.fixture(autouse=True)
def dev_environment(monkeypatch):
    """A judge dispatch is refused outside `dev`, and that check lives in
    `parse_dispatch_message` — so even the tests that call it directly need the
    environment the Lambda has in dev. The tests that assert the refusal set
    ENVIRONMENT themselves, after this."""
    monkeypatch.setenv("ENVIRONMENT", "dev")


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


def _message(*, override: object = None, params: dict | None = None, run_id: str | None = None) -> dict:
    """A dispatch message. With no override this is a PRODUCT dispatch, run id
    included — the no-override assertions are only meaningful against one."""
    body: dict = {
        "experiment_type": EXPERIMENT_ID,
        "organization_slug": "org-123",
        "run_id": run_id or (JUDGE_RUN_ID if override is not None else PRODUCT_RUN_ID),
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

    def test_a_judge_override_key_on_routing_does_not_reach_the_container_env(self):
        """A forward regression guard, not a proof: `build_container_overrides`
        reads no judge input today, so this passes trivially. Its job is to
        fail the day someone teaches the env builder about `judge_override` —
        the allowlist belongs on the scope ticket, and an ECS env var carrying
        it would be an authorization the broker never validated."""
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
        """The whole dict, not two fields of it. `derive_scope` is the single
        source of the run's Databricks authorization, and a spot-check would
        pass while an override had quietly added or widened some other key."""
        handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)

        job = _enqueued_job(dispatch_env["store"])
        assert job.routing["scope"] == derive_scope(
            EXPERIMENT_ID,
            VALID_PARAMS,
            manifest_scope=synthetic_manifest()["scope"],
        )

    def test_params_are_validated_against_the_published_input_schema(self, dispatch_env):
        """The override cannot loosen its own input validation: it may not
        carry an input_schema at all, and params still fail the published one.

        On a PRODUCT dispatch this is a client fault notified via callback. On a
        judge dispatch the callback is suppressed — there is no gp-api row — so
        the message goes to the DLQ instead, which is where a broken sweep
        belongs."""
        result = handler(
            _sqs_event(_message(override=dict(VALID_OVERRIDE), params={"state": "not-a-state-code"})),
            None,
        )

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["sqs"].send_message.assert_not_called()
        dispatch_env["store"].put_queued_job.assert_not_called()
        dispatch_env["loader"].fetch_judge_override.assert_not_called()

    def test_the_same_violation_on_a_product_dispatch_still_calls_back(self, dispatch_env):
        """The other half of the pair: suppression must not have leaked onto
        the product path."""
        result = handler(
            _sqs_event(_message(params={"state": "not-a-state-code"})),
            None,
        )

        assert result == {"batchItemFailures": []}
        assert dispatch_env["sqs"].send_message.call_count == 1
        body = json.loads(dispatch_env["sqs"].send_message.call_args.kwargs["MessageBody"])
        assert body["data"]["runId"] == PRODUCT_RUN_ID

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
        dispatch_env["store"].put_queued_job.assert_not_called()

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
            run_id=JUDGE_RUN_ID,
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


class TestOverrideRequiresAJudgeRunId:
    """An override may only ride a judge run id.

    Everything downstream that must tell a judge dispatch from a product one
    keys on that prefix: whether the mint marks the ticket `is_eval`, whether a
    content-level rejection sends a results callback, and whether the task
    reaper reconciles a dead task. Without this gate, a dispatch carrying
    `_judge_override` that failed content validation would leave a real gp-api
    row QUEUED until the 6h backstop, because that rejection sends no callback.
    """

    def test_rejects_an_override_on_a_product_run_id(self):
        with pytest.raises(ValueError, match="judge run_id must match"):
            parse_dispatch_message(json.dumps(_message(override=dict(VALID_OVERRIDE), run_id=PRODUCT_RUN_ID)))

    def test_a_product_run_id_carrying_an_override_gets_a_callback(self, dispatch_env):
        """Consistent with the sibling shape-level rejection path: it is a
        malformed dispatch, and the run row it names is real, so gp-api is
        told rather than left waiting."""
        event = _sqs_event(_message(override=dict(VALID_OVERRIDE), run_id=PRODUCT_RUN_ID))

        result = handler(event, None)

        assert result == {"batchItemFailures": []}
        assert dispatch_env["sqs"].send_message.call_count == 1
        body = json.loads(dispatch_env["sqs"].send_message.call_args.kwargs["MessageBody"])
        assert body["data"]["runId"] == PRODUCT_RUN_ID
        assert body["data"]["status"] == "failed"
        dispatch_env["store"].put_queued_job.assert_not_called()

    def test_a_judge_rejection_still_sends_no_callback(self, dispatch_env, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "prod")

        result = handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["sqs"].send_message.assert_not_called()


class TestEvalRunsSuppressTheCallback:
    """`is_eval` is what tells the broker never to post a results callback for
    this run. It rides the mint body, derived from the run id prefix — so it
    covers a sweep's base arm, which runs the published bytes with no override
    at all and whose callback also has nowhere to land."""

    def _mint_kwargs(self, *, routing: dict, message: dict) -> dict:
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
                message=message,
                scope=routing.get("scope", {}),
                params_json=json.dumps(VALID_PARAMS),
            )
        return broker.mint_run_token.call_args.kwargs

    def test_a_product_run_mints_is_eval_false(self, dispatch_env):
        kwargs = self._mint_kwargs(routing=_published_routing(), message=_message())

        assert kwargs["is_eval"] is False

    def test_an_override_arm_mints_is_eval_true(self, dispatch_env):
        handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)
        routing = _enqueued_job(dispatch_env["store"]).routing

        kwargs = self._mint_kwargs(routing=routing, message=_message(override=dict(VALID_OVERRIDE)))

        assert kwargs["is_eval"] is True

    def test_a_base_arm_with_no_override_still_mints_is_eval_true(self, dispatch_env):
        """The base arm is why `is_eval` is not simply derived from the
        presence of an override."""
        kwargs = self._mint_kwargs(
            routing=_published_routing(),
            message=_message(run_id=JUDGE_RUN_ID),
        )

        assert kwargs["is_eval"] is True
        assert kwargs["experiment_override"] is None

    def test_the_product_mint_body_omits_is_eval_entirely(self):
        captured: dict = {}

        client = BrokerClient("https://broker.example.com", "svc-token")
        with patch("httpx.post", side_effect=_capturing_post(captured)):
            client.mint_run_token(
                run_id=PRODUCT_RUN_ID,
                organization_slug="org-1",
                experiment_id=EXPERIMENT_ID,
                scope={},
                params={},
                clerk_user_id=None,
                is_eval=False,
            )

        assert "is_eval" not in captured["body"]

    def test_an_eval_mint_body_carries_is_eval(self):
        captured: dict = {}

        client = BrokerClient("https://broker.example.com", "svc-token")
        with patch("httpx.post", side_effect=_capturing_post(captured)):
            client.mint_run_token(
                run_id=JUDGE_RUN_ID,
                organization_slug="org-1",
                experiment_id=EXPERIMENT_ID,
                scope={},
                params={},
                clerk_user_id=None,
                is_eval=True,
            )

        assert captured["body"]["is_eval"] is True


class TestOverrideMustBeVersionPinned:
    """The pin is enforcement, not race protection alone.

    Dispatch vets the override manifest's contents and the broker reads the
    same object minutes later. Unpinned, anyone who can write the key can swap
    the bytes in between, and the behavior allowlist will have vetted something
    the agent never runs. S3 returns no VersionId on an unversioned OR a
    version-SUSPENDED bucket, and `aws_s3_bucket_versioning` accepts
    `Suspended`, so this is one Terraform edit away rather than hypothetical.
    """

    @pytest.mark.parametrize(
        "manifest_vid,instruction_vid",
        [
            (None, OVERRIDE_INSTRUCTION_VERSION_ID),
            (OVERRIDE_MANIFEST_VERSION_ID, None),
            (None, None),
            ("", OVERRIDE_INSTRUCTION_VERSION_ID),
        ],
    )
    def test_an_unpinned_override_is_refused_through_the_handler(self, dispatch_env, manifest_vid, instruction_vid):
        dispatch_env["loader"].fetch_judge_override.return_value = (
            copy.deepcopy(OVERRIDE_MANIFEST),
            manifest_vid,
            instruction_vid,
        )

        result = handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["store"].put_queued_job.assert_not_called()
        dispatch_env["sqs"].send_message.assert_not_called()


class TestOutputSchemaMatchesTheRunnersCheck:
    """`output_schema` is checked here to fail fast, so it has to be the same
    check the runner makes (`runner/config._is_draft7_object_schema`). A
    weaker one does not just miss a Fargate-start crash: the legacy no-op
    `{"name": "string"}` shape is one Draft7Validator accepts every artifact
    against, so the candidate arm would run with no artifact contract and the
    judge would score garbage as valid."""

    @pytest.mark.parametrize(
        "output_schema",
        [
            # Passes a "non-empty dict" check and crashes at Fargate start.
            {"type": "object"},
            {"type": "object", "properties": []},
            {"oneOf": []},
            {"oneOf": [{}]},
            {"anyOf": [{"type": "object", "properties": {"a": {}}}, {}]},
            # The legacy GP example-dict shape: no constraints at all.
            {"name": "string"},
            {"type": "string"},
        ],
    )
    def test_rejects_a_schema_the_runner_would_reject(self, dispatch_env, output_schema):
        result = _handle_with_override_manifest(
            dispatch_env, {**copy.deepcopy(OVERRIDE_MANIFEST), "output_schema": output_schema}
        )

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["store"].put_queued_job.assert_not_called()

    @pytest.mark.parametrize(
        "output_schema",
        [
            {"type": "object", "properties": {"headline": {"type": "string"}}},
            {"oneOf": [{"type": "object", "properties": {"a": {}}}, {"type": "object", "properties": {"b": {}}}]},
            {"allOf": [{"type": "object", "properties": {"a": {}}}]},
        ],
    )
    def test_accepts_a_schema_the_runner_would_accept(self, dispatch_env, output_schema):
        result = _handle_with_override_manifest(
            dispatch_env, {**copy.deepcopy(OVERRIDE_MANIFEST), "output_schema": output_schema}
        )

        assert result == {"batchItemFailures": []}
        assert dispatch_env["store"].put_queued_job.call_count == 1

    def test_the_mirrored_check_agrees_with_the_runners(self):
        """The two copies exist because the runner ships in the Fargate image
        and dispatch ships in the Lambda zip — there is no import path between
        them. This test is the only thing keeping them honest."""
        from pmf_engine.control_plane.dispatch_handler import _is_draft7_object_schema as dispatch_check
        from pmf_engine.runner.config import _is_draft7_object_schema as runner_check

        cases = [
            {"type": "object", "properties": {}},
            {"type": "object"},
            {"oneOf": []},
            {"oneOf": [{}]},
            {"oneOf": [{"type": "object", "properties": {}}]},
            {"name": "string"},
            {},
            "object",
            None,
            [],
        ]
        assert [dispatch_check(c) for c in cases] == [runner_check(c) for c in cases]


class TestErrorMessagesAreBounded:
    """These messages ride the error callback into gp-api's results queue and
    get persisted, and the values they quote come off an S3 object nothing
    upstream bounds."""

    def test_a_huge_model_value_is_truncated_in_the_rejection(self):
        huge = "x" * 5000
        manifest = {**copy.deepcopy(OVERRIDE_MANIFEST), "model": huge}

        with pytest.raises(ValueError) as excinfo:
            _judge_override_behavior(manifest, MANIFEST_KEY)

        assert huge not in str(excinfo.value)
        assert len(str(excinfo.value)) < 600

    def test_a_huge_unknown_key_reaches_the_callback_truncated(self, dispatch_env):
        """This one goes through the handler, because the shape-level rejection
        path is the one that actually posts the message to gp-api's results
        queue — where it lands in a DB error column."""
        huge = "z" * 5000
        override = {**VALID_OVERRIDE, huge: "x"}

        handler(_sqs_event(_message(override=override, run_id=PRODUCT_RUN_ID)), None)

        assert dispatch_env["sqs"].send_message.call_count == 1
        body = json.loads(dispatch_env["sqs"].send_message.call_args.kwargs["MessageBody"])
        assert huge not in body["data"]["error"]
        assert len(body["data"]["error"]) < 900

    def test_a_huge_max_turns_value_is_truncated_in_the_rejection(self):
        huge = "9" * 5000
        manifest = {**copy.deepcopy(OVERRIDE_MANIFEST), "max_turns": huge}

        with pytest.raises(ValueError) as excinfo:
            _judge_override_behavior(manifest, MANIFEST_KEY)

        assert huge not in str(excinfo.value)
        assert len(str(excinfo.value)) < 600


class TestSchedulerSendsNoCallbackForAJudgeRun:
    """The scheduler is the third results-queue sender, after the broker's
    publish/run-status paths and the task reaper. A judge run has no gp-api
    row, so its `started` and launch-`failed` callbacks have nowhere to land
    either — and suppression has to report success, because the return value
    drives `mark_dispatched` / `mark_failed` and there is no row to orphan."""

    def test_a_judge_run_id_suppresses_the_send_and_still_reports_sent(self, monkeypatch):
        import pmf_engine.control_plane.scheduler_handler as sched

        sqs = MagicMock()
        monkeypatch.setattr(sched, "RESULTS_QUEUE_URL", "https://sqs.example.com/callback.fifo", raising=False)
        monkeypatch.setattr(sched, "get_sqs_client", lambda: sqs)

        assert sched._send_callback(JUDGE_RUN_ID, "started") is True
        assert sched._send_callback(JUDGE_RUN_ID, "failed", error="boom") is True
        sqs.send_message.assert_not_called()

    def test_a_product_run_id_still_sends(self, monkeypatch):
        import pmf_engine.control_plane.scheduler_handler as sched

        sqs = MagicMock()
        monkeypatch.setattr(sched, "RESULTS_QUEUE_URL", "https://sqs.example.com/callback.fifo", raising=False)
        monkeypatch.setattr(sched, "get_sqs_client", lambda: sqs)

        assert sched._send_callback(PRODUCT_RUN_ID, "started") is True

        assert sqs.send_message.call_count == 1
        body = json.loads(sqs.send_message.call_args.kwargs["MessageBody"])
        assert body["data"]["runId"] == PRODUCT_RUN_ID
        assert body["data"]["status"] == "started"


class TestRuntimeBlockSurvivesTheOverride:
    """`runtime` has to ride the override, not be refused by it.

    The broker serves the override manifest IN PLACE OF the published one, and
    11 of the 16 published experiments declare a `runtime` block — every one of
    them setting `max_thinking_tokens: 0`, several also setting
    `max_parallel_subagents` to 3..6. Dropped, every candidate arm would
    silently switch extended thinking ON and fan-out OFF, and the sweep would
    score that config delta instead of the branch. That is the same failure
    mode the write-action refusal exists to prevent, so it cannot be left to
    the base/candidate diff to reveal.
    """

    def test_the_runtime_block_is_accepted(self, dispatch_env):
        result = _handle_with_override_manifest(dispatch_env, copy.deepcopy(OVERRIDE_MANIFEST))

        assert result == {"batchItemFailures": []}
        assert dispatch_env["store"].put_queued_job.call_count == 1

    def test_a_zero_thinking_budget_is_not_mistaken_for_absent(self, dispatch_env):
        """`max_thinking_tokens: 0` means thinking OFF and `None` means the CLI
        default (thinking ON), so a falsy-check anywhere in the path would
        invert the setting on every candidate arm."""
        manifest = {**copy.deepcopy(OVERRIDE_MANIFEST), "runtime": {"max_thinking_tokens": 0}}

        result = _handle_with_override_manifest(dispatch_env, manifest)

        assert result == {"batchItemFailures": []}
        assert _judge_override_behavior(manifest, MANIFEST_KEY)["runtime"] == {"max_thinking_tokens": 0}

    def test_an_absent_runtime_block_is_still_allowed(self, dispatch_env):
        """Five published experiments declare none. Passed through rather than
        defaulted: dispatch cannot see the published block (`_project_routing`
        validates it but does not project it), so inventing one here would be a
        guess."""
        manifest = {k: v for k, v in copy.deepcopy(OVERRIDE_MANIFEST).items() if k != "runtime"}

        result = _handle_with_override_manifest(dispatch_env, manifest)

        assert result == {"batchItemFailures": []}
        assert "runtime" not in _judge_override_behavior(manifest, MANIFEST_KEY)

    @pytest.mark.parametrize(
        "runtime",
        [
            "not an object",
            [],
            {"max_thinking_tokens": -1},
            {"max_thinking_tokens": True},
            {"max_thinking_tokens": "0"},
            {"max_parallel_subagents": -1},
            {"max_parallel_subagents": 21},
            {"max_parallel_subagents": 1.5},
            # `additionalProperties: false` in the published meta-schema.
            {"max_thinking_tokens": 0, "harness": "custom"},
            {"maxThinkingTokens": 0},
        ],
    )
    def test_rejects_a_runtime_block_a_published_manifest_could_not_carry(self, dispatch_env, runtime):
        result = _handle_with_override_manifest(dispatch_env, {**copy.deepcopy(OVERRIDE_MANIFEST), "runtime": runtime})

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["store"].put_queued_job.assert_not_called()

    def test_refused_for_an_experiment_that_declares_allowed_external_tools(self, dispatch_env):
        """The one write-action field that is NOT a write-action discriminator,
        so the refusal above would miss it. It widens which non-gp-api tools
        the agent may reach, so it can never ride an override — which means an
        experiment declaring it would silently lose it."""
        routing = {**_published_routing(), "allowed_external_tools": ["WebFetch"]}
        dispatch_env["loader"].routing_for.side_effect = lambda eid: copy.deepcopy(routing)

        result = handler(_sqs_event(_message(override=dict(VALID_OVERRIDE))), None)

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["loader"].fetch_judge_override.assert_not_called()
        dispatch_env["store"].put_queued_job.assert_not_called()


class TestJudgeRunIdFitsWhatEcsAccepts:
    """ECS caps `startedBy` at 36 characters, dispatch sets it to the run id
    verbatim, and the task reaper reads it back. A longer judge run id mints a
    ticket and claims the job to LAUNCHING before RunTask rejects it on
    validation — so every job in the sweep sticks. Enforced where the run id is
    first seen rather than discovered at launch."""

    def test_a_run_id_at_the_cap_is_accepted(self):
        run_id = JUDGE_RUN_ID_PREFIX + "a" * (JUDGE_RUN_ID_MAX_LENGTH - len(JUDGE_RUN_ID_PREFIX))
        assert len(run_id) == JUDGE_RUN_ID_MAX_LENGTH

        parsed = parse_dispatch_message(json.dumps(_message(override=dict(VALID_OVERRIDE), run_id=run_id)))

        assert parsed["run_id"] == run_id

    def test_a_run_id_one_character_over_the_cap_is_refused(self):
        """`_judge-` + a bare uuid4 (43 chars) is the shape that would do this."""
        run_id = JUDGE_RUN_ID_PREFIX + "a" * (JUDGE_RUN_ID_MAX_LENGTH - len(JUDGE_RUN_ID_PREFIX) + 1)

        with pytest.raises(ValueError, match="judge run_id must match"):
            parse_dispatch_message(json.dumps(_message(override=dict(VALID_OVERRIDE), run_id=run_id)))

    def test_a_judge_run_id_with_a_uuid4_suffix_is_refused(self):
        with pytest.raises(ValueError, match="judge run_id must match"):
            parse_dispatch_message(
                json.dumps(
                    _message(
                        override=dict(VALID_OVERRIDE),
                        run_id=f"{JUDGE_RUN_ID_PREFIX}0199b4c0-7b1e-7000-8000-0123456789ab",
                    )
                )
            )

    def test_a_trailing_newline_does_not_pass_as_a_judge_run_id(self):
        """The envelope's own run-id check is `re.match` against a `$`-anchored
        pattern, and Python's `$` matches before a trailing newline — so
        `_judge-x\\n` satisfies it. A judge run id decides whether gp-api hears
        about this run at all, so it gets `fullmatch` on an explicit alphabet."""
        with pytest.raises(ValueError, match="judge run_id must match"):
            parse_dispatch_message(
                json.dumps(_message(override=dict(VALID_OVERRIDE), run_id=f"{JUDGE_RUN_ID_PREFIX}x\n"))
            )


class TestShapeLevelJudgeRejectionAlsoSendsNoCallback:
    """The sibling of the content-level rejection. Both must stay silent for a
    judge run id: there is no `experiment_run` row for the callback to land on,
    so it would only log `Experiment run not found` once per malformed record —
    the error storm the whole design exists to avoid. A product run id still
    gets its callback, because there its row is real and would otherwise sit
    QUEUED until the 6h backstop."""

    @pytest.mark.parametrize(
        "override",
        [
            {"manifest_key": "voter_targeting/manifest.json", "instruction_key": INSTRUCTION_KEY},
            {"manifest_key": MANIFEST_KEY},
            {**{"manifest_key": MANIFEST_KEY, "instruction_key": INSTRUCTION_KEY}, "scope": {}},
            {"manifest_key": MANIFEST_KEY, "instruction_key": f"_judge/{EXPERIMENT_ID}/deadbeef/instruction.md"},
            {"manifest_key": 12, "instruction_key": INSTRUCTION_KEY},
        ],
    )
    def test_a_judge_run_id_gets_no_callback(self, dispatch_env, override):
        result = handler(_sqs_event(_message(override=override, run_id=JUDGE_RUN_ID)), None)

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["sqs"].send_message.assert_not_called()
        dispatch_env["store"].put_queued_job.assert_not_called()

    def test_a_product_run_id_still_gets_its_callback(self, dispatch_env):
        override = {"manifest_key": "voter_targeting/manifest.json", "instruction_key": INSTRUCTION_KEY}

        handler(_sqs_event(_message(override=override, run_id=PRODUCT_RUN_ID)), None)

        assert dispatch_env["sqs"].send_message.call_count == 1


class TestTheJudgeGateCoversTheBaseArm:
    """A sweep's base arm carries a judge run id and no `_judge_override`.

    It still gets every consequence the prefix implies — suppressed callbacks,
    no reaper reconciliation, no `latest.json` write, no gp-api row — so it has
    to pass the same gate. Gating only the override arm left the base arm
    ungated in prod: real Anthropic spend on a run nothing can observe, an
    artifact under a real organization's experiment prefix, and for a
    write-action experiment real product writes through /agent/mcp, which does
    not read `is_eval`.
    """

    @pytest.mark.parametrize("environment", ["prod", "PROD", "production", "qa", ""])
    def test_a_base_arm_is_refused_outside_dev(self, dispatch_env, monkeypatch, environment):
        monkeypatch.setenv("ENVIRONMENT", environment)

        result = handler(_sqs_event(_message(run_id=JUDGE_RUN_ID)), None)

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["store"].put_queued_job.assert_not_called()
        dispatch_env["sqs"].send_message.assert_not_called()

    def test_a_base_arm_run_id_past_the_ecs_cap_is_refused(self, dispatch_env):
        run_id = JUDGE_RUN_ID_PREFIX + "a" * (JUDGE_RUN_ID_MAX_LENGTH - len(JUDGE_RUN_ID_PREFIX) + 1)

        result = handler(_sqs_event(_message(run_id=run_id)), None)

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["store"].put_queued_job.assert_not_called()

    def test_a_base_arm_is_accepted_in_dev(self, dispatch_env):
        result = handler(_sqs_event(_message(run_id=JUDGE_RUN_ID)), None)

        assert result == {"batchItemFailures": []}
        job = _enqueued_job(dispatch_env["store"])
        assert "judge_override" not in job.routing
        dispatch_env["loader"].fetch_judge_override.assert_not_called()

    def test_a_base_arm_of_a_write_action_experiment_is_refused(self, dispatch_env):
        """Its own reason, worse than the override arm's: a write-action run
        writes to gp-api through /agent/mcp, which does not read
        `ticket.is_eval`, so this would make real product writes on a real
        organization with every failure signal suppressed."""
        routing = {**_published_routing(), "system_prompt": "you write ordinances", "scope": {}}
        dispatch_env["loader"].routing_for.side_effect = lambda eid: copy.deepcopy(routing)

        result = handler(_sqs_event(_message(run_id=JUDGE_RUN_ID)), None)

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["store"].put_queued_job.assert_not_called()
        dispatch_env["sqs"].send_message.assert_not_called()

    def test_a_product_dispatch_is_untouched_by_the_gate(self, dispatch_env, monkeypatch):
        """The gate keys on the run-id prefix only, so a product dispatch in
        any environment is unaffected."""
        monkeypatch.setenv("ENVIRONMENT", "prod")

        result = handler(_sqs_event(_message()), None)

        assert result == {"batchItemFailures": []}
        assert dispatch_env["store"].put_queued_job.call_count == 1


class TestNoJudgeRunEverCallsBackToGpApi:
    """The suppression is a property of the destination, not of one failure, so
    it lives inside `send_error_callback` rather than at its ten call sites.

    Every one of those callbacks would produce exactly one `Experiment run not
    found` in gp-api for a judge run — the error-rate storm the eval path
    exists to avoid, once per arm per sweep. One of the call sites also runs
    before `parse_dispatch_message` has looked at the message, so a per-site
    check could not have covered it.
    """

    def test_it_reports_not_sent_so_the_message_reaches_the_dlq(self, dispatch_env):
        from pmf_engine.control_plane.dispatch_handler import send_error_callback

        sent = send_error_callback(
            {"run_id": JUDGE_RUN_ID, "experiment_type": EXPERIMENT_ID, "organization_slug": "org-123"},
            "boom",
            "https://sqs.example.com/callback.fifo",
        )

        assert sent is False
        dispatch_env["sqs"].send_message.assert_not_called()

    def test_a_product_run_still_sends(self, dispatch_env):
        from pmf_engine.control_plane.dispatch_handler import send_error_callback

        sent = send_error_callback(
            {"run_id": PRODUCT_RUN_ID, "experiment_type": EXPERIMENT_ID, "organization_slug": "org-123"},
            "boom",
            "https://sqs.example.com/callback.fifo",
        )

        assert sent is True
        assert dispatch_env["sqs"].send_message.call_count == 1

    @pytest.mark.parametrize(
        "message,expected_metric",
        [
            # Unknown experiment.
            ({"experiment_type": "no_such_experiment"}, "UnknownExperiment"),
            # params is not an object.
            ({"params": ["WI"]}, "InvalidParamsType"),
            # params fail the published input_schema.
            ({"params": {"state": "not-a-state-code"}}, "InputSchemaViolation"),
        ],
    )
    def test_every_shared_rejection_path_stays_silent_for_a_judge_run(self, dispatch_env, message, expected_metric):
        """These call sites are shared with the product path, which is why the
        check had to move into the callback rather than be added to each."""
        body = {**_message(run_id=JUDGE_RUN_ID), **message}

        result = handler(_sqs_event(body), None)

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["sqs"].send_message.assert_not_called()
        dispatch_env["store"].put_queued_job.assert_not_called()

    @pytest.mark.parametrize(
        "message",
        [
            {"experiment_type": "no_such_experiment"},
            {"params": ["WI"]},
            {"params": {"state": "not-a-state-code"}},
        ],
    )
    def test_the_same_paths_still_notify_a_product_run(self, dispatch_env, message):
        body = {**_message(), **message}

        handler(_sqs_event(body), None)

        assert dispatch_env["sqs"].send_message.call_count == 1
