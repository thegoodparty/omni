import logging
import os
import time
import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from broker.auth import hash_service_token
from broker.dynamodb_client import (
    JUDGE_RUN_ID_MAX_LENGTH,
    JUDGE_RUN_ID_PREFIX,
    InputFileRef,
    ScopeTicket,
    ScopeTicketStore,
    TicketAlreadyExistsError,
)
from broker.endpoints.mint_run_token import (
    get_service_token_hash,
    get_ticket_store,
    router,
)

SERVICE_TOKEN = "test-dispatch-lambda-token"
SERVICE_TOKEN_HASH = hash_service_token(SERVICE_TOKEN)
DEFAULT_CLERK_USER_ID = "user_test_abc123"


def _create_test_app(
    store: ScopeTicketStore | None = None,
    token_hash: str = SERVICE_TOKEN_HASH,
) -> FastAPI:
    app = FastAPI()
    app.include_router(router)

    _store = store or MagicMock(spec=ScopeTicketStore)

    app.dependency_overrides[get_ticket_store] = lambda: _store
    app.dependency_overrides[get_service_token_hash] = lambda: token_hash

    return app


def _mint_payload(**overrides) -> dict:
    base = {
        "run_id": "run-20260415-001",
        "organization_slug": "org-42",
        "experiment_id": "voter_targeting",
        "scope": {"databricks": ["SELECT"]},
        "params": {"state": "CA", "district": "SD-15"},
        "clerk_user_id": DEFAULT_CLERK_USER_ID,
    }
    base.update(overrides)
    return base


class TestMintRunTokenSuccess:
    def test_returns_200_with_broker_token_and_exp(self):
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        before = int(time.time())
        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        after = int(time.time())

        assert resp.status_code == 200
        body = resp.json()

        uuid.UUID(body["broker_token"])

        assert body["exp"] >= before + 3600
        assert body["exp"] <= after + 3600
        assert body["params_clean"] == {"state": "CA", "district": "SD-15"}

    def test_stores_scope_ticket_in_dynamodb(self):
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )

        assert resp.status_code == 200
        store.put_ticket.assert_called_once()

        ticket: ScopeTicket = store.put_ticket.call_args[0][0]
        assert ticket.pk == resp.json()["broker_token"]
        assert ticket.run_id == "run-20260415-001"
        assert ticket.organization_slug == "org-42"
        assert ticket.experiment_id == "voter_targeting"
        assert ticket.issued_by == "dispatch_lambda"


class TestMintRunTokenAuth:
    def test_missing_auth_header_returns_401(self):
        app = _create_test_app()
        client = TestClient(app)

        resp = client.post("/internal/mint-run-token", json=_mint_payload())
        assert resp.status_code == 401

    def test_invalid_service_token_returns_401(self):
        app = _create_test_app()
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(),
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert resp.status_code == 401


class TestMintRunTokenTTLCap:
    def test_ttl_above_max_is_rejected(self):
        """Caller asks for a TTL beyond MAX_TTL_SECONDS — reject loudly so a
        misconfigured dispatch (e.g., experiment with absurd timeout) is
        visible as a 400 instead of silently clamping. Silent clamp means
        agent thinks it has more time and 401s mid-run; row sticks RUNNING
        forever in gp-api.
        """
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(exp_ttl_seconds=999999),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        assert resp.status_code == 400
        assert "exp_ttl_seconds" in resp.json()["detail"].lower() or "max" in resp.json()["detail"].lower()

    def test_ttl_below_cap_honored(self):
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        before = int(time.time())
        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(exp_ttl_seconds=1800),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        after = int(time.time())

        assert resp.status_code == 200
        body = resp.json()
        assert body["exp"] >= before + 1800
        assert body["exp"] <= after + 1800


