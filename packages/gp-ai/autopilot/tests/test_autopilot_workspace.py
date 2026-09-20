"""Tests for the pre-flight omni workspace setup every autopilot stage runs
against — the warm baked-image path and the cold network-clone fallback."""

import hashlib
import json
import subprocess

import pytest

from autopilot.agent import workspace as workspace_module
from autopilot.agent.workspace import (
    CLONE_TIMEOUT_SECONDS,
    POST_BAKE_STEPS,
    REFRESH_TIMEOUT_SECONDS,
    WorkspaceCloneError,
    baked_clone_available,
    clone_omni,
    npm_ci_needed,
    point_playwright_mcp_at_chromium,
    prepare_omni_workspace,
    refresh_baked_clone,
    run_npm_ci,
    run_post_bake_setup,
)

TOKEN = "ghs_supersecrettoken"


class FakeCompletedProcess:
    def __init__(self, returncode: int, stderr: str = ""):
        self.returncode = returncode
        self.stderr = stderr


def test_successful_clone_returns_the_omni_subdirectory(monkeypatch, tmp_path):
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    dest = clone_omni(str(tmp_path), TOKEN)

    assert dest == str(tmp_path / "omni")
    assert captured["cmd"][:3] == ["git", "clone", "--depth"]
    assert captured["cmd"][-1] == dest
    assert TOKEN in captured["cmd"][-2]


def test_a_stalled_clone_times_out_instead_of_hanging_the_task(monkeypatch, tmp_path):
    # This clone runs BEFORE run_agent's asyncio.wait_for deadline wrapper, so
    # a stalled connection to github.com has no other backstop — a trigger
    # subprocess.run's own `timeout=` argument is what has to catch.
    def fake_run(cmd, **kwargs):
        assert kwargs["timeout"] == CLONE_TIMEOUT_SECONDS
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=kwargs["timeout"])

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(WorkspaceCloneError, match=str(CLONE_TIMEOUT_SECONDS)):
        clone_omni(str(tmp_path), TOKEN)


def test_failed_clone_raises_workspace_clone_error(monkeypatch, tmp_path):
    monkeypatch.setattr(subprocess, "run", lambda cmd, **kwargs: FakeCompletedProcess(1, stderr="fatal: not found"))

    with pytest.raises(WorkspaceCloneError, match="not found"):
        clone_omni(str(tmp_path), TOKEN)


def test_failed_clone_scrubs_the_token_from_the_raised_error(monkeypatch, tmp_path):
    # git echoes the clone URL (token included) into stderr on failure — that
    # text must never reach a log line with the token still in it.
    leaking_stderr = f"fatal: repository 'https://x-access-token:{TOKEN}@github.com/thegoodparty/omni.git/' not found"
    monkeypatch.setattr(subprocess, "run", lambda cmd, **kwargs: FakeCompletedProcess(128, stderr=leaking_stderr))

    with pytest.raises(WorkspaceCloneError) as caught:
        clone_omni(str(tmp_path), TOKEN)

    assert TOKEN not in str(caught.value)
    assert "***" in str(caught.value)


def _write_mcp_json(tmp_path, playwright_args):
    (tmp_path / ".mcp.json").write_text(
        json.dumps({"mcpServers": {"playwright": {"command": "npx", "args": playwright_args}}})
    )


def test_playwright_mcp_gets_pointed_at_chromium(tmp_path):
    # The repo default (no --browser) means the branded-Chrome channel, which
    # cannot exist on ARM64 Linux — the first live qa run died on it.
    _write_mcp_json(tmp_path, ["@playwright/mcp@latest", "--headless", "--isolated"])

    point_playwright_mcp_at_chromium(str(tmp_path))

    args = json.loads((tmp_path / ".mcp.json").read_text())["mcpServers"]["playwright"]["args"]
    assert args == ["@playwright/mcp@latest", "--headless", "--isolated", "--browser", "chromium"]


def test_playwright_mcp_left_alone_when_a_browser_is_already_chosen(tmp_path):
    original = ["@playwright/mcp@latest", "--browser", "firefox"]
    _write_mcp_json(tmp_path, original)

    point_playwright_mcp_at_chromium(str(tmp_path))

    args = json.loads((tmp_path / ".mcp.json").read_text())["mcpServers"]["playwright"]["args"]
    assert args == original


def test_unreadable_mcp_json_fails_the_workspace_loudly(tmp_path):
    # A workspace whose MCP config can't be read is broken the same way a
    # failed clone is; a mid-run browser error after paid work is worse.
    (tmp_path / ".mcp.json").write_text("{not json")

    with pytest.raises(WorkspaceCloneError, match="Playwright MCP"):
        point_playwright_mcp_at_chromium(str(tmp_path))


