import socket
import time

import pytest

from broker.dynamodb_client import ScopeTicket
from broker.secrets import BrokerSecrets


@pytest.fixture
def fake_public_dns(monkeypatch):
    """Resolve every hostname to one public address, so endpoint tests that post
    real-looking URLs run the real SSRF guard without a live DNS lookup. A CI
    resolver hiccup on linc.osbm.nc.gov failed main's gp-ai run on 2026-11-06."""

    def _getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.215.14", port))]

    monkeypatch.setattr(socket, "getaddrinfo", _getaddrinfo)


@pytest.fixture
def fake_scope_ticket() -> ScopeTicket:
    now = int(time.time())
    return ScopeTicket(
        pk="broker-token-test-abc123",
        run_id="run-20260415-001",
        organization_slug="org-42",
        experiment_id="voter_targeting",
        scope={"databricks": ["SELECT"], "s3": ["PutObject"]},
        params={"state": "CA", "district": "SD-15", "election_type": "general"},
        exp=now + 3600,
        issued_at=now,
        issued_by="dispatch-lambda-dev",
    )


@pytest.fixture
def fake_secrets() -> BrokerSecrets:
    return BrokerSecrets(
        anthropic_api_key="sk-ant-fake-key-for-testing",
        databricks_server_hostname="test-workspace.cloud.databricks.com",
        databricks_http_path="/sql/1.0/warehouses/test123",
        databricks_api_key="dapi-fake-key-for-testing",
        service_token_hash="a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        clerk_secret_key="sk_test_fake_clerk_secret",
        clerk_frontend_api_base="https://fake.clerk.app",
        gp_api_base_url="https://gp-api-dev.goodparty.org",
        agent_fleet_clerk_id="user_agent_fleet_test",
        agent_mcp_token_secret="test-agent-mcp-secret",
        results_queue_url="https://sqs.us-west-2.amazonaws.com/333022194791/agent-results-dev.fifo",
    )
