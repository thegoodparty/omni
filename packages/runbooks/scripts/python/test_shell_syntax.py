"""Every shipped shell script must at least parse (bash -n). A typo in
coldrun-build-rubric.sh would otherwise surface only mid cold-run.

Behavioral tests for coldrun-build-rubric.sh run the real script under a
controlled env: PATH never contains the real `claude` binary (either an empty
dir, or a fake `claude` plus /usr/bin:/bin), so the suite can never launch an
actual cold run.
"""
import glob
import os
import subprocess
from pathlib import Path

SHELL_DIR = Path(__file__).resolve().parents[1] / "shell"
COLDRUN = SHELL_DIR / "coldrun-build-rubric.sh"
BASH = "/bin/bash"


def test_all_shell_scripts_parse():
    scripts = sorted(glob.glob(str(SHELL_DIR / "*.sh")))
    assert scripts, f"no shell scripts found under {SHELL_DIR}"
    for s in scripts:
        p = subprocess.run(["bash", "-n", s], capture_output=True, text=True)
        assert p.returncode == 0, f"{s} fails bash -n:\n{p.stderr}"


def _run_coldrun(args, env, timeout=30):
    return subprocess.run(
        [BASH, str(COLDRUN), *args],
        env=env, capture_output=True, text=True, timeout=timeout,
    )


def _env_no_claude(tmp_path, with_required=False):
    """Env whose PATH is an empty dir (no claude). Required vars stripped
    unless with_required=True. RUNBOOKS_DIR is preset so the script never
    needs external tools (dirname) to compute its default."""
    empty_bin = tmp_path / "emptybin"
    empty_bin.mkdir(exist_ok=True)
    env = {k: v for k, v in os.environ.items()
           if k not in ("AWS_PROFILE", "CLAUDE_CONFIG_DIR", "OUTROOT", "RUNBOOKS_DIR")}
    env.update(RUNBOOKS_DIR=str(tmp_path), PATH=str(empty_bin))
    if with_required:
        env.update(AWS_PROFILE="testprofile",
                   CLAUDE_CONFIG_DIR=str(tmp_path / "claude-cfg"))
    return env


def _env_fake_claude(tmp_path, fake_body):
    """Env with a fake `claude` first on PATH; rest of PATH is /usr/bin:/bin
    only, so the real claude can never be found."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    fake = bin_dir / "claude"
    fake.write_text(f"#!/bin/bash\n{fake_body}\n")
    fake.chmod(0o755)
    env = {k: v for k, v in os.environ.items()
           if k not in ("AWS_PROFILE", "CLAUDE_CONFIG_DIR", "OUTROOT", "RUNBOOKS_DIR")}
    env.update(
        AWS_PROFILE="testprofile",
        CLAUDE_CONFIG_DIR=str(tmp_path / "claude-cfg"),
        RUNBOOKS_DIR=str(tmp_path),
        OUTROOT=str(tmp_path / "outputs"),
        PATH=f"{bin_dir}:/usr/bin:/bin",
    )
    return env


def test_missing_required_env_fails_fast_with_required_in_stderr(tmp_path):
    p = _run_coldrun(["someexp"], _env_no_claude(tmp_path), timeout=10)
    assert p.returncode != 0
    assert "required" in p.stderr


def test_env_set_but_claude_missing_exits_3(tmp_path):
    p = _run_coldrun(["someexp"], _env_no_claude(tmp_path, with_required=True),
                     timeout=10)
    assert p.returncode == 3
    assert "claude CLI not found" in p.stderr


def test_no_args_with_env_set_exits_2_with_usage(tmp_path):
    p = _run_coldrun([], _env_no_claude(tmp_path, with_required=True), timeout=10)
    assert p.returncode == 2
    assert "usage:" in p.stderr


def test_failed_child_surfaces_failure_and_nonzero_exit(tmp_path):
    p = _run_coldrun(["failexp"], _env_fake_claude(tmp_path, "exit 1"))
    assert p.returncode != 0
    assert "FAILED: failexp" in p.stderr
    assert "run.log" in p.stderr
    assert "all cold runs complete" not in p.stdout
    logs = list((tmp_path / "outputs").glob("failexp/coldrun-*/run.log"))
    assert len(logs) == 1
    assert "=== EXIT 1 for failexp ===" in logs[0].read_text()


def test_mixed_children_reports_only_failed_experiment(tmp_path):
    fake = 'if [[ "$*" == *failexp* ]]; then exit 1; fi\nexit 0'
    p = _run_coldrun(["okexp", "failexp"], _env_fake_claude(tmp_path, fake))
    assert p.returncode != 0
    assert "FAILED: failexp" in p.stderr
    assert "FAILED: okexp" not in p.stderr


def test_all_children_succeed_exits_zero(tmp_path):
    p = _run_coldrun(["okexp"], _env_fake_claude(tmp_path, "exit 0"))
    assert p.returncode == 0
    assert "all cold runs complete" in p.stdout
    assert "FAILED" not in p.stderr
    logs = list((tmp_path / "outputs").glob("okexp/coldrun-*/run.log"))
    assert len(logs) == 1
    assert "=== EXIT 0 for okexp ===" in logs[0].read_text()
