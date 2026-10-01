"""The conductor's credentials, read from the AI_SECRETS_<ENV> bundle at runtime.

Terraform passes only the bundle's name (AI_SECRETS_NAME); the values stay in
Secrets Manager, so they are not in the function's configuration or in
Terraform state. The bundle is fetched once per container, on the first
secret() call, and cached. A failed fetch is logged and NOT cached, so one
Secrets Manager blip does not poison a warm container; every caller already
treats an empty value as "not configured" and fails closed (a webhook or Slack
request 401s, a ClickUp/Slack/GitHub/Amplitude call is skipped or refused).

An env var with the runtime name wins over the bundle. That is what lets the
tests and local runs set a credential directly and never reach AWS; with no
override and no AI_SECRETS_NAME there is nothing to fetch, and the value is
empty. Same shape as alert_filter's secret().

Copied, not imported from shared/, for the reason every module here is (see
handler.py's module docstring): this Lambda's zip is a plain copy of lambda/
with nothing beyond boto3/botocore and the standard library.
"""

import json
import os
from typing import Any

import boto3
from botocore.config import Config

SECRETS_NAME_ENV = "AI_SECRETS_NAME"

# Bundle keys a runtime name is read from, first non-empty wins; a name not
# listed reads the key of the same name. Autopilot posts as its OWN Slack app
# ("GP Autopilot", AUTOPILOT_SLACK_BOT_TOKEN), never the shared gp_ai_bot token
# the other gp-ai bots use, so rotating or breaking one app can't take down the
# other's posting. The runtime name stays SLACK_BOT_TOKEN (what supervisor.py
# reads); only the SOURCE key differs. The fallback to the shared token keeps
# autopilot working until the dedicated key lands in AI_SECRETS_<ENV>; drop it
# after both envs carry it.
SOURCE_KEYS: dict[str, tuple[str, ...]] = {
    "SLACK_BOT_TOKEN": ("AUTOPILOT_SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN"),
}

# The first fetch can land on the webhook's fast-ack path (verifying the
# signature needs the secret), so botocore's 60s defaults must not apply.
# total_max_attempts, not max_attempts: see handler.py's LAMBDA_CLIENT_CONFIG.
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
            # payload, and this log group feeds an alarm and Slack.
            print(f"ERROR: Failed to load {secret_id} from Secrets Manager: {type(e).__name__}")
            return ""

    for key in SOURCE_KEYS.get(name, (name,)):
        value = _bundle.get(key)
        if value:
            return str(value)
    return ""


def reset_for_tests() -> None:
    global _bundle, _client
    _bundle = None
    _client = None
