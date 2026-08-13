"""Project-root pytest config.

The autouse fixture below blocks every test in the repo from emitting
real Braintrust telemetry. Several test suites (campaign_plan_lambda,
pmf_engine smoke tests, hubspot_ddhq_match) call into application code
that in turn calls `init_braintrust(...)` / `BraintrustClient.init(...)`
without mocking. With `BRAINTRUST_API_KEY` present in the local `.env`,
those tests would otherwise authenticate to Braintrust and pollute
whichever project ended up first to grab the singleton.

Clearing the API key keeps `BraintrustClient` in its disabled state for
the duration of each test — `traced_span`, `traced_call`, and
`load_prompt` all become no-ops. Resetting the singleton around each
test prevents state leaking between tests if any of them set the key
locally for their own assertions.
"""

import os

import pytest

from shared.braintrust import BraintrustClient


@pytest.fixture(autouse=True)
def disable_braintrust(monkeypatch):
    monkeypatch.setenv("BRAINTRUST_API_KEY", "")
    BraintrustClient.reset_instance()
    yield
    BraintrustClient.reset_instance()


@pytest.fixture(autouse=True)
def default_aws_region(monkeypatch):
    """Give botocore a region so client construction never depends on the
    developer's ambient AWS config.

    Application code builds clients without an explicit region (e.g.
    `broker.dynamodb_client.ScopeTicketStore`), which is correct in ECS where
    the region always comes from the environment. On a laptop with an AWS
    profile configured it also happens to work, which is why this went
    unnoticed — but a bare CI runner has no region and boto3 raises
    NoRegionError before the test reaches its first assertion.

    Only sets a default: a test that needs a specific region can still
    monkeypatch over it.
    """
    monkeypatch.setenv("AWS_DEFAULT_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-west-2"))
