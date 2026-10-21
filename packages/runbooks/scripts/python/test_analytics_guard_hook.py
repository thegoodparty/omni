"""The edit-time hook maps guard exit codes to Claude Code hook behavior (DATA-2432)."""

import json
import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
HOOK = REPO / ".claude" / "hooks" / "analytics-guard-check.sh"


def _run(file_path: str, stub_exit: int, stub_out: str = "report",
         status: str | None = None) -> subprocess.CompletedProcess:
    """The stub writes the guard's --json the way the real guard does: a 2 counts as a block
    only when that file says so."""
    status = status or ("block" if stub_exit == 2 else "pass")
    payload = json.dumps({"tool_input": {"file_path": file_path}})
    cmd = f"echo '{stub_out}'; echo '{{\"status\": \"{status}\"}}' > \"$ANALYTICS_GUARD_JSON\"; exit {stub_exit}"
    env = {**os.environ, "ANALYTICS_GUARD_CMD": cmd}
    return subprocess.run(["bash", str(HOOK)], input=payload, capture_output=True, text=True, env=env)


def test_an_unrelated_file_is_ignored():
    r = _run(str(REPO / "docs" / "testing.md"), 2)
    assert r.returncode == 0 and r.stdout == "" and r.stderr == ""


def test_a_blocking_finding_feeds_the_report_back_to_the_agent():
    r = _run(str(REPO / "packages/gp-webapp/helpers/analyticsHelper.ts"), 2)
    assert r.returncode == 2 and "report" in r.stderr
    assert "finish the move" in r.stderr


def test_an_exit_2_the_json_does_not_confirm_is_not_a_block():
    r = _run(str(REPO / "packages/gp-webapp/helpers/analyticsHelper.ts"), 2, status="error")
    assert r.returncode == 0
    assert "could not run" in json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]


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


def test_a_real_run_works_without_gnu_timeout(tmp_path):
    """`timeout` is GNU coreutils, not stock on macOS. A PATH with neither `timeout`
    nor `gtimeout` must still run the real guard command, not silently skip it."""
    stub_bin = tmp_path / "bin"
    stub_bin.mkdir()
    stub_uv = stub_bin / "uv"
    stub_uv.write_text("#!/usr/bin/env bash\necho 'No analytics governance problems found.'\nexit 0\n")
    stub_uv.chmod(0o755)

    env = {**os.environ, "PATH": f"{stub_bin}:/usr/bin:/bin"}
    env.pop("ANALYTICS_GUARD_CMD", None)
    payload = json.dumps(
        {"tool_input": {"file_path": str(REPO / "packages/gp-webapp/helpers/analyticsHelper.ts")}}
    )
    r = subprocess.run(["bash", str(HOOK)], input=payload, capture_output=True, text=True, env=env)
    assert r.returncode == 0 and r.stdout == ""


def _stub_uv(tmp_path, body: str) -> dict:
    stub_bin = tmp_path / "bin"
    stub_bin.mkdir()
    stub_uv = stub_bin / "uv"
    stub_uv.write_text("#!/usr/bin/env bash\n" + body)
    stub_uv.chmod(0o755)
    env = {**os.environ, "PATH": f"{stub_bin}:/usr/bin:/bin"}
    env.pop("ANALYTICS_GUARD_CMD", None)
    return env


def test_uv_failing_with_exit_2_is_not_a_block(tmp_path):
    """uv and argparse also exit 2. Without a guard json saying block, that is the guard
    failing to run, and it must never stop the edit."""
    env = _stub_uv(tmp_path, "echo 'Failed to download distribution' >&2\nexit 2\n")
    payload = json.dumps(
        {"tool_input": {"file_path": str(REPO / "packages/gp-webapp/helpers/analyticsHelper.ts")}}
    )
    r = subprocess.run(["bash", str(HOOK)], input=payload, capture_output=True, text=True, env=env)
    assert r.returncode == 0
    context = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "could not run" in context and "Failed to download distribution" in context


def test_a_file_in_another_checkout_runs_that_checkouts_guard(tmp_path):
    """The hook is shared through settings, so the edited file can live in a different
    worktree from the hook script. It must run there, not skip as 'outside the repo'."""
    other = tmp_path / "other"
    target = other / "packages/gp-webapp/helpers/analyticsHelper.ts"
    target.parent.mkdir(parents=True)
    target.write_text("export const EVENTS = {}\n")
    (other / "packages/runbooks/scripts/python").mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(other)], check=True)
    payload = json.dumps({"tool_input": {"file_path": str(target)}})
    cmd = 'echo "ran in $PWD"; echo \'{"status": "block"}\' > "$ANALYTICS_GUARD_JSON"; exit 2'
    env = {**os.environ, "ANALYTICS_GUARD_CMD": cmd}
    r = subprocess.run(["bash", str(HOOK)], input=payload, capture_output=True, text=True, env=env)
    assert r.returncode == 2
    assert f"ran in {other.resolve()}" in r.stderr


def test_a_file_outside_any_git_checkout_is_ignored(tmp_path):
    loose = tmp_path / "packages/gp-webapp/helpers/analyticsHelper.ts"
    loose.parent.mkdir(parents=True)
    loose.write_text("x\n")
    r = _run(str(loose), 2)
    assert r.returncode == 0 and r.stdout == "" and r.stderr == ""
