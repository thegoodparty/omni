"""Tests for the pre-flight omni clone every autopilot stage runs against."""

import subprocess

import pytest

from autopilot.agent.workspace import CLONE_TIMEOUT_SECONDS, WorkspaceCloneError, clone_omni

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
