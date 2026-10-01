"""The edit-time hook maps guard exit codes to Claude Code hook behavior (DATA-2432)."""

import json
import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
HOOK = REPO / ".claude" / "hooks" / "analytics-guard-check.sh"


def _run(file_path: str, stub_exit: int, stub_out: str = "report") -> subprocess.CompletedProcess:
    payload = json.dumps({"tool_input": {"file_path": file_path}})
    env = {**os.environ, "ANALYTICS_GUARD_CMD": f"echo '{stub_out}'; exit {stub_exit}"}
    return subprocess.run(["bash", str(HOOK)], input=payload, capture_output=True, text=True, env=env)


def test_an_unrelated_file_is_ignored():
    r = _run(str(REPO / "docs" / "testing.md"), 2)
    assert r.returncode == 0 and r.stdout == "" and r.stderr == ""


def test_a_blocking_finding_feeds_the_report_back_to_the_agent():
    r = _run(str(REPO / "packages/gp-webapp/helpers/analyticsHelper.ts"), 2)
    assert r.returncode == 2 and "report" in r.stderr


def test_a_guard_error_never_blocks_the_edit():
    r = _run(str(REPO / "packages/gp-webapp/helpers/analyticsHelper.ts"), 1)
    assert r.returncode == 0
    assert "could not run" in json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]


def test_warnings_only_become_a_nudge():
    r = _run(str(REPO / "packages/gp-webapp/helpers/analyticsHelper.ts"), 0, "**Warnings**")
    assert r.returncode == 0
    assert "Warnings" in json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]


def test_a_clean_run_is_silent():
    r = _run(str(REPO / "packages/gp-webapp/helpers/analyticsHelper.ts"), 0, "No analytics governance problems found.")
    assert r.returncode == 0 and r.stdout == ""
