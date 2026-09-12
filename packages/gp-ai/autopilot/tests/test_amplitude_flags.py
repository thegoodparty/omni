"""Tests for autopilot's Amplitude Experiment management API client.

httpx is mocked at the module-level function (httpx.get/post/patch), the same
pattern pmf_engine/tests/test_broker_client.py uses against
pmf_engine/control_plane/broker_client.py — this tree has no respx dependency.
"""

from unittest.mock import MagicMock, patch

import pytest

from autopilot.agent.amplitude_flags import (
    DEV_ROLLOUT_PERCENTAGE,
    PROD_ROLLOUT_PERCENTAGE,
    AmplitudeFlagClient,
    AmplitudeFlagError,
)

ENV = {
    "AMPLITUDE_MANAGEMENT_API_KEY": "test-mgmt-key",
    "AMPLITUDE_DEV_PROJECT_ID": "703396",
    "AMPLITUDE_DEV_DEPLOYMENT_IDS": "13486",
    "AMPLITUDE_PROD_PROJECT_ID": "694490",
    "AMPLITUDE_PROD_DEPLOYMENT_IDS": "13485,53792",
}


@pytest.fixture(autouse=True)
def amplitude_env(monkeypatch):
    for key, value in ENV.items():
        monkeypatch.setenv(key, value)


def empty_list_response() -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"flags": []}
    return response


def list_response(flag: dict) -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"flags": [flag]}
    return response


def create_response(flag_id: str) -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"id": flag_id, "url": f"https://experiment.amplitude.com/x/{flag_id}"}
    return response


def patch_response() -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    return response


def flag_object(flag_id: str, key: str, enabled: bool, rollout_percentage: float, project_id: str = "703396") -> dict:
    return {
        "id": flag_id,
        "key": key,
        "enabled": enabled,
        "rolloutPercentage": rollout_percentage,
        "deleted": False,
        "projectId": project_id,
    }


# ---------------------------------------------------------------------------
# Construction: missing config raises at construction, not mid-pipeline
# ---------------------------------------------------------------------------


class TestConstruction:
    def test_missing_api_key_raises_at_construction(self, monkeypatch):
        monkeypatch.delenv("AMPLITUDE_MANAGEMENT_API_KEY", raising=False)

        with pytest.raises(AmplitudeFlagError, match="AMPLITUDE_MANAGEMENT_API_KEY"):
            AmplitudeFlagClient()

    def test_missing_dev_project_id_raises_at_construction(self, monkeypatch):
        monkeypatch.delenv("AMPLITUDE_DEV_PROJECT_ID", raising=False)

        with pytest.raises(AmplitudeFlagError, match="AMPLITUDE_DEV_PROJECT_ID"):
            AmplitudeFlagClient()

    def test_missing_prod_deployment_ids_raises_at_construction(self, monkeypatch):
        monkeypatch.delenv("AMPLITUDE_PROD_DEPLOYMENT_IDS", raising=False)

        with pytest.raises(AmplitudeFlagError, match="AMPLITUDE_PROD_DEPLOYMENT_IDS"):
            AmplitudeFlagClient()

    def test_blank_deployment_ids_env_raises_at_construction(self, monkeypatch):
        # Set-but-empty (e.g. "  ,  ") must fail the same way as unset — a
        # silent empty deployment list would create flags that can't serve.
        monkeypatch.setenv("AMPLITUDE_DEV_DEPLOYMENT_IDS", "  ,  ")

        with pytest.raises(AmplitudeFlagError, match="AMPLITUDE_DEV_DEPLOYMENT_IDS"):
            AmplitudeFlagClient()

    def test_construction_makes_no_http_calls(self):
        with patch("autopilot.agent.amplitude_flags.httpx.get") as mock_get:
            AmplitudeFlagClient()
            mock_get.assert_not_called()


# ---------------------------------------------------------------------------
# create_feature_flag: fresh create
# ---------------------------------------------------------------------------