# ---------------------------------------------------------------------------
# Warm path: baked-clone detection (ENG-11149)
# ---------------------------------------------------------------------------


def test_baked_clone_available_when_the_bake_has_a_git_dir(tmp_path):
    (tmp_path / "omni" / ".git").mkdir(parents=True)

    assert baked_clone_available(str(tmp_path)) is True


def test_baked_clone_not_available_on_an_image_with_no_bake(tmp_path):
    assert baked_clone_available(str(tmp_path)) is False


# ---------------------------------------------------------------------------
# Warm path: fetch + reset onto origin/main
# ---------------------------------------------------------------------------


def test_refresh_baked_clone_sets_url_fetches_and_resets_in_order(monkeypatch, tmp_path):
    (tmp_path / "omni").mkdir()
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        return FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = refresh_baked_clone(str(tmp_path), TOKEN)

    assert result == str(tmp_path / "omni")
    assert calls[0][:3] == ["git", "remote", "set-url"]
    assert TOKEN in calls[0][-1]
    assert calls[1][:2] == ["git", "fetch"]
    assert calls[2] == ["git", "reset", "--hard", "origin/main"]


def test_a_failed_fetch_raises_and_never_runs_reset_against_a_stale_tree(monkeypatch, tmp_path):
    (tmp_path / "omni").mkdir()
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        if cmd[:2] == ["git", "fetch"]:
            return FakeCompletedProcess(returncode=1, stderr="fatal: could not read from remote repository")
        return FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(WorkspaceCloneError, match="fetch failed"):
        refresh_baked_clone(str(tmp_path), TOKEN)

    assert not any(cmd[:2] == ["git", "reset"] for cmd in calls)


def test_a_failed_reset_raises_rather_than_leaving_the_bake_half_updated(monkeypatch, tmp_path):
    (tmp_path / "omni").mkdir()

    def fake_run(cmd, **kwargs):
        if cmd[:2] == ["git", "reset"]:
            return FakeCompletedProcess(returncode=1, stderr="fatal: Could not reset index")
        return FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(WorkspaceCloneError, match="reset failed"):
        refresh_baked_clone(str(tmp_path), TOKEN)


def test_refresh_baked_clone_scrubs_the_token_from_a_raised_error(monkeypatch, tmp_path):
    (tmp_path / "omni").mkdir()
    leaking_stderr = f"fatal: repository 'https://x-access-token:{TOKEN}@github.com/thegoodparty/omni.git/' not found"

    def fake_run(cmd, **kwargs):
        if cmd[:2] == ["git", "fetch"]:
            return FakeCompletedProcess(returncode=128, stderr=leaking_stderr)
        return FakeCompletedProcess(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(WorkspaceCloneError) as caught:
        refresh_baked_clone(str(tmp_path), TOKEN)

    assert TOKEN not in str(caught.value)
    assert "***" in str(caught.value)


def test_a_stalled_refresh_times_out_instead_of_hanging_the_task(monkeypatch, tmp_path):
    (tmp_path / "omni").mkdir()

    def fake_run(cmd, **kwargs):
        assert kwargs["timeout"] == REFRESH_TIMEOUT_SECONDS
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=kwargs["timeout"])

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(WorkspaceCloneError, match=str(REFRESH_TIMEOUT_SECONDS)):
        refresh_baked_clone(str(tmp_path), TOKEN)


# ---------------------------------------------------------------------------
# Warm path: conditional npm ci on lockfile drift
# ---------------------------------------------------------------------------


def _write_lockfile(omni_dir, contents='{"lockfileVersion": 3}'):
    omni_dir.mkdir(parents=True, exist_ok=True)
    lockfile = omni_dir / "package-lock.json"
    lockfile.write_text(contents)
    return lockfile


def test_npm_ci_not_needed_when_the_fetched_lockfile_matches_the_baked_hash(tmp_path):
    omni_dir = tmp_path / "omni"
    lockfile = _write_lockfile(omni_dir)
    digest = hashlib.sha256(lockfile.read_bytes()).hexdigest()
    (tmp_path / "lockfile.sha256").write_text(digest + "\n")

    assert npm_ci_needed(str(omni_dir), str(tmp_path)) is False


def test_npm_ci_needed_when_the_fetched_lockfile_has_drifted(tmp_path):
    omni_dir = tmp_path / "omni"
    _write_lockfile(omni_dir)
    (tmp_path / "lockfile.sha256").write_text("0" * 64)

    assert npm_ci_needed(str(omni_dir), str(tmp_path)) is True


