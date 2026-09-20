"""Puts a ready omni checkout in the agent's workspace before the SDK loop
starts, so no stage spends a paid turn on repo setup.

Every autopilot stage works against the omni monorepo (the clone command below
matches engineer_agent's OMNI_BRIEFING). Unlike engineer_agent, which leaves
the decision of when — or whether — to clone to the model, every autopilot
stage needs the same repo, so the harness prepares it once before the SDK loop
starts.

Two paths, in `prepare_omni_workspace`:

- **Warm** (ENG-11149): the image bakes a full omni checkout plus its
  `npm ci`'d node_modules (Dockerfile). At container start this is
  `git fetch` + `git reset --hard origin/main` (seconds) instead of a network
  clone, and `npm ci` only re-runs when the fetched lockfile no longer matches
  the hash recorded at bake time. Every image build's postinstall lifecycle
  (ai-rules submodule init, workspace-internal builds, Prisma generation) was
  skipped at bake time on purpose (`npm ci --ignore-scripts` — see the
  Dockerfile) and runs here instead, where the run's own real env is in scope
  and there is no image layer for it to leak into.
- **Cold fallback**: a plain network clone (`clone_omni`), for an image built
  before the bake existed or a local run with none. Setup beyond the clone is
  left to the stage's own instructions, same as before this task.
"""

import hashlib
import json
import os
import subprocess
from pathlib import Path

OMNI_REPO = "thegoodparty/omni"

# Well under the smallest stage deadline (30 minutes, epic-create/qa): this
# clone runs BEFORE run_agent's asyncio.wait_for deadline wrapper even starts,
# so a stalled connection to github.com (no RST, nothing to time it out) would
# otherwise hold the Fargate task open indefinitely — exactly the failure mode
# the deadline exists to prevent, just outside where it currently reaches.
CLONE_TIMEOUT_SECONDS = 120

# fetch+reset should land in seconds on a warm image; this reuses the clone's
# own budget rather than inventing a second number, for the same "stalled
# connection, no other backstop this early" reason.
REFRESH_TIMEOUT_SECONDS = CLONE_TIMEOUT_SECONDS

# Only paid when the lockfile hash has drifted since the image was built — the
# same order of magnitude as a cold install, still well under the shortest
# stage deadline.
NPM_CI_TIMEOUT_SECONDS = 600

# Each step is cheap (seconds) against an already-`npm ci`'d tree; the ceiling
# exists only to fail a hung step loudly instead of holding the Fargate task
# open for the rest of its deadline.
POST_BAKE_STEP_TIMEOUT_SECONDS = 180

# The image's baked checkout (Dockerfile, ENG-11149). Matches the Dockerfile's
# ENV BAKED_OMNI_DIR so the two never drift independently.
DEFAULT_BAKE_DIR = "/opt/omni-bake"


class WorkspaceCloneError(RuntimeError):
    """The omni clone/refresh failed; there is nothing useful to run the agent against."""


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


def _run(cmd: list[str], cwd: str, timeout: float) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def baked_omni_dir(bake_dir: str) -> str:
    return str(Path(bake_dir) / "omni")


def baked_clone_available(bake_dir: str) -> bool:
    """Whether this image has a warm checkout baked in, vs. an older image (or
    a local run) with no bake to refresh."""
    return (Path(baked_omni_dir(bake_dir)) / ".git").is_dir()


