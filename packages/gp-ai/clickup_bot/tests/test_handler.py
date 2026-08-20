"""Behavioral tests for the clickup_bot webhook Lambda handler.

Written from the behavioral contract only (3-agent pattern: test writer never
reads the source). Each test encodes one numbered behavior from the spec.
"""

import hashlib
import hmac
import json
import re
import time
from urllib.error import HTTPError, URLError

import handler
import pytest
from botocore.exceptions import ClientError, ReadTimeoutError

TEST_SECRET = "test-secret"
TEST_API_KEY = "test-key"
TASK_ARN = "arn:aws:ecs:us-east-1:123456789012:task/gpbot/abc123def456"

ECS_ENV = {
    "ECS_CLUSTER_ARN": "arn:aws:ecs:us-east-1:123456789012:cluster/gpbot-cluster",
    "ECS_TASK_DEFINITION": "gpbot-engineer-agent:7",
    "ECS_SUBNET_IDS": "subnet-aaa111,subnet-bbb222",
    "ECS_SECURITY_GROUP_ID": "sg-0123456789",
}


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeHTTPResponse:
    """Context-manager response whose read() returns JSON bytes."""

    def __init__(self, payload: dict):
        self._payload = json.dumps(payload).encode()

    def read(self) -> bytes:
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False


class FakeUrlopen:
    """Fake for handler.urlopen. Records every ClickUp API call.

    calls: list of (method, url, decoded_body_dict_or_None)
    """

    def __init__(self):
        self.calls = []
        self.requests = []  # raw Request objects, for header assertions
        self.comments_response = {"comments": []}
        self.get_comments_error = None  # exception to raise on GET .../comment
        self.post_comment_error = None  # exception to raise on EVERY POST .../comment
        self.post_comment_error_queue = []  # one-shot exceptions, consumed per POST
        # GET /task/{id} — the scope guard's lookup. Default is an in-scope
        # ENG task in the Win bug list, so every pre-existing implement test
        # keeps its old behavior without opting in.
        self.task_response = {"custom_id": "ENG-1234", "list": {"id": "901321761872", "name": "Bugs"}, "tags": []}
        self.get_task_error = None  # exception to raise on GET /task/{id}

    def __call__(self, request, timeout=None, **kwargs):
        method = request.get_method()
        url = request.full_url
        body = json.loads(request.data.decode()) if request.data else None
        self.calls.append((method, url, body))
        self.requests.append(request)

        if method == "GET" and "/comment" in url:
            if self.get_comments_error is not None:
                raise self.get_comments_error
            return FakeHTTPResponse(self.comments_response)
        if method == "GET" and "/task/" in url:
            if self.get_task_error is not None:
                raise self.get_task_error
            return FakeHTTPResponse(self.task_response)
        if method == "POST" and "/comment" in url:
            if self.post_comment_error_queue:
                raise self.post_comment_error_queue.pop(0)
            if self.post_comment_error is not None:
                raise self.post_comment_error
            return FakeHTTPResponse({"id": "new-comment-1"})
        return FakeHTTPResponse({})

    @property
    def posted_comments(self) -> list[dict]:
        """Bodies of every POST .../comment call."""
        return [body for method, url, body in self.calls if method == "POST" and "/comment" in url]

    @property
    def posted_comment_texts(self) -> list[str]:
        return [body["comment_text"] for body in self.posted_comments]

    @property
    def authorization_headers(self) -> list[str | None]:
        """Authorization header value for every recorded ClickUp API request."""
        return [
            next((value for key, value in request.headers.items() if key.lower() == "authorization"), None)
            for request in self.requests
        ]


class FakeECSClient:
    def __init__(self):
        self.run_task_calls = []
        self.response = {"tasks": [{"taskArn": TASK_ARN}], "failures": []}
        self.exception = None

    def run_task(self, **kwargs):
        self.run_task_calls.append(kwargs)
        if self.exception is not None:
            raise self.exception
        return self.response


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


class FakeDynamoDBClient:
    """Fake for the atomic-dedup DynamoDB client. Records every call.

    put_item_exception / delete_item_exception raise on the corresponding call
    (set put_item_exception to conditional_check_failed() to simulate a lost
    claim race).
    """

    def __init__(self):
        self.put_item_calls = []
        self.delete_item_calls = []
        self.put_item_exception = None
        self.delete_item_exception = None

    def put_item(self, **kwargs):
        self.put_item_calls.append(kwargs)
        if self.put_item_exception is not None:
            raise self.put_item_exception
        return {}

    def delete_item(self, **kwargs):
        self.delete_item_calls.append(kwargs)
        if self.delete_item_exception is not None:
            raise self.delete_item_exception
        return {}


class FakeBoto3ClientFactory:
    """Stands in for boto3.client; routes each service to its fake.

    client_calls records (service_name, kwargs) so tests can pin the botocore
    Config the handler constructs clients with.
    """

    def __init__(
        self,
        ecs_client: FakeECSClient,
        lambda_client: FakeLambdaClient | None = None,
        dynamodb_client: FakeDynamoDBClient | None = None,
    ):
        self.ecs_client = ecs_client
        self.lambda_client = lambda_client if lambda_client is not None else FakeLambdaClient()
        self.dynamodb_client = dynamodb_client if dynamodb_client is not None else FakeDynamoDBClient()
        self.requested_services = []
        self.client_calls = []

    def __call__(self, service_name, *args, **kwargs):
        self.requested_services.append(service_name)
        self.client_calls.append((service_name, kwargs))
        if service_name == "lambda":
            return self.lambda_client
        if service_name == "dynamodb":
            return self.dynamodb_client
        return self.ecs_client


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def secrets_cache():
    handler._secrets_cache = {
        "CLICKUP_API_KEY": TEST_API_KEY,
        "CLICKUP_WEBHOOK_SECRET": TEST_SECRET,
    }
    yield
    handler._secrets_cache = None


@pytest.fixture(autouse=True)
def clean_ecs_env(monkeypatch):
    for var in ECS_ENV:
        monkeypatch.delenv(var, raising=False)


@pytest.fixture(autouse=True)
def fake_clickup(monkeypatch):
    fake = FakeUrlopen()
    monkeypatch.setattr(handler, "urlopen", fake)
    return fake


@pytest.fixture(autouse=True)
def fake_lambda():
    return FakeLambdaClient()


@pytest.fixture(autouse=True)
def fake_dynamodb():
    return FakeDynamoDBClient()


@pytest.fixture(autouse=True)
def boto3_factory(monkeypatch, fake_lambda, fake_dynamodb):
    factory = FakeBoto3ClientFactory(FakeECSClient(), fake_lambda, fake_dynamodb)
    monkeypatch.setattr(handler.boto3, "client", factory)
    return factory


@pytest.fixture(autouse=True)
def fake_ecs(boto3_factory):
    return boto3_factory.ecs_client


@pytest.fixture(autouse=True)
def reset_boto3_client_cache():
    # The handler caches boto3 clients at module level (fast-ack in-path
    # budget); each test monkeypatches boto3.client with its own fakes, so a
    # client cached by one test must never leak into the next.
    handler._lambda_client = None
    handler._ecs_client = None
    handler._dynamodb_client = None
    yield
    handler._lambda_client = None
    handler._ecs_client = None
    handler._dynamodb_client = None


@pytest.fixture(autouse=True)
def clean_self_invoke_env(monkeypatch):
    # Tests run outside Lambda, but a developer shell (or the Lambda runtime,
    # which always sets AWS_LAMBDA_FUNCTION_NAME) must not flip tests between
    # the fast-ack and synchronous paths. Default: sync fallback.
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    monkeypatch.delenv("DEDUP_COMMENT_WINDOW_SECONDS", raising=False)


@pytest.fixture(autouse=True)
def clean_dedup_table_env(monkeypatch):
    # Default state is the pre-terraform prod state: no dedup table configured,
    # comment-based dedup only. A DEDUP_TABLE_NAME set in a developer shell must
    # not silently flip the whole suite onto the atomic-dedup path — it gates
    # both the lock functions and the is_atomic_dedup_configured branch point
    # in the async comment-fetch failure handling.
    monkeypatch.delenv("DEDUP_TABLE_NAME", raising=False)
    monkeypatch.delenv("DEDUP_TTL_SECONDS", raising=False)


@pytest.fixture
def dedup_table_env(monkeypatch):
    monkeypatch.setenv("DEDUP_TABLE_NAME", "clickup-bot-dedup-test")
    return "clickup-bot-dedup-test"


@pytest.fixture
def self_invoke_env(monkeypatch):
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "clickup-bot-prod")
    return "clickup-bot-prod"


@pytest.fixture(autouse=True)
def no_ack_retry_delay(monkeypatch):
    # The ack-retry pause's real length is not a behavioral contract and would
    # add wall-clock seconds to every ack-failure test; zero it. raising=False
    # keeps this inert before the constant exists (red phase of its TDD cycle).
    monkeypatch.setattr(handler, "ACK_COMMENT_RETRY_DELAY_SECONDS", 0, raising=False)


@pytest.fixture
def ecs_env(clean_ecs_env, monkeypatch):
    for key, value in ECS_ENV.items():
        monkeypatch.setenv(key, value)
    return ECS_ENV


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def sign(body: str, secret: str = TEST_SECRET) -> str:
    return hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()


def make_event(body_dict: dict, signature: str | None = None, header_name: str = "x-signature") -> dict:
    body = json.dumps(body_dict)
    if signature is None:
        signature = sign(body)
    return {"headers": {header_name: signature}, "body": body}


def tag_updated_body(task_id: str | None = "abc123", tags: tuple = ("gpbot-analyze",), history_items=None) -> dict:
    if history_items is None:
        history_items = [{"field": "tag", "after": [{"name": tag} for tag in tags]}]
    body = {"event": "taskTagUpdated", "history_items": history_items}
    if task_id is not None:
        body["task_id"] = task_id
    return body


def response_body(resp: dict) -> dict:
    return json.loads(resp["body"])


def engineer_agent_env(run_task_kwargs: dict) -> dict:
    """Extract {name: value} env of the engineer-agent container override."""
    container_overrides = run_task_kwargs["overrides"]["containerOverrides"]
    matches = [c for c in container_overrides if c.get("name") == "engineer-agent"]
    assert len(matches) == 1, f"expected exactly one engineer-agent container override, got: {container_overrides}"
    return {entry["name"]: entry["value"] for entry in matches[0]["environment"]}


def existing_gpbot_comment_response(
    age_seconds: float = 30.0,
    include_comment_text: bool = True,
    with_type_key: bool = False,
) -> dict:
    """REAL ClickUp GET /task/{id}/comment shape, captured live during the
    2026-07-14 duplicate-launch incident (task DATA-2108): comment[] items have
    NO "type" key, and "date" is a STRING of epoch milliseconds. The previous
    fixture invented a "type": "text" field the real API never sends, so the
    dedup matcher passed its test while matching 0 real comments in prod
    (oracle problem). Never add fields here that a live capture doesn't show.

    with_type_key adds the (fabricated) "type" key back to prove forward-compat
    if ClickUp ever ships one; include_comment_text=False exercises the
    item-concatenation fallback path.
    """
    text = "[GP-Bot] Processing started (analyze, model: opus)..."
    item: dict = {"text": text}
    if with_type_key:
        item["type"] = "text"
    comment: dict = {
        "id": "90130291038679",
        "comment": [item],
        "user": {"id": 105985359, "username": "Collin Park"},
        "date": str(int((time.time() - age_seconds) * 1000)),
        "reply_count": 0,
    }
    if include_comment_text:
        comment["comment_text"] = text
    return {"comments": [comment]}


def assert_no_side_effects(fake_clickup: FakeUrlopen, fake_ecs: FakeECSClient):
    assert fake_ecs.run_task_calls == []
    assert fake_clickup.posted_comments == []


# The CloudWatch alarm leg of fail-loud: infrastructure/modules/clickup-bot/main.tf
# creates a log metric filter with pattern ?"ERROR" ?"Failed to" ?"Task timed out"
# and alarms on any match in this Lambda's log group. These helpers are the
# test-side half of that contract:
#   - every failure path must emit a line containing one of those terms, or the
#     alarm never fires and the failure is operationally silent;
#   - unauthenticated request content must never be echoed to the logs, or any
#     internet client could fire (or drown) the alarm by sending "ERROR" in a body.
# If a handler log line is reworded, update the terraform pattern and these terms
# together.
#
# "Task timed out" is deliberately NOT in ALARM_FILTER_TERMS: it is emitted by
# the Lambda RUNTIME at the hard timeout, never by handler code, so these
# helpers (which police handler-controlled log lines) have nothing to assert
# about it. It exists in the terraform pattern so a hard-timed-out async
# worker — no HTTP caller, zero platform retries — still fires the alarm.
ALARM_FILTER_TERMS = ("ERROR", "Failed to")

# Marker an attacker would embed in a request to poison the alarm log filter.
ALARM_POISON = "ERROR Failed to poison"


def assert_alarm_log_emitted(capsys) -> str:
    out = capsys.readouterr().out
    assert any(term in out for term in ALARM_FILTER_TERMS), f"no alarm-matching log line in: {out!r}"
    return out


def assert_no_alarm_log_emitted(capsys) -> str:
    out = capsys.readouterr().out
    assert not any(term in out for term in ALARM_FILTER_TERMS), f"alarm-matching log line leaked: {out!r}"
    return out


# ---------------------------------------------------------------------------
# 1. Signature verification
# ---------------------------------------------------------------------------


def test_invalid_signature_returns_401(fake_clickup, fake_ecs, ecs_env, capsys):
    event = make_event(tag_updated_body(), signature="0" * 64)

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 401
    assert fake_clickup.calls == []
    assert fake_ecs.run_task_calls == []
    # A rotated/mismatched CLICKUP_WEBHOOK_SECRET 401s every gpbot delivery until
    # ClickUp suspends the webhook — this class MUST fire the CloudWatch alarm.
    assert_alarm_log_emitted(capsys)


def test_missing_signature_header_returns_401(fake_clickup, fake_ecs, ecs_env, capsys):
    body = json.dumps(tag_updated_body())
    event = {"headers": {}, "body": body}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 401
    assert fake_clickup.calls == []
    assert fake_ecs.run_task_calls == []
    assert_alarm_log_emitted(capsys)


def test_non_ascii_signature_returns_401_not_500(fake_clickup, fake_ecs, ecs_env, capsys):
    # hmac.compare_digest raises TypeError on non-ASCII str input. The x-signature
    # header is attacker-controlled, so a malformed signature is an invalid
    # signature (401) — never a secrets outage (500), which would page ops with
    # the wrong runbook while Secrets Manager is healthy.
    event = make_event(tag_updated_body(), signature="café")

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 401
    assert response_body(resp)["error"] == "Unauthorized"
    assert fake_clickup.calls == []
    assert fake_ecs.run_task_calls == []
    out = assert_alarm_log_emitted(capsys)
    assert "secrets unavailable" not in out.lower()


def test_signature_header_lookup_is_case_insensitive(fake_clickup, fake_ecs, ecs_env):
    event = make_event(tag_updated_body(), header_name="X-Signature")

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert len(fake_ecs.run_task_calls) == 1


# ---------------------------------------------------------------------------
# 2. Missing webhook secret
# ---------------------------------------------------------------------------


def test_missing_webhook_secret_returns_401(fake_clickup, fake_ecs, ecs_env, capsys):
    handler._secrets_cache = {"CLICKUP_API_KEY": "test-key"}
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 401
    assert fake_clickup.calls == []
    assert fake_ecs.run_task_calls == []
    assert_alarm_log_emitted(capsys)


# ---------------------------------------------------------------------------
# 3. Events the bot does not trigger on are skipped
# ---------------------------------------------------------------------------


def test_other_event_type_returns_200_without_side_effects(fake_clickup, fake_ecs, ecs_env):
    body = {"event": "taskUpdated", "task_id": "abc123", "history_items": []}
    event = make_event(body)

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert_no_side_effects(fake_clickup, fake_ecs)


# ---------------------------------------------------------------------------
# 3b. taskCreated: the tag-in-the-create-call race.
#
# The tag that summons this bot is applied by the HubSpot integration, and
# whether it lands inside the create call or as a follow-up edit is not
# deterministic. When it lands inside the create, ClickUp emits taskCreated and
# NO tag delta ever exists — on 2026-08-14/17 that silently swallowed two of
# five reported bugs (ENG-10890, ENG-10891), which sat tagged and un-analyzed
# until someone re-tagged them by hand. So a created task must be judged on the
# tags it actually carries, not on a delta that may never arrive.
# ---------------------------------------------------------------------------


def created_body(task_id: str | None = "abc123", history_items: list | None = None) -> dict:
    body: dict = {"event": "taskCreated", "history_items": history_items if history_items is not None else []}
    if task_id is not None:
        body["task_id"] = task_id
    return body


def task_get_calls(fake_clickup: FakeUrlopen) -> list:
    """Every GET /task/{id} (the tag lookup and the scope guard share these)."""
    return [c for c in fake_clickup.calls if c[0] == "GET" and "/task/" in c[1] and "/comment" not in c[1]]


