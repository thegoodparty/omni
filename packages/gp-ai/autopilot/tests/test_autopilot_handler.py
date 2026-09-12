"""Behavioral tests for the autopilot conductor Lambda's webhook handler.

Named distinctly from clickup_bot/tests/test_handler.py (which the whole
gp-ai suite already ships) to sidestep the basename-clash note in the root
pyproject.toml's pytest config — see autopilot/tests/conftest.py for how the
module itself is loaded without colliding with clickup_bot's.
"""

import hashlib
import hmac
import json

import autopilot_conductor_handler as handler
import pytest

TEST_SECRET = "test-webhook-secret"
IN_SCOPE_LIST_ID = "901300000001"
OUT_OF_SCOPE_LIST_ID = "901300000999"


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeLambdaClient:
    def __init__(self):
        self.invoke_calls = []
        self.exception = None

    def invoke(self, **kwargs):
        self.invoke_calls.append(kwargs)
        if self.exception is not None:
            raise self.exception
        return {"StatusCode": 202}

    @property
    def invoke_payloads(self) -> list[dict]:
        return [json.loads(call["Payload"]) for call in self.invoke_calls]


class FakeBoto3ClientFactory:
    def __init__(self, lambda_client: FakeLambdaClient):
        self.lambda_client = lambda_client
        self.client_calls = []

    def __call__(self, service_name, *args, **kwargs):
        self.client_calls.append((service_name, kwargs))
        assert service_name == "lambda", (
            f"autopilot's conductor handler should only need a lambda client, got {service_name!r}"
        )
        return self.lambda_client


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def webhook_secret_env(monkeypatch):
    monkeypatch.setenv("AUTOPILOT_CLICKUP_WEBHOOK_SECRET", TEST_SECRET)


@pytest.fixture(autouse=True)
def list_ids_env(monkeypatch):
    monkeypatch.setenv("AUTOPILOT_LIST_IDS", f"{IN_SCOPE_LIST_ID}, other-list-id")


@pytest.fixture(autouse=True)
def self_invoke_env(monkeypatch):
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "autopilot-conductor-prod")


@pytest.fixture
def fake_lambda():
    return FakeLambdaClient()


@pytest.fixture(autouse=True)
def boto3_factory(monkeypatch, fake_lambda):
    factory = FakeBoto3ClientFactory(fake_lambda)
    monkeypatch.setattr(handler.boto3, "client", factory)
    return factory


@pytest.fixture(autouse=True)
def reset_lambda_client_cache():
    # The handler caches the boto3 lambda client at module level (fast-ack
    # in-path budget); each test monkeypatches boto3.client with its own fake,
    # so a client cached by one test must never leak into the next.
    handler._lambda_client = None
    yield
    handler._lambda_client = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def sign(body: str, secret: str = TEST_SECRET) -> str:
    return hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()


def status_updated_body(
    task_id: str | None = "task-abc123",
    list_id: str | None = IN_SCOPE_LIST_ID,
    history_items: list | None = None,
) -> dict:
    if history_items is None:
        history_items = [
            {
                "user": {"id": 42},
                "before": {"status": "open"},
                "after": {"status": "in progress"},
                "date": "1700000000000",
            }
        ]
    body: dict = {"event": "taskStatusUpdated", "history_items": history_items}
    if task_id is not None:
        body["task_id"] = task_id
    if list_id is not None:
        body["list_id"] = list_id
    return body


def make_event(body_dict: dict, signature: str | None = None, header_name: str = "x-signature") -> dict:
    body = json.dumps(body_dict)
    if signature is None:
        signature = sign(body)
    return {"headers": {header_name: signature}, "body": body}


def response_body(resp: dict) -> dict:
    return json.loads(resp["body"])


# ---------------------------------------------------------------------------
# Signature verification
# ---------------------------------------------------------------------------


