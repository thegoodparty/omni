"""Shallow clone of omni into the agent's workspace.

Every autopilot stage works against the omni monorepo (the clone command below
matches engineer_agent's OMNI_BRIEFING). Unlike engineer_agent, which leaves
the decision of when — or whether — to clone to the model, every autopilot
stage needs the same repo, so the harness clones it once before the SDK loop
starts rather than spending a turn on the model running the same `git clone`
every single run.
"""

import json
import subprocess
from pathlib import Path

OMNI_REPO = "thegoodparty/omni"

# Well under the smallest stage deadline (30 minutes, epic-create/qa): this
# clone runs BEFORE run_agent's asyncio.wait_for deadline wrapper even starts,
# so a stalled connection to github.com (no RST, nothing to time it out) would
# otherwise hold the Fargate task open indefinitely — exactly the failure mode
# the deadline exists to prevent, just outside where it currently reaches.
CLONE_TIMEOUT_SECONDS = 120


class WorkspaceCloneError(RuntimeError):
    """The omni clone failed; there is nothing useful to run the agent against."""


def _scrub_token(text: str, token: str) -> str:
    # git echoes the clone URL — token included — into stderr on a failed
    # clone (e.g. "fatal: repository '.../x-access-token:TOKEN@...' not
    # found"). That text is exactly what gets logged on the error path below,
    # so the token must not survive into it.
    return text.replace(token, "***") if token else text


def clone_omni(workspace_dir: str, github_token: str) -> str:
    """Shallow-clones omni into `{workspace_dir}/omni` and returns that path."""
    dest = str(Path(workspace_dir) / "omni")
    url = f"https://x-access-token:{github_token}@github.com/{OMNI_REPO}.git"
    try:
        result = subprocess.run(
            ["git", "clone", "--depth", "1", url, dest],
            capture_output=True,
            text=True,
            timeout=CLONE_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as e:
        raise WorkspaceCloneError(f"git clone did not finish within {CLONE_TIMEOUT_SECONDS}s") from e
    if result.returncode != 0:
        raise WorkspaceCloneError(
            f"git clone failed (exit {result.returncode}): {_scrub_token(result.stderr, github_token)}"
        )
    return dest


def point_playwright_mcp_at_chromium(clone_dir: str) -> None:
    """Rewrites the clone's .mcp.json so the Playwright MCP launches chromium.

    @playwright/mcp defaults to the branded-Chrome channel, which exists on
    every engineer's laptop but cannot exist in this container: Google ships
    no ARM64 Linux Chrome at all, and the qa image bakes Playwright's
    chromium instead (Dockerfile, INSTALL_PLAYWRIGHT=true). Without this the
    first browser call dies with "Chromium distribution 'chrome' is not
    found" — the first live qa run did exactly that. Patched here, in the
    run's own clone, rather than in the repo's .mcp.json, so engineers'
    local MCP keeps using their real Chrome.

    Raises on a malformed or unexpected .mcp.json: a workspace whose MCP
    config can't be read is broken the same way a failed clone is, and
    failing at startup beats a mid-run browser error after paid work.
    """
    path = Path(clone_dir) / ".mcp.json"
    try:
        config = json.loads(path.read_text())
        args = config["mcpServers"]["playwright"]["args"]
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise WorkspaceCloneError(f"could not point the Playwright MCP at chromium: {e!r}") from e
    if not isinstance(args, list):
        raise WorkspaceCloneError(f"could not point the Playwright MCP at chromium: args is {type(args).__name__}")
    if "--browser" not in args:
        args.extend(["--browser", "chromium"])
        path.write_text(json.dumps(config, indent=2) + "\n")
