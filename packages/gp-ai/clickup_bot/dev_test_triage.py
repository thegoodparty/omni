"""Find the `@dev-only` Playwright specs that failed a post-merge release run.

WHY THIS EXISTS: two specs in packages/gp-webapp/e2e-tests carry `@dev-only`,
and CI greps them OUT on pull requests (`--grep-invert @dev-only` in
gp-webapp.yml) and IN on the post-merge run against dev (release.yml's
`e2e-shard`). So they are the only tests in the repo whose first and only
verdict arrives AFTER the code has merged, on a run nobody authored, and a
failure blocks all seven prod promotion jobs until somebody happens to look.

That has already happened: `d961dc105` ("Unbreak the release train: port the
polls person-overlay spec to the CRM contacts page") is a `@dev-only` failure
that stopped prod shipping and was diagnosed and fixed by hand.

WHAT THIS DOES NOT DO: it does not decide whether the failure is a product bug,
a stale selector, or dev being broken. That judgement needs the codebase, so it
belongs to the analyze agent this feeds — see DEV_TEST_INSTRUCTION in
clickup_bot/lambda/handler.py. This module answers the narrower question the
agent cannot answer from inside a container: which specs failed, whether they
were `@dev-only`, and whether the suite ran at all.

THE SHARDS-RAN CHECK IS NOT A FORMALITY. release-failure-alert.yml's phase
classifier carries the lesson: a failed `Dev <service>` job SKIPS the E2E
shards, and the run's red gate job is STILL named `E2E`. During the Sep 2026
incident (ENG-11106/11107) that got a deploy-role IAM failure triaged as an e2e
problem. A skipped shard produces an empty report rather than a failing one, so
"no dev-only failures" and "the suite never ran" are the same shape unless
something distinguishes them — and reading the second as the first would report
a broken deploy as a healthy test suite.

Pure functions over the Playwright JSON report, no network and no clients, on
the same contract as ci_triage.py and weekly_digest.py:
.github/workflows/gpbot-dev-test-triage.yml gathers the facts and files the
tickets, and every judgement about what they mean is made here where
clickup_bot/tests/test_dev_test_triage.py can pin it against captured report
shapes.
"""

import json
import sys
from typing import Any

# The tag that makes a spec merge-only. Matched case-insensitively against the
# spec title and every describe title above it, because the two tagged sites in
# the repo use different levels: polls-onboarding.spec.ts tags the
# `describe.serial` block and pro-upgrade-happy-path.spec.ts tags the test
# title. A matcher that read only `spec.title` would miss the first file
# entirely — both of its tests inherit the tag from their describe.
DEV_ONLY_TAG = "@dev-only"

# How Playwright joins a title path, and what its own `list` reporter prints.
# Used verbatim so a fingerprint here can be pasted into `--grep`.
TITLE_SEPARATOR = " › "

# Where the e2e suite lives, relative to the repo root. The report's `file`
# paths are relative to Playwright's rootDir, which is the e2e-tests directory,
# so a repro command needs this prefix to be runnable from anywhere.
E2E_DIR = "packages/gp-webapp/e2e-tests"

# Playwright's `testDir`. A report `file` may arrive already relative to the
# config dir (`tests/app/...`) or relative to testDir (`app/...`) depending on
# where rootDir resolved, so the repro path normalises on this rather than
# assuming one of the two.
TEST_DIR = "tests"

# How much of a failure's error text is carried into the ticket. Enough for the
# assertion and a few stack frames, which is what makes the ticket readable
# without opening the HTML report; the agent fetches the full trace itself.
# ClickUp silently rejects very large descriptions, and the trace is the better
# evidence anyway.
MAX_ERROR_EXCERPT_CHARS = 2000

# Cap on a ClickUp task name. The full title path plus the file is routinely
# 120+ characters, and a task list of truncated-at-the-wrong-end names is
# unreadable. The fingerprint is carried in the body, so nothing is lost.
MAX_TICKET_TITLE_CHARS = 120


def _text(value: Any) -> str:
    """A non-empty string, or "". Report shapes drift between Playwright
    versions and a merged report is assembled from four separate blobs, so
    every field is read defensively — a malformed spec must not abort the whole
    triage and strand a real failure."""
    return value if isinstance(value, str) and value else ""


def _children(node: Any, key: str) -> list:
    if not isinstance(node, dict):
        return []
    value = node.get(key)
    return value if isinstance(value, list) else []