def test_npm_ci_needed_when_the_baked_hash_file_is_missing(tmp_path):
    # No known-good baseline to trust the baked node_modules against — an
    # image that somehow shipped without ever writing the hash file, or a
    # bake_dir pointed at the wrong place, must still get a real install.
    omni_dir = tmp_path / "omni"
    _write_lockfile(omni_dir)

    assert npm_ci_needed(str(omni_dir), str(tmp_path)) is True


def test_run_npm_ci_raises_on_failure(monkeypatch, tmp_path):
    monkeypatch.setattr(subprocess, "run", lambda cmd, **kwargs: FakeCompletedProcess(1, stderr="ERESOLVE"))

    with pytest.raises(WorkspaceCloneError, match="npm ci failed"):
        run_npm_ci(str(tmp_path))


def test_run_npm_ci_is_silent_on_success(monkeypatch, tmp_path):
    monkeypatch.setattr(subprocess, "run", lambda cmd, **kwargs: FakeCompletedProcess(0))

    run_npm_ci(str(tmp_path))


# ---------------------------------------------------------------------------
# Warm path: the deferred postinstall/Prisma pass
# ---------------------------------------------------------------------------


def test_run_post_bake_setup_runs_every_step(monkeypatch, tmp_path):
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        return FakeCompletedProcess(0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    run_post_bake_setup(str(tmp_path))

    assert calls == list(POST_BAKE_STEPS)


def test_run_post_bake_setup_raises_on_a_failing_step_and_names_it(monkeypatch, tmp_path):
    def fake_run(cmd, **kwargs):
        if tuple(cmd[:2]) == ("npm", "run") and "generate" in cmd:
            return FakeCompletedProcess(1, stderr="prisma schema not found")
        return FakeCompletedProcess(0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(WorkspaceCloneError, match="generate"):
        run_post_bake_setup(str(tmp_path))


# ---------------------------------------------------------------------------
# Orchestration: prepare_omni_workspace picks warm vs. cold-fallback
# ---------------------------------------------------------------------------


def _stub_success(monkeypatch):
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        return FakeCompletedProcess(0)

    monkeypatch.setattr(subprocess, "run", fake_run)
    return calls


def test_prepare_omni_workspace_takes_the_fetch_reset_path_when_a_bake_is_present(monkeypatch, tmp_path):
    bake_dir = tmp_path / "bake"
    omni_dir = bake_dir / "omni"
    lockfile = _write_lockfile(omni_dir)
    (omni_dir / ".git").mkdir()
    digest = hashlib.sha256(lockfile.read_bytes()).hexdigest()
    (bake_dir / "lockfile.sha256").write_text(digest)

    calls = _stub_success(monkeypatch)
    monkeypatch.setattr(
        workspace_module,
        "clone_omni",
        lambda *a, **k: pytest.fail("cold-clone fallback must not run when a bake is present"),
    )

    result = prepare_omni_workspace(str(tmp_path / "ws"), TOKEN, bake_dir=str(bake_dir))

    assert result == str(omni_dir)
    assert any(cmd[:2] == ["git", "fetch"] for cmd in calls)
    # Hash matched: the expensive reinstall must be skipped.
    assert not any(cmd[:2] == ["npm", "ci"] for cmd in calls)


def test_prepare_omni_workspace_runs_npm_ci_when_the_lockfile_has_drifted(monkeypatch, tmp_path):
    bake_dir = tmp_path / "bake"
    omni_dir = bake_dir / "omni"
    _write_lockfile(omni_dir)
    (omni_dir / ".git").mkdir()
    (bake_dir / "lockfile.sha256").write_text("0" * 64)

    calls = _stub_success(monkeypatch)

    prepare_omni_workspace(str(tmp_path / "ws"), TOKEN, bake_dir=str(bake_dir))

    assert any(cmd[:2] == ["npm", "ci"] for cmd in calls)


def test_prepare_omni_workspace_falls_back_to_a_network_clone_when_no_bake_exists(monkeypatch, tmp_path):
    fallback_calls = []

    def fake_clone(workspace_dir, github_token):
        fallback_calls.append((workspace_dir, github_token))
        return str(tmp_path / "ws" / "omni")

    monkeypatch.setattr(workspace_module, "clone_omni", fake_clone)

    result = prepare_omni_workspace(str(tmp_path / "ws"), TOKEN, bake_dir=str(tmp_path / "no-bake-here"))

    assert fallback_calls == [(str(tmp_path / "ws"), TOKEN)]
    assert result == str(tmp_path / "ws" / "omni")
