"""Judge page replay (`_judge_replay`) on the dispatch Lambda.

The Lambda only checks the field's shape and carries it to the mint; the
broker records and replays. What matters here is that a product dispatch is
untouched, that a bad field fails the dispatch before anything is minted, and
that a good one reaches the mint body intact after the queue round trip.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from pmf_engine.control_plane.broker_client import BrokerClient
from pmf_engine.control_plane.dispatch_handler import handler, launch_run, parse_dispatch_message
from pmf_engine.control_plane.job_store import JobStore, QueuedJob
from pmf_engine.tests import test_judge_override as override_tests
from pmf_engine.tests.test_judge_override import (
    EXPERIMENT_ID,
    JUDGE_RUN_ID,
    PRODUCT_RUN_ID,
    VALID_OVERRIDE,
    VALID_PARAMS,
    _capturing_post,
    _enqueued_job,
    _message,
    _published_routing,
    _sqs_event,
)

# The override suite's fixtures: the dev ENVIRONMENT every judge dispatch
# needs, and the stubbed Lambda module state.
dev_environment = override_tests.dev_environment
dispatch_env = override_tests.dispatch_env

SWEEP_KEY = f"_judge/replay/sweep/judge-1-1/{EXPERIMENT_ID}/case-a-1"
BASE_KEY = f"_judge/replay/base/{EXPERIMENT_ID}/d1/case-a-1"
SEED_KEY = f"_judge/replay/seed/{EXPERIMENT_ID}/case-a"


def _replay_message(replay: object, *, run_id: str = JUDGE_RUN_ID, override: object = None) -> dict:
    body = _message(override=override, run_id=run_id)
    body["_judge_replay"] = replay
    return body


def _parse(replay: object, **kwargs) -> dict:
    return parse_dispatch_message(json.dumps(_replay_message(replay, **kwargs)))


def _mint_kwargs(routing: dict, message: dict) -> dict:
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


class TestNoReplayIsUnchanged:
    def test_parse_leaves_no_replay_key_on_the_message(self):
        assert "_judge_replay" not in parse_dispatch_message(json.dumps(_message(run_id=JUDGE_RUN_ID)))

    def test_routing_carries_no_replay_key(self, dispatch_env):
        handler(_sqs_event(_message(run_id=JUDGE_RUN_ID)), None)

        assert "replay" not in _enqueued_job(dispatch_env["store"]).routing

    def test_mint_is_handed_no_replay(self, dispatch_env):
        assert _mint_kwargs(_published_routing(), _message())["replay"] is None

    def test_the_mint_body_omits_replay_rather_than_sending_null(self):
        """MintRequest refuses unknown fields, so a broker that predates
        replay would 422 an explicit null on every mint."""
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
                replay=None,
            )

        assert "replay" not in captured["body"]


class TestReplayShape:
    @pytest.mark.parametrize(
        "replay",
        [
            {"mode": "record", "key": SWEEP_KEY},
            {"mode": "replay", "key": SWEEP_KEY},
            {"mode": "record", "key": BASE_KEY},
            {"mode": "replay", "key": BASE_KEY},
            {"mode": "replay", "key": SEED_KEY},
        ],
    )
    def test_accepts_each_store_and_mode(self, replay):
        assert _parse(dict(replay))["_judge_replay"] == replay

    @pytest.mark.parametrize("replay", ["record", ["record", SWEEP_KEY], 1])
    def test_rejects_a_non_object(self, replay):
        with pytest.raises(ValueError, match="_judge_replay must be an object"):
            _parse(replay)

    @pytest.mark.parametrize(
        "replay",
        [
            {"mode": "record"},
            {"key": SWEEP_KEY},
            {"mode": "record", "key": SWEEP_KEY, "agent": EXPERIMENT_ID},
        ],
    )
    def test_rejects_missing_or_unknown_fields(self, replay):
        with pytest.raises(ValueError, match="exactly the keys"):
            _parse(replay)

    @pytest.mark.parametrize("mode", ["RECORD", "seed", None, True])
    def test_rejects_an_unknown_mode(self, mode):
        with pytest.raises(ValueError, match="mode must be one of"):
            _parse({"mode": mode, "key": SWEEP_KEY})

    def test_rejects_a_non_string_key(self):
        with pytest.raises(ValueError, match="key must be a string"):
            _parse({"mode": "record", "key": ["_judge", "replay"]})

    @pytest.mark.parametrize(
        "key",
        [
            f"{SWEEP_KEY}/",
            f"{SWEEP_KEY}\n",
            f"/{SWEEP_KEY}",
            f"_judge/replay/sweep/judge-1-1/{EXPERIMENT_ID}/../x-1",
            f"_judge/replay/sweep/judge-1-1/{EXPERIMENT_ID}/case-a-0",
            f"_judge/replay/sweep/judge-1-1/{EXPERIMENT_ID}/case-a",
            f"_judge/{EXPERIMENT_ID}/d1/manifest.json",
            f"_judge/replay/other/{EXPERIMENT_ID}/case-a",
        ],
    )
    def test_rejects_a_key_outside_the_three_stores(self, key):
        with pytest.raises(ValueError, match="sweep/, base/ or seed/ key"):
            _parse({"mode": "replay", "key": key})

    def test_rejects_recording_into_a_seed_store(self):
        with pytest.raises(ValueError, match="seed store is replay-only"):
            _parse({"mode": "record", "key": SEED_KEY})

    def test_rejects_another_agents_store(self):
        with pytest.raises(ValueError, match="does not match experiment_type"):
            _parse({"mode": "record", "key": "_judge/replay/sweep/judge-1-1/walking_plan/case-a-1"})

    def test_a_huge_key_is_truncated_in_the_rejection(self):
        with pytest.raises(ValueError) as raised:
            _parse({"mode": "record", "key": "x" * 10_000})
        assert len(str(raised.value)) < 400


class TestReplayRequiresAJudgeRun:
    def test_rejects_replay_on_a_product_run_id(self):
        with pytest.raises(ValueError, match="judge run_id must match"):
            _parse({"mode": "record", "key": SWEEP_KEY}, run_id=PRODUCT_RUN_ID)

    @pytest.mark.parametrize("environment", ["prod", "staging", ""])
    def test_refused_outside_dev(self, monkeypatch, environment):
        monkeypatch.setenv("ENVIRONMENT", environment)
        with pytest.raises(ValueError, match="only accepted when ENVIRONMENT"):
            _parse({"mode": "record", "key": SWEEP_KEY})

    def test_a_rejected_judge_replay_reaches_the_dlq_without_a_callback(self, dispatch_env):
        result = handler(_sqs_event(_replay_message({"mode": "record", "key": SEED_KEY})), None)

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg-001"}]}
        dispatch_env["sqs"].send_message.assert_not_called()
        dispatch_env["store"].put_queued_job.assert_not_called()


class TestReplayReachesTheMint:
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

    def test_a_base_arm_with_no_override_carries_replay_on_routing(self, dispatch_env):
        replay = {"mode": "record", "key": SWEEP_KEY}
        handler(_sqs_event(_replay_message(dict(replay))), None)

        routing = _enqueued_job(dispatch_env["store"]).routing
        assert routing["replay"] == replay
        assert "judge_override" not in routing

    def test_an_override_arm_carries_both(self, dispatch_env):
        replay = {"mode": "replay", "key": SWEEP_KEY}
        handler(_sqs_event(_replay_message(dict(replay), override=dict(VALID_OVERRIDE))), None)

        routing = _enqueued_job(dispatch_env["store"]).routing
        assert routing["replay"] == replay
        assert routing["judge_override"]["manifest_key"] == VALID_OVERRIDE["manifest_key"]

    def test_the_scheduler_threads_replay_into_mint_after_the_queue_round_trip(self, dispatch_env):
        import pmf_engine.control_plane.scheduler_handler as sched

        replay = {"mode": "replay", "key": SWEEP_KEY}
        handler(_sqs_event(_replay_message(dict(replay))), None)
        routing = _enqueued_job(dispatch_env["store"]).routing

        ddb = MagicMock()
        JobStore("agent-job-queue-test", dynamodb_client=ddb).put_queued_job(self._queued_job(routing))
        item = ddb.put_item.call_args.kwargs["Item"]
        item["attempts"] = {"N": "0"}
        revived = JobStore("agent-job-queue-test", dynamodb_client=ddb)._to_job(item)

        broker = MagicMock()
        broker.mint_run_token.return_value = {"broker_token": "tok", "exp": 1, "params_clean": {}}
        ecs = MagicMock()
        ecs.run_task.return_value = {"tasks": [{"taskArn": "arn:task/1"}], "failures": []}
        with (
            patch("pmf_engine.control_plane.dispatch_handler.get_broker_client", return_value=broker),
            patch("pmf_engine.control_plane.dispatch_handler.get_ecs_client", return_value=ecs),
            patch.object(sched, "_send_callback", return_value=True),
        ):
            assert sched._launch_one(MagicMock(), revived) is True

        assert broker.mint_run_token.call_args.kwargs["replay"] == replay
        assert broker.mint_run_token.call_args.kwargs["is_eval"] is True

    def test_replay_never_reaches_the_container_env(self, dispatch_env):
        replay = {"mode": "record", "key": SWEEP_KEY}
        routing = {**_published_routing(), "replay": replay}
        ecs = MagicMock()
        ecs.run_task.return_value = {"tasks": [{"taskArn": "arn:task/1"}], "failures": []}
        broker = MagicMock()
        broker.mint_run_token.return_value = {"broker_token": "tok", "exp": 1, "params_clean": {}}
        with (
            patch("pmf_engine.control_plane.dispatch_handler.get_broker_client", return_value=broker),
            patch("pmf_engine.control_plane.dispatch_handler.get_ecs_client", return_value=ecs),
        ):
            launch_run(
                experiment=routing,
                message=_message(run_id=JUDGE_RUN_ID),
                scope=routing["scope"],
                params_json=json.dumps(VALID_PARAMS),
            )

        env = ecs.run_task.call_args.kwargs["overrides"]["containerOverrides"][0]["environment"]
        assert SWEEP_KEY not in json.dumps(env)

    def test_the_mint_body_carries_replay_on_the_wire(self):
        replay = {"mode": "record", "key": SWEEP_KEY}
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
                replay=replay,
            )

        assert captured["body"]["replay"] == replay