def _spec_path(file: str) -> str:
    """The path to pass to `playwright test`, whichever way the report spelled it.

    Normalised rather than used verbatim because the prefix decides whether the
    repro command in the ticket actually runs, and a command that does not run
    is worse than no command: it sends whoever tries it hunting for a config
    problem instead of the failure.
    """
    if not file:
        return ""
    return file if file.startswith(f"{TEST_DIR}/") else f"{TEST_DIR}/{file}"


def _error_excerpt(spec: dict) -> tuple[str, int]:
    """The final attempt's error text, and how many attempts were made.

    THE LAST RESULT, NOT THE FIRST. `retries: 3` in CI means up to four
    attempts, and the earlier ones are frequently a different, more confusing
    failure than the one that settled it — a timeout waiting for a page that a
    later attempt reached before failing on the real assertion. The last
    attempt is the one whose error describes the state the test actually ended
    in.

    The attempt count rides along because it is the cheapest available evidence
    against flakiness: a spec that failed all four attempts is deterministic,
    and one that failed once is a different conversation. `e2e-tests/AGENTS.md`
    is explicit that a flaky test is a `fix` and never a reason to tag a test
    `@dev-only`, so the agent needs to know which it is looking at.
    """
    results = []
    for test in _children(spec, "tests"):
        results.extend(_children(test, "results"))

    if not results:
        return "", 0

    # `retry` is 0-based, so the attempt count is the highest retry index seen
    # plus one. Counting the results instead would overcount a spec whose
    # `tests` array carries more than one project entry.
    retry_indices: list[int] = []
    for result in results:
        if not isinstance(result, dict):
            continue
        retry = result.get("retry")
        if isinstance(retry, int):
            retry_indices.append(retry)
    attempts = 1 + max(retry_indices, default=0)

    failed = [
        r for r in results if isinstance(r, dict) and _text(r.get("status")) in ("failed", "timedOut", "interrupted")
    ]
    if not failed:
        return "", attempts

    last = failed[-1]
    error = last.get("error")
    if not isinstance(error, dict):
        error = {}
    # `stack` over `message`: it contains the message as its first line plus
    # the frames that say which helper actually threw, which is the difference
    # between "expected visible, got hidden" and knowing it was a shared
    # fixture. Falls back to `message` because a timeout carries no stack.
    text = _text(error.get("stack")) or _text(error.get("message"))
    if not text:
        # A timed-out spec sometimes reports only the top-level `errors` array.
        for candidate in _children(last, "errors"):
            text = _text(candidate.get("message")) if isinstance(candidate, dict) else ""
            if text:
                break

    return text[:MAX_ERROR_EXCERPT_CHARS], attempts


def walk_specs(report: Any) -> list[dict]:
    """Every spec in the report, each with the describe titles above it.

    Playwright nests a file-level suite (whose `title` IS the file path) around
    zero or more describe-level suites. The file level is deliberately dropped
    from the title path: `is_dev_only` matches the tag against the whole joined
    path, so a file whose NAME contained the tag would mark every spec inside it
    `@dev-only`. The file is not lost — `fingerprint` and `ticket_title` take it
    from the spec's own `file`, and `repro_command` passes it positionally,
    which is how Playwright takes a path.

    Identified by comparing against the spec's own `file` rather than by depth,
    because a merged report has been observed with an extra wrapping level and
    "depth 0 is the file" is not a promise Playwright makes.
    """
    found: list[dict] = []

    def visit(suite: Any, ancestors: list[str]) -> None:
        if not isinstance(suite, dict):
            return
        title = _text(suite.get("title"))
        file = _text(suite.get("file"))
        # A suite whose title is its own path is the file wrapper, not a
        # describe. Compared both ways because the report spells the two
        # relative to different roots depending on where rootDir resolved.
        is_file_suite = bool(title) and title in (file, _spec_path(file), file.removeprefix(f"{TEST_DIR}/"))
        next_ancestors = ancestors if is_file_suite or not title else ancestors + [title]

        for spec in _children(suite, "specs"):
            if not isinstance(spec, dict):
                continue
            spec_title = _text(spec.get("title"))
            if not spec_title:
                continue
            spec_file = _text(spec.get("file")) or file
            error_excerpt, attempts = _error_excerpt(spec)
            found.append(
                {
                    "file": spec_file,
                    "line": spec.get("line") if isinstance(spec.get("line"), int) else None,
                    "title_path": next_ancestors + [spec_title],
                    # `ok` is Playwright's own verdict and already accounts for
                    # retries: a spec that failed once and passed on a retry is
                    # `ok: true` and reported as flaky, and a spec skipped
                    # because an earlier test in its `describe.serial` block
                    # failed is also `ok: true`. So this is read verbatim rather
                    # than recomputed from the results, which would turn one
                    # failure in a serial block into three tickets.
                    "ok": spec.get("ok") is not False,
                    "error_excerpt": error_excerpt,
                    "attempts": attempts,
                }
            )

        for child in _children(suite, "suites"):
            visit(child, next_ancestors)

    for suite in _children(report, "suites"):
        visit(suite, [])
    return found


