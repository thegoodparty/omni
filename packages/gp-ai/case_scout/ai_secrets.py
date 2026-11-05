"""case_scout's credentials, read from the AI_SECRETS_<ENV> bundle at runtime.

Terraform passes only the bundle's name (AI_SECRETS_NAME); the values stay in
Secrets Manager, so they are not in the function's configuration or in
Terraform state. The bundle is fetched once per container, on the first
secret() call, and cached. A failed fetch is logged and NOT cached, so one
Secrets Manager blip does not poison a warm container.

An env var with the runtime name wins over the bundle. That is what lets
tests and local runs set a credential directly and never reach AWS.

Copied from autopilot/lambda/ai_secrets.py (same bundle, same shape), not
imported: case_scout's Lambda zip ships only its own handler and the pure
modules beside it (see infrastructure/modules/case-scout's archive_file), with
no pip-install step — the same sibling-independence reason
autopilot/lambda/github_auth.py's own module docstring gives for not sharing
code across Lambdas that deploy independently. Trimmed of autopilot's
SLACK_BOT_TOKEN source-key remapping, which is specific to that Lambda's own
Slack app.
"""

import json
import os
from typing import Any

import boto3
from botocore.config import Config

SECRETS_NAME_ENV = "AI_SECRETS_NAME"

# The first fetch can land on a cold-started Lambda invocation with a tight
# overall timeout, so botocore's 60s connect/read defaults must not apply.
# total_max_attempts, not max_attempts: the latter counts RETRIES AFTER the
# initial call in botocore's legacy retry mode, so {"max_attempts": 1} would
# silently normalize to two real attempts.
CLIENT_CONFIG = Config(connect_timeout=2, read_timeout=5, retries={"total_max_attempts": 2})

_bundle: dict[str, Any] | None = None
_client: Any = None


def _secrets_client() -> Any:
    global _client
    if _client is None:
        _client = boto3.client("secretsmanager", config=CLIENT_CONFIG)
    return _client


def secret(name: str) -> str:
    from_env = os.environ.get(name)
    if from_env:
        return from_env

    secret_id = os.environ.get(SECRETS_NAME_ENV, "")
    if not secret_id:
        return ""

    global _bundle
    if _bundle is None:
        try:
            response = _secrets_client().get_secret_value(SecretId=secret_id)
            _bundle = json.loads(response["SecretString"])
        except Exception as e:
            # Exception type only: a decode error's message can quote the
            # payload, and this log group feeds an alarm.
            print(f"ERROR: Failed to load {secret_id} from Secrets Manager: {type(e).__name__}")
            return ""

    value = _bundle.get(name)
    return str(value) if value else ""


def reset_for_tests() -> None:
    global _bundle, _client
    _bundle = None
    _client = None
