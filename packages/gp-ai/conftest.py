"""Project-root pytest config."""

import os

import pytest


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