def is_dev_only(spec: dict) -> bool:
    """Whether this spec is merge-only, by the same signal CI greps on.

    Matched against the WHOLE title path, so a tag on the describe covers every
    test inside it — which is how polls-onboarding.spec.ts is written, and the
    convention `e2e-tests/AGENTS.md` prescribes for a `describe.serial` block
    whose tests share state.
    """
    joined = TITLE_SEPARATOR.join(spec.get("title_path") or [])
    return DEV_ONLY_TAG in joined.lower()


def fingerprint(spec: dict) -> str:
    """The stable identity of one failing spec, across runs.

    File AND title path, because neither alone is stable enough to dedup on. A
    title moves between files when a spec is ported (`d961dc105` did exactly
    that), and a file holds several specs. Together they change only when
    somebody renames the test, which is a case worth a fresh ticket anyway.

    Deliberately NOT the line number: every unrelated edit above the test moves
    it, and a fingerprint that changes on an unrelated commit would file a
    duplicate ticket for a failure that was already open.
    """
    return f"{spec.get('file', '')}::{TITLE_SEPARATOR.join(spec.get('title_path') or [])}"


def repro_command(spec: dict) -> str:
    """The exact command that reproduces this failure against dev.

    `--retries=0 --workers=1` per `e2e-tests/AGENTS.md`: the CI retry count
    triples the time to see a deterministic failure, and serial specs
    interleave under parallel workers. The absolute `--config` is load-bearing
    for the same reason AGENTS.md calls it out — a bare `npx playwright test`
    resolves against the nearest package.json (`packages/gp-webapp`, one level
    above e2e-tests) and silently finds no config at all.
    """
    path = _spec_path(_text(spec.get("file")))
    return (
        f"cd {E2E_DIR} && BASE_URL=https://dev.goodparty.org "
        f'npx playwright test --config="$PWD/playwright.config.ts" '
        f"{path} --retries=0 --workers=1"
    )


def ticket_title(spec: dict) -> str:
    """The ClickUp task name.

    Prefixed so the tickets are filterable as a class, and truncated from the
    END of the title path rather than the start: the leaf test name is the part
    that distinguishes two failures in the same file, so it is the part that
    must survive.
    """
    leaf = (spec.get("title_path") or [""])[-1]
    file = _text(spec.get("file"))
    title = f"[dev-only E2E] {file} — {leaf}"
    if len(title) <= MAX_TICKET_TITLE_CHARS:
        return title
    return title[: MAX_TICKET_TITLE_CHARS - 1].rstrip() + "…"