class TestMintRunTokenTTLVsTimeout:
    """The ticket MUST outlive the experiment's timeout, or the agent's publish
    call will 401 at the finish line and the row sticks in RUNNING forever.
    Mint enforces exp >= timeout_seconds + buffer when the caller supplies
    timeout_seconds, even if they request a shorter exp_ttl_seconds.
    """

    def test_ttl_floor_matches_timeout_plus_buffer(self):
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        before = int(time.time())
        # Caller asks for a too-short TTL relative to the experiment timeout.
        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(exp_ttl_seconds=600, timeout_seconds=3000),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        after = int(time.time())

        assert resp.status_code == 200
        body = resp.json()
        # Floor = timeout (3000) + buffer (300) = 3300 seconds.
        assert body["exp"] >= before + 3300
        assert body["exp"] <= after + 3300

    def test_ttl_honored_when_already_exceeds_timeout(self):
        """If caller already requests enough TTL, keep what they asked for."""
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        before = int(time.time())
        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(exp_ttl_seconds=3900, timeout_seconds=3000),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        after = int(time.time())

        assert resp.status_code == 200
        body = resp.json()
        assert body["exp"] >= before + 3900
        assert body["exp"] <= after + 3900

    def test_ttl_cap_still_enforced_when_timeout_large(self):
        """Timeout + buffer can't exceed MAX_TTL_SECONDS — reject loudly so
        ops notices the misconfigured experiment rather than silently clamping.
        """
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(exp_ttl_seconds=3600, timeout_seconds=200000),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        assert resp.status_code == 400
        assert "timeout_seconds" in resp.json()["detail"].lower()


class TestMintRunTokenConflict:
    def test_duplicate_ticket_returns_409(self):
        store = MagicMock(spec=ScopeTicketStore)
        store.put_ticket.side_effect = TicketAlreadyExistsError("already exists")
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        assert resp.status_code == 409

    def test_duplicate_run_id_returns_409(self):
        import boto3
        from moto import mock_aws

        with mock_aws():
            ddb = boto3.client("dynamodb", region_name="us-west-2")
            ddb.create_table(
                TableName="scope-tickets-conflict",
                AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}],
                KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}],
                BillingMode="PAY_PER_REQUEST",
            )
            store = ScopeTicketStore("scope-tickets-conflict", dynamodb_client=ddb)
            app = _create_test_app(store=store)
            client = TestClient(app)

            first = client.post(
                "/internal/mint-run-token",
                json=_mint_payload(run_id="run-SQS-redelivery"),
                headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
            )
            assert first.status_code == 200

            second = client.post(
                "/internal/mint-run-token",
                json=_mint_payload(run_id="run-SQS-redelivery"),
                headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
            )
            assert second.status_code == 409


class TestMintRunTokenIdentifierValidation:
    """Identifiers are composed into S3 keys like
    `{experiment_id}/{organization_slug}/latest.json`. A poisoned value like
    `../other_org` would let a run escape its intended prefix. Pydantic
    validation rejects unsafe identifiers at the boundary.
    """

    def test_rejects_run_id_with_path_traversal(self):
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(run_id="../../other"),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        assert resp.status_code == 422

    def test_rejects_organization_slug_with_slash(self):
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(organization_slug="org/../foo"),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        assert resp.status_code == 422

    def test_rejects_experiment_id_too_long(self):
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(experiment_id="a" * 65),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        assert resp.status_code == 422

    def test_accepts_valid_identifiers(self):
        """Regression guard — the validator must still accept legit
        production values like slugs with hyphens and snake_case experiment IDs.
        """
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(
                run_id="run-abc123",
                organization_slug="yakima-city-council-2",
                experiment_id="voter_targeting",
            ),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        assert resp.status_code == 200