class TestCreateFreshFlag:
    def test_creates_and_enables_in_both_projects(self):
        get_responses = [empty_list_response(), empty_list_response()]
        create_responses = [create_response("dev-flag-1"), create_response("prod-flag-1")]

        with (
            patch("autopilot.agent.amplitude_flags.httpx.get", side_effect=get_responses),
            patch("autopilot.agent.amplitude_flags.httpx.post", side_effect=create_responses) as mock_post,
            patch("autopilot.agent.amplitude_flags.httpx.patch", return_value=patch_response()) as mock_patch,
        ):
            client = AmplitudeFlagClient()
            result = client.create_feature_flag("win-new-donation-flow", "New donation flow")

        assert result.dev.project_id == "703396"
        assert result.dev.flag_id == "dev-flag-1"
        assert result.dev.enabled is True
        assert result.dev.rollout_percentage == DEV_ROLLOUT_PERCENTAGE

        assert result.prod.project_id == "694490"
        assert result.prod.flag_id == "prod-flag-1"
        assert result.prod.enabled is True
        assert result.prod.rollout_percentage == PROD_ROLLOUT_PERCENTAGE
        assert result.prod.rollout_percentage == 0

        # Two creates (dev, prod), same key, no invented name.
        assert mock_post.call_count == 2
        dev_body = mock_post.call_args_list[0].kwargs["json"]
        prod_body = mock_post.call_args_list[1].kwargs["json"]
        assert dev_body["key"] == "win-new-donation-flow"
        assert dev_body["name"] == "win-new-donation-flow"
        assert dev_body["projectId"] == "703396"
        assert dev_body["deployments"] == ["13486"]
        assert prod_body["projectId"] == "694490"
        assert prod_body["deployments"] == ["13485", "53792"]

        # Two patches (dev enabled+100, prod enabled+0).
        assert mock_patch.call_count == 2
        dev_patch_body = mock_patch.call_args_list[0].kwargs["json"]
        prod_patch_body = mock_patch.call_args_list[1].kwargs["json"]
        assert dev_patch_body == {"enabled": True, "rolloutPercentage": 100}
        assert prod_patch_body == {"enabled": True, "rolloutPercentage": 0}

    def test_uses_bearer_auth_header(self):
        get_responses = [empty_list_response(), empty_list_response()]
        with (
            patch("autopilot.agent.amplitude_flags.httpx.get", side_effect=get_responses),
            patch(
                "autopilot.agent.amplitude_flags.httpx.post",
                side_effect=[create_response("d1"), create_response("p1")],
            ) as mock_post,
            patch("autopilot.agent.amplitude_flags.httpx.patch", return_value=patch_response()),
        ):
            client = AmplitudeFlagClient()
            client.create_feature_flag("win-flag", "desc")

        assert mock_post.call_args_list[0].kwargs["headers"]["Authorization"] == "Bearer test-mgmt-key"


# ---------------------------------------------------------------------------
# create_feature_flag: idempotent resume path
# ---------------------------------------------------------------------------


class TestCreateExistingFlagIsIdempotent:
    def test_existing_flag_is_verified_not_recreated(self):
        dev_flag = flag_object("dev-flag-1", "win-flag", enabled=True, rollout_percentage=100)
        prod_flag = flag_object("prod-flag-1", "win-flag", enabled=True, rollout_percentage=0, project_id="694490")

        with (
            patch(
                "autopilot.agent.amplitude_flags.httpx.get",
                side_effect=[list_response(dev_flag), list_response(prod_flag)],
            ),
            patch("autopilot.agent.amplitude_flags.httpx.post") as mock_post,
            patch("autopilot.agent.amplitude_flags.httpx.patch") as mock_patch,
        ):
            client = AmplitudeFlagClient()
            result = client.create_feature_flag("win-flag", "desc")

        assert result.dev.rollout_percentage == 100
        assert result.prod.rollout_percentage == 0
        mock_post.assert_not_called()
        mock_patch.assert_not_called()

    def test_resume_never_modifies_a_manually_ramped_prod_rollout(self):
        # If a human manually ramped prod (e.g. to 50%) between runs, a
        # resumed create must report that state, not silently reset it —
        # and definitely must not error.
        dev_flag = flag_object("dev-flag-1", "win-flag", enabled=True, rollout_percentage=100)
        prod_flag = flag_object("prod-flag-1", "win-flag", enabled=True, rollout_percentage=50, project_id="694490")

        with (
            patch(
                "autopilot.agent.amplitude_flags.httpx.get",
                side_effect=[list_response(dev_flag), list_response(prod_flag)],
            ),
            patch("autopilot.agent.amplitude_flags.httpx.post") as mock_post,
            patch("autopilot.agent.amplitude_flags.httpx.patch") as mock_patch,
        ):
            client = AmplitudeFlagClient()
            result = client.create_feature_flag("win-flag", "desc")

        assert result.prod.rollout_percentage == 50
        mock_post.assert_not_called()
        mock_patch.assert_not_called()


