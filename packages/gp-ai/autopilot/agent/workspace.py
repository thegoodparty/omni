"""Shallow clone of omni into the agent's workspace.

Every autopilot stage works against the omni monorepo (the clone command below
matches engineer_agent's OMNI_BRIEFING). Unlike engineer_agent, which leaves
the decision of when — or whether — to clone to the model, every autopilot
stage needs the same repo, so the harness clones it once before the SDK loop
starts rather than spending a turn on the model running the same `git clone`
every single run.
"""

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