class TestMintRunTokenPriorArtifactVersions:
    """STALE invariant: `peer_city_benchmarking`/`meeting_briefing` must read
    the exact district_intel snapshot they were dispatched against. Dispatch
    supplies `prior_artifact_versions` on mint; the ticket persists the map so
    artifact_read can enforce the pin.
    """

    def test_prior_artifact_versions_roundtrips_to_ticket(self):
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        pinned = {"district_intel": "district_intel/org/run-1/artifact.json"}
        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(prior_artifact_versions=pinned),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )

        assert resp.status_code == 200
        store.put_ticket.assert_called_once()
        ticket: ScopeTicket = store.put_ticket.call_args[0][0]
        assert ticket.prior_artifact_versions == pinned

    def test_prior_artifact_versions_optional(self):
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )

        assert resp.status_code == 200
        ticket: ScopeTicket = store.put_ticket.call_args[0][0]
        assert ticket.prior_artifact_versions is None


class TestMintRunTokenInputFiles:
    """User-uploaded inputs (e.g. agenda PDFs) flow as enumerated S3 refs:
    dispatch supplies `input_files` on mint; the ticket persists the list so
    /inputs/read can enforce that the runner only fetches refs gp-api
    authorized for this run.
    """

    def test_input_files_roundtrips_to_ticket(self):
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        refs = [
            {
                "bucket": "gp-agent-run-inputs-dev",
                "key": "uploads/org/abc/agenda.pdf",
                "dest": "agenda.pdf",
            }
        ]
        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(input_files=refs),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )

        assert resp.status_code == 200
        store.put_ticket.assert_called_once()
        ticket: ScopeTicket = store.put_ticket.call_args[0][0]
        assert ticket.input_files == [
            InputFileRef(
                bucket="gp-agent-run-inputs-dev",
                key="uploads/org/abc/agenda.pdf",
                dest="agenda.pdf",
            )
        ]

    def test_input_files_optional(self):
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )

        assert resp.status_code == 200
        ticket: ScopeTicket = store.put_ticket.call_args[0][0]
        assert ticket.input_files is None

    def test_input_files_rejects_unsafe_dest(self):
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(input_files=[{"bucket": "b", "key": "k", "dest": "../etc/passwd"}]),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )

        assert resp.status_code == 422
        store.put_ticket.assert_not_called()

    def test_input_files_rejects_foreign_bucket(self, monkeypatch):
        """The broker task role can GetObject on the artifact and metadata
        buckets too, so a ticket must only ever authorize the env's own inputs
        bucket. A ref naming any other bucket is rejected at mint so it can
        never reach /inputs/read.
        """
        monkeypatch.setenv("ENVIRONMENT", "dev")
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(
                input_files=[
                    {
                        "bucket": "gp-agent-artifacts-dev",
                        "key": "other-org/run-9/artifact.json",
                        "dest": "agenda.pdf",
                    }
                ]
            ),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )

        assert resp.status_code == 400
        assert "bucket" in resp.json()["detail"].lower()
        store.put_ticket.assert_not_called()

    def test_input_files_honors_environment_bucket(self, monkeypatch):
        """A ref naming the env's own inputs bucket passes the gate."""
        monkeypatch.setenv("ENVIRONMENT", "dev")
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(
                input_files=[
                    {
                        "bucket": "gp-agent-run-inputs-dev",
                        "key": "uploads/org/abc/agenda.pdf",
                        "dest": "agenda.pdf",
                    }
                ]
            ),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )

        assert resp.status_code == 200
        store.put_ticket.assert_called_once()


class TestMintRunTokenClerkUserIdOnTicket:
    """Mint stores clerk_user_id directly on the ticket; no Clerk API calls."""

    def test_clerk_user_id_optional_stored_as_none(self):
        """Callers that don't need MCP-proxy access can omit clerk_user_id. Mint
        then stores clerk_user_id=None on the ticket; agent_mcp_proxy will
        reject such tickets with reason=ticket_missing_clerk_user_id."""
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        payload = _mint_payload()
        del payload["clerk_user_id"]

        resp = client.post(
            "/internal/mint-run-token",
            json=payload,
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )

        assert resp.status_code == 200
        ticket: ScopeTicket = store.put_ticket.call_args[0][0]
        assert ticket.clerk_user_id is None

    def test_clerk_user_id_persisted_on_ticket(self):
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )

        assert resp.status_code == 200
        ticket: ScopeTicket = store.put_ticket.call_args[0][0]
        assert ticket.clerk_user_id == DEFAULT_CLERK_USER_ID