class TestGetFlagPartialExistence:
    def test_missing_in_both_returns_none(self):
        with patch(
            "autopilot.agent.amplitude_flags.httpx.get",
            side_effect=[empty_list_response(), empty_list_response()],
        ):
            client = AmplitudeFlagClient()
            assert client.get_flag("win-flag") is None

    def test_present_in_dev_only_raises(self):
        dev_flag = flag_object("dev-flag-1", "win-flag", enabled=True, rollout_percentage=100)

        with patch(
            "autopilot.agent.amplitude_flags.httpx.get",
            side_effect=[list_response(dev_flag), empty_list_response()],
        ):
            client = AmplitudeFlagClient()
            with pytest.raises(AmplitudeFlagError, match="missing in prod"):
                client.get_flag("win-flag")

    def test_present_in_prod_only_raises(self):
        prod_flag = flag_object("prod-flag-1", "win-flag", enabled=True, rollout_percentage=0, project_id="694490")

        with patch(
            "autopilot.agent.amplitude_flags.httpx.get",
            side_effect=[empty_list_response(), list_response(prod_flag)],
        ):
            client = AmplitudeFlagClient()
            with pytest.raises(AmplitudeFlagError, match="missing in dev"):
                client.get_flag("win-flag")


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


class TestErrorHandling:
    def test_401_on_lookup_raises_amplitude_flag_error(self):
        response = MagicMock()
        response.status_code = 401

        with patch("autopilot.agent.amplitude_flags.httpx.get", return_value=response):
            client = AmplitudeFlagClient()
            with pytest.raises(AmplitudeFlagError, match="rejected the API key"):
                client.get_flag("win-flag")

    def test_server_error_on_create_raises_amplitude_flag_error(self):
        error_response = MagicMock()
        error_response.status_code = 503
        error_response.text = "service unavailable"

        with (
            patch(
                "autopilot.agent.amplitude_flags.httpx.get",
                side_effect=[empty_list_response(), empty_list_response()],
            ),
            patch("autopilot.agent.amplitude_flags.httpx.post", return_value=error_response),
        ):
            client = AmplitudeFlagClient()
            with pytest.raises(AmplitudeFlagError, match="HTTP 503"):
                client.create_feature_flag("win-flag", "desc")

    def test_rate_limit_on_patch_raises_amplitude_flag_error(self):
        rate_limited = MagicMock()
        rate_limited.status_code = 429
        rate_limited.text = "too many requests"

        with (
            patch(
                "autopilot.agent.amplitude_flags.httpx.get",
                side_effect=[empty_list_response(), empty_list_response()],
            ),
            patch("autopilot.agent.amplitude_flags.httpx.post", return_value=create_response("dev-flag-1")),
            patch("autopilot.agent.amplitude_flags.httpx.patch", return_value=rate_limited),
        ):
            client = AmplitudeFlagClient()
            with pytest.raises(AmplitudeFlagError, match="HTTP 429"):
                client.create_feature_flag("win-flag", "desc")

    def test_create_response_without_id_raises_amplitude_flag_error(self):
        no_id_response = MagicMock()
        no_id_response.status_code = 200
        no_id_response.json.return_value = {"url": "https://experiment.amplitude.com/x/whatever"}

        with (
            patch(
                "autopilot.agent.amplitude_flags.httpx.get",
                side_effect=[empty_list_response(), empty_list_response()],
            ),
            patch("autopilot.agent.amplitude_flags.httpx.post", return_value=no_id_response),
        ):
            client = AmplitudeFlagClient()
            with pytest.raises(AmplitudeFlagError, match="no 'id'"):
                client.create_feature_flag("win-flag", "desc")

    def test_non_json_2xx_on_lookup_raises_amplitude_flag_error(self):
        html_response = MagicMock()
        html_response.status_code = 200
        html_response.text = "<html>maintenance</html>"
        html_response.json.side_effect = ValueError("not json")

        with patch("autopilot.agent.amplitude_flags.httpx.get", return_value=html_response):
            client = AmplitudeFlagClient()
            with pytest.raises(AmplitudeFlagError, match="non-JSON 2xx"):
                client.get_flag("win-flag")

    def test_non_json_2xx_on_create_raises_amplitude_flag_error(self):
        html_response = MagicMock()
        html_response.status_code = 200
        html_response.text = "<html>maintenance</html>"
        html_response.json.side_effect = ValueError("not json")

        with (
            patch(
                "autopilot.agent.amplitude_flags.httpx.get",
                side_effect=[empty_list_response(), empty_list_response()],
            ),
            patch("autopilot.agent.amplitude_flags.httpx.post", return_value=html_response),
        ):
            client = AmplitudeFlagClient()
            with pytest.raises(AmplitudeFlagError, match="non-JSON 2xx"):
                client.create_feature_flag("win-flag", "desc")

    def test_list_flag_without_id_raises_amplitude_flag_error(self):
        malformed_dev = flag_object("x", "win-flag", enabled=True, rollout_percentage=100)
        del malformed_dev["id"]
        malformed_prod = flag_object("x", "win-flag", enabled=True, rollout_percentage=0, project_id="694490")
        del malformed_prod["id"]

        with patch(
            "autopilot.agent.amplitude_flags.httpx.get",
            side_effect=[list_response(malformed_dev), list_response(malformed_prod)],
        ):
            client = AmplitudeFlagClient()
            with pytest.raises(AmplitudeFlagError, match="no 'id'"):
                client.get_flag("win-flag")

    def test_server_error_on_lookup_raises_amplitude_flag_error(self):
        response = MagicMock()
        response.status_code = 503
        response.text = "service unavailable"

        with patch("autopilot.agent.amplitude_flags.httpx.get", return_value=response):
            client = AmplitudeFlagClient()
            with pytest.raises(AmplitudeFlagError, match="HTTP 503"):
                client.get_flag("win-flag")

    def test_flag_from_another_project_is_ignored(self):
        # If the projectId query param is not a server-side filter, a key-only
        # match would report a dev-only flag as existing in prod too.
        foreign_flag = flag_object("other-1", "win-flag", enabled=True, rollout_percentage=100, project_id="999999")

        with patch(
            "autopilot.agent.amplitude_flags.httpx.get",
            side_effect=[list_response(foreign_flag), list_response(foreign_flag)],
        ):
            client = AmplitudeFlagClient()
            assert client.get_flag("win-flag") is None

    def test_400_on_create_raises_amplitude_flag_error(self):
        bad_response = MagicMock()
        bad_response.status_code = 400
        bad_response.text = "invalid key format"

        with (
            patch(
                "autopilot.agent.amplitude_flags.httpx.get",
                side_effect=[empty_list_response(), empty_list_response()],
            ),
            patch("autopilot.agent.amplitude_flags.httpx.post", return_value=bad_response),
        ):
            client = AmplitudeFlagClient()
            with pytest.raises(AmplitudeFlagError, match="invalid key format"):
                client.create_feature_flag("bad key", "desc")

    def test_deleted_flag_is_treated_as_not_existing(self):
        deleted_flag = flag_object("old-flag-1", "win-flag", enabled=False, rollout_percentage=0)
        deleted_flag["deleted"] = True

        with patch(
            "autopilot.agent.amplitude_flags.httpx.get",
            side_effect=[list_response(deleted_flag), empty_list_response()],
        ):
            client = AmplitudeFlagClient()
            assert client.get_flag("win-flag") is None