def test_valid_signature_acks_fast_and_self_invokes_once(fake_lambda):
    event = make_event(status_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["status"] == "accepted"
    assert len(fake_lambda.invoke_calls) == 1


def test_valid_signature_self_invoke_carries_the_parsed_event(fake_lambda):
    event = make_event(status_updated_body(task_id="task-xyz", list_id=IN_SCOPE_LIST_ID))

    handler.handler(event, None)

    payload = fake_lambda.invoke_payloads[0]
    assert payload["autopilot_async"] is True
    assert payload["task_id"] == "task-xyz"
    assert payload["list_id"] == IN_SCOPE_LIST_ID
    assert payload["kind"] == "statusUpdated"
    assert payload["transitions"] == [
        {
            "actor_user_id": "42",
            "from_status": "open",
            "to_status": "in progress",
            "transitioned_at": "1700000000000",
        }
    ]


def test_self_invoke_uses_event_invocation_type(fake_lambda):
    handler.handler(make_event(status_updated_body()), None)

    assert fake_lambda.invoke_calls[0]["InvocationType"] == "Event"
    assert fake_lambda.invoke_calls[0]["FunctionName"] == "autopilot-conductor-prod"


def test_missing_signature_header_returns_401_and_no_self_invoke(fake_lambda):
    body = json.dumps(status_updated_body())
    event = {"headers": {}, "body": body}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 401
    assert fake_lambda.invoke_calls == []


def test_wrong_signature_returns_401_and_no_self_invoke(fake_lambda):
    event = make_event(status_updated_body(), signature="0" * 64)

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 401
    assert fake_lambda.invoke_calls == []


def test_non_ascii_signature_returns_401_not_500(fake_lambda):
    # hmac.compare_digest raises TypeError on non-ASCII str input. The header
    # is attacker-controlled, so a malformed signature must be a clean 401,
    # never an unhandled crash.
    event = make_event(status_updated_body(), signature="ñ" * 10)

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 401
    assert fake_lambda.invoke_calls == []


def test_missing_webhook_secret_returns_401_and_no_self_invoke(monkeypatch, fake_lambda):
    monkeypatch.delenv("AUTOPILOT_CLICKUP_WEBHOOK_SECRET", raising=False)
    event = make_event(status_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 401
    assert fake_lambda.invoke_calls == []


def test_invalid_json_body_returns_400_and_no_self_invoke(fake_lambda):
    event = {"headers": {"x-signature": sign("not json")}, "body": "not json"}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 400
    assert fake_lambda.invoke_calls == []


# ---------------------------------------------------------------------------
# List-id scoping
# ---------------------------------------------------------------------------


def test_out_of_scope_list_id_is_acked_and_dropped(fake_lambda):
    event = make_event(status_updated_body(list_id=OUT_OF_SCOPE_LIST_ID))

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["skipped"] == "list not in scope"
    assert fake_lambda.invoke_calls == []


def test_missing_list_id_is_acked_and_dropped(fake_lambda):
    event = make_event(status_updated_body(list_id=None))

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert fake_lambda.invoke_calls == []


def test_unrecognized_event_kind_is_acked_and_dropped(fake_lambda):
    body = status_updated_body()
    body["event"] = "taskDeleted"
    event = make_event(body)

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["skipped"] == "not a triggering event"
    assert fake_lambda.invoke_calls == []


def test_missing_task_id_is_acked_and_dropped(fake_lambda):
    event = make_event(status_updated_body(task_id=None))

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert fake_lambda.invoke_calls == []


# ---------------------------------------------------------------------------
# Internal async dispatch — unspoofable through the ALB
# ---------------------------------------------------------------------------


def test_internal_payload_with_headers_key_is_not_treated_as_internal(monkeypatch, fake_lambda):
    routed = []
    monkeypatch.setattr(handler, "route_event", lambda e: routed.append(e))
    # An ALB-wrapped attacker request always carries "headers" — even one that
    # smuggles the autopilot_async marker into its JSON body must fall through
    # to normal (and here, failing) signature verification, not the trusted
    # worker path.
    event = {"autopilot_async": True, "headers": {"x-signature": "forged"}, "body": "{}"}

    resp = handler.handler(event, None)

    assert routed == []
    assert resp["statusCode"] in (400, 401)
    assert fake_lambda.invoke_calls == []


def test_internal_payload_with_request_context_key_is_not_treated_as_internal(monkeypatch, fake_lambda):
    routed = []
    monkeypatch.setattr(handler, "route_event", lambda e: routed.append(e))
    event = {"autopilot_async": True, "requestContext": {}, "body": "{}", "headers": {}}

    handler.handler(event, None)

    assert routed == []
    assert fake_lambda.invoke_calls == []


def test_genuine_internal_payload_is_routed_without_reinvoking(monkeypatch, fake_lambda):
    routed = []
    monkeypatch.setattr(handler, "route_event", lambda e: routed.append(e))
    payload = handler.AutopilotEvent(
        kind="statusUpdated",
        task_id="task-abc123",
        list_id=IN_SCOPE_LIST_ID,
        transitions=[
            handler.StatusTransition(
                actor_user_id="42", from_status="open", to_status="in progress", transitioned_at="1700000000000"
            )
        ],
    ).to_payload()

    resp = handler.handler(payload, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["status"] == "processed"
    assert len(routed) == 1
    assert routed[0].task_id == "task-abc123"
    assert routed[0].kind == "statusUpdated"
    assert routed[0].transitions[0].to_status == "in progress"
    # The worker must never re-invoke itself.
    assert fake_lambda.invoke_calls == []


def test_invalid_internal_payload_returns_400(monkeypatch, fake_lambda):
    monkeypatch.setattr(handler, "route_event", lambda e: None)
    event = {"autopilot_async": True}  # missing task_id/kind

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 400


def test_route_event_exception_returns_500_not_a_crash(monkeypatch, fake_lambda):
    def boom(event):
        raise RuntimeError("boom")

    monkeypatch.setattr(handler, "route_event", boom)
    payload = handler.AutopilotEvent(
        kind="taskCreated", task_id="task-abc123", list_id=IN_SCOPE_LIST_ID, transitions=[]
    ).to_payload()

    resp = handler.handler(payload, None)

    assert resp["statusCode"] == 500


# ---------------------------------------------------------------------------
# Self-invoke failure handling
# ---------------------------------------------------------------------------


def test_self_invoke_failure_returns_500(fake_lambda):
    fake_lambda.exception = RuntimeError("Lambda control plane unavailable")

    resp = handler.handler(make_event(status_updated_body()), None)

    assert resp["statusCode"] == 500


def test_self_invoke_unavailable_without_function_name_returns_500(monkeypatch, fake_lambda):
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)

    resp = handler.handler(make_event(status_updated_body()), None)

    assert resp["statusCode"] == 500
    assert fake_lambda.invoke_calls == []


# ---------------------------------------------------------------------------
# Self-invoke botocore config — the max_attempts trap
# ---------------------------------------------------------------------------


def test_lambda_client_uses_fast_ack_timeouts(boto3_factory):
    handler.handler(make_event(status_updated_body()), None)

    lambda_calls = [kwargs for service, kwargs in boto3_factory.client_calls if service == "lambda"]
    assert len(lambda_calls) == 1
    config = lambda_calls[0]["config"]
    assert config.connect_timeout == 2
    assert config.read_timeout == 5
    assert config.retries == {"total_max_attempts": 1}


def test_lambda_client_config_resolves_to_a_single_total_attempt():
    # BEHAVIORAL, not just a dict pin: build a REAL botocore client from the
    # handler's constant and assert the RESOLVED retry budget. botocore's
    # legacy mode normalizes retries into {"total_max_attempts": N, ...} where
    # N counts the initial call — {"max_attempts": 1} would silently resolve
    # to total_max_attempts=2 (one full SDK retry), which this test catches.
    import boto3.session

    real_client = boto3.session.Session(
        region_name="us-west-2",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
    ).client("lambda", config=handler.LAMBDA_CLIENT_CONFIG)

    assert real_client.meta.config.retries["total_max_attempts"] == 1


def test_lambda_client_is_cached_across_invocations(boto3_factory):
    handler.handler(make_event(status_updated_body()), None)
    handler.handler(make_event(status_updated_body()), None)

    lambda_calls = [kwargs for service, kwargs in boto3_factory.client_calls if service == "lambda"]
    assert len(lambda_calls) == 1
