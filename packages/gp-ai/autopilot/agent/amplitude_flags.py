"""Amplitude Experiment management API client for autopilot's flag-create step.

Every pipeline-built feature ships dark behind an Amplitude flag created at
epic kickoff: on in dev, 0% in prod (see ENG-11098). The Amplitude MCP is
OAuth-only and unusable headless from an autonomous agent, so this is a small
REST client against the Amplitude Experiment management API instead
(https://amplitude.com/docs/experiment/apis/management-api/flags).

GoodParty runs one Amplitude project per environment (see
.claude/skills/amplitude-flag/SKILL.md for the human-facing equivalent of this
flow, done through the MCP). A "flag" is a separate object, with its own id,
in each project — same key in both. This client always operates on both
projects together: create_feature_flag() and get_flag() each return state for
both dev and prod, never one alone.

PROD GUARDRAIL: no public method on this client accepts a rollout percentage.
PROD_ROLLOUT_PERCENTAGE is the only place a prod rollout number appears in
this file. That is deliberate — the PRD requires new features to ship dark in
prod, and this makes "ramp prod above 0%" impossible to reach through this
client by construction, not by convention. Ramping prod is a manual Amplitude
UI step, same as the MCP-driven skill.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx

AMPLITUDE_BASE_URL = "https://experiment.amplitude.com/api/1"

# The only variant this client creates: a plain on/off flag, no experiment
# arms. rolloutWeights={"on": 1} means "of whatever slice of traffic
# rolloutPercentage lets into the experiment, all of it gets 'on'" — the
# percentage split lives entirely in rolloutPercentage, set via PATCH below.
_FLAG_VARIANTS = [{"key": "on"}]
_FLAG_ROLLOUT_WEIGHTS = {"on": 1}
_EVALUATION_MODE = "remote"

DEV_ROLLOUT_PERCENTAGE = 100
# PRD guardrail (see module docstring): every feature ships dark in prod.
# This is the only place a prod rollout number is written, anywhere in this
# client — no public method takes a rollout argument.
PROD_ROLLOUT_PERCENTAGE = 0


class AmplitudeFlagError(Exception):
    """An Amplitude management API call failed in a way autopilot cannot
    recover from on its own — bad auth, a rejected payload, or a flag that
    exists in one project but not the other. Callers should surface this to a
    human rather than retry blindly."""


@dataclass(frozen=True)
class EnvironmentFlagState:
    project_id: str
    flag_id: str
    enabled: bool
    rollout_percentage: float | None


@dataclass(frozen=True)
class FlagResult:
    flag_key: str
    dev: EnvironmentFlagState
    prod: EnvironmentFlagState


@dataclass(frozen=True)
class _EnvConfig:
    label: str
    project_id: str
    deployment_ids: list[str]


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise AmplitudeFlagError(f"Missing required env var {name}")
    return value


def _require_deployment_ids(name: str) -> list[str]:
    raw = _require_env(name)
    ids = [part.strip() for part in raw.split(",") if part.strip()]
    if not ids:
        raise AmplitudeFlagError(f"{name} is set but contains no deployment ids")
    return ids


class AmplitudeFlagClient:
    """Thin REST client against the Amplitude Experiment management API.

    Auth and both projects' identifiers are read from env at construction, so
    a misconfigured deploy fails immediately at startup rather than on the
    first flag create mid-pipeline.
    """

    def __init__(self, timeout: float = 30.0) -> None:
        self._api_key = _require_env("AMPLITUDE_MANAGEMENT_API_KEY")
        self._dev = _EnvConfig(
            label="dev",
            project_id=_require_env("AMPLITUDE_DEV_PROJECT_ID"),
            deployment_ids=_require_deployment_ids("AMPLITUDE_DEV_DEPLOYMENT_IDS"),
        )
        self._prod = _EnvConfig(
            label="prod",
            project_id=_require_env("AMPLITUDE_PROD_PROJECT_ID"),
            deployment_ids=_require_deployment_ids("AMPLITUDE_PROD_DEPLOYMENT_IDS"),
        )
        self._timeout = timeout

    def get_flag(self, flag_key: str) -> FlagResult | None:
        """Looks up an existing flag by key in both projects.

        Returns None only when the key exists in neither project (nothing to
        resume). If it exists in exactly one, raises — that shape only
        happens if a prior create crashed between the dev and prod calls, and
        silently treating it as "not created" would re-run dev's create
        against an already-existing dev flag while a human may need to
        reconcile prod.
        """
        dev_flag = self._get_flag_by_key(self._dev, flag_key)
        prod_flag = self._get_flag_by_key(self._prod, flag_key)

        if dev_flag is None and prod_flag is None:
            return None
        if dev_flag is None or prod_flag is None:
            missing = "dev" if dev_flag is None else "prod"
            raise AmplitudeFlagError(
                f"Flag {flag_key!r} exists in one Amplitude project but not the other "
                f"(missing in {missing}) — needs manual reconciliation, not an automatic retry."
            )

        return FlagResult(
            flag_key=flag_key,
            dev=self._state_from_flag(self._dev.project_id, dev_flag),
            prod=self._state_from_flag(self._prod.project_id, prod_flag),
        )

    def create_feature_flag(self, flag_key: str, description: str) -> FlagResult:
        """Creates flag_key in both projects: on (100%) in dev, active but 0%
        in prod. Idempotent — a resumed epic-create run that calls this again
        for a flag_key that already exists gets its verified current state
        back, with no create/patch calls made and prod rollout left untouched.

        Does not invent a display name: the flag's "name" is flag_key itself.
        """
        existing = self.get_flag(flag_key)
        if existing is not None:
            return existing

        dev_state = self._create_and_enable(self._dev, flag_key, description, DEV_ROLLOUT_PERCENTAGE)
        prod_state = self._create_and_enable(self._prod, flag_key, description, PROD_ROLLOUT_PERCENTAGE)
        return FlagResult(flag_key=flag_key, dev=dev_state, prod=prod_state)

    def _create_and_enable(
        self, env: _EnvConfig, flag_key: str, description: str, rollout_percentage: int
    ) -> EnvironmentFlagState:
        created = self._create(env, flag_key, description)
        flag_id = str(created["id"])
        self._patch(env, flag_id, enabled=True, rollout_percentage=rollout_percentage)
        return EnvironmentFlagState(
            project_id=env.project_id,
            flag_id=flag_id,
            enabled=True,
            rollout_percentage=rollout_percentage,
        )

    def _create(self, env: _EnvConfig, flag_key: str, description: str) -> dict[str, Any]:
        response = httpx.post(
            f"{AMPLITUDE_BASE_URL}/flags",
            json={
                "projectId": env.project_id,
                "key": flag_key,
                "name": flag_key,
                "description": description,
                "variants": _FLAG_VARIANTS,
                "rolloutWeights": _FLAG_ROLLOUT_WEIGHTS,
                "deployments": env.deployment_ids,
                "evaluationMode": _EVALUATION_MODE,
            },
            headers=self._headers(),
            timeout=self._timeout,
        )
        self._raise_for_auth_or_bad_request(response, f"create flag {flag_key!r} in {env.label}")
        response.raise_for_status()
        return response.json()

    def _patch(self, env: _EnvConfig, flag_id: str, *, enabled: bool, rollout_percentage: int) -> None:
        response = httpx.patch(
            f"{AMPLITUDE_BASE_URL}/flags/{flag_id}",
            json={"enabled": enabled, "rolloutPercentage": rollout_percentage},
            headers=self._headers(),
            timeout=self._timeout,
        )
        self._raise_for_auth_or_bad_request(response, f"configure flag {flag_id} in {env.label}")
        response.raise_for_status()

    def _get_flag_by_key(self, env: _EnvConfig, flag_key: str) -> dict[str, Any] | None:
        response = httpx.get(
            f"{AMPLITUDE_BASE_URL}/flags",
            params={"key": flag_key, "projectId": env.project_id},
            headers=self._headers(),
            timeout=self._timeout,
        )
        self._raise_for_auth_or_bad_request(response, f"look up flag {flag_key!r} in {env.label}")
        response.raise_for_status()
        flags = response.json().get("flags", [])
        matches = [f for f in flags if f.get("key") == flag_key and not f.get("deleted", False)]
        return matches[0] if matches else None

    def _raise_for_auth_or_bad_request(self, response: httpx.Response, action: str) -> None:
        if response.status_code == 401:
            raise AmplitudeFlagError(f"Amplitude management API rejected the API key while trying to {action}")
        if response.status_code == 400:
            raise AmplitudeFlagError(f"Amplitude management API rejected the request to {action}: {response.text}")

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}"}

    @staticmethod
    def _state_from_flag(project_id: str, flag: dict[str, Any]) -> EnvironmentFlagState:
        return EnvironmentFlagState(
            project_id=project_id,
            flag_id=str(flag["id"]),
            enabled=bool(flag.get("enabled", False)),
            rollout_percentage=flag.get("rolloutPercentage"),
        )
