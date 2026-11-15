import importlib.util
import os
import sys
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

TEST_BUCKET = "case-scout-test"

# The handler is loaded BY PATH under a unique module name, exactly like
# alert_filter/tests/conftest.py's own handler load (see its docstring for
# the full reasoning): every gp-ai Lambda member ships a file named
# `handler.py` under its own `lambda/` directory, and `make test` runs every
# member's suite in one pytest process, so two bare `import handler`s would
# collide on whichever conftest ran first.
_HANDLER_PATH = Path(__file__).resolve().parent.parent / "lambda" / "handler.py"
_SPEC = importlib.util.spec_from_file_location("case_scout_handler", _HANDLER_PATH)
if _SPEC is None or _SPEC.loader is None:
    raise ImportError(f"could not load the case scout handler from {_HANDLER_PATH}")
HANDLER = importlib.util.module_from_spec(_SPEC)
sys.modules["case_scout_handler"] = HANDLER
_SPEC.loader.exec_module(HANDLER)


@pytest.fixture(autouse=True)
def case_scout_env(monkeypatch):
    monkeypatch.setenv("CASE_SCOUT_BUCKET", TEST_BUCKET)
    monkeypatch.setenv("AWS_DEFAULT_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-west-2"))


@pytest.fixture
def s3_bucket():
    """A moto-mocked S3 bucket matching the scout's real one (private,
    versioned) — see case_scout/bucket.py's module docstring for the object
    shapes this backs."""
    with mock_aws():
        client = boto3.client("s3", region_name="us-west-2")
        client.create_bucket(
            Bucket=TEST_BUCKET,
            CreateBucketConfiguration={"LocationConstraint": "us-west-2"},
        )
        client.put_bucket_versioning(Bucket=TEST_BUCKET, VersioningConfiguration={"Status": "Enabled"})
        yield client
