"""Unit tests for the conductor Lambda's runtime secret loader
(lambda/ai_secrets.py)."""

import json

import autopilot_conductor_ai_secrets as ai_secrets
import pytest

BUNDLE_NAME = "AI_SECRETS_TEST"


class FakeSecretsClient:
    def __init__(self, bundle: dict | None = None, error: Exception | None = None):
        self.bundle = bundle or {}
        self.error = error
        self.calls: list[str] = []

    def get_secret_value(self, SecretId):
        self.calls.append(SecretId)
        if self.error is not None:
            raise self.error
        return {"SecretString": json.dumps(self.bundle)}


@pytest.fixture
def fake_client(monkeypatch):
    client = FakeSecretsClient(
        {
            "AUTOPILOT_CLICKUP_WEBHOOK_SECRET": "bundle-webhook-secret",
            "AUTOPILOT_SLACK_BOT_TOKEN": "xoxb-autopilot",
            "SLACK_BOT_TOKEN": "xoxb-shared",
        }
    )
    monkeypatch.setattr(ai_secrets, "_secrets_client", lambda: client)
    monkeypatch.setenv(ai_secrets.SECRETS_NAME_ENV, BUNDLE_NAME)
    return client


def test_reads_the_named_bundle_once_per_container(fake_client, monkeypatch):
    monkeypatch.delenv("AUTOPILOT_CLICKUP_WEBHOOK_SECRET", raising=False)
    monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)

    assert ai_secrets.secret("AUTOPILOT_CLICKUP_WEBHOOK_SECRET") == "bundle-webhook-secret"
    assert ai_secrets.secret("AUTOPILOT_CLICKUP_WEBHOOK_SECRET") == "bundle-webhook-secret"
    ai_secrets.secret("SLACK_BOT_TOKEN")

    assert fake_client.calls == [BUNDLE_NAME]


def test_env_var_overrides_the_bundle_without_calling_aws(fake_client, monkeypatch):
    monkeypatch.setenv("AUTOPILOT_CLICKUP_WEBHOOK_SECRET", "local-secret")

    assert ai_secrets.secret("AUTOPILOT_CLICKUP_WEBHOOK_SECRET") == "local-secret"
    assert fake_client.calls == []


def test_no_bundle_name_means_no_aws_call_and_an_empty_value(monkeypatch):
    def fail():
        raise AssertionError("must not build a Secrets Manager client")

    monkeypatch.setattr(ai_secrets, "_secrets_client", fail)
    monkeypatch.delenv("AUTOPILOT_CLICKUP_API_KEY", raising=False)

    assert ai_secrets.secret("AUTOPILOT_CLICKUP_API_KEY") == ""


def test_missing_key_is_empty_so_the_optional_clickup_keys_stay_optional(fake_client, monkeypatch):
    monkeypatch.delenv("AUTOPILOT_CLICKUP_API_KEY", raising=False)

    assert ai_secrets.secret("AUTOPILOT_CLICKUP_API_KEY") == ""


def test_slack_bot_token_prefers_autopilots_own_app(fake_client, monkeypatch):
    monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)

    assert ai_secrets.secret("SLACK_BOT_TOKEN") == "xoxb-autopilot"


def test_slack_bot_token_falls_back_to_the_shared_key(fake_client, monkeypatch):
    monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
    del fake_client.bundle["AUTOPILOT_SLACK_BOT_TOKEN"]

    assert ai_secrets.secret("SLACK_BOT_TOKEN") == "xoxb-shared"


def test_a_failed_fetch_is_logged_empty_and_retried_next_call(monkeypatch, capsys):
    client = FakeSecretsClient({"GITHUB_APP_PRIVATE_KEY": "pem"}, error=RuntimeError("secret-payload-text"))
    monkeypatch.setattr(ai_secrets, "_secrets_client", lambda: client)
    monkeypatch.setenv(ai_secrets.SECRETS_NAME_ENV, BUNDLE_NAME)
    monkeypatch.delenv("GITHUB_APP_PRIVATE_KEY", raising=False)

    assert ai_secrets.secret("GITHUB_APP_PRIVATE_KEY") == ""
    out = capsys.readouterr().out
    assert "ERROR: Failed to load AI_SECRETS_TEST" in out
    assert "secret-payload-text" not in out

    client.error = None
    assert ai_secrets.secret("GITHUB_APP_PRIVATE_KEY") == "pem"
    assert client.calls == [BUNDLE_NAME, BUNDLE_NAME]