class TestFailureLogging:
    """Every failure path on mint must surface a structured warning so on-call
    can grep CloudWatch when a dispatch run mysteriously fails to mint. Without
    these logs the endpoint is a black box — a non-2xx response goes out and
    no operator-visible breadcrumb exists. Success is logged at info so the
    optional-Clerk path (clerk_session=present|absent) is observable too.

    Each assertion checks (a) a stable greppable failure-mode token and
    (b) the run_id is included so a specific run can be traced end-to-end.
    """

    LOGGER_NAME = "broker.endpoints.mint_run_token"

    def test_logs_warning_on_invalid_service_token(self, caplog):
        caplog.set_level(logging.WARNING, logger=self.LOGGER_NAME)
        app = _create_test_app()
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(run_id="run-bad-token"),
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert resp.status_code == 401
        assert any("invalid_service_token" in r.message for r in caplog.records if r.name == self.LOGGER_NAME), (
            f"missing invalid_service_token warning; got: {[r.message for r in caplog.records]}"
        )

    def test_logs_warning_on_ttl_above_cap(self, caplog):
        caplog.set_level(logging.WARNING, logger=self.LOGGER_NAME)
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(run_id="run-ttl-cap", exp_ttl_seconds=999999),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        assert resp.status_code == 400
        assert any(
            "ttl_above_cap" in r.message and "run_id=run-ttl-cap" in r.message
            for r in caplog.records
            if r.name == self.LOGGER_NAME
        ), f"missing ttl_above_cap warning; got: {[r.message for r in caplog.records]}"

    def test_logs_warning_on_timeout_plus_buffer_above_cap(self, caplog):
        caplog.set_level(logging.WARNING, logger=self.LOGGER_NAME)
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(
                run_id="run-timeout-cap",
                exp_ttl_seconds=3600,
                timeout_seconds=200000,
            ),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        assert resp.status_code == 400
        assert any(
            "timeout_plus_buffer_above_cap" in r.message and "run_id=run-timeout-cap" in r.message
            for r in caplog.records
            if r.name == self.LOGGER_NAME
        ), f"missing timeout_plus_buffer_above_cap warning; got: {[r.message for r in caplog.records]}"

    def test_logs_warning_on_ticket_collision(self, caplog):
        caplog.set_level(logging.WARNING, logger=self.LOGGER_NAME)
        store = MagicMock(spec=ScopeTicketStore)
        store.put_ticket.side_effect = TicketAlreadyExistsError("already exists")
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(run_id="run-collision"),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        assert resp.status_code == 409
        assert any(
            "ticket_already_exists" in r.message and "run_id=run-collision" in r.message
            for r in caplog.records
            if r.name == self.LOGGER_NAME
        ), f"missing ticket_already_exists warning; got: {[r.message for r in caplog.records]}"

    def test_logs_info_on_success_with_clerk_user_id(self, caplog):
        caplog.set_level(logging.INFO, logger=self.LOGGER_NAME)
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        resp = client.post(
            "/internal/mint-run-token",
            json=_mint_payload(run_id="run-ok-clerk"),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        assert resp.status_code == 200
        assert any(
            "mint_run_token ok" in r.message
            and "run_id=run-ok-clerk" in r.message
            and "clerk_user=present" in r.message
            for r in caplog.records
            if r.name == self.LOGGER_NAME and r.levelno == logging.INFO
        ), f"missing success info log with clerk_user=present; got: {[r.message for r in caplog.records]}"

    def test_logs_info_on_success_without_clerk_user_id(self, caplog):
        caplog.set_level(logging.INFO, logger=self.LOGGER_NAME)
        store = MagicMock(spec=ScopeTicketStore)
        app = _create_test_app(store=store)
        client = TestClient(app)

        payload = _mint_payload(run_id="run-ok-no-clerk")
        del payload["clerk_user_id"]
        resp = client.post(
            "/internal/mint-run-token",
            json=payload,
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
        assert resp.status_code == 200
        assert any(
            "mint_run_token ok" in r.message
            and "run_id=run-ok-no-clerk" in r.message
            and "clerk_user=absent" in r.message
            for r in caplog.records
            if r.name == self.LOGGER_NAME and r.levelno == logging.INFO
        ), f"missing success info log with clerk_user=absent; got: {[r.message for r in caplog.records]}"


class TestMintJudgeFields:
    """The enforcement half of the judge override contract.

    The dispatch Lambda mints the allowlist; this endpoint is what turns it
    into a ScopeTicket the broker's `/experiment/manifest` will honor. Split
    across two PRs, this half did not exist and pydantic silently dropped what
    dispatch sent — the ticket carried no override and every judge run read the
    published bytes.

    A SERVICE_TOKEN holder is authenticated, not trusted, so every judge
    invariant dispatch establishes is re-established here.
    """

    MANIFEST_KEY = "_judge/voter_targeting/abc123def456/manifest.json"
    INSTRUCTION_KEY = "_judge/voter_targeting/abc123def456/instruction.md"
    JUDGE_RUN_ID = "_judge-run-001"
    PRODUCT_RUN_ID = "0199b4c0-7b1e-7000-8000-0123456789ab"

    @pytest.fixture(autouse=True)
    def _dev_environment(self, monkeypatch):
        """An override is dev-only at the broker as well as at dispatch."""
        monkeypatch.setenv("ENVIRONMENT", "dev")

    def _override(self, **overrides) -> dict:
        base = {
            "manifest_key": self.MANIFEST_KEY,
            "instruction_key": self.INSTRUCTION_KEY,
            "manifest_version_id": "override-m-1",
            "instruction_version_id": "override-i-1",
        }
        base.update(overrides)
        return base

    def _post(self, store, **payload_overrides):
        app = _create_test_app(store=store)
        return TestClient(app).post(
            "/internal/mint-run-token",
            json=_mint_payload(**payload_overrides),
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )

    def _judge(self, **payload_overrides):
        return {"run_id": self.JUDGE_RUN_ID, "is_eval": True, **payload_overrides}

    def test_override_and_eval_flag_reach_the_stored_ticket(self):
        store = MagicMock(spec=ScopeTicketStore)

        resp = self._post(store, **self._judge(experiment_override=self._override()))

        assert resp.status_code == 200
        ticket = store.put_ticket.call_args.args[0]
        assert ticket.is_eval is True
        assert ticket.experiment_override is not None
        assert ticket.experiment_override.manifest_key == self.MANIFEST_KEY
        assert ticket.experiment_override.instruction_key == self.INSTRUCTION_KEY
        assert ticket.experiment_override.manifest_version_id == "override-m-1"
        assert ticket.experiment_override.instruction_version_id == "override-i-1"

    def test_eval_flag_alone_is_accepted_for_a_base_arm(self):
        """A sweep's base arm runs the published bytes with no override, and
        its callback still has to be suppressed."""
        store = MagicMock(spec=ScopeTicketStore)

        resp = self._post(store, **self._judge())

        assert resp.status_code == 200
        ticket = store.put_ticket.call_args.args[0]
        assert ticket.is_eval is True
        assert ticket.experiment_override is None

    def test_a_product_mint_stores_neither_judge_field(self):
        store = MagicMock(spec=ScopeTicketStore)

        resp = self._post(store, run_id=self.PRODUCT_RUN_ID)

        assert resp.status_code == 200
        ticket = store.put_ticket.call_args.args[0]
        assert ticket.is_eval is False
        assert ticket.experiment_override is None

    def test_is_eval_on_a_product_run_id_is_a_400(self):
        """The load-bearing binding. `is_eval` makes the broker drop this run's
        success callback AND every terminal status, so a token holder who could
        set it against a real run id could hide a genuine product failure from
        gp-api until the 45-minute stale sweep."""
        store = MagicMock(spec=ScopeTicketStore)

        resp = self._post(store, run_id=self.PRODUCT_RUN_ID, is_eval=True)

        assert resp.status_code == 400
        assert "is_eval" in resp.json()["detail"]
        store.put_ticket.assert_not_called()

    def test_a_judge_run_id_without_is_eval_is_a_400(self):
        """The converse is a wiring bug rather than an attack: it posts
        callbacks gp-api cannot match, one error per run."""
        store = MagicMock(spec=ScopeTicketStore)

        resp = self._post(store, run_id=self.JUDGE_RUN_ID)

        assert resp.status_code == 400
        store.put_ticket.assert_not_called()

    def test_override_without_the_eval_flag_is_a_400(self):
        store = MagicMock(spec=ScopeTicketStore)

        resp = self._post(store, run_id=self.JUDGE_RUN_ID, experiment_override=self._override())

        assert resp.status_code == 400
        store.put_ticket.assert_not_called()

    def test_a_judge_run_id_at_the_dispatch_cap_is_accepted(self):
        """The boundary itself is legal — the longest run id dispatch will
        accept must still mint, or a real sweep arm would 400."""
        store = MagicMock(spec=ScopeTicketStore)
        run_id = JUDGE_RUN_ID_PREFIX + "a" * (JUDGE_RUN_ID_MAX_LENGTH - len(JUDGE_RUN_ID_PREFIX))
        assert len(run_id) == JUDGE_RUN_ID_MAX_LENGTH

        resp = self._post(store, **self._judge(run_id=run_id))

        assert resp.status_code == 200
        assert store.put_ticket.call_args.args[0].run_id == run_id

    def test_a_judge_run_id_over_the_dispatch_cap_is_a_400(self):
        """The prefix check alone passed anything up to IDENTIFIER_PATTERN's 64
        characters. The dispatch Lambda `fullmatch`es JUDGE_RUN_ID_RE and
        refuses a longer run id outright, because it hands the run id to ECS
        RunTask as `startedBy` verbatim and the task reaper reads it back — so
        a ticket minted here for a longer one is a live credential for a run
        the layer above will never dispatch. A SERVICE_TOKEN holder is
        authenticated, not trusted; mint re-establishes the whole shape, not
        just the prefix."""
        store = MagicMock(spec=ScopeTicketStore)
        run_id = JUDGE_RUN_ID_PREFIX + "a" * (JUDGE_RUN_ID_MAX_LENGTH - len(JUDGE_RUN_ID_PREFIX) + 1)
        assert len(run_id) == JUDGE_RUN_ID_MAX_LENGTH + 1

        resp = self._post(store, **self._judge(run_id=run_id))

        assert resp.status_code == 400
        assert "startedBy" in resp.json()["detail"]
        store.put_ticket.assert_not_called()

    def test_the_rejection_does_not_echo_the_run_id(self):
        """The 400 body is returned to a caller that may not be dispatch. The
        other judge rejections keep the run id out of the response too — it
        goes to the log line, which is ours."""
        store = MagicMock(spec=ScopeTicketStore)
        run_id = JUDGE_RUN_ID_PREFIX + "z" * (JUDGE_RUN_ID_MAX_LENGTH - len(JUDGE_RUN_ID_PREFIX) + 1)

        resp = self._post(store, **self._judge(run_id=run_id))

        assert resp.status_code == 400
        assert run_id not in resp.json()["detail"]

    def test_a_long_product_run_id_is_untouched_by_the_judge_cap(self):
        """The cap is the judge dispatch contract, not a product one. A product
        mint keeps whatever IDENTIFIER_PATTERN already allowed — narrowing it
        here would reject run ids gp-api is free to mint."""
        store = MagicMock(spec=ScopeTicketStore)
        run_id = "a" * 64

        resp = self._post(store, run_id=run_id)

        assert resp.status_code == 200
        assert store.put_ticket.call_args.args[0].run_id == run_id

    @pytest.mark.parametrize("environment", ["prod", "production", "qa", ""])
    def test_an_eval_run_outside_dev_is_a_400(self, environment):
        """Dev-only on `is_eval` itself, not just on the override, and at the
        broker as well as upstream in the Lambda.

        A sweep's base arm sets `is_eval` with no override at all and gets
        every consequence of it — both callback senders silenced, the org's
        `latest.json` left alone. In prod that is a run spending real money
        that gp-api has no row for and no signal about. An allowlist, not a
        deny-prod check, and with no permissive default."""
        store = MagicMock(spec=ScopeTicketStore)

        with patch.dict(os.environ, {"ENVIRONMENT": environment}):
            resp = self._post(store, **self._judge())

            assert resp.status_code == 400
            assert "ENVIRONMENT" in resp.json()["detail"]
        store.put_ticket.assert_not_called()

    @pytest.mark.parametrize("environment", ["prod", "production", "qa", ""])
    def test_an_override_outside_dev_is_a_400(self, environment):
        store = MagicMock(spec=ScopeTicketStore)

        with patch.dict(os.environ, {"ENVIRONMENT": environment}):
            resp = self._post(store, **self._judge(experiment_override=self._override()))

            assert resp.status_code == 400
            assert "ENVIRONMENT" in resp.json()["detail"]
        store.put_ticket.assert_not_called()

    @pytest.mark.parametrize("environment", ["prod", "production", "qa", ""])
    def test_a_product_mint_is_untouched_by_the_environment_gate(self, environment):
        """The gate keys on `is_eval`, so a product mint works in every
        environment exactly as it does today."""
        store = MagicMock(spec=ScopeTicketStore)

        with patch.dict(os.environ, {"ENVIRONMENT": environment}):
            resp = self._post(store, run_id=self.PRODUCT_RUN_ID)

        assert resp.status_code == 200
        assert store.put_ticket.call_args.args[0].is_eval is False

    def test_override_for_another_agent_is_a_400(self):
        """The agentId segment is bound to the experiment being minted: without
        it a ticket for experiment A could be handed experiment B's staged
        candidate bytes."""
        store = MagicMock(spec=ScopeTicketStore)

        resp = self._post(
            store,
            **self._judge(
                experiment_override=self._override(
                    manifest_key="_judge/walking_plan/abc123def456/manifest.json",
                    instruction_key="_judge/walking_plan/abc123def456/instruction.md",
                )
            ),
        )

        assert resp.status_code == 400
        assert "does not match experiment_id" in resp.json()["detail"]
        store.put_ticket.assert_not_called()

    def test_override_outside_the_judge_prefix_is_a_422(self):
        store = MagicMock(spec=ScopeTicketStore)

        resp = self._post(
            store,
            **self._judge(experiment_override=self._override(manifest_key="voter_targeting/manifest.json")),
        )

        assert resp.status_code == 422
        store.put_ticket.assert_not_called()

    def test_override_without_a_version_pin_is_a_422(self):
        store = MagicMock(spec=ScopeTicketStore)
        override = self._override()
        del override["manifest_version_id"]

        resp = self._post(store, **self._judge(experiment_override=override))

        assert resp.status_code == 422
        store.put_ticket.assert_not_called()

    def test_an_unknown_mint_field_is_refused_rather_than_dropped(self):
        """`extra="forbid"`. A mint field this model merely accepted is an
        authorization the ticket never carries — which is exactly how the judge
        override shipped inert. A 422 on the first request beats a silent
        drop."""
        store = MagicMock(spec=ScopeTicketStore)

        resp = self._post(store, judge_override=self._override())

        assert resp.status_code == 422
        store.put_ticket.assert_not_called()
