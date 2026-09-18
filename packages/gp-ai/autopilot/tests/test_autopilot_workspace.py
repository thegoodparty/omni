"""Tests for the pre-flight omni clone every autopilot stage runs against."""

import json
import subprocess

import pytest

from autopilot.agent.workspace import (
    CLONE_TIMEOUT_SECONDS,
    WorkspaceCloneError,
    clone_omni,
    point_playwright_mcp_at_chromium,
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
