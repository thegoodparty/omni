"""Fetch large experiment params from the broker, and hand params to the agent.

Small params ride the PARAMS_JSON env var inline. When they exceed the ECS
RunTask containerOverrides budget, the dispatch omits PARAMS_JSON and sets
PARAMS_VIA_BROKER=1; the runner then pulls params from the broker's
``/params/read`` endpoint, which returns them from this run's scope ticket
(minted with the full params at launch). Mirrors input_files.py's broker-client
usage — the broker's long-lived task role is the egress gate, so no AWS
credentials live on the runner.

Either way, the harness writes the resolved params to ``/workspace/params.json``
and names it in the agent's ``PARAMS_FILE`` env var, so instructions have one
way to read them.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os

import httpx

logger = logging.getLogger(__name__)

PARAMS_FILENAME = "params.json"


def fetch_params_from_broker(
    *,
    broker_url: str,
    broker_token: str,
    client: httpx.Client | None = None,
) -> dict:
    """Fetch this run's params from the broker. Returns the params dict.

    Failures bubble up: params are required to run the agent, so a fetch failure
    means the run is doomed — fail fast so main()'s config-load handler reports
    FAILED to gp-api cleanly. A `client` arg is accepted for tests
    (httpx.MockTransport); when omitted, the helper owns the httpx.Client.
    """
    owns_client = client is None
    if owns_client:
        client = httpx.Client(
            base_url=broker_url,
            headers={"X-Broker-Token": broker_token},
            timeout=30.0,
        )
    try:
        response = client.get("/params/read")
        response.raise_for_status()
        params = response.json()
    finally:
        if owns_client:
            client.close()

    if not isinstance(params, dict):
        raise ValueError(f"/params/read must return an object, got {type(params).__name__}")
    logger.info("fetched params from broker keys=%d", len(params))
    return params


def write_params_file(workspace_dir: str, params: dict) -> str:
    """Write params to <workspace>/params.json and return the path.

    This is the agent's one source for params. PARAMS_JSON is absent whenever
    params went via the broker, and the large ones can't move into an env var:
    Linux caps a single env string at ~128 KB (MAX_ARG_STRLEN), so an oversize
    var would break every exec the agent makes.
    """
    path = os.path.join(workspace_dir, PARAMS_FILENAME)
    # open("w") can't truncate the read-only file a previous run in a reused
    # (local) workspace left behind, but the directory still lets us unlink it.
    with contextlib.suppress(FileNotFoundError):
        os.unlink(path)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(params, f, indent=2)
    # Read-only so a stray write can't corrupt the inputs later steps re-read.
    os.chmod(path, 0o444)
    return path