def test_created_task_tagged_inside_the_create_call_still_launches(fake_clickup, fake_ecs, ecs_env):
    # The regression that started all this: no tag delta at all, the tag is
    # only visible on the task itself.
    fake_clickup.task_response = {
        "custom_id": "ENG-10890",
        "list": {"id": "901321761872", "name": "Bugs"},
        "tags": [{"name": "hs ticket"}, {"name": "production-bug"}, {"name": "gpbot-analyze"}],
    }
    event = make_event(created_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1
    assert engineer_agent_env(fake_ecs.run_task_calls[0])["CLICKUP_TASK_ID"] == "abc123"


def test_created_task_without_a_gpbot_tag_is_silent(fake_clickup, fake_ecs, ecs_env, capsys):
    # taskCreated fires for EVERY task created anywhere in the workspace, so
    # the overwhelming majority of these deliveries are none of the bot's
    # business. They must cost one lookup and produce no launch, no comment,
    # and no alarm noise.
    fake_clickup.task_response = {"custom_id": "ENG-1", "list": {"id": "901321761872"}, "tags": [{"name": "hs ticket"}]}
    event = make_event(created_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert_no_side_effects(fake_clickup, fake_ecs)
    assert_no_alarm_log_emitted(capsys)


def test_created_task_carrying_both_tags_analyzes_rather_than_opening_a_pr(fake_clickup, fake_ecs, ecs_env):
    # Tag order in a ClickUp response is not promised, and the two actions are
    # not equally reversible: analyze posts a comment, implement opens a PR. An
    # ambiguous snapshot must always resolve to the cheap one.
    fake_clickup.task_response = {
        "custom_id": "ENG-7497",
        "list": {"id": "901321761872", "name": "Bugs"},
        "tags": [{"name": "gpbot-work"}, {"name": "gpbot-analyze"}],
    }
    event = make_event(created_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert "analyze" in fake_clickup.posted_comment_texts[0]
    assert "Analyze and Report" in engineer_agent_env(fake_ecs.run_task_calls[0])["INSTRUCTION"]


def test_created_task_lookup_failure_never_comments_on_an_unrelated_ticket(fake_clickup, fake_ecs, ecs_env, capsys):
    # The failure-comment habit everywhere else in this handler would, on this
    # path, scatter "[GP-Bot] Failed to start processing" across every ticket
    # anyone creates during a ClickUp blip — tickets that never asked for the
    # bot. Loud in the logs, silent on the ticket.
    fake_clickup.get_task_error = URLError("clickup unreachable")
    event = make_event(created_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 500
    assert_no_side_effects(fake_clickup, fake_ecs)
    assert_alarm_log_emitted(capsys)


def test_created_task_with_tag_in_the_delta_skips_the_lookup(fake_clickup, fake_ecs, ecs_env):
    # If ClickUp does include the tag in the create payload, the free path must
    # be taken: no GET /task for an analyze run. This is also what would let
    # the lookup (and the secrets exposure it forces) be removed later.
    event = make_event(created_body(history_items=[{"field": "tag", "after": [{"name": "gpbot-analyze"}]}]))

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert len(fake_ecs.run_task_calls) == 1
    assert task_get_calls(fake_clickup) == []


def test_created_task_resolution_and_scope_guard_share_one_lookup(fake_clickup, fake_ecs, ecs_env):
    # A created DATA ticket tagged gpbot-work has to be refused, and the tag
    # lookup already fetched the task — re-fetching it for the scope guard
    # would double the ClickUp calls on a path fed by every task in the
    # workspace.
    fake_clickup.task_response = {
        "custom_id": "DATA-2108",
        "list": {"id": "901326391561", "name": "Data Backlog"},
        "tags": [{"name": "gpbot-work"}],
    }
    event = make_event(created_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["skipped"] == "out of scope"
    assert_no_side_effects(fake_clickup, fake_ecs)
    assert len(task_get_calls(fake_clickup)) == 1


def test_created_task_defers_tag_resolution_to_the_async_worker(
    fake_clickup, fake_ecs, fake_lambda, ecs_env, self_invoke_env
):
    # Fast-ack must stay fast: resolving the tag needs a ClickUp round trip, so
    # it belongs in the worker, not on the path ClickUp is waiting on. The
    # payload says "resolve it" rather than carrying a null tag, so the worker's
    # fail-loud check on an unknown matched_tag keeps its teeth.
    fake_clickup.task_response = {
        "custom_id": "ENG-10891",
        "list": {"id": "901321761872", "name": "Bugs"},
        "tags": [{"name": "gpbot-analyze"}],
    }
    event = make_event(created_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["status"] == "accepted"
    assert response_body(resp)["label"] == "unresolved"
    payload = fake_lambda.invoke_payloads[0]
    assert payload["resolve_tag_from_task"] is True
    assert "matched_tag" not in payload
    assert task_get_calls(fake_clickup) == []
    assert fake_ecs.run_task_calls == []

    # The worker then does the lookup and launches.
    worker_resp = handler.handler(payload, None)

    assert worker_resp["statusCode"] == 200
    assert len(fake_ecs.run_task_calls) == 1


def test_async_resolve_payload_without_task_id_is_refused(fake_clickup, fake_ecs, ecs_env, capsys):
    resp = handler.handler({"gpbot_async": True, "resolve_tag_from_task": True}, None)

    assert resp["statusCode"] == 400
    assert_no_side_effects(fake_clickup, fake_ecs)
    assert_alarm_log_emitted(capsys)


@pytest.mark.parametrize(
    "task",
    [
        None,
        "not-a-dict",
        {},
        {"tags": None},
        {"tags": "gpbot-analyze"},
        {"tags": [None, "gpbot-analyze"]},
        {"tags": [{"name": None}]},
        {"tags": [{"name": "needs-grooming"}]},
    ],
)
def test_find_task_tag_fails_closed_on_unusable_shapes(task):
    # Mirror of out_of_scope_reason's shape defensiveness, but failing the other
    # way: no readable tag means no run. Coercing a drifted shape into a match
    # would launch an agent — or open a PR — off a response nobody can parse.
    assert handler.find_task_tag(task) is None


def test_find_task_tag_matches_case_insensitively():
    assert handler.find_task_tag({"tags": [{"name": "GPBot-Analyze"}]}) == "gpbot-analyze"


# ---------------------------------------------------------------------------
# 4. Missing task_id
# ---------------------------------------------------------------------------


def test_missing_task_id_returns_400(fake_clickup, fake_ecs, ecs_env):
    event = make_event(tag_updated_body(task_id=None))

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 400
    assert fake_ecs.run_task_calls == []
    assert fake_clickup.posted_comments == []


# ---------------------------------------------------------------------------
# 5. Non-gpbot tags are skipped
# ---------------------------------------------------------------------------


def test_non_gpbot_tag_returns_200_without_side_effects(fake_clickup, fake_ecs, ecs_env):
    event = make_event(tag_updated_body(tags=("needs-grooming",)))

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert_no_side_effects(fake_clickup, fake_ecs)


# ---------------------------------------------------------------------------
# 6. tag_removed entries never trigger
# ---------------------------------------------------------------------------


def test_tag_removed_entry_never_triggers(fake_clickup, fake_ecs, ecs_env):
    history_items = [{"field": "tag_removed", "after": [{"name": "gpbot-analyze"}]}]
    event = make_event(tag_updated_body(history_items=history_items))

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert_no_side_effects(fake_clickup, fake_ecs)


# ---------------------------------------------------------------------------
# 7. gpbot-analyze launches the Fargate engineer agent
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("tag_name", ["gpbot-analyze", "GPBot-Analyze"])
def test_gpbot_analyze_launches_fargate_task(fake_clickup, fake_ecs, ecs_env, tag_name):
    event = make_event(tag_updated_body(tags=(tag_name,)))

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN

    # Exactly one processing-started comment on the ClickUp task.
    assert len(fake_clickup.posted_comments) == 1
    comment = fake_clickup.posted_comments[0]
    assert comment["comment_text"].startswith("[GP-Bot] Processing started")
    assert "analyze" in comment["comment_text"]
    assert "opus" in comment["comment_text"]
    assert comment["notify_all"] is False

    # Exactly one Fargate launch with the configured infrastructure.
    assert len(fake_ecs.run_task_calls) == 1
    kwargs = fake_ecs.run_task_calls[0]
    assert kwargs["cluster"] == ECS_ENV["ECS_CLUSTER_ARN"]
    assert kwargs["taskDefinition"] == ECS_ENV["ECS_TASK_DEFINITION"]
    assert kwargs["launchType"] == "FARGATE"

    container_env = engineer_agent_env(kwargs)
    assert container_env["CLICKUP_TASK_ID"] == "abc123"
    assert container_env["AGENT_MODEL"] == "opus"
    # The INSTRUCTION content IS the behavioral difference between the two
    # tags: gpbot-analyze must ship the analyze contract, not the implement one.
    assert "Analyze and Report" in container_env["INSTRUCTION"]
    assert "Implement and Create PR" not in container_env["INSTRUCTION"]
    # Repo guidance (omni monorepo / archived repos) is deliberately NOT in the
    # INSTRUCTION: it is single-sourced in the agent's capability prompt and
    # pinned by engineer_agent/tests/test_config.py.

    vpc_config = kwargs["networkConfiguration"]["awsvpcConfiguration"]
    assert vpc_config["subnets"] == ["subnet-aaa111", "subnet-bbb222"]
    assert vpc_config["securityGroups"] == ["sg-0123456789"]

    assert {"key": "Project", "value": "clickup-bot"} in kwargs["tags"]


# ---------------------------------------------------------------------------
# 8. gpbot-work launches with an "implement" comment
# ---------------------------------------------------------------------------


def test_gpbot_work_launches_with_implement_comment(fake_clickup, fake_ecs, ecs_env):
    event = make_event(tag_updated_body(tags=("gpbot-work",)))

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN

    assert len(fake_clickup.posted_comments) == 1
    comment = fake_clickup.posted_comments[0]
    assert comment["comment_text"].startswith("[GP-Bot] Processing started")
    assert "implement" in comment["comment_text"]

    assert len(fake_ecs.run_task_calls) == 1
    kwargs = fake_ecs.run_task_calls[0]
    assert kwargs["cluster"] == ECS_ENV["ECS_CLUSTER_ARN"]
    assert kwargs["taskDefinition"] == ECS_ENV["ECS_TASK_DEFINITION"]
    assert kwargs["launchType"] == "FARGATE"

    container_env = engineer_agent_env(kwargs)
    assert container_env["CLICKUP_TASK_ID"] == "abc123"
    assert container_env["AGENT_MODEL"] == "opus"
    # gpbot-work must ship the implement contract (PR + branch naming), and
    # must NOT receive the analyze instruction.
    assert "Implement and Create PR" in container_env["INSTRUCTION"]
    assert "gp-bot_" in container_env["INSTRUCTION"]
    assert "Analyze and Report" not in container_env["INSTRUCTION"]
    # Repo guidance (omni/archived) lives in the agent's capability prompt
    # (engineer_agent/agent/config.py — pinned by engineer_agent/tests), NOT
    # here: single source. The implement contract must drive every change
    # with a failing test first (red/green TDD)...
    assert "failing test" in container_env["INSTRUCTION"]
    # ...and self-review the finished diff against the repo's ai-rules files
    # before opening the PR.
    assert "ai-rules" in container_env["INSTRUCTION"]


# ---------------------------------------------------------------------------
# 9. Existing [GP-Bot] comment means already processed -> skip
# ---------------------------------------------------------------------------


def test_existing_gpbot_comment_skips_processing(fake_clickup, fake_ecs, ecs_env):
    # Fixture is the REAL API shape (no "type" key on comment items). During the
    # 2026-07-14 incident the matcher required item["type"] == "text" and so
    # matched 0 of 13 real comments — including 6 of the bot's own ack comments —
    # letting one retried webhook delivery launch 6 Fargate agents.
    fake_clickup.comments_response = existing_gpbot_comment_response()
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert fake_ecs.run_task_calls == []
    assert fake_clickup.posted_comments == []


def test_dedup_matches_via_item_concatenation_when_comment_text_absent(fake_clickup, fake_ecs, ecs_env):
    # Defensive fallback: if ClickUp ever omits the top-level comment_text, the
    # matcher must derive the text by concatenating item["text"] WITHOUT
    # filtering on a "type" key the real API does not send.
    fake_clickup.comments_response = existing_gpbot_comment_response(include_comment_text=False)
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert fake_ecs.run_task_calls == []
    assert fake_clickup.posted_comments == []


def test_dedup_tolerates_type_keyed_items_forward_compat(fake_clickup, fake_ecs, ecs_env):
    # Forward-compat: if ClickUp ever ADDS a "type" key to comment items, its
    # presence must not break the matcher either.
    fake_clickup.comments_response = existing_gpbot_comment_response(include_comment_text=False, with_type_key=True)
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert fake_ecs.run_task_calls == []
    assert fake_clickup.posted_comments == []


def test_null_text_item_neither_crashes_dedup_nor_hides_the_marker():
    # ClickUp can ship "text": null on a comment item (JSON null survives
    # item.get("text", "") — the default only covers a MISSING key). The
    # fallback's "".join() then raised TypeError, crashing the whole dedup
    # check mid-webhook. A null item must contribute "" — NOT the string
    # "None" (str-wrapping alone would prepend "None" to the concatenation
    # and silently break the marker prefix match, which this test would
    # catch as a False). So this single assertion pins both contracts:
    # no crash, and null items are invisible to the matcher.
    comments = [
        {
            "id": "90130291038679",
            "comment": [
                {"text": None},
                {"text": "[GP-Bot] Processing started (analyze, model: opus)..."},
            ],
            "user": {"id": 105985359, "username": "Collin Park"},
            "date": epoch_ms_str(PINNED_NOW, 30),
            "reply_count": 0,
        }
    ]
    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is True


def test_non_string_comment_text_neither_crashes_nor_hides_the_marker():
    # ClickUp's top-level comment_text is attacker-of-drift territory: only a
    # null has been observed, but a non-string (int, list, dict) must not
    # crash .startswith() mid-webhook. Anything that isn't a str must fall
    # through to the item-concatenation fallback — which here carries the
    # marker, so the matcher must still block.
    text = "[GP-Bot] Processing started (analyze, model: opus)..."
    comments = [
        {
            "id": "90130291038679",
            "comment_text": 123,
            "comment": [{"text": text}],
            "date": epoch_ms_str(PINNED_NOW, 30),
            "reply_count": 0,
        }
    ]
    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is True


def test_empty_comment_text_falls_through_to_item_concatenation():
    # An empty top-level comment_text carries no information — treating it as
    # authoritative would hide a marker that only lives in the comment[] items.
    # "" must fall through to the fallback, converging with the shared
    # get_text() twin's truthiness semantics (shared/clickup_client.py).
    text = "[GP-Bot] Processing started (analyze, model: opus)..."
    comments = [
        {
            "id": "90130291038679",
            "comment_text": "",
            "comment": [{"text": text}],
            "date": epoch_ms_str(PINNED_NOW, 30),
            "reply_count": 0,
        }
    ]
    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is True


def test_non_string_item_text_contributes_empty_not_str_wrapped():
    # ANY non-string item text (not just null) must contribute "" to the
    # concatenation: str-wrapping 0 to "0" would prepend garbage ahead of the
    # marker and silently break the prefix match — this test fails as False
    # if the fallback ever str()-wraps instead of dropping.
    comments = [
        {
            "id": "90130291038679",
            "comment": [
                {"text": 0},
                {"text": "[GP-Bot] Processing started (analyze, model: opus)..."},
            ],
            "date": epoch_ms_str(PINNED_NOW, 30),
            "reply_count": 0,
        }
    ]
    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is True


def test_recent_analyze_marker_does_not_block_gpbot_work(fake_clickup, fake_ecs, ecs_env):
    # LABEL SCOPE: dedup is per (task, label), mirroring the atomic layer's
    # {task_id}#{label} key. A fresh gpbot-analyze ack marker must NOT
    # suppress a gpbot-work trigger on the same task — analyze-then-implement
    # within 15 minutes is the normal workflow, not a duplicate.
    fake_clickup.comments_response = existing_gpbot_comment_response()  # analyze marker, 30s old
    event = make_event(tag_updated_body(tags=("gpbot-work",)))

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1


def test_recent_same_label_marker_still_blocks_at_unit_level():
    # The label-scoped prefix must still match its OWN label's marker.
    comments = processing_started_comments(epoch_ms_str(PINNED_NOW, 30))
    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is True
    assert handler.has_processing_started_comment(comments, "implement", now=PINNED_NOW) is False


# ---------------------------------------------------------------------------
# 9b. Dedup recency window: a "Processing started" marker only blocks while it
# is RECENT (DEDUP_COMMENT_WINDOW_SECONDS, default 900). The marker exists to
# absorb webhook retry storms and double-tags (seconds-to-minutes); a human
# re-tagging a task hours later to deliberately re-run must not be silently
# ignored. (Dedup never actually fired before the 2026-07-14 fix, so
# "re-tag always re-runs" is the behavior users know; an unbounded marker
# would silently change it.)
# ---------------------------------------------------------------------------

PINNED_NOW = 1784040000.0  # arbitrary fixed epoch so boundary math is exact


def processing_started_comments(date_value) -> list[dict]:
    """Real-shape comment list whose marker carries an explicit raw date value."""
    text = "[GP-Bot] Processing started (analyze, model: opus)..."
    comment = {
        "id": "90130291038679",
        "comment": [{"text": text}],
        "comment_text": text,
        "user": {"id": 105985359, "username": "Collin Park"},
        "reply_count": 0,
    }
    if date_value is not None:
        comment["date"] = date_value
    return [comment]


def epoch_ms_str(now: float, age_seconds: float) -> str:
    return str(int((now - age_seconds) * 1000))


def test_marker_899s_old_blocks_at_default_window():
    comments = processing_started_comments(epoch_ms_str(PINNED_NOW, 899))
    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is True


def test_marker_901s_old_does_not_block_at_default_window():
    comments = processing_started_comments(epoch_ms_str(PINNED_NOW, 901))
    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is False


def test_marker_with_missing_date_does_not_block_and_alarms(capsys):
    # An undatable marker must NOT block: blocking would have no age bound, so
    # a ClickUp date-format drift would silently and permanently disable
    # re-tag re-runs. Failing toward duplicate risk is bounded (the atomic
    # DynamoDB layer still guards duplicates), and the shape drift is an
    # integration break an operator must see — the line is alarm-matching.
    comments = processing_started_comments(None)
    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is False
    out = assert_alarm_log_emitted(capsys)
    assert "date unparseable" in out


def test_marker_with_unparseable_date_does_not_block_and_alarms(capsys):
    comments = processing_started_comments("not-a-number")
    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is False
    out = assert_alarm_log_emitted(capsys)
    assert "date unparseable" in out


def test_marker_59s_in_the_future_still_blocks_within_skew_tolerance():
    # Sub-minute NEGATIVE ages are expected in normal operation: the age is
    # OUR clock minus CLICKUP's clock, so the bot's own just-posted ack read
    # back through a ClickUp server whose clock runs slightly ahead shows up
    # seconds "in the future". That marker is the exact retry-storm marker the
    # dedup window exists for — it MUST still block.
    comments = processing_started_comments(epoch_ms_str(PINNED_NOW, -59))
    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is True


def test_marker_exactly_at_skew_tolerance_boundary_blocks():
    # Boundary is inclusive: age == -CLOCK_SKEW_TOLERANCE_SECONDS still blocks.
    comments = processing_started_comments(epoch_ms_str(PINNED_NOW, -60))
    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is True


def test_marker_61s_in_the_future_does_not_block_and_alarms(capsys):
    # Beyond the skew tolerance the date is clock/shape drift, and the window
    # cannot be evaluated. Before the skew guard, ANY future date made
    # age_seconds negative and `age <= window` trivially True — drift would
    # BLOCK re-triggering for skew+window, inverting the documented
    # fail-toward-not-blocking posture of every other undatable-marker case.
    # Like the unparseable-date case, this is an integration break an operator
    # must see: the line is alarm-matching.
    comments = processing_started_comments(epoch_ms_str(PINNED_NOW, -61))
    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is False
    out = assert_alarm_log_emitted(capsys)
    assert "date is in the future" in out


@pytest.mark.parametrize("bad_value", ["nan", "inf", "-inf", "0", "-60", "junk"])
def test_non_finite_or_non_positive_window_falls_back_to_default_quietly(monkeypatch, capsys, bad_value):
    # float() happily parses 'nan'/'inf'/'-inf', which escape a bare
    # ValueError guard: NaN comparisons are always False (window silently
    # disabled) and inf breaks later arithmetic. Any non-finite or
    # non-positive value must fall back to the default with the existing
    # quiet (non-alarm) line — this runs in-path on every dedup check.
    monkeypatch.setenv("DEDUP_COMMENT_WINDOW_SECONDS", bad_value)

    assert handler.get_dedup_window_seconds() == handler.DEFAULT_DEDUP_COMMENT_WINDOW_SECONDS

    out = assert_no_alarm_log_emitted(capsys)
    assert "Invalid DEDUP_COMMENT_WINDOW_SECONDS" in out


def test_window_is_configurable_via_env(monkeypatch):
    monkeypatch.setenv("DEDUP_COMMENT_WINDOW_SECONDS", "60")
    recent = processing_started_comments(epoch_ms_str(PINNED_NOW, 30))
    stale = processing_started_comments(epoch_ms_str(PINNED_NOW, 120))
    assert handler.has_processing_started_comment(recent, "analyze", now=PINNED_NOW) is True
    assert handler.has_processing_started_comment(stale, "analyze", now=PINNED_NOW) is False


def incident_shaped_comments(marker_ages_seconds: list[float], now: float) -> list[dict]:
    """Comment list mirroring the REAL captured DATA-2108 incident payload
    (13 comments): one human comment whose items carry "type": "tag" user
    mentions and "attributes", six non-marker bot analysis comments, and six
    'Processing started' markers — newest first, string epoch-ms dates, no
    "type" key on plain text items. Marker ages are injectable so tests can
    place them inside/outside the dedup window.
    """
    marker_text = "[GP-Bot] Processing started (analyze, model: opus)..."
    comments: list[dict] = [
        {
            "id": "90130291057993",
            "comment": [
                {"type": "tag", "user": {"id": 105985351, "username": "Hugh Karimi"}, "text": "@Hugh Karimi"},
                {
                    "text": " BR's data is out of date here. Anything you need before you can escalate?",
                    "attributes": {},
                },
                {"text": "\n", "attributes": {"block-id": "block-42H9Q2cBDM"}},
            ],
            "comment_text": "@Hugh Karimi BR's data is out of date here. Anything you need before you can escalate?\n",
            "user": {"id": 111932291, "username": "Chadwyck"},
            "date": epoch_ms_str(now, 10),
            "reply_count": 0,
        }
    ]
    analysis_texts = [
        "[GP-Bot] Analysis\n\n## Reproduction / verified facts\n- Confirmed the customer-reported 83k voter count",
        "[GP-Bot] Analysis — reproduces the report, root cause is upstream data",
        "[GP-Bot] Analysis\n\n**Reproduced.** The 83k voter count is real",
        "[GP-Bot] **Analysis — DATA-2108 / Montebello Unified School Board**",
        "[GP-Bot] Re-verified — findings unchanged from prior investigation",
        "[GP-Bot] Investigation summary — Montebello USD school-board race",
    ]
    for i, text in enumerate(analysis_texts):
        comments.append(
            {
                "id": f"9013029104{i:04d}",
                "comment": [{"text": text}],
                "comment_text": text,
                "user": {"id": 105985359, "username": "Collin Park"},
                "date": epoch_ms_str(now, 60 + i),
                "reply_count": 0,
            }
        )
    for i, age in enumerate(marker_ages_seconds):
        comments.append(
            {
                "id": f"9013029105{i:04d}",
                "comment": [{"text": marker_text}],
                "comment_text": marker_text,
                "user": {"id": 105985359, "username": "Collin Park"},
                "date": epoch_ms_str(now, age),
                "reply_count": 0,
            }
        )
    return comments


def test_incident_payload_recent_same_label_marker_blocks():
    # Realistic 13-comment payload (real captured incident shape): human
    # comment, six bot analyses, six markers — one marker inside the window.
    # The matcher must pick the marker out of the noise and block analyze,
    # while implement (different label) stays unblocked.
    ages = [30.0, 200.0, 400.0, 1000.0, 2000.0, 3600.0]
    comments = incident_shaped_comments(ages, PINNED_NOW)

    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is True
    assert handler.has_processing_started_comment(comments, "implement", now=PINNED_NOW) is False


def test_incident_payload_only_stale_markers_do_not_block():
    # All six markers older than the window: analysis comments and the human
    # comment must not be mistaken for markers, so nothing blocks.
    ages = [1000.0, 1200.0, 1800.0, 2400.0, 3000.0, 3600.0]
    comments = incident_shaped_comments(ages, PINNED_NOW)

    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is False


def test_ack_comment_mentions_retag_cooldown(fake_clickup, fake_ecs, ecs_env):
    # UX: a deliberate re-tag inside the dedup window is suppressed with zero
    # feedback — the ack comment is the only place users can learn the
    # cooldown exists. The number derives from the configured window.
    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 200
    ack = next(t for t in fake_clickup.posted_comment_texts if t.startswith("[GP-Bot] Processing started"))
    assert "(re-tag after 15 minutes to re-run)" in ack


def test_ack_cooldown_minutes_derive_from_configured_window(fake_clickup, fake_ecs, ecs_env, monkeypatch):
    monkeypatch.setenv("DEDUP_COMMENT_WINDOW_SECONDS", "600")

    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 200
    ack = next(t for t in fake_clickup.posted_comment_texts if t.startswith("[GP-Bot] Processing started"))
    assert "(re-tag after 10 minutes to re-run)" in ack


def test_ack_cooldown_minutes_round_up_never_understate(fake_clickup, fake_ecs, ecs_env, monkeypatch):
    # The hint must never promise an earlier re-run than the window enforces:
    # round(89/60) would say "1 minute" while the marker still blocks at 89s.
    # Ceil is the only rounding that keeps the promise honest.
    monkeypatch.setenv("DEDUP_COMMENT_WINDOW_SECONDS", "89")

    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 200
    ack = next(t for t in fake_clickup.posted_comment_texts if t.startswith("[GP-Bot] Processing started"))
    assert "(re-tag after 2 minutes to re-run)" in ack


def test_full_ack_text_with_suffix_matches_label_scoped_matcher(fake_clickup, fake_ecs, ecs_env):
    # Round-trip: the exact text the handler posts (including the cooldown
    # suffix) must still be recognized by the dedup matcher — the matcher
    # matches the label-scoped PREFIX, so appending is safe. This test breaks
    # if anyone ever inserts text between the label and the prefix.
    handler.handler(make_event(tag_updated_body()), None)
    ack_text = next(t for t in fake_clickup.posted_comment_texts if t.startswith("[GP-Bot] Processing started"))

    comments = [
        {
            "id": "90130291038679",
            "comment": [{"text": ack_text}],
            "comment_text": ack_text,
            "date": epoch_ms_str(PINNED_NOW, 30),
            "reply_count": 0,
        }
    ]
    assert handler.has_processing_started_comment(comments, "analyze", now=PINNED_NOW) is True
    assert handler.has_processing_started_comment(comments, "implement", now=PINNED_NOW) is False


def test_stale_marker_allows_deliberate_re_tag_to_retrigger(fake_clickup, fake_ecs, ecs_env):
    # Handler-level: a marker from hours ago must NOT block a fresh tag event —
    # a human re-tagging later is a deliberate re-run, not a retry storm.
    fake_clickup.comments_response = existing_gpbot_comment_response(age_seconds=3600)
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1


# ---------------------------------------------------------------------------
# 9c. Fast-ack via async self-invoke. ClickUp's webhook delivery has a short
# response timeout; in the 2026-07-14 incident every invocation ran 7.6-20.5s
# of serial ClickUp API calls, every delivery timed out, and ClickUp retried
# one event 5x (6 Fargate launches) while counting each timeout toward the
# ~100 consecutive failures that auto-disable the webhook. The handler must
# therefore 200 BEFORE any ClickUp API call: it self-invokes asynchronously
# and the worker invocation does dedup + trigger + ack off the critical path.
# Until the self-invoke IAM lands (separate terraform PR), the invoke fails
# and the handler must fall back to exactly the old synchronous flow.
# ---------------------------------------------------------------------------


def test_fast_ack_returns_accepted_and_self_invokes(fake_clickup, fake_ecs, fake_lambda, ecs_env, self_invoke_env):
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["status"] == "accepted"
    # Exactly one async self-invoke carrying the validated work item.
    assert len(fake_lambda.invoke_calls) == 1
    call = fake_lambda.invoke_calls[0]
    assert call["FunctionName"] == self_invoke_env
    assert call["InvocationType"] == "Event"
    assert fake_lambda.invoke_payloads[0] == {
        "gpbot_async": True,
        "task_id": "abc123",
        "matched_tag": "gpbot-analyze",
    }
    # THE point of fast-ack: zero ClickUp API calls and zero ECS calls in-path.
    assert fake_clickup.calls == []
    assert fake_ecs.run_task_calls == []


def test_missing_function_name_env_falls_back_to_sync_quietly(fake_clickup, fake_ecs, fake_lambda, ecs_env, capsys):
    # clean_self_invoke_env (autouse) removed AWS_LAMBDA_FUNCTION_NAME: the
    # handler must not attempt an invoke and must run the full synchronous
    # flow, logging only a quiet (non-alarm) line about the fallback.
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert fake_lambda.invoke_calls == []
    assert len(fake_ecs.run_task_calls) == 1
    assert any(text.startswith("[GP-Bot] Processing started") for text in fake_clickup.posted_comment_texts)
    out = assert_no_alarm_log_emitted(capsys)
    assert "Async self-invoke unavailable" in out


def make_invoke_client_error(code: str, message: str = "denied") -> ClientError:
    """Real botocore ClientError shape for lambda.invoke failures."""
    return ClientError({"Error": {"Code": code, "Message": message}}, "Invoke")


def test_invoke_access_denied_falls_back_to_full_sync_flow(
    fake_clickup, fake_ecs, fake_lambda, ecs_env, self_invoke_env, capsys
):
    # Initial prod state: the self-invoke IAM permission ships in a later
    # terraform PR, so lambda:InvokeFunction is denied. AccessDenied is a
    # DETERMINISTIC "the Event was NOT accepted" rejection, so the fallback
    # must preserve exactly today's synchronous behavior (dedup GET +
    # run_task + ack) and the fallback itself must NOT fire the alarm — it
    # is expected on every delivery until the IAM lands.
    fake_lambda.exception = make_invoke_client_error(
        "AccessDeniedException", "not authorized to perform lambda:InvokeFunction"
    )
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_lambda.invoke_calls) == 1
    # Dedup GET ran...
    assert any(method == "GET" and "/comment" in url for method, url, _ in fake_clickup.calls)
    # ...the task launched, and the ack comment was posted.
    assert len(fake_ecs.run_task_calls) == 1
    assert any(text.startswith("[GP-Bot] Processing started") for text in fake_clickup.posted_comment_texts)
    assert_no_alarm_log_emitted(capsys)


def test_deterministic_invoke_rejection_with_alarm_terms_in_message_stays_quiet(
    fake_clickup, fake_ecs, fake_lambda, ecs_env, self_invoke_env, capsys
):
    # The sync-fallback line fires on EVERY delivery until the self-invoke IAM
    # lands, and raw botocore messages can contain alarm-filter terms — e.g.
    # "Failed to connect to endpoint". Echoing the message would fire the
    # fail-loud alarm on every single delivery of the initial prod state.
    # Only the exception type / error code may be logged (same pattern as the
    # ack first-failure line).
    fake_lambda.exception = make_invoke_client_error("AccessDeniedException", "ERROR: Failed to invoke lambda")
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    out = assert_no_alarm_log_emitted(capsys)
    assert "Async self-invoke unavailable" in out
    assert "AccessDeniedException" in out


def test_ambiguous_invoke_read_timeout_returns_500_without_sync_processing(
    fake_clickup, fake_ecs, fake_lambda, ecs_env, self_invoke_env, capsys
):
    # DOUBLE-LAUNCH GUARD: an async Event invoke can fail CLIENT-side after
    # being accepted SERVER-side (read timeout, dropped connection) — the
    # worker may already be queued. Falling back would then run BOTH the
    # worker and the inline path for one delivery. Ambiguous failures must
    # NOT fall back: 500 (ClickUp redelivers; the dedup layers absorb the
    # possible duplicate worker), zero ClickUp API calls, zero ECS launches,
    # and an alarm-matching line — this is a genuine failure, unlike the
    # expected deterministic rejection above.
    fake_lambda.exception = ReadTimeoutError(endpoint_url="https://lambda.us-west-2.amazonaws.com/")
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 500
    assert fake_clickup.calls == []
    assert fake_ecs.run_task_calls == []
    out = assert_alarm_log_emitted(capsys)
    assert "Failed to enqueue async processing: ReadTimeoutError" in out
    # Type only, never the raw message (the endpoint URL adds nothing and raw
    # botocore messages are what the quiet deterministic path guards against).
    assert "lambda.us-west-2.amazonaws.com" not in out


@pytest.mark.parametrize(
    "code",
    [
        "AccessDeniedException",
        "ResourceNotFoundException",
        "InvalidParameterValueException",
        "UnrecognizedClientException",
    ],
)
def test_enqueue_returns_fallback_for_deterministic_rejection_codes(fake_lambda, self_invoke_env, code):
    # Unit pin of the determinism split: these codes mean the control plane
    # REFUSED the Event (never queued), so inline processing cannot double-run.
    fake_lambda.exception = make_invoke_client_error(code)
    assert handler.enqueue_async_processing("abc123", "gpbot-analyze") == "fallback"


@pytest.mark.parametrize(
    "exception",
    [
        make_invoke_client_error("TooManyRequestsException", "Rate exceeded"),  # throttle: retry may have landed
        make_invoke_client_error("ServiceException", "internal error"),  # unknown code: can't prove not-queued
        ReadTimeoutError(endpoint_url="https://lambda.us-west-2.amazonaws.com/"),
        ConnectionResetError("connection reset by peer"),
    ],
)
def test_enqueue_returns_ambiguous_for_everything_else(fake_lambda, self_invoke_env, capsys, exception):
    # Any failure that cannot PROVE the Event was rejected is ambiguous — the
    # invoke may have been accepted server-side before the client gave up.
    fake_lambda.exception = exception
    assert handler.enqueue_async_processing("abc123", "gpbot-analyze") == "ambiguous"
    assert_alarm_log_emitted(capsys)


def test_enqueue_returns_accepted_on_success(fake_lambda, self_invoke_env):
    assert handler.enqueue_async_processing("abc123", "gpbot-analyze") == "accepted"


def test_enqueue_returns_fallback_when_function_name_missing(fake_lambda):
    # clean_self_invoke_env (autouse) removed AWS_LAMBDA_FUNCTION_NAME:
    # deterministic — no invoke was even attempted, nothing can be queued.
    assert handler.enqueue_async_processing("abc123", "gpbot-analyze") == "fallback"
    assert fake_lambda.invoke_calls == []


def test_boto3_clients_are_cached_across_invocations(
    fake_clickup, fake_ecs, fake_lambda, boto3_factory, ecs_env, self_invoke_env
):
    # boto3.client() re-runs endpoint resolution and session wiring on every
    # call — in-path latency against the fast-ack promise of an instant 200.
    # Each service client must be constructed once per execution environment
    # and reused across invocations (warm Lambda containers).
    handler.handler(make_event(tag_updated_body()), None)
    handler.handler(make_event(tag_updated_body()), None)

    assert boto3_factory.requested_services.count("lambda") == 1


def test_ecs_client_is_cached_across_invocations(fake_clickup, fake_ecs, boto3_factory, ecs_env):
    # Same caching contract for the ECS client used by the sync fallback /
    # async worker.
    handler.handler(make_event(tag_updated_body()), None)
    handler.handler(make_event(tag_updated_body()), None)

    assert boto3_factory.requested_services.count("ecs") == 1


def test_lambda_client_uses_fast_ack_timeouts(fake_clickup, fake_ecs, boto3_factory, ecs_env, self_invoke_env):
    # botocore defaults are 60s connect + 60s read with retries: a hung Lambda
    # control plane would blow ClickUp's whole webhook timeout in-path. The
    # fast-ack budget demands tight timeouts and a single attempt — a provable
    # rejection takes the quiet sync fallback, anything ambiguous 500s so
    # ClickUp redelivers (no inline double-run). total_max_attempts, NOT
    # max_attempts: legacy-mode botocore reads max_attempts as retries AFTER
    # the initial call, so {"max_attempts": 1} silently means 2 attempts (see
    # test_lambda_client_config_resolves_to_a_single_total_attempt).
    handler.handler(make_event(tag_updated_body()), None)

    lambda_calls = [kwargs for service, kwargs in boto3_factory.client_calls if service == "lambda"]
    assert len(lambda_calls) == 1
    config = lambda_calls[0]["config"]
    assert config.connect_timeout == 2
    assert config.read_timeout == 5
    assert config.retries == {"total_max_attempts": 1}


def test_lambda_client_config_resolves_to_a_single_total_attempt():
    # BEHAVIORAL, not just a dict pin: build a REAL botocore client from the
    # handler's constant and assert the RESOLVED retry budget. botocore's
    # legacy mode normalizes retries into {"total_max_attempts": N, "mode":
    # "legacy"} where N counts the initial call — the previous
    # {"max_attempts": 1} config resolved to total_max_attempts=2 (one full
    # SDK retry on the fast-ack path), which this test would have caught.
    # The fakes intercept boto3.client (not the transport), so the module-
    # level boto3.session path below deliberately bypasses the patched
    # boto3.client to reach real botocore config resolution. No network I/O:
    # client construction only resolves endpoints/config locally.
    import boto3.session

    real_client = boto3.session.Session(
        region_name="us-west-2",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
    ).client("lambda", config=handler.LAMBDA_CLIENT_CONFIG)

    assert real_client.meta.config.retries["total_max_attempts"] == 1


def test_dynamodb_client_is_cached_across_invocations(
    fake_clickup, fake_ecs, fake_dynamodb, boto3_factory, ecs_env, dedup_table_env
):
    # Same caching contract for the DynamoDB client used by the atomic dedup
    # claim: in the sync fallback (the initial prod state) the conditional
    # PutItem sits inside ClickUp's webhook timeout budget, so per-call
    # boto3.client() endpoint resolution is in-path latency there too.
    handler.handler(make_event(tag_updated_body()), None)
    handler.handler(make_event(tag_updated_body()), None)

    assert boto3_factory.requested_services.count("dynamodb") == 1


def test_dynamodb_client_uses_fast_path_timeouts(
    fake_clickup, fake_ecs, fake_dynamodb, boto3_factory, ecs_env, dedup_table_env
):
    # botocore defaults (60s connect + 60s read, with retries) on the dedup
    # PutItem could blow ClickUp's webhook timeout in the sync fallback — the
    # same fast-path budget as the self-invoke call. Tight timeouts, single
    # attempt: a timeout lands in try_acquire_dedup_lock's existing fail-open.
    # total_max_attempts, NOT max_attempts — legacy-mode botocore reads
    # max_attempts as retries AFTER the initial call (see
    # test_dynamodb_client_config_resolves_to_a_single_total_attempt).
    handler.handler(make_event(tag_updated_body()), None)

    dynamodb_calls = [kwargs for service, kwargs in boto3_factory.client_calls if service == "dynamodb"]
    assert len(dynamodb_calls) == 1
    config = dynamodb_calls[0]["config"]
    assert config.connect_timeout == 2
    assert config.read_timeout == 5
    assert config.retries == {"total_max_attempts": 1}


def test_dynamodb_client_config_resolves_to_a_single_total_attempt():
    # Same resolved-config contract as the lambda client (see
    # test_lambda_client_config_resolves_to_a_single_total_attempt for the
    # legacy-mode max_attempts trap this guards against): the dedup PutItem
    # must make exactly ONE attempt — an SDK retry after an ambiguous failure
    # would double the fast-path budget, and the fail-open handling already
    # owns the failure. Real botocore client; no network I/O.
    import boto3.session

    real_client = boto3.session.Session(
        region_name="us-west-2",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
    ).client("dynamodb", config=handler.DYNAMODB_CLIENT_CONFIG)

    assert real_client.meta.config.retries["total_max_attempts"] == 1


def test_ecs_client_uses_single_attempt_run_task_budget(fake_clickup, fake_ecs, boto3_factory, ecs_env):
    # RunTask has NO idempotency token: an SDK retry after an ambiguous
    # failure (read timeout with the request already accepted server-side)
    # can double-launch Fargate INSIDE one dedup claim — the exact class of
    # duplicate the claim exists to prevent, invisible to both dedup layers.
    # botocore defaults (60s timeouts, ~5 legacy attempts) must never apply:
    # bounded timeouts, exactly one attempt. A genuine failure already fails
    # loud (failure comment + re-tag retry path).
    handler.handler(make_event(tag_updated_body()), None)

    ecs_calls = [kwargs for service, kwargs in boto3_factory.client_calls if service == "ecs"]
    assert len(ecs_calls) == 1
    config = ecs_calls[0]["config"]
    assert config.connect_timeout == 5
    assert config.read_timeout == 30
    assert config.retries == {"total_max_attempts": 1}


def test_async_event_runs_dedup_and_triggers(fake_clickup, fake_ecs, fake_lambda, ecs_env):
    event = {"gpbot_async": True, "task_id": "abc123", "matched_tag": "gpbot-analyze"}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    # The worker owns the ClickUp work: dedup GET, launch, ack comment.
    assert any(method == "GET" and "/comment" in url for method, url, _ in fake_clickup.calls)
    assert len(fake_ecs.run_task_calls) == 1
    assert any(text.startswith("[GP-Bot] Processing started") for text in fake_clickup.posted_comment_texts)
    # The worker must not re-enqueue itself.
    assert fake_lambda.invoke_calls == []


def test_async_event_with_recent_marker_skips(fake_clickup, fake_ecs, ecs_env):
    # The retry-storm case the whole design exists for: a duplicate delivery's
    # worker sees the first worker's recent ack comment and stops.
    fake_clickup.comments_response = existing_gpbot_comment_response()
    event = {"gpbot_async": True, "task_id": "abc123", "matched_tag": "gpbot-analyze"}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp) == {"skipped": "already processed"}
    assert fake_ecs.run_task_calls == []
    assert fake_clickup.posted_comments == []


def test_async_worker_exception_returns_dict_and_alarms(fake_clickup, fake_ecs, ecs_env, monkeypatch, capsys):
    # An unhandled exception in an async ("Event") invocation makes Lambda
    # auto-RETRY it — recreating exactly the duplicate-launch bug this design
    # fixes. The worker must ALWAYS return a dict; the alarm-matching ERROR
    # log is the only fail-loud channel (nobody receives an HTTP error), and
    # a best-effort failure comment tells the tagger.
    def explode(task_id, matched_tag):
        raise RuntimeError("unexpected worker crash")

    monkeypatch.setattr(handler, "dedup_check_then_trigger", explode)
    event = {"gpbot_async": True, "task_id": "abc123", "matched_tag": "gpbot-analyze"}

    resp = handler.handler(event, None)

    assert isinstance(resp, dict)
    assert resp["statusCode"] == 500
    out = assert_alarm_log_emitted(capsys)
    assert "ERROR: Async processing failed" in out
    failure_comments = [
        text for text in fake_clickup.posted_comment_texts if text.startswith("[GP-Bot] Failed to start processing")
    ]
    assert len(failure_comments) == 1


def test_async_event_with_unknown_tag_returns_dict_without_side_effects(fake_clickup, fake_ecs, ecs_env, capsys):
    # Defensive: the payload is self-generated, so an unknown tag means a bug
    # (or a direct invoke with AWS creds) — refuse loudly, never launch.
    event = {"gpbot_async": True, "task_id": "abc123", "matched_tag": "not-a-tag"}

    resp = handler.handler(event, None)

    assert isinstance(resp, dict)
    assert resp["statusCode"] == 400
    assert fake_ecs.run_task_calls == []
    assert fake_clickup.calls == []
    assert_alarm_log_emitted(capsys)


def test_alb_body_gpbot_async_is_not_async_dispatch(
    fake_clickup, fake_ecs, fake_lambda, ecs_env, self_invoke_env, capsys
):
    # SPOOF GUARD: an attacker POSTing {"gpbot_async": true, ...} through the
    # ALB lands in event["body"] as a string — top-level event keys are
    # unspoofable. The delivery must be treated as a normal webhook (signature
    # verified, 401 on mismatch), never dispatched to the trusted worker path.
    body = tag_updated_body()
    body["gpbot_async"] = True
    event = {"headers": {"x-signature": "0" * 64}, "body": json.dumps(body)}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 401
    assert fake_clickup.calls == []
    assert fake_ecs.run_task_calls == []
    assert fake_lambda.invoke_calls == []
    assert_alarm_log_emitted(capsys)  # signature-mismatch 401s must still alarm


def test_top_level_gpbot_async_with_alb_keys_is_not_async_dispatch(fake_clickup, fake_ecs, fake_lambda, ecs_env):
    # Belt-and-braces for the same guard: even a top-level gpbot_async key is
    # ignored when the event carries ALB markers (headers/requestContext) —
    # an ALB-wrapped request always has those, an internal self-invoke never does.
    body = tag_updated_body()
    event = make_event(body)  # valid signature
    event["gpbot_async"] = True
    event["requestContext"] = {"elb": {"targetGroupArn": "arn:aws:elasticloadbalancing:..."}}

    resp = handler.handler(event, None)

    # Processed as a normal webhook: with no AWS_LAMBDA_FUNCTION_NAME... but
    # self_invoke fixture not used here, so sync flow runs end-to-end.
    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1
    assert fake_lambda.invoke_calls == []


# ---------------------------------------------------------------------------
# 10. Comment fetch failure -> 500
# ---------------------------------------------------------------------------


def test_comment_fetch_http_error_returns_500(fake_clickup, fake_ecs, ecs_env, capsys):
    # SYNC path pinned: ClickUp receives the 500 and redelivers, so failing
    # the delivery is self-healing at-least-once — keep exactly as is.
    fake_clickup.get_comments_error = HTTPError("http://x", 500, "err", {}, None)
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 500
    assert fake_ecs.run_task_calls == []
    assert_alarm_log_emitted(capsys)


def test_async_comment_fetch_failure_with_atomic_backstop_still_launches(
    fake_clickup, fake_ecs, ecs_env, monkeypatch, capsys
):
    # ASYNC path + DEDUP_TABLE_NAME configured: ClickUp already got its 200
    # 'accepted', so a 500 dict returned here goes NOWHERE — the tag event
    # would be permanently dropped. The comment layer is best-effort (the
    # atomic conditional write still guards duplicates), so a comment-fetch
    # failure must skip the best-effort check and PROCEED to launch. The
    # degraded state is alarm-worthy: 'Failed to get comments' must fire.
    monkeypatch.setenv("DEDUP_TABLE_NAME", "clickup-bot-dedup-test")
    fake_clickup.get_comments_error = HTTPError("http://x", 500, "err", {}, None)

    resp = handler.handler(async_worker_event(), None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1
    out = assert_alarm_log_emitted(capsys)
    assert "Failed to get comments" in out


def test_async_comment_fetch_failure_without_backstop_posts_failure_comment(fake_clickup, fake_ecs, ecs_env, capsys):
    # ASYNC path, NO atomic backstop configured: launching blind would be
    # unbounded duplicate risk, and returning a 500 dict would silently drop
    # the delivery. The user must get a visible retry path instead: the
    # standard failure comment ('Remove and re-add the tag to retry.'), no
    # launch, no raise.
    fake_clickup.get_comments_error = URLError("connection refused")

    resp = handler.handler(async_worker_event(), None)

    assert isinstance(resp, dict)
    assert resp["statusCode"] == 500
    assert fake_ecs.run_task_calls == []
    failure_comments = [
        text for text in fake_clickup.posted_comment_texts if text.startswith("[GP-Bot] Failed to start processing")
    ]
    assert len(failure_comments) == 1
    assert "Remove and re-add the tag to retry" in failure_comments[0]
    assert_alarm_log_emitted(capsys)


def test_is_atomic_dedup_configured_reads_dedup_table_env(monkeypatch):
    # Unit-level pin for the branch-point predicate: in this PR the env var is
    # never set in prod (the atomic layer ships in the stacked PR), so the
    # configured arm is dead code at the handler level — the predicate itself
    # must still be locked down.
    monkeypatch.delenv("DEDUP_TABLE_NAME", raising=False)
    assert handler.is_atomic_dedup_configured() is False
    monkeypatch.setenv("DEDUP_TABLE_NAME", "")
    assert handler.is_atomic_dedup_configured() is False
    monkeypatch.setenv("DEDUP_TABLE_NAME", "clickup-bot-dedup-prod")
    assert handler.is_atomic_dedup_configured() is True


# ---------------------------------------------------------------------------
# 11-13. run_task failure modes -> failure comment + 500
# ---------------------------------------------------------------------------


def assert_failed_loudly(resp: dict, fake_clickup: FakeUrlopen, capsys):
    assert resp["statusCode"] == 500
    failure_comments = [
        text for text in fake_clickup.posted_comment_texts if text.startswith("[GP-Bot] Failed to start processing")
    ]
    assert len(failure_comments) == 1
    assert_alarm_log_emitted(capsys)


def test_run_task_failures_posts_failure_comment_and_returns_500(fake_clickup, fake_ecs, ecs_env, capsys):
    fake_ecs.response = {"tasks": [], "failures": [{"arn": "arn:x", "reason": "RESOURCE:MEMORY"}]}
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert_failed_loudly(resp, fake_clickup, capsys)


def test_run_task_empty_response_posts_failure_comment_and_returns_500(fake_clickup, fake_ecs, ecs_env, capsys):
    fake_ecs.response = {"tasks": [], "failures": []}
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert_failed_loudly(resp, fake_clickup, capsys)


def test_run_task_exception_posts_failure_comment_and_returns_500(fake_clickup, fake_ecs, ecs_env, capsys):
    fake_ecs.exception = RuntimeError("ECS exploded")
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert_failed_loudly(resp, fake_clickup, capsys)


# ---------------------------------------------------------------------------
# 14. FAIL-LOUD: missing/incomplete ECS config must comment failure + 500
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("missing_var", list(ECS_ENV))
@pytest.mark.parametrize("mode", ["unset", "empty"])
def test_missing_ecs_config_fails_loud(fake_clickup, fake_ecs, ecs_env, monkeypatch, missing_var, mode, capsys):
    if mode == "unset":
        monkeypatch.delenv(missing_var)
    else:
        monkeypatch.setenv(missing_var, "")
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 500
    failure_comments = [
        text for text in fake_clickup.posted_comment_texts if text.startswith("[GP-Bot] Failed to start processing")
    ]
    assert len(failure_comments) == 1
    assert fake_ecs.run_task_calls == []
    assert_alarm_log_emitted(capsys)


def test_all_ecs_config_missing_fails_loud(fake_clickup, fake_ecs, capsys):
    # No ecs_env fixture: none of the four ECS_* vars are set at all.
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 500
    failure_comments = [
        text for text in fake_clickup.posted_comment_texts if text.startswith("[GP-Bot] Failed to start processing")
    ]
    assert len(failure_comments) == 1
    assert fake_ecs.run_task_calls == []
    assert_alarm_log_emitted(capsys)


# ---------------------------------------------------------------------------
# 15. tag_removed entry before a valid tag entry still triggers
# ---------------------------------------------------------------------------


def test_tag_removed_before_tag_added_still_triggers(fake_clickup, fake_ecs, ecs_env):
    history_items = [
        {"field": "tag_removed", "after": [{"name": "gpbot-analyze"}]},
        {"field": "tag", "after": [{"name": "gpbot-analyze"}]},
    ]
    event = make_event(tag_updated_body(history_items=history_items))

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1
    assert len(fake_clickup.posted_comments) == 1
    assert fake_clickup.posted_comments[0]["comment_text"].startswith("[GP-Bot] Processing started")


# ---------------------------------------------------------------------------
# 16. Failure comments must NOT block retries (fail-loud must stay retryable)
# ---------------------------------------------------------------------------


def failure_comment_response(reason: str = "ECS configuration is missing or incomplete") -> dict:
    # Real API shape: no "type" key on items, comment_text present, string epoch-ms date.
    text = f"[GP-Bot] Failed to start processing: {reason}"
    return {
        "comments": [
            {
                "id": "90130291038680",
                "comment": [{"text": text}],
                "comment_text": text,
                "user": {"id": 105985359, "username": "Collin Park"},
                "date": str(int((time.time() - 30) * 1000)),
                "reply_count": 0,
            }
        ]
    }


def test_prior_failure_comment_does_not_block_retry(fake_clickup, fake_ecs, ecs_env):
    fake_clickup.comments_response = failure_comment_response()
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1
    assert any(text.startswith("[GP-Bot] Processing started") for text in fake_clickup.posted_comment_texts)


def test_retry_after_config_fixed_processes_task(fake_clickup, fake_ecs, monkeypatch):
    # First attempt: no ECS config at all -> fail loud with a failure comment.
    event = make_event(tag_updated_body())
    resp = handler.handler(event, None)

    assert resp["statusCode"] == 500
    failure_texts = [
        text for text in fake_clickup.posted_comment_texts if text.startswith("[GP-Bot] Failed to start processing")
    ]
    assert len(failure_texts) == 1
    assert fake_ecs.run_task_calls == []

    # Ops fixes the config; the failure comment is now on the task; the user
    # re-adds the tag. The retry must process, not skip as 'already processed'.
    for key, value in ECS_ENV.items():
        monkeypatch.setenv(key, value)
    fake_clickup.comments_response = {
        "comments": [
            {
                "id": "90130291038681",
                "comment": [{"text": failure_texts[0]}],
                "comment_text": failure_texts[0],
                "user": {"id": 105985359, "username": "Collin Park"},
                "date": str(int((time.time() - 30) * 1000)),
                "reply_count": 0,
            }
        ]
    }

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1


def test_run_task_failure_leaves_no_processing_started_marker(fake_clickup, fake_ecs, ecs_env):
    # If the launch fails, no 'Processing started' comment may exist on the
    # task, otherwise the dedup check would block the retry.
    fake_ecs.exception = RuntimeError("ECS exploded")
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 500
    assert not any(text.startswith("[GP-Bot] Processing started") for text in fake_clickup.posted_comment_texts)


# ---------------------------------------------------------------------------
# 17. Non-HTTPError network failures must not crash the handler
# ---------------------------------------------------------------------------


def test_comment_fetch_urlerror_returns_500(fake_clickup, fake_ecs, ecs_env, capsys):
    fake_clickup.get_comments_error = URLError("connection refused")
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 500
    assert response_body(resp)["error"] == "failed to get comments"
    assert fake_ecs.run_task_calls == []
    assert_alarm_log_emitted(capsys)


def test_ack_comment_failure_does_not_prevent_launch(fake_clickup, fake_ecs, ecs_env, capsys):
    fake_clickup.post_comment_error = TimeoutError("read timed out")
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1
    # The swallowed ack-post failure is invisible to the caller (200), so the
    # alarm log line is its ONLY operational signal.
    assert_alarm_log_emitted(capsys)


def async_worker_event(task_id: str = "abc123", matched_tag: str = "gpbot-analyze") -> dict:
    """Trusted internal payload the fast-ack path self-invokes with."""
    return {"gpbot_async": True, "task_id": task_id, "matched_tag": matched_tag}


def test_async_ack_transient_failure_is_retried_and_succeeds(fake_clickup, fake_ecs, ecs_env, capsys):
    # The ack comment is the dedup marker: without it, the retry-storm window
    # stays open. In the ASYNC WORKER, ClickUp already got its 200, so this
    # post is off the webhook critical path: a transient ClickUp 5xx on the
    # first attempt must be retried once — and a successful retry is a
    # non-event: no alarm.
    fake_clickup.post_comment_error_queue = [HTTPError("http://x", 502, "bad gateway", {}, None)]

    resp = handler.handler(async_worker_event(), None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1
    # Two POST attempts: the failed one and the successful retry.
    assert len(fake_clickup.posted_comments) == 2
    assert fake_clickup.posted_comments[-1]["comment_text"].startswith("[GP-Bot] Processing started")
    assert_no_alarm_log_emitted(capsys)


def test_async_ack_double_failure_alarms_after_second_attempt(fake_clickup, fake_ecs, ecs_env, capsys):
    # Only the SECOND failure logs the alarm-matching line — swallowed ack
    # failures are exactly what the alarm exists for (it alarmed correctly
    # during the 2026-07-14 incident). Exactly two attempts: unbounded retries
    # against a down ClickUp would just burn the worker invocation.
    fake_clickup.post_comment_error = HTTPError("http://x", 500, "err", {}, None)

    resp = handler.handler(async_worker_event(), None)

    assert resp["statusCode"] == 200
    assert len(fake_ecs.run_task_calls) == 1
    assert len(fake_clickup.posted_comments) == 2
    out = assert_alarm_log_emitted(capsys)
    assert "Failed to post starting comment" in out


def test_sync_fallback_ack_failure_posts_once_without_sleep(fake_clickup, fake_ecs, ecs_env, capsys, monkeypatch):
    # The SYNC FALLBACK is the guaranteed initial prod state (self-invoke IAM
    # ships in a later terraform PR) and runs while ClickUp is still waiting
    # on the webhook response — the exact path whose slowness caused the
    # 2026-07-14 retry storm. The ack must be a single attempt with NO sleep
    # and NO retry: adding up to 12s here would guarantee webhook timeouts.
    sleep_calls: list[float] = []
    monkeypatch.setattr(handler.time, "sleep", lambda seconds: sleep_calls.append(seconds))
    fake_clickup.post_comment_error = HTTPError("http://x", 500, "err", {}, None)

    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 200
    assert len(fake_ecs.run_task_calls) == 1
    started_posts = [t for t in fake_clickup.posted_comment_texts if t.startswith("[GP-Bot] Processing started")]
    assert len(started_posts) == 1
    assert sleep_calls == []
    # The swallowed ack failure is still alarm-worthy (missing dedup marker).
    out = assert_alarm_log_emitted(capsys)
    assert "Failed to post starting comment" in out


def test_missing_config_failure_comment_urlerror_still_returns_500(fake_clickup, fake_ecs, capsys):
    # No ecs_env fixture: config missing. Posting the failure comment blows up
    # with a connection error; the handler must still return the structured 500.
    fake_clickup.post_comment_error = URLError("connection refused")
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 500
    assert "error" in response_body(resp)
    assert fake_ecs.run_task_calls == []
    # When the failure comment itself cannot be posted, the user gets nothing:
    # BOTH the config error and the swallowed comment failure must reach the
    # alarm-matching logs.
    out = assert_alarm_log_emitted(capsys)
    assert "Failed to post failure comment" in out


# ---------------------------------------------------------------------------
# 18. Secrets fetch failure: distinct 500, and the failure is never cached
# ---------------------------------------------------------------------------


class FakeSecretsManagerClient:
    def __init__(self):
        self.exception = None
        self.calls = 0
        self.secret_string = json.dumps({"CLICKUP_API_KEY": "test-key", "CLICKUP_WEBHOOK_SECRET": TEST_SECRET})

    def get_secret_value(self, SecretId):
        self.calls += 1
        if self.exception is not None:
            raise self.exception
        return {"SecretString": self.secret_string}


def test_secrets_fetch_failure_returns_500_and_is_not_cached(fake_clickup, fake_ecs, ecs_env, monkeypatch, capsys):
    handler._secrets_cache = None
    secrets = FakeSecretsManagerClient()
    secrets.exception = RuntimeError("throttled")
    ecs = FakeECSClient()

    def client_factory(service_name, *args, **kwargs):
        if service_name == "secretsmanager":
            return secrets
        return ecs

    monkeypatch.setattr(handler.boto3, "client", client_factory)
    event = make_event(tag_updated_body())

    # Secrets unavailable must be a 500, distinguishable from a 401
    # signature mismatch.
    resp = handler.handler(event, None)
    assert resp["statusCode"] == 500
    assert response_body(resp)["error"] == "secrets unavailable"
    assert ecs.run_task_calls == []
    # During a secrets outage no failure comment can be posted; the alarm log
    # line is the only feedback anyone gets.
    assert_alarm_log_emitted(capsys)

    # Secrets Manager recovers: the same warm container must retry the fetch
    # (the failure must not have been cached as {}) and process normally.
    secrets.exception = None
    resp = handler.handler(event, None)
    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(ecs.run_task_calls) == 1


# ---------------------------------------------------------------------------
# 19. Secrets outage must not fail deliveries the bot would ignore anyway.
# ClickUp suspends a webhook after sustained consecutive delivery failures;
# if EVERY workspace delivery 500s during a secrets outage, the webhook gets
# suspended and the bot stays dead after the outage is fixed. Only deliveries
# that would actually trigger the bot may fail on a secrets outage.
# ---------------------------------------------------------------------------


def secrets_outage_client_factory(secrets: FakeSecretsManagerClient, ecs: FakeECSClient):
    def factory(service_name, *args, **kwargs):
        if service_name == "secretsmanager":
            return secrets
        return ecs

    return factory


def test_secrets_outage_non_target_event_returns_200(fake_clickup, fake_ecs, ecs_env, monkeypatch):
    # taskUpdated, not taskCreated: taskCreated became a triggering event when
    # the tag-in-create-call race was fixed, so it is no longer an example of a
    # delivery the bot would ignore. The property under test is unchanged —
    # a delivery the bot would never act on must not even reach Secrets Manager.
    handler._secrets_cache = None
    secrets = FakeSecretsManagerClient()
    secrets.exception = RuntimeError("AccessDeniedException")
    monkeypatch.setattr(handler.boto3, "client", secrets_outage_client_factory(secrets, fake_ecs))
    event = make_event({"event": "taskUpdated", "task_id": "abc123", "history_items": []})

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert secrets.calls == 0
    assert_no_side_effects(fake_clickup, fake_ecs)


def test_secrets_outage_unresolved_created_task_returns_200_to_protect_the_webhook(
    fake_clickup, fake_ecs, ecs_env, monkeypatch, capsys
):
    # A taskCreated delivery with no tag delta cannot be classified without the
    # API key, and it fires for every task created anywhere in the workspace.
    # 500-ing all of them during a secrets outage is what drives ClickUp's
    # consecutive-failure counter into suspending the webhook, which is a silent
    # outage lasting until a human notices (Jul 31 -> Aug 14, last time). So the
    # delivery is dropped with a 200 and the operator signal comes from the alarm.
    handler._secrets_cache = None
    secrets = FakeSecretsManagerClient()
    secrets.exception = RuntimeError("AccessDeniedException")
    monkeypatch.setattr(handler.boto3, "client", secrets_outage_client_factory(secrets, fake_ecs))
    event = make_event({"event": "taskCreated", "task_id": "abc123", "history_items": []})

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert_no_side_effects(fake_clickup, fake_ecs)
    # Dropping the delivery silently would make a secrets outage invisible.
    assert_alarm_log_emitted(capsys)


def test_secrets_outage_still_fails_a_created_task_we_know_is_tagged(fake_clickup, fake_ecs, ecs_env, monkeypatch):
    # The counterpart to the test above: when the create payload DOES carry a
    # gpbot tag, the delivery is known-relevant and rare, so the redelivery a
    # 500 buys is worth the failure count.
    handler._secrets_cache = None
    secrets = FakeSecretsManagerClient()
    secrets.exception = RuntimeError("AccessDeniedException")
    monkeypatch.setattr(handler.boto3, "client", secrets_outage_client_factory(secrets, fake_ecs))
    body = {
        "event": "taskCreated",
        "task_id": "abc123",
        "history_items": [{"field": "tag", "after": [{"name": "gpbot-analyze"}]}],
    }
    event = make_event(body)

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 500
    assert response_body(resp)["error"] == "secrets unavailable"
    assert_no_side_effects(fake_clickup, fake_ecs)


def test_secrets_outage_non_gpbot_tag_update_returns_200(fake_clickup, fake_ecs, ecs_env, monkeypatch):
    handler._secrets_cache = None
    secrets = FakeSecretsManagerClient()
    secrets.exception = RuntimeError("AccessDeniedException")
    monkeypatch.setattr(handler.boto3, "client", secrets_outage_client_factory(secrets, fake_ecs))
    event = make_event(tag_updated_body(tags=("needs-grooming",)))

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert secrets.calls == 0
    assert_no_side_effects(fake_clickup, fake_ecs)


def test_invalid_json_body_returns_400(fake_clickup, fake_ecs, ecs_env):
    raw_body = "{not json"
    event = {"headers": {"x-signature": sign(raw_body)}, "body": raw_body}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 400
    assert fake_clickup.calls == []
    assert fake_ecs.run_task_calls == []


@pytest.mark.parametrize("raw_body", ["[]", "null", "42", '"x"'])
def test_non_dict_json_body_returns_400_without_alarm(fake_clickup, fake_ecs, ecs_env, capsys, raw_body):
    # Valid JSON that is not an object reaches body.get() BEFORE signature
    # verification; it must get the same quiet 400 as malformed JSON, not an
    # AttributeError crash that the Lambda runtime logs as "[ERROR] ..." and
    # the fail-loud alarm picks up (unauthenticated log poisoning).
    event = {"headers": {"x-signature": "junk"}, "body": raw_body}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 400
    assert fake_clickup.calls == []
    assert fake_ecs.run_task_calls == []
    assert_no_alarm_log_emitted(capsys)


# ---------------------------------------------------------------------------
# 20. Alarm-log poisoning: the endpoint is public, and the metric filter (see
# ALARM_FILTER_TERMS) matches every log line in the log group. The handler must
# never echo unauthenticated (pre-signature-verification) request content to
# its logs — otherwise any internet client can fire the fail-loud alarm, or
# drown it in false positives until ops learns to ignore it.
# ---------------------------------------------------------------------------


def test_skipped_event_type_with_poison_body_logs_nothing_alarmable(fake_clickup, fake_ecs, ecs_env, capsys):
    body = {"event": ALARM_POISON, "task_id": "abc123", "history_items": [], "note": ALARM_POISON}
    event = {"headers": {"x-signature": "junk", "x-note": ALARM_POISON}, "body": json.dumps(body)}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert_no_side_effects(fake_clickup, fake_ecs)
    assert_no_alarm_log_emitted(capsys)


def test_non_target_tag_with_poison_body_logs_nothing_alarmable(fake_clickup, fake_ecs, ecs_env, capsys):
    body = tag_updated_body(tags=(ALARM_POISON,))
    event = {"headers": {"x-signature": "junk"}, "body": json.dumps(body)}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert_no_side_effects(fake_clickup, fake_ecs)
    assert_no_alarm_log_emitted(capsys)


def test_invalid_json_with_poison_body_logs_nothing_alarmable(fake_clickup, fake_ecs, ecs_env, capsys):
    raw_body = f"{ALARM_POISON} {{not json"
    event = {"headers": {"x-signature": "junk"}, "body": raw_body}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 400
    assert fake_clickup.calls == []
    assert fake_ecs.run_task_calls == []
    assert_no_alarm_log_emitted(capsys)


def test_signature_mismatch_poison_body_is_not_echoed(fake_clickup, fake_ecs, ecs_env, capsys):
    # A gpbot-tagged delivery with a bad signature IS alarm-worthy (rotated
    # secret death mode), but only via the handler's own controlled log line —
    # the attacker-supplied body must never be echoed.
    body = tag_updated_body()
    body["note"] = ALARM_POISON
    event = {"headers": {"x-signature": "0" * 64}, "body": json.dumps(body)}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 401
    out = assert_alarm_log_emitted(capsys)
    assert "poison" not in out


# ---------------------------------------------------------------------------
# 21. The x-signature value is a shared-secret HMAC that authenticates the
# webhook; if it reaches CloudWatch it is a replayable credential. The handler
# may log the (authenticated) event for debugging, but the signature value
# must be redacted first.
# ---------------------------------------------------------------------------


def test_signature_value_is_redacted_from_logs(fake_clickup, fake_ecs, ecs_env, capsys):
    body = json.dumps(tag_updated_body())
    signature = sign(body)
    event = {"headers": {"x-signature": signature}, "body": body}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    out = capsys.readouterr().out
    # The raw signature must never appear anywhere in the logs...
    assert signature not in out
    # ...but the event IS logged for debugging, with the value redacted.
    assert "[redacted]" in out


def test_signature_value_is_redacted_from_logs_case_insensitive(fake_clickup, fake_ecs, ecs_env, capsys):
    # ClickUp/API Gateway may deliver the header with any casing; redaction
    # must key off the header name case-insensitively or the secret leaks.
    body = json.dumps(tag_updated_body())
    signature = sign(body)
    event = {"headers": {"X-Signature": signature}, "body": body}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert signature not in capsys.readouterr().out


def test_signature_value_is_redacted_from_multi_value_headers(fake_clickup, fake_ecs, ecs_env, capsys):
    # ALB delivers the signature a SECOND time under multiValueHeaders (values
    # are lists). Redacting only headers still leaks the replayable HMAC through
    # this copy when the (authenticated) event is logged for debugging.
    body = json.dumps(tag_updated_body())
    signature = sign(body)
    event = {
        "headers": {"x-signature": signature},
        "multiValueHeaders": {"x-signature": [signature]},
        "body": body,
    }

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    out = capsys.readouterr().out
    assert signature not in out
    assert "[redacted]" in out


def test_signature_value_is_redacted_from_multi_value_headers_case_insensitive(fake_clickup, fake_ecs, ecs_env, capsys):
    # Same casing hazard as headers: multiValueHeaders may arrive as any casing.
    body = json.dumps(tag_updated_body())
    signature = sign(body)
    event = {
        "headers": {"x-signature": signature},
        "multiValueHeaders": {"X-Signature": [signature]},
        "body": body,
    }

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert signature not in capsys.readouterr().out


# ---------------------------------------------------------------------------
# 22. Raw boto3 exception text (ARNs, request IDs, credential context) must
# never be posted into a public ClickUp comment. The failure comment names the
# exception type and points at CloudWatch; the full detail stays in the logs.
# ---------------------------------------------------------------------------


def test_run_task_exception_detail_not_leaked_into_comment(fake_clickup, fake_ecs, ecs_env, capsys):
    marker = "arn:aws:iam::123456789012:role/leaked-role reqid=deadbeef-secret"
    fake_ecs.exception = RuntimeError(marker)
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 500
    failure_comments = [
        text for text in fake_clickup.posted_comment_texts if text.startswith("[GP-Bot] Failed to start processing")
    ]
    assert len(failure_comments) == 1
    comment = failure_comments[0]
    # The leak-prone raw exception message must not reach ClickUp...
    assert marker not in comment
    # ...but the exception class name must, so a human knows what broke.
    assert "RuntimeError" in comment
    # Full detail must still reach the logs (CloudWatch) for debugging.
    assert marker in capsys.readouterr().out


# ---------------------------------------------------------------------------
# 23. Every ClickUp API call authenticates with the configured CLICKUP_API_KEY
# in the Authorization header. Pins the wiring: if the key were dropped or read
# from the wrong secret, ClickUp would 401 and the bot would silently stop
# posting comments and reading task state.
# ---------------------------------------------------------------------------


def test_clickup_requests_carry_authorization_header(fake_clickup, fake_ecs, ecs_env):
    event = make_event(tag_updated_body())

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    # Happy path hits both the GET comments and the POST ack-comment endpoints.
    assert len(fake_clickup.requests) >= 2
    assert all(auth == TEST_API_KEY for auth in fake_clickup.authorization_headers)


# ---------------------------------------------------------------------------
# PR-review findings: pre-auth payload-shape hardening
# (cursor bugbot: null history_items; delegate-reviewer: dict body)
# ---------------------------------------------------------------------------


def test_null_history_items_returns_200_skipped_without_alarmable_log(fake_clickup, fake_ecs, ecs_env, capsys):
    # "history_items": null is present-but-null, so .get(key, []) returns None.
    # Must skip quietly pre-auth, not crash into a runtime [ERROR] log that an
    # unauthenticated client could use to fire the fail-loud alarm.
    body = {"event": "taskTagUpdated", "task_id": "abc123", "history_items": None}
    resp = handler.handler(make_event(body, signature="junk"), None)
    assert resp["statusCode"] == 200
    assert response_body(resp) == {"skipped": "not a target tag"}
    out = capsys.readouterr().out
    assert "ERROR" not in out
    assert "Failed to" not in out


def test_non_dict_history_entries_and_tags_are_skipped(fake_clickup, fake_ecs, ecs_env, capsys):
    # Attacker-shaped entries (strings, numbers, non-dict tags) must not crash
    # pre-auth; a valid entry later in the list must still match.
    history = ["junk-string", 42, {"field": "tag", "after": ["not-a-dict", {"name": "gpbot-analyze"}]}]
    body = tag_updated_body(history_items=history)
    event = make_event(body)
    resp = handler.handler(event, None)
    assert resp["statusCode"] == 200
    assert len(fake_ecs.run_task_calls) == 1
    out = capsys.readouterr().out
    assert "Traceback" not in out


def test_dict_body_direct_invocation_returns_401_not_secrets_error(fake_clickup, fake_ecs, ecs_env, capsys):
    # Direct invocation (console/test) can pass body as an already-parsed dict.
    # Signature can never match a re-serialized dict, so this must be a clean
    # 401 — NOT an AttributeError misclassified as a Secrets Manager outage.
    event = {"headers": {"x-signature": "junk"}, "body": tag_updated_body()}
    resp = handler.handler(event, None)
    assert resp["statusCode"] == 401
    out = capsys.readouterr().out
    assert "Secrets unavailable" not in out
    assert len(fake_ecs.run_task_calls) == 0


def test_ack_post_failure_still_200_but_logs_alarmable_line(fake_clickup, fake_ecs, ecs_env, capsys):
    # If the "Processing started" ack fails AFTER a successful run_task, the
    # Fargate agent is already running: a 500 would make ClickUp re-deliver
    # and guarantee a duplicate launch, so the handler must return 200. The
    # residual risk (a later manual re-tag re-launches because no dedup marker
    # exists) is accepted and made visible: the log line must contain
    # "Failed to" so the CloudWatch metric filter fires the fail-loud alarm.
    fake_clickup.post_comment_error = HTTPError("http://x", 500, "err", {}, None)
    resp = handler.handler(make_event(tag_updated_body()), None)
    assert resp["statusCode"] == 200
    assert len(fake_ecs.run_task_calls) == 1
    assert "Failed to" in capsys.readouterr().out


def test_ecs_failure_reasons_not_leaked_into_comment_or_response(fake_clickup, fake_ecs, ecs_env, capsys):
    # ECS failures[].reason can embed ARNs and account details. The ClickUp
    # comment and HTTP response must carry only a generic message; the raw
    # reasons belong in CloudWatch logs.
    marker = "arn:aws:iam::999999999999:role/secret-leak-marker"
    fake_ecs.response = {"tasks": [], "failures": [{"reason": marker, "detail": "x"}]}
    resp = handler.handler(make_event(tag_updated_body()), None)
    assert resp["statusCode"] == 500
    assert marker not in resp["body"]
    failure_comments = [t for t in fake_clickup.posted_comment_texts if "Failed to start processing" in t]
    assert len(failure_comments) == 1
    assert marker not in failure_comments[0]
    assert marker in capsys.readouterr().out


# ---------------------------------------------------------------------------
# 24. Atomic dedup lock (DynamoDB conditional write). Comment-based dedup is
# best-effort: it reads through ClickUp's slow, eventually-consistent API, and
# concurrent worker invocations can ALL pass the comment check before any ack
# comment is visible — exactly how one retried delivery launched 6 Fargate
# agents on 2026-07-14. The authoritative dedup is an atomic conditional
# PutItem claim on (task_id, label) that does not depend on ClickUp at all:
# exactly one worker wins.
# Prod-state contract: DEDUP_TABLE_NAME is unset between the code deploy and
# the terraform apply that creates the table, so the unconfigured state must be
# a quiet no-op — every test outside this section runs in that state.
# ---------------------------------------------------------------------------


def conditional_check_failed() -> ClientError:
    # Built the way boto3 raises it: a botocore ClientError whose Error.Code is
    # "ConditionalCheckFailedException". The handler must match on that code,
    # never on the exception class name.
    return ClientError(
        {"Error": {"Code": "ConditionalCheckFailedException", "Message": "The conditional request failed"}},
        "PutItem",
    )


def test_lock_acquired_writes_claim_item_and_launches(fake_clickup, fake_ecs, fake_dynamodb, ecs_env, dedup_table_env):
    before = int(time.time())
    resp = handler.handler(make_event(tag_updated_body()), None)
    after = int(time.time())

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1

    # Exactly one conditional claim write, keyed on task#label, refusing to
    # overwrite a live (unexpired) claim.
    assert len(fake_dynamodb.put_item_calls) == 1
    call = fake_dynamodb.put_item_calls[0]
    assert call["TableName"] == dedup_table_env
    assert call["ConditionExpression"] == "attribute_not_exists(pk) OR #exp < :now"
    assert call["ExpressionAttributeNames"] == {"#exp": "expires_at"}
    item = call["Item"]
    assert item["pk"] == {"S": "abc123#analyze"}
    assert item["task_id"] == {"S": "abc123"}
    assert item["label"] == {"S": "analyze"}
    # DynamoDB TTL requires epoch SECONDS as a Number attribute.
    expires_at = int(item["expires_at"]["N"])
    assert before + 900 <= expires_at <= after + 900

    # UNITS CONTRACT for the reclaim arm ('#exp < :now'): :now must be epoch
    # SECONDS — the same units as expires_at above. If :now were ever written
    # in milliseconds, every live claim would compare as expired and the
    # dedup lock would silently never hold.
    now_value = call["ExpressionAttributeValues"][":now"]
    assert set(now_value.keys()) == {"N"}
    assert before <= int(now_value["N"]) <= after

    # A successful launch KEEPS the claim (DynamoDB TTL expires it); deleting
    # it here would reopen the retry-storm window immediately.
    assert fake_dynamodb.delete_item_calls == []


def test_lock_ttl_configurable_via_env(fake_clickup, fake_ecs, fake_dynamodb, ecs_env, dedup_table_env, monkeypatch):
    monkeypatch.setenv("DEDUP_TTL_SECONDS", "60")
    before = int(time.time())
    resp = handler.handler(make_event(tag_updated_body()), None)
    after = int(time.time())

    assert resp["statusCode"] == 200
    expires_at = int(fake_dynamodb.put_item_calls[0]["Item"]["expires_at"]["N"])
    assert before + 60 <= expires_at <= after + 60


def test_invalid_lock_ttl_falls_back_to_default_quietly(
    fake_clickup, fake_ecs, fake_dynamodb, ecs_env, dedup_table_env, monkeypatch, capsys
):
    # Same contract as DEDUP_COMMENT_WINDOW_SECONDS: a typo'd env var must not
    # crash in-path and must not fire the alarm on every trigger — quiet
    # fallback to the 900s default.
    monkeypatch.setenv("DEDUP_TTL_SECONDS", "not-a-number")
    before = int(time.time())
    resp = handler.handler(make_event(tag_updated_body()), None)
    after = int(time.time())

    assert resp["statusCode"] == 200
    expires_at = int(fake_dynamodb.put_item_calls[0]["Item"]["expires_at"]["N"])
    assert before + 900 <= expires_at <= after + 900
    assert_no_alarm_log_emitted(capsys)


@pytest.mark.parametrize("bad_value", ["nan", "inf", "-inf", "0", "-60", "junk"])
def test_non_finite_or_non_positive_ttl_falls_back_to_default_quietly(monkeypatch, capsys, bad_value):
    # Same guard as DEDUP_COMMENT_WINDOW_SECONDS: float() happily parses
    # 'nan'/'inf'/'-inf', which escape a bare ValueError guard and then crash
    # at int(time.time() + ttl) inside the claim write — in-path, on every
    # trigger. Non-finite or non-positive values must fall back to the
    # default with the existing quiet (non-alarm) line.
    monkeypatch.setenv("DEDUP_TTL_SECONDS", bad_value)

    assert handler.get_dedup_ttl_seconds() == handler.DEFAULT_DEDUP_TTL_SECONDS

    out = assert_no_alarm_log_emitted(capsys)
    assert "Invalid DEDUP_TTL_SECONDS" in out


class ConditionEvaluatingFakeDynamoDB(FakeDynamoDBClient):
    """Fake that EVALUATES the claim condition against a stored item the way
    DynamoDB would, instead of blindly succeeding. Locks in the reclaim arm
    ('attribute_not_exists(pk) OR #exp < :now') behaviorally: both sides must
    be epoch-second numbers or the comparison is meaningless.
    """

    def __init__(self, stored_item: dict | None = None):
        super().__init__()
        self.stored_item = stored_item

    def put_item(self, **kwargs):
        self.put_item_calls.append(kwargs)
        assert kwargs["ConditionExpression"] == "attribute_not_exists(pk) OR #exp < :now"
        if self.stored_item is not None:
            exp_attribute = kwargs["ExpressionAttributeNames"]["#exp"]
            stored_expires_at = int(self.stored_item[exp_attribute]["N"])
            now = int(kwargs["ExpressionAttributeValues"][":now"]["N"])
            if not stored_expires_at < now:
                raise conditional_check_failed()
        self.stored_item = kwargs["Item"]
        return {}


def test_expired_claim_is_reclaimed_and_launch_proceeds(
    fake_clickup, fake_ecs, boto3_factory, ecs_env, dedup_table_env
):
    # DynamoDB TTL deletion can lag hours, so an expired-but-undeleted claim
    # must be reclaimable — otherwise a deliberate re-tag after the window
    # would be silently suppressed until TTL cleanup happens to run.
    expired = {"pk": {"S": "abc123#analyze"}, "expires_at": {"N": str(int(time.time()) - 10)}}
    evaluating_fake = ConditionEvaluatingFakeDynamoDB(stored_item=expired)
    boto3_factory.dynamodb_client = evaluating_fake

    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1
    # The reclaim refreshed the claim: the stored item now carries a future
    # expires_at, so a concurrent second claimer fails the condition.
    assert int(evaluating_fake.stored_item["expires_at"]["N"]) > int(time.time())


def test_live_claim_is_not_reclaimed_and_suppresses_launch(
    fake_clickup, fake_ecs, boto3_factory, ecs_env, dedup_table_env, capsys
):
    # The mirror case: an UNexpired claim must fail the condition and suppress
    # the launch — quiet skip, no launch, no ack comment.
    live = {"pk": {"S": "abc123#analyze"}, "expires_at": {"N": str(int(time.time()) + 500)}}
    boto3_factory.dynamodb_client = ConditionEvaluatingFakeDynamoDB(stored_item=live)

    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 200
    assert response_body(resp) == {"skipped": "duplicate suppressed"}
    assert fake_ecs.run_task_calls == []
    assert fake_clickup.posted_comments == []
    assert_no_alarm_log_emitted(capsys)


def test_duplicate_claim_suppresses_launch_quietly_sync_path(
    fake_clickup, fake_ecs, fake_dynamodb, ecs_env, dedup_table_env, capsys
):
    # A lost claim race is the dedup WORKING, not a failure: quiet log, no
    # launch, no ack comment (the winner posts its own), 200 skipped so
    # ClickUp does not re-deliver.
    fake_dynamodb.put_item_exception = conditional_check_failed()

    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 200
    assert response_body(resp) == {"skipped": "duplicate suppressed"}
    assert fake_ecs.run_task_calls == []
    assert fake_clickup.posted_comments == []
    assert fake_dynamodb.delete_item_calls == []
    out = assert_no_alarm_log_emitted(capsys)
    assert "suppressed by dedup table" in out


def test_duplicate_claim_suppresses_launch_async_worker(
    fake_clickup, fake_ecs, fake_dynamodb, ecs_env, dedup_table_env, capsys
):
    # Same suppression through the async worker path — the concurrent-delivery
    # case the lock exists for (both workers pass the comment check; only one
    # wins the conditional write).
    fake_dynamodb.put_item_exception = conditional_check_failed()
    event = {"gpbot_async": True, "task_id": "abc123", "matched_tag": "gpbot-analyze"}

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert response_body(resp) == {"skipped": "duplicate suppressed"}
    assert fake_ecs.run_task_calls == []
    assert fake_clickup.posted_comments == []
    assert_no_alarm_log_emitted(capsys)


@pytest.mark.parametrize(
    "dynamo_error",
    [
        ClientError({"Error": {"Code": "ProvisionedThroughputExceededException", "Message": "slow"}}, "PutItem"),
        RuntimeError("socket timeout talking to dynamodb"),
    ],
    ids=["client-error-other-code", "non-client-error"],
)
def test_dynamo_outage_fails_open_and_alarms(
    fake_clickup, fake_ecs, fake_dynamodb, ecs_env, dedup_table_env, capsys, dynamo_error
):
    # FAIL-OPEN: a broken dedup table must not take the bot down — the launch
    # still happens — but this is real infrastructure breakage an operator
    # must see, so the log line is deliberately alarm-matching.
    fake_dynamodb.put_item_exception = dynamo_error

    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1
    assert any(text.startswith("[GP-Bot] Processing started") for text in fake_clickup.posted_comment_texts)
    out = assert_alarm_log_emitted(capsys)
    assert "dedup table unavailable" in out


def test_dynamo_read_timeout_fails_open_and_alarms(
    fake_clickup, fake_ecs, fake_dynamodb, ecs_env, dedup_table_env, capsys
):
    # CONTRACT PIN, expected to pass against the current broad except: the
    # exception a read timeout ACTUALLY raises is botocore's ReadTimeoutError,
    # which is NOT a ClientError (it subclasses HTTPClientError/BotoCoreError)
    # — so the single-attempt read_timeout budget lands in the generic
    # except-Exception arm, not the ClientError one. This test exists so that
    # anyone narrowing that except later (e.g. to ClientError only) turns the
    # most likely real-world failure shape from fail-open into an unhandled
    # crash and finds out here instead of in prod.
    fake_dynamodb.put_item_exception = ReadTimeoutError(endpoint_url="https://dynamodb.us-west-2.amazonaws.com/")

    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1
    out = assert_alarm_log_emitted(capsys)
    assert "dedup table unavailable" in out


def test_unconfigured_table_skips_dynamo_entirely(
    fake_clickup, fake_ecs, fake_dynamodb, boto3_factory, ecs_env, capsys
):
    # clean_dedup_table_env (autouse) removed DEDUP_TABLE_NAME: the initial
    # prod state between the code deploy and the terraform apply. Everything
    # must work exactly as before — no dynamodb client, no calls, quiet log.
    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1
    assert "dynamodb" not in boto3_factory.requested_services
    assert fake_dynamodb.put_item_calls == []
    assert fake_dynamodb.delete_item_calls == []
    out = assert_no_alarm_log_emitted(capsys)
    assert "Dedup table not configured" in out


def test_recent_comment_marker_skips_before_any_lock_attempt(
    fake_clickup, fake_ecs, fake_dynamodb, ecs_env, dedup_table_env
):
    # Layer order is a contract: the cheap comment check runs FIRST, and a
    # recent marker must short-circuit without ever writing a claim — a
    # comment-deduped skip that also burned a lock would block a legitimate
    # re-trigger for the whole TTL after the marker expires.
    fake_clickup.comments_response = existing_gpbot_comment_response()

    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 200
    assert response_body(resp) == {"skipped": "already processed"}
    assert fake_dynamodb.put_item_calls == []


# ---------------------------------------------------------------------------
# 24b. Claim release on launch failure. The documented retry contract is
# "remove and re-add the tag to retry" — failure comments never block it, so
# a failed launch's claim must not either, or the user's retry would be
# silently suppressed until the TTL expires.
# ---------------------------------------------------------------------------


def assert_claim_released(fake_dynamodb: FakeDynamoDBClient, table_name: str, pk: str = "abc123#analyze"):
    assert len(fake_dynamodb.delete_item_calls) == 1
    call = fake_dynamodb.delete_item_calls[0]
    assert call["TableName"] == table_name
    assert call["Key"] == {"pk": {"S": pk}}


def test_launch_exception_releases_claim(fake_clickup, fake_ecs, fake_dynamodb, ecs_env, dedup_table_env, capsys):
    fake_ecs.exception = RuntimeError("ECS exploded")

    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 500
    assert len(fake_dynamodb.put_item_calls) == 1
    assert_claim_released(fake_dynamodb, dedup_table_env)
    assert_alarm_log_emitted(capsys)


def test_launch_failures_response_releases_claim(fake_clickup, fake_ecs, fake_dynamodb, ecs_env, dedup_table_env):
    fake_ecs.response = {"tasks": [], "failures": [{"reason": "RESOURCE:MEMORY"}]}

    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 500
    assert_claim_released(fake_dynamodb, dedup_table_env)


def test_missing_ecs_config_releases_claim(fake_clickup, fake_ecs, fake_dynamodb, dedup_table_env):
    # No ecs_env fixture: trigger_fargate_task 500s before run_task. The claim
    # must still be released so the retry after ops fixes the config works.
    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 500
    assert fake_ecs.run_task_calls == []
    assert_claim_released(fake_dynamodb, dedup_table_env)


def test_release_failure_alarms_but_does_not_change_response(
    fake_clickup, fake_ecs, fake_dynamodb, ecs_env, dedup_table_env, capsys
):
    # A failed DeleteItem leaves a stuck claim that suppresses the user's
    # retry until the TTL expires — alarm-worthy — but it must not change
    # control flow: the launch-failure 500 and its failure comment stand.
    fake_ecs.exception = RuntimeError("ECS exploded")
    fake_dynamodb.delete_item_exception = RuntimeError("dynamodb down")

    resp = handler.handler(make_event(tag_updated_body()), None)

    assert resp["statusCode"] == 500
    assert any("Failed to start processing" in text for text in fake_clickup.posted_comment_texts)
    out = assert_alarm_log_emitted(capsys)
    assert "Failed to release dedup lock" in out


# ---------------------------------------------------------------------------
# 25. Scope guard. gpbot-work used to be applied by hand, so a human decided
# "is this omni code work?" before the agent ever ran. Two ClickUp Automations
# now apply it — one on the bug lists, one workspace-wide on `production-bug`
# — so nothing upstream answers that question and this guard is the only
# thing standing between a data ticket and a code agent. Data tickets carry
# `production-bug` as heavily as ENG tickets do, so this is a routine path,
# not an edge case.
# ---------------------------------------------------------------------------


def data_task(**overrides) -> dict:
    task = {"custom_id": "DATA-1845", "list": {"id": "901326391561", "name": "Data Backlog"}, "tags": []}
    task.update(overrides)
    return task


def test_data_custom_id_blocks_implement(fake_clickup, fake_ecs, ecs_env, capsys):
    fake_clickup.task_response = data_task()

    resp = handler.handler(make_event(tag_updated_body(tags=("gpbot-work",))), None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["skipped"] == "out of scope"
    assert_no_side_effects(fake_clickup, fake_ecs)
    # Firing on every data ticket in the workspace is the guard WORKING; it
    # must not look like breakage to the CloudWatch alarm.
    assert_no_alarm_log_emitted(capsys)


def test_data_backlog_list_blocks_implement_without_a_custom_id(fake_clickup, fake_ecs, ecs_env):
    # Not every Data Backlog task carries a DATA- custom_id, so the list id is
    # an independent check rather than a redundant one.
    fake_clickup.task_response = data_task(custom_id=None)

    resp = handler.handler(make_event(tag_updated_body(tags=("gpbot-work",))), None)

    assert response_body(resp)["skipped"] == "out of scope"
    assert_no_side_effects(fake_clickup, fake_ecs)


def test_growth_bugs_list_blocks_implement(fake_clickup, fake_ecs, ecs_env):
    # Growth-Bugs is marketing-site work that does not live in omni; the agent
    # only knows omni, so a run there produces nothing.
    fake_clickup.task_response = {
        "custom_id": None,
        "list": {"id": "901326170992", "name": "Growth-Bugs"},
        "tags": [],
    }

    resp = handler.handler(make_event(tag_updated_body(tags=("gpbot-work",))), None)

    assert response_body(resp)["skipped"] == "out of scope"
    assert_no_side_effects(fake_clickup, fake_ecs)


def test_district_assignment_tag_blocks_implement_inside_an_eng_list(fake_clickup, fake_ecs, ecs_env):
    # Data work triaged into an ENG list: neither the custom_id nor the list
    # id flags it, so the data team's own marker is the only remaining signal.
    fake_clickup.task_response = {
        "custom_id": "ENG-9999",
        "list": {"id": "901321761872", "name": "Bugs"},
        "tags": [{"name": "bug: district-assignment"}, {"name": "production-bug"}],
    }

    resp = handler.handler(make_event(tag_updated_body(tags=("gpbot-work",))), None)

    assert response_body(resp)["skipped"] == "out of scope"
    assert_no_side_effects(fake_clickup, fake_ecs)


def test_scope_guard_does_not_block_analyze_on_data_tickets(fake_clickup, fake_ecs, ecs_env):
    # DELIBERATE ASYMMETRY: analyzing a data bug is useful and gpbot-analyze
    # is used on DATA tickets constantly. Only opening a code PR against one
    # is wrong, so the guard is scoped to the implement label.
    fake_clickup.task_response = data_task()

    resp = handler.handler(make_event(tag_updated_body(tags=("gpbot-analyze",))), None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1


def test_eng_bug_still_launches_with_the_guard_in_place(fake_clickup, fake_ecs, ecs_env):
    fake_clickup.task_response = {
        "custom_id": "ENG-7337",
        "list": {"id": "901321761872", "name": "Bugs"},
        "tags": [{"name": "production-bug"}, {"name": "hs ticket"}],
    }

    resp = handler.handler(make_event(tag_updated_body(tags=("gpbot-work",))), None)

    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1


def test_scope_lookup_failure_fails_open_and_alarms(fake_clickup, fake_ecs, ecs_env, capsys):
    # FAIL OPEN: one wasted run costs a few dollars and a closeable PR, while
    # refusing every bug during a ClickUp blip is a silent outage. Alarming is
    # the other half — a persistent failure here disables the data boundary
    # without changing anything an operator would otherwise notice.
    fake_clickup.get_task_error = URLError("clickup unreachable")

    resp = handler.handler(make_event(tag_updated_body(tags=("gpbot-work",))), None)

    assert response_body(resp)["fargate_task_arn"] == TASK_ARN
    assert len(fake_ecs.run_task_calls) == 1
    assert "Failed to fetch task" in assert_alarm_log_emitted(capsys)


def test_out_of_scope_task_never_writes_a_dedup_claim(fake_clickup, fake_ecs, fake_dynamodb, ecs_env, dedup_table_env):
    # Ordering contract: a claim written for a task we then refuse would
    # outlive this delivery and suppress a legitimate re-tag for the whole
    # TTL, so the guard must run before try_acquire_dedup_lock.
    fake_clickup.task_response = data_task()

    handler.handler(make_event(tag_updated_body(tags=("gpbot-work",))), None)

    assert fake_dynamodb.put_item_calls == []


def test_out_of_scope_rejection_costs_one_clickup_call(fake_clickup, fake_ecs, ecs_env):
    # The guard also runs before the comments GET: once a workspace-wide
    # automation is feeding it every data ticket, the rejected path should not
    # pay for a second round trip.
    fake_clickup.task_response = data_task()

    handler.handler(make_event(tag_updated_body(tags=("gpbot-work",))), None)

    assert [url for method, url, _ in fake_clickup.calls if "/comment" in url] == []


@pytest.mark.parametrize(
    "task",
    [
        {},
        {"custom_id": None, "list": None, "tags": None},
        {"custom_id": 1234, "list": {"id": 901326391561}, "tags": [None, "str", {"name": None}]},
        [],
        None,
    ],
)
def test_unreadable_task_shapes_never_crash_the_guard(task):
    # Shape drift must not crash the worker. It must also not silently WIDEN
    # scope, but an unreadable field simply fails to match and lands in the
    # caller's fail-open — the same posture as a failed lookup.
    assert handler.out_of_scope_reason(task) is None


def test_custom_id_prefix_match_is_case_insensitive():
    assert handler.out_of_scope_reason({"custom_id": "data-1845"}) is not None


# ---------------------------------------------------------------------------
# 22. The analyze prompt and the verdict parser are one contract split across
# two deployment artifacts.
#
# The prompt that asks for `GPBOT-VERDICT:` lives in this Lambda; the parser
# that acts on it lives in the Fargate agent. Nothing at runtime connects them,
# so a reworded prompt or a renamed verdict would not fail anything — every
# analysis would just quietly stop escalating, which is indistinguishable from
# the feature being switched off. These tests are the only thing holding the two
# ends together.
# ---------------------------------------------------------------------------


def test_every_verdict_the_prompt_offers_is_one_the_parser_accepts():
    from engineer_agent.agent.escalation import parse_verdict

    offered = re.findall(r"GPBOT-VERDICT:\s*([a-z-]+)", handler.ANALYZE_INSTRUCTION)

    assert offered, "the analyze prompt no longer shows the agent any GPBOT-VERDICT line"
    for verdict in offered:
        assert parse_verdict(f"GPBOT-VERDICT: {verdict}") == verdict


def test_the_prompt_offers_every_verdict_the_parser_knows():
    # The other direction: a verdict the parser handles but the prompt never
    # mentions is dead code the model can never reach.
    from engineer_agent.agent.escalation import KNOWN_VERDICTS

    offered = set(re.findall(r"GPBOT-VERDICT:\s*([a-z-]+)", handler.ANALYZE_INSTRUCTION))

    assert offered == set(KNOWN_VERDICTS)


def test_only_the_analyze_prompt_asks_for_a_verdict():
    # An implement run that emitted the token could otherwise look like an
    # analysis asking to queue another implement run.
    assert "GPBOT-VERDICT" not in handler.IMPLEMENT_INSTRUCTION


# ---------------------------------------------------------------------------
# 23. The agent is told which kind of run it is, as a value.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("tag_name,expected_label", [("gpbot-analyze", "analyze"), ("gpbot-work", "implement")])
def test_run_label_is_passed_to_the_container(fake_clickup, fake_ecs, ecs_env, tag_name, expected_label):
    # The agent gates escalation on this value. Inferring the run type from the
    # instruction prose instead would make an unrelated prompt edit silently
    # change whether a run can open a PR.
    event = make_event(tag_updated_body(tags=(tag_name,)))

    resp = handler.handler(event, None)

    assert resp["statusCode"] == 200
    assert engineer_agent_env(fake_ecs.run_task_calls[0])["AGENT_LABEL"] == expected_label


# ---------------------------------------------------------------------------
# 24. The reconciliation sweep.
#
# This exists because the webhook is not a complete feed: on 2026-08-17 the only
# task of 53 created workspace-wide that produced no delivery was the sole
# HubSpot-filed ticket, which is the class the bot serves. The sweep is what
# stops a dropped delivery from becoming a bug nobody ever looks at, so the
# behavior that matters most here is that it keeps going and that it cannot
# spend unbounded money.
# ---------------------------------------------------------------------------


def sweep_event():
    return {"gpbot_sweep": True}


def triggered_result():
    return {"statusCode": 200, "body": json.dumps({"status": "triggered", "task_id": "x"})}


def skipped_result(reason="duplicate"):
    return {"statusCode": 200, "body": json.dumps({"skipped": reason})}


@pytest.fixture
def sweep_calls(monkeypatch):
    """Records which task ids the sweep asked to trigger."""
    calls = []

    def fake_trigger(task_id, matched_tag, from_async_worker=False):
        calls.append((task_id, matched_tag, from_async_worker))
        return triggered_result()

    monkeypatch.setattr(handler, "dedup_check_then_trigger", fake_trigger)
    return calls


def stub_listing(monkeypatch, tasks):
    monkeypatch.setattr(handler, "list_recently_updated_tagged_tasks", lambda tag, since: tasks)


def test_sweep_triggers_a_tagged_task_the_webhook_never_delivered(monkeypatch, sweep_calls, sweep_comments):
    stub_listing(monkeypatch, [{"id": "86ak1w3tn"}])

    resp = handler.handler(sweep_event(), None)

    assert resp["statusCode"] == 200
    assert json.loads(resp["body"])["triggered"] == 1
    # from_async_worker=True: nobody is waiting on an HTTP response here, so the
    # sweep must take the worker's failure semantics, not the webhook's.
    assert sweep_calls == [("86ak1w3tn", handler.ANALYZE_TAG, True)]


def test_sweep_only_ever_asks_for_analyze(monkeypatch, sweep_calls, sweep_comments):
    # gpbot-work opens a PR, and the gap being patched does not apply to it:
    # hand-tagging and the escalation's own API write both fire taskTagUpdated
    # normally. A sweep for it would be a second, less-scrutinised route to
    # opening PRs.
    stub_listing(monkeypatch, [{"id": "a"}, {"id": "b"}])

    handler.handler(sweep_event(), None)

    assert {tag for _, tag, _ in sweep_calls} == {handler.ANALYZE_TAG}
    assert handler.SWEEP_TAG == "gpbot-analyze"


def test_sweep_is_idempotent_because_dedup_declines(monkeypatch, sweep_comments):
    # The whole safety argument: the sweep re-offers everything in its window on
    # every run, and dedup is what makes that harmless.
    monkeypatch.setattr(handler, "list_recently_updated_tagged_tasks", lambda tag, since: [{"id": "a"}, {"id": "b"}])
    monkeypatch.setattr(handler, "dedup_check_then_trigger", lambda *a, **k: skipped_result())

    resp = handler.handler(sweep_event(), None)

    body = json.loads(resp["body"])
    assert body == {"swept": 2, "triggered": 0, "skipped": 2}


def test_sweep_caps_how_many_runs_one_pass_can_start(monkeypatch, sweep_calls, sweep_comments):
    # Each trigger is a real agent run costing real money. A bulk re-tag must
    # not turn into an unbounded spend.
    monkeypatch.setenv("SWEEP_MAX_TRIGGERS", "2")
    stub_listing(monkeypatch, [{"id": f"t{i}"} for i in range(10)])

    resp = handler.handler(sweep_event(), None)

    assert len(sweep_calls) == 2
    assert json.loads(resp["body"])["triggered"] == 2


def test_declined_tasks_do_not_consume_the_cap(monkeypatch, sweep_comments):
    # A window full of already-handled tickets must not starve the one ticket
    # that still needs a run.
    monkeypatch.setenv("SWEEP_MAX_TRIGGERS", "1")
    seen = []

    def trigger(task_id, tag, from_async_worker=False):
        seen.append(task_id)
        return triggered_result() if task_id == "needs-run" else skipped_result()

    monkeypatch.setattr(handler, "dedup_check_then_trigger", trigger)
    stub_listing(monkeypatch, [{"id": "done1"}, {"id": "done2"}, {"id": "needs-run"}])

    handler.handler(sweep_event(), None)

    assert "needs-run" in seen


def test_one_bad_task_does_not_end_the_sweep(monkeypatch, sweep_comments):
    # The next ticket may be the bug nobody has looked at.
    seen = []

    def trigger(task_id, tag, from_async_worker=False):
        seen.append(task_id)
        if task_id == "boom":
            raise RuntimeError("clickup blip")
        return triggered_result()

    monkeypatch.setattr(handler, "dedup_check_then_trigger", trigger)
    stub_listing(monkeypatch, [{"id": "boom"}, {"id": "good"}])

    resp = handler.handler(sweep_event(), None)

    assert seen == ["boom", "good"]
    assert json.loads(resp["body"])["triggered"] == 1


def test_a_listing_failure_is_loud(monkeypatch, capsys):
    # The sweep is the backstop for a feed known to drop work, so a sweep that
    # cannot list has silently returned us to missing bugs.
    def boom(tag, since):
        raise RuntimeError("clickup down")

    monkeypatch.setattr(handler, "list_recently_updated_tagged_tasks", boom)

    resp = handler.handler(sweep_event(), None)

    assert resp["statusCode"] == 500
    assert "ERROR" in capsys.readouterr().out


@pytest.mark.parametrize("task", [{}, {"id": ""}, {"id": None}, {"id": 123}, "not-a-dict", None])
def test_sweep_ignores_unusable_task_shapes(monkeypatch, sweep_calls, task):
    stub_listing(monkeypatch, [task])

    resp = handler.handler(sweep_event(), None)

    assert resp["statusCode"] == 200
    assert sweep_calls == []


def test_sweep_marker_cannot_be_forged_through_the_alb(fake_clickup, monkeypatch):
    # Same guarantee as gpbot_async: an ALB request always carries headers and
    # requestContext and lands its body as a string, so a public caller cannot
    # reach the sweep path.
    called = []
    monkeypatch.setattr(handler, "handle_sweep", lambda e: called.append(e) or {"statusCode": 200, "body": "{}"})
    event = make_event(json.dumps({"gpbot_sweep": True}))

    handler.handler(event, None)

    assert called == []


# --- window and cap parsing -------------------------------------------------


def test_the_lookback_window_bounds_the_sweep(monkeypatch):
    # Without a bound the sweep would re-run the ~170 historical tickets that
    # already carry this tag — hundreds of dollars to re-analyze closed bugs.
    monkeypatch.setenv("SWEEP_LOOKBACK_HOURS", "6")
    captured = {}

    def listing(tag, since_ms):
        captured["since"] = since_ms
        return []

    monkeypatch.setattr(handler, "list_recently_updated_tagged_tasks", listing)

    handler.handler(sweep_event(), None)

    age_hours = (time.time() * 1000 - captured["since"]) / 3600000
    assert 5.9 < age_hours < 6.1


@pytest.mark.parametrize("raw", ["", "abc", "0", "-4", "none"])
def test_unusable_sweep_settings_fall_back_to_defaults(monkeypatch, raw):
    # A typo must not disable the bound or the cap.
    monkeypatch.setenv("SWEEP_LOOKBACK_HOURS", raw)
    monkeypatch.setenv("SWEEP_MAX_TRIGGERS", raw)

    assert handler.sweep_lookback_ms() == int(handler.DEFAULT_SWEEP_LOOKBACK_HOURS * 3600 * 1000)
    assert handler.sweep_max_triggers() == handler.DEFAULT_SWEEP_MAX_TRIGGERS


@pytest.mark.parametrize(
    "result,expected",
    [
        ({"statusCode": 200, "body": json.dumps({"status": "triggered"})}, True),
        ({"statusCode": 200, "body": json.dumps({"skipped": "duplicate"})}, False),
        ({"statusCode": 200, "body": json.dumps({"skipped": "out of scope"})}, False),
        ({"statusCode": 500, "body": json.dumps({"error": "boom"})}, False),
        ({"statusCode": 200, "body": "not json"}, False),
        ({"statusCode": 200, "body": None}, False),
        ({"statusCode": 200}, False),
        (None, False),
        ("nope", False),
    ],
)
def test_launched_a_run_only_counts_real_launches(result, expected):
    assert handler.launched_a_run(result) is expected


def test_listing_asks_clickup_for_the_right_window(monkeypatch):
    captured = {}

    def fake_request(method, endpoint, data=None):
        captured["endpoint"] = endpoint
        return {"tasks": []}

    monkeypatch.setattr(handler, "clickup_request", fake_request)

    handler.list_recently_updated_tagged_tasks("gpbot-analyze", 1234567)

    assert "date_updated_gt=1234567" in captured["endpoint"]
    # The literal bracket form, not urlencode's default `tags%5B%5D=`. An
    # unrecognized filter parameter is not an error — the endpoint would return
    # every recently-updated task in the workspace and the sweep would silently
    # stop being a tag query. Asserting on the bare tag name would pass either
    # way and catch nothing.
    assert "tags[]=gpbot-analyze" in captured["endpoint"]
    # Closed tickets are settled work; re-analyzing them is pure spend.
    assert "include_closed=false" in captured["endpoint"]
    # ClickUp omits subtasks unless asked. Dropping this would make the sweep
    # silently blind to any gpbot-analyze ticket filed as a subtask — and
    # ClickUp ignores unrecognized parameters, so nothing would report it.
    assert "subtasks=true" in captured["endpoint"]


def test_listing_follows_pagination_until_a_short_page(monkeypatch):
    # Without this, a regression to the termination condition silently caps the
    # sweep at one page and the tickets behind it are never rescued.
    full = [{"id": f"t{i}"} for i in range(handler.CLICKUP_PAGE_SIZE)]
    pages = iter([{"tasks": full}, {"tasks": full}, {"tasks": [{"id": "last"}]}])
    requested = []

    def fake_request(method, endpoint, data=None):
        requested.append(endpoint)
        return next(pages)

    monkeypatch.setattr(handler, "clickup_request", fake_request)

    result = handler.list_recently_updated_tagged_tasks("gpbot-analyze", 0)

    assert len(requested) == 3
    assert [f"page={n}" in requested[n] for n in range(3)] == [True, True, True]
    assert len(result) == handler.CLICKUP_PAGE_SIZE * 2 + 1


def test_listing_stops_at_the_page_ceiling(monkeypatch):
    # A result set that never shortens must terminate rather than page forever
    # against ClickUp inside a Lambda invocation.
    full = [{"id": f"t{i}"} for i in range(handler.CLICKUP_PAGE_SIZE)]
    requested = []

    def fake_request(method, endpoint, data=None):
        requested.append(endpoint)
        return {"tasks": full}

    monkeypatch.setattr(handler, "clickup_request", fake_request)

    result = handler.list_recently_updated_tagged_tasks("gpbot-analyze", 0)

    assert len(requested) == handler.SWEEP_MAX_PAGES
    assert len(result) == handler.CLICKUP_PAGE_SIZE * handler.SWEEP_MAX_PAGES


def test_listing_tolerates_a_malformed_page(monkeypatch):
    monkeypatch.setattr(handler, "clickup_request", lambda *a, **k: {"tasks": "not-a-list"})

    assert handler.list_recently_updated_tagged_tasks("gpbot-analyze", 0) == []


# ---------------------------------------------------------------------------
# 25. The sweep's PERMANENT idempotency.
#
# The most expensive way to get this wrong. Both ordinary dedup layers expire
# after ~15 minutes by design, so that a human re-tagging hours later re-runs.
# The sweep runs every 15 minutes over a 24h window, so if it leaned on those
# layers it would re-analyze every ticket in the window on nearly every pass —
# ~96 agent runs per ticket per day. These tests pin the separate, unwindowed
# check that makes a scheduled re-offer safe.
# ---------------------------------------------------------------------------


def bot_comment(text="[GP-Bot] Analysis complete", age_seconds=86400):
    return {"comment_text": text, "date": str(int((time.time() - age_seconds) * 1000))}


def human_comment(text="Any update on this?"):
    return {"comment_text": text, "date": str(int(time.time() * 1000))}


@pytest.fixture
def sweep_comments(monkeypatch):
    """Controls what get_task_comments returns per task id."""
    by_task = {}
    monkeypatch.setattr(handler, "get_task_comments", lambda tid: by_task.get(tid, []))
    return by_task


def test_a_ticket_analyzed_yesterday_is_never_swept_again(monkeypatch, sweep_calls, sweep_comments):
    # The runaway-cost case. The bot's comment is a day old, so BOTH ordinary
    # dedup layers have long expired and would happily re-run it.
    sweep_comments["old"] = [bot_comment(age_seconds=86400)]
    stub_listing(monkeypatch, [{"id": "old"}])

    resp = handler.handler(sweep_event(), None)

    assert sweep_calls == []
    assert json.loads(resp["body"]) == {"swept": 1, "triggered": 0, "skipped": 1}


def test_repeated_sweeps_of_an_analyzed_ticket_never_re_run_it(monkeypatch, sweep_calls, sweep_comments):
    # Simulates a day of sweeps against a stable window.
    sweep_comments["old"] = [bot_comment(age_seconds=86400)]
    stub_listing(monkeypatch, [{"id": "old"}])

    for _ in range(96):
        handler.handler(sweep_event(), None)

    assert sweep_calls == []


def test_a_ticket_the_bot_has_never_touched_is_swept(monkeypatch, sweep_calls, sweep_comments):
    # The whole point: DATA-2336 got no delivery, so nobody ever looked at it.
    sweep_comments["never-seen"] = [human_comment()]
    stub_listing(monkeypatch, [{"id": "never-seen"}])

    handler.handler(sweep_event(), None)

    assert [c[0] for c in sweep_calls] == ["never-seen"]


def test_an_in_flight_run_is_not_duplicated_by_the_sweep(monkeypatch, sweep_calls, sweep_comments):
    # The webhook fired two minutes ago and the agent has posted its ack. The
    # sweep must not start a second agent on the same ticket.
    sweep_comments["running"] = [bot_comment(text="[GP-Bot] Processing started (analyze)", age_seconds=120)]
    stub_listing(monkeypatch, [{"id": "running"}])

    handler.handler(sweep_event(), None)

    assert sweep_calls == []


def test_unreadable_comments_skip_rather_than_risk_a_repeating_charge(monkeypatch, sweep_calls):
    # Fail CLOSED here specifically: guessing "not analyzed" on a schedule is
    # how one ClickUp blip becomes a recurring bill. The webhook is still the
    # primary path and the next sweep retries.
    def boom(task_id):
        raise RuntimeError("clickup blip")

    monkeypatch.setattr(handler, "get_task_comments", boom)
    stub_listing(monkeypatch, [{"id": "unknown"}])

    resp = handler.handler(sweep_event(), None)

    assert sweep_calls == []
    assert json.loads(resp["body"])["skipped"] == 1


def test_skipped_tickets_do_not_consume_the_trigger_cap(monkeypatch, sweep_calls, sweep_comments):
    monkeypatch.setenv("SWEEP_MAX_TRIGGERS", "1")
    sweep_comments.update({"a": [bot_comment()], "b": [bot_comment()], "c": [human_comment()]})
    stub_listing(monkeypatch, [{"id": "a"}, {"id": "b"}, {"id": "c"}])

    handler.handler(sweep_event(), None)

    assert [c[0] for c in sweep_calls] == ["c"]


@pytest.mark.parametrize(
    "comments,expected",
    [
        ([], False),
        ([human_comment()], False),
        ([{"comment_text": "[GP-Bot] Analysis"}], True),
        ([{"comment_text": "[GP-Bot] Processing started (analyze)"}], True),
        ([{"comment_text": "[GP-Bot] Failed to start processing: boom"}], True),
        # Text living only in the items array, the shape that broke dedup in the
        # 2026-07-14 incident.
        ([{"comment": [{"text": "[GP-Bot] Analysis"}]}], True),
        ([{"comment": [{"text": "[GP-"}, {"text": "Bot] Analysis"}]}], True),
        # Null-ish shapes must not crash, and must not be read as a bot comment.
        ([{"comment_text": None, "comment": [{"text": None}]}], False),
        ([{"comment_text": "", "comment": []}], False),
        ([None], False),
        (["not-a-dict"], False),
        ([{"comment": [None, {"text": "[GP-Bot] hi"}]}], True),
        # A human quoting the bot is indistinguishable from the bot, and that is
        # the safe direction: at worst one ticket waits for the webhook.
        ([{"comment_text": "the [GP-Bot] comment above is wrong"}], True),
    ],
)
def test_has_any_bot_comment_shape_tolerance(comments, expected):
    assert handler.has_any_bot_comment(comments) is expected


def test_the_permanent_check_is_unwindowed_unlike_the_dedup_layers():
    # Pins the distinction itself: a marker far older than the dedup window
    # still counts here, and does not count there.
    ancient = [bot_comment(text="[GP-Bot] Processing started (analyze)", age_seconds=30 * 86400)]

    assert handler.has_any_bot_comment(ancient) is True
    assert handler.has_processing_started_comment(ancient, "analyze") is False


# ---------------------------------------------------------------------------
# CI drive: launching a run to get a [GP-Bot] PR's checks green
#
# This dispatch is reachable only by something holding AWS credentials
# (.github/workflows/gpbot-ci-drive.yml), and unlike every other trigger it
# consults no tag and opens no ticket — so the payload guards are the only thing
# standing between a malformed request and an agent that can push code.
# ---------------------------------------------------------------------------


def ci_fix_event(task_id: str | None = "abc123", pr_number=1306) -> dict:
    event: dict = {"gpbot_ci_fix": True, "pr_number": pr_number}
    if task_id is not None:
        event["clickup_task_id"] = task_id
    return event


def test_ci_fix_request_launches_a_run_labelled_ci_fix(fake_clickup, fake_ecs, ecs_env):
    # AGENT_LABEL is what engineer_agent gates its analyze->implement escalation
    # on, so a CI fix run carrying "analyze" could queue an implementation run
    # off the back of a CI failure. It must be its own label.
    handler.handler(ci_fix_event(), None)

    assert len(fake_ecs.run_task_calls) == 1
    env = engineer_agent_env(fake_ecs.run_task_calls[0])
    assert env["AGENT_LABEL"] == handler.CI_FIX_LABEL
    assert env["CLICKUP_TASK_ID"] == "abc123"


def test_a_launched_fix_run_answers_the_workflow_with_a_200(fake_clickup, fake_ecs, ecs_env):
    # gpbot-ci-drive.yml reads `.statusCode` out of the invoke response to tell a
    # launch from a silent failure, and now fails the step when it is not 200.
    # handle_ci_fix forwards trigger_fargate_task's return value untouched, so a
    # drift in that shape would report every successful launch as failed — the
    # PR's slot spent, the run running, and the workflow red over nothing.
    resp = handler.handler(ci_fix_event(), None)

    assert resp["statusCode"] == 200
    assert response_body(resp)["status"] == "triggered"


def test_the_fix_instruction_names_the_pr_to_push_to(fake_clickup, fake_ecs, ecs_env):
    # A fix run that cannot tell which PR it is fixing is a fix run that opens a
    # second PR, which is the outcome this whole path exists to avoid.
    handler.handler(ci_fix_event(pr_number=1306), None)

    assert "#1306" in engineer_agent_env(fake_ecs.run_task_calls[0])["INSTRUCTION"]


def test_the_fix_instruction_forbids_weakening_tests_and_merging(fake_clickup, fake_ecs, ecs_env):
    # The two prohibitions that turn this feature from useful into dangerous if
    # they are ever dropped from the prompt. A green check bought by a deleted
    # test is strictly worse than the red check it replaced, and the contract of
    # the whole bot is that a human decides what lands.
    handler.handler(ci_fix_event(), None)

    instruction = engineer_agent_env(fake_ecs.run_task_calls[0])["INSTRUCTION"].lower()
    assert "never weaken a test" in instruction
    assert "never merge this pr" in instruction
    assert "gh pr merge" in instruction
    assert "never open a second pr" in instruction


def test_the_fix_instruction_tells_the_agent_to_stop_on_an_infra_failure(fake_clickup, fake_ecs, ecs_env):
    # The triage in ci_triage.py only sends deterministic failures here, but its
    # signature list is not exhaustive, so the agent is the second line of the
    # same defence: an infra or pre-existing failure must produce a comment, not
    # a code change.
    handler.handler(ci_fix_event(), None)

    instruction = engineer_agent_env(fake_ecs.run_task_calls[0])["INSTRUCTION"].lower()
    assert "change nothing" in instruction
    assert "main" in instruction


@pytest.mark.parametrize(
    "task_id",
    [None, "", "not a task id", "../../etc/passwd", "abc/def", "x" * 65],
)
def test_a_malformed_task_id_launches_nothing(fake_clickup, fake_ecs, ecs_env, capsys, task_id):
    # The id is interpolated into a ClickUp URL path and this payload does not
    # come through the signature-verified webhook, so it is validated rather
    # than trusted.
    resp = handler.handler(ci_fix_event(task_id=task_id), None)

    assert resp["statusCode"] == 400
    assert_no_side_effects(fake_clickup, fake_ecs)
    assert_alarm_log_emitted(capsys)


@pytest.mark.parametrize("pr_number", [None, 0, -1, "1306", 1.5, True, 10_000_000])
def test_a_malformed_pr_number_launches_nothing(fake_clickup, fake_ecs, ecs_env, capsys, pr_number):
    # True is in the list on purpose: bool subclasses int, so an isinstance check
    # alone would accept it and format the instruction against "PR #True".
    resp = handler.handler(ci_fix_event(pr_number=pr_number), None)

    assert resp["statusCode"] == 400
    assert_no_side_effects(fake_clickup, fake_ecs)
    assert_alarm_log_emitted(capsys)


def test_a_ci_fix_payload_arriving_through_the_alb_is_not_dispatched(fake_clickup, fake_ecs, ecs_env):
    # Same unspoofable-through-the-ALB contract as the async and sweep markers,
    # and it matters most here: this dispatch checks no tag and no signature, so
    # a public request that reached it could launch a run that pushes code. An
    # ALB-wrapped request always carries "headers", and its JSON stays a string
    # inside event["body"].
    resp = handler.handler({"headers": {}, "body": json.dumps(ci_fix_event())}, None)

    assert resp["statusCode"] != 200 or response_body(resp).get("status") != "triggered"
    assert_no_side_effects(fake_clickup, fake_ecs)


def test_a_second_concurrent_ci_fix_for_one_ticket_is_suppressed(
    fake_clickup, fake_ecs, ecs_env, dedup_table_env, fake_dynamodb
):
    # The per-PR budget lives in the drive's marker comment, but two workflow
    # runs racing on the same PR would both read the same pre-write state. The
    # existing atomic claim is the concurrency guard underneath it.
    fake_dynamodb.put_item_exception = conditional_check_failed()

    resp = handler.handler(ci_fix_event(), None)

    assert response_body(resp)["skipped"] == "duplicate suppressed"
    assert_no_side_effects(fake_clickup, fake_ecs)


def test_a_failed_ci_fix_launch_releases_its_claim(fake_clickup, fake_ecs, ecs_env, dedup_table_env, fake_dynamodb):
    # A claim left behind by a launch that never happened would suppress the
    # next attempt for the whole TTL, silently costing the PR a round.
    fake_ecs.exception = RuntimeError("ECS is down")

    handler.handler(ci_fix_event(), None)

    assert len(fake_dynamodb.delete_item_calls) == 1


def test_the_ci_fix_claim_is_scoped_to_its_own_label(fake_clickup, fake_ecs, ecs_env, dedup_table_env, fake_dynamodb):
    # Sharing a claim key with the implement run would let a recent gpbot-work
    # launch silently suppress the CI drive for the same ticket.
    handler.handler(ci_fix_event(), None)

    assert fake_dynamodb.put_item_calls[0]["Item"]["pk"]["S"] == f"abc123#{handler.CI_FIX_LABEL}"


def test_ci_fix_never_raises_into_the_lambda_runtime(fake_clickup, fake_ecs, ecs_env, monkeypatch, capsys):
    # The caller is an `aws lambda invoke` step in a workflow. An escaping
    # exception surfaces there as a Lambda stack trace with nothing on the
    # ticket, so failures are logged fail-loud and returned instead.
    monkeypatch.setattr(handler, "trigger_fargate_task", _raise_boom)

    resp = handler.handler(ci_fix_event(), None)

    assert resp["statusCode"] == 500
    assert_alarm_log_emitted(capsys)


def test_a_ci_fix_that_raises_before_returning_still_releases_its_claim(
    fake_clickup, fake_ecs, ecs_env, dedup_table_env, fake_dynamodb, monkeypatch
):
    # trigger_fargate_task handles its own failures and returns a status, but not
    # all of it is inside that try — building the ECS client and reading its env
    # vars run first, so a boto3 failure there propagates out. Releasing only on
    # the returned status leaves the claim held for the full TTL, and the drive's
    # next attempt on that PR is then suppressed with no run behind it.
    monkeypatch.setattr(handler, "trigger_fargate_task", _raise_boom)

    handler.handler(ci_fix_event(), None)

    assert len(fake_dynamodb.delete_item_calls) == 1


def test_a_ci_fix_refused_before_it_claims_anything_releases_nothing(
    fake_clickup, fake_ecs, ecs_env, dedup_table_env, fake_dynamodb, monkeypatch
):
    # The other half of the same guard. Deleting unconditionally in the handler
    # would let a request that never held the claim delete the one a concurrent
    # launch is holding, which is exactly the duplicate-agent race the claim
    # exists to prevent.
    monkeypatch.setattr(handler, "try_acquire_dedup_lock", _raise_boom)

    handler.handler(ci_fix_event(), None)

    assert fake_dynamodb.delete_item_calls == []


def _raise_boom(*args, **kwargs):
    raise RuntimeError("boom")


def test_ci_fix_is_not_reachable_from_a_clickup_tag():
    # gpbot-work and gpbot-analyze are applied by ClickUp Automations, one of
    # them workspace-wide. A tag that could launch a PR-pushing run against an
    # arbitrary PR number has no business existing.
    assert handler.CI_FIX_LABEL not in {config["label"] for config in handler.TAG_CONFIG.values()}