def ticket_body(spec: dict, context: dict) -> str:
    """Everything the analyze agent and a human need, in one place.

    The fingerprint is embedded as a literal line because it is the dedup key
    the workflow searches ClickUp for on the next failure. It has to be in the
    body rather than only the title, which is truncated.

    The attempt count is stated explicitly rather than left implicit in the
    error text, because it is the single fact that decides whether the agent is
    looking at a deterministic break or a flake — and AGENTS.md forbids the
    lazy answer to a flake ("never" tag it `@dev-only`).
    """
    run_url = _text(context.get("run_url"))
    report_url = _text(context.get("report_url"))
    head_sha = _text(context.get("head_sha"))
    attempts = spec.get("attempts") or 0
    excerpt = _text(spec.get("error_excerpt"))

    attempt_line = (
        f"Failed all {attempts} attempts (CI runs `retries: 3`), so this is deterministic rather than flaky."
        if attempts >= 4
        else f"Failed after {attempts} attempt(s) of a possible 4."
    )

    lines = [
        "A `@dev-only` Playwright spec failed on the post-merge run against dev, "
        "which blocks every prod promotion job until the release train goes green.",
        "",
        "**These specs do not run on pull requests** "
        "(`--grep-invert @dev-only` in gp-webapp.yml), so this failure was never "
        "seen before the code merged.",
        "",
        f"- **Spec:** `{TITLE_SEPARATOR.join(spec.get('title_path') or [])}`",
        f"- **File:** `{_spec_path(_text(spec.get('file')))}`"
        + (f" (line {spec['line']})" if spec.get("line") else ""),
        f"- **Attempts:** {attempt_line}",
    ]
    if head_sha:
        lines.append(f"- **Commit:** `{head_sha}`")
    if run_url:
        lines.append(f"- **Release run:** {run_url}")
    if report_url:
        lines.append(f"- **HTML report:** {report_url}")

    lines += ["", "**Reproduce against dev:**", "```", repro_command(spec), "```"]

    if excerpt:
        lines += ["", "**Error (final attempt):**", "```", excerpt, "```"]

    lines += [
        "",
        "Before concluding this is a product bug, check whether dev itself is "
        "healthy and whether the spec's own selectors or fixtures moved — and note "
        "that `e2e-tests/AGENTS.md` is explicit that a flaky test must be "
        "stabilized, never hidden behind the tag.",
        "",
        f"<!-- gpbot-dev-test-fingerprint: {fingerprint(spec)} -->",
    ]
    return "\n".join(lines)


def triage(payload: Any) -> dict:
    """Which `@dev-only` specs failed, and whether the suite ran at all.

    `shards_ran` is the guard described in the module docstring, and it is
    reported rather than raised so the workflow can exit silently: a release run
    that died in its dev deploy is a real failure, but it is
    release-failure-alert.yml's to report, not this one's. Filing a test ticket
    for it would point an agent at a test that never executed.

    `other_failures` counts specs that failed WITHOUT the tag. Those are
    ordinary E2E failures which the same commit's author can see on their own
    PR, so they get no ticket — but the count is surfaced because a run where
    everything failed is an environment problem rather than five separate bugs,
    and a human reading the Slack thread needs to be able to tell.
    """
    if not isinstance(payload, dict):
        raise ValueError("triage input must be a JSON object")

    report = payload.get("report")
    if not isinstance(report, dict):
        # An unreadable report is NOT "no failures". The artifact is missing or
        # truncated, and claiming a clean suite from it is the one wrong answer
        # this module must never give.
        return {
            "shards_ran": False,
            "reason": "no readable Playwright JSON report was provided",
            "total_specs": 0,
            "failures": [],
            "other_failures": 0,
        }

    specs = walk_specs(report)
    if not specs:
        return {
            "shards_ran": False,
            "reason": (
                "the report contains no specs, so the E2E shards did not run — "
                "a failed dev deploy skips them while the gate job is still named E2E"
            ),
            "total_specs": 0,
            "failures": [],
            "other_failures": 0,
        }

    failed = [spec for spec in specs if not spec["ok"]]
    dev_only = [spec for spec in failed if is_dev_only(spec)]

    context = {
        "run_url": payload.get("run_url"),
        "report_url": payload.get("report_url"),
        "head_sha": payload.get("head_sha"),
    }

    return {
        "shards_ran": True,
        "total_specs": len(specs),
        "failures": [
            {
                "fingerprint": fingerprint(spec),
                "file": spec["file"],
                "line": spec["line"],
                "full_title": TITLE_SEPARATOR.join(spec["title_path"]),
                "attempts": spec["attempts"],
                "ticket_title": ticket_title(spec),
                "ticket_body": ticket_body(spec, context),
                "repro": repro_command(spec),
            }
            for spec in dev_only
        ],
        "other_failures": len(failed) - len(dev_only),
    }


def main() -> int:
    """Read the report and run context on stdin, write the triage on stdout.

    A CLI rather than an importable-only module, for the same reason
    ci_triage.py is one: the workflow stays a fact gatherer that shells out
    here, and every judgement — including the ticket prose — is exercised by
    pytest instead of by a Monday morning release train.

    Exit 0 whenever a decision was reached, including "the shards did not run".
    Exit 1 only when the input could not be read at all, because a non-zero exit
    is the workflow's signal that it cannot trust the output, and a red triage
    job on every dev-deploy failure would train everyone to ignore it.
    """
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"ERROR: unreadable triage input: {e}", file=sys.stderr)
        return 1

    try:
        result = triage(payload)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