def refresh_baked_clone(bake_dir: str, github_token: str) -> str:
    """Fast-forwards the image's baked omni checkout onto origin/main.

    The image is only ever as fresh as its last build, so this is MANDATORY,
    never optional — a swallowed failure here would let the run continue
    against whatever the last image build happened to freeze, silently, with
    nothing to say the tree is stale.
    """
    omni_dir = baked_omni_dir(bake_dir)
    url = f"https://x-access-token:{github_token}@github.com/{OMNI_REPO}.git"
    try:
        set_url = _run(["git", "remote", "set-url", "origin", url], cwd=omni_dir, timeout=REFRESH_TIMEOUT_SECONDS)
        if set_url.returncode != 0:
            raise WorkspaceCloneError(
                "could not point the baked clone's origin at the authenticated remote "
                f"(exit {set_url.returncode}): {_scrub_token(set_url.stderr, github_token)}"
            )
        fetch = _run(["git", "fetch", "--depth", "1", "origin", "main"], cwd=omni_dir, timeout=REFRESH_TIMEOUT_SECONDS)
        if fetch.returncode != 0:
            raise WorkspaceCloneError(
                f"baked clone fetch failed (exit {fetch.returncode}): {_scrub_token(fetch.stderr, github_token)}"
            )
        reset = _run(["git", "reset", "--hard", "origin/main"], cwd=omni_dir, timeout=REFRESH_TIMEOUT_SECONDS)
        if reset.returncode != 0:
            raise WorkspaceCloneError(
                f"baked clone reset failed (exit {reset.returncode}): {_scrub_token(reset.stderr, github_token)}"
            )
    except subprocess.TimeoutExpired as e:
        raise WorkspaceCloneError(f"baked clone refresh did not finish within {REFRESH_TIMEOUT_SECONDS}s") from e
    return omni_dir


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def npm_ci_needed(omni_dir: str, bake_dir: str) -> bool:
    """True when the just-fetched package-lock.json no longer matches the hash
    recorded at bake time (Dockerfile writes `{bake_dir}/lockfile.sha256`),
    meaning the baked node_modules was installed for a different lockfile. A
    missing or unreadable baked hash counts as a mismatch too — with no
    known-good baseline to trust, only a real `npm ci` is safe.
    """
    try:
        baked_hash = (Path(bake_dir) / "lockfile.sha256").read_text().strip()
    except OSError:
        return True
    try:
        current_hash = _sha256_file(Path(omni_dir) / "package-lock.json")
    except OSError:
        return True
    return current_hash != baked_hash


def run_npm_ci(omni_dir: str) -> None:
    result = _run(["npm", "ci"], cwd=omni_dir, timeout=NPM_CI_TIMEOUT_SECONDS)
    if result.returncode != 0:
        raise WorkspaceCloneError(f"npm ci failed (exit {result.returncode}): {result.stderr[-4000:]}")


# The lifecycle work `npm ci --ignore-scripts` skipped at bake time
# (Dockerfile), plus the workspace-internal builds and Prisma client
# generation scripts/worktree-setup.sh runs for a fresh checkout. Run every
# time — cheap against an already-installed tree — rather than only on an
# npm_ci_needed mismatch, since ignore-scripts skipped these regardless of
# whether node_modules itself needed reinstalling.
POST_BAKE_STEPS: tuple[tuple[str, ...], ...] = (
    ("git", "submodule", "update", "--init", "--recursive", "ai-rules"),
    ("npm", "run", "build", "-w", "packages/contracts"),
    ("npm", "run", "build", "-w", "packages/nest-common"),
    ("npm", "run", "generate", "-w", "packages/gp-api"),
    ("npm", "run", "generate", "-w", "packages/election-api"),
)


def run_post_bake_setup(omni_dir: str) -> None:
    for cmd in POST_BAKE_STEPS:
        result = _run(cmd, cwd=omni_dir, timeout=POST_BAKE_STEP_TIMEOUT_SECONDS)
        if result.returncode != 0:
            raise WorkspaceCloneError(f"{' '.join(cmd)} failed (exit {result.returncode}): {result.stderr[-4000:]}")


def prepare_omni_workspace(workspace_dir: str, github_token: str, bake_dir: str | None = None) -> str:
    """The one entry point main.py calls: returns a ready omni checkout path.

    Warm when the image has a bake (fetch+reset, conditional npm ci, the
    deferred post-bake steps); a full network clone otherwise. See the module
    docstring for why there are two paths.
    """
    bake_dir = bake_dir if bake_dir is not None else os.environ.get("BAKED_OMNI_DIR", DEFAULT_BAKE_DIR)
    if not baked_clone_available(bake_dir):
        return clone_omni(workspace_dir, github_token)

    omni_dir = refresh_baked_clone(bake_dir, github_token)
    if npm_ci_needed(omni_dir, bake_dir):
        run_npm_ci(omni_dir)
    run_post_bake_setup(omni_dir)
    return omni_dir
