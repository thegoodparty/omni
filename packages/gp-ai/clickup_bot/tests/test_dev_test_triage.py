"""Tests for the `@dev-only` failure triage that files the tickets.

Two failure modes matter here and they run in opposite directions.

Reporting a failure that did not happen files a ticket and spends an analyze
run on a test that never executed — which is exactly what a failed dev deploy
looks like, because it SKIPS the E2E shards while the gate job stays named
`E2E`.

Missing a failure that did happen is worse: `@dev-only` specs never run on a
pull request, so nothing else in the system will ever surface it, and the
release train stays red until a human happens to look. That is the state
`d961dc105` was fixed out of by hand.

The fixtures mirror the two real tagged sites, because they are tagged at
different levels and a matcher that handles one and not the other looks
correct: polls-onboarding.spec.ts tags its `describe.serial` block, and
pro-upgrade-happy-path.spec.ts tags the test title.
"""

import json

import dev_test_triage
from dev_test_triage import (
    DEV_ONLY_TAG,
    MAX_TICKET_TITLE_CHARS,
    fingerprint,
    is_dev_only,
    repro_command,
    ticket_body,
    ticket_title,
    triage,
    walk_specs,
)

POLLS_FILE = "app/polls/polls-onboarding.spec.ts"
PRO_UPGRADE_FILE = "app/dashboard/pro-upgrade/pro-upgrade-happy-path.spec.ts"
CONTACTS_FILE = "app/dashboard/contacts/contacts-table.spec.ts"


def _result(status: str, retry: int, stack: str = "", message: str = "") -> dict:
    error = {}
    if stack:
        error["stack"] = stack
    if message:
        error["message"] = message
    return {"workerIndex": 0, "status": status, "duration": 1000, "retry": retry, "error": error, "errors": []}


def _spec(title: str, *, ok: bool, line: int, file: str, results: list[dict] | None = None) -> dict:
    return {
        "title": title,
        "ok": ok,
        "file": file,
        "line": line,
        "column": 3,
        "tests": [
            {"projectName": "default", "status": "unexpected" if not ok else "expected", "results": results or []}
        ],
    }


def polls_report(*, first_ok: bool = False) -> dict:
    """polls-onboarding.spec.ts — the tag is on the `describe.serial` block.

    The second test is `ok: true` even on a failing run, because
    `describe.serial` SKIPS it once the first one fails. That is the shape that
    would turn one failure into two tickets if `ok` were recomputed from the
    results instead of read from Playwright.
    """
    return {
        "config": {"rootDir": "/home/runner/work/omni/omni/packages/gp-webapp/e2e-tests"},
        "suites": [
            {
                "title": POLLS_FILE,
                "file": POLLS_FILE,
                "specs": [],
                "suites": [
                    {
                        "title": "poll onboarding @dev-only",
                        "file": POLLS_FILE,
                        "specs": [
                            _spec(
                                "poll onboarding and expansion",
                                ok=first_ok,
                                line=325,
                                file=POLLS_FILE,
                                results=[
                                    _result("failed", 0, message="Timeout waiting for pollAnalysisComplete"),
                                    _result("failed", 1, message="Timeout waiting for pollAnalysisComplete"),
                                    _result("failed", 2, message="Timeout waiting for pollAnalysisComplete"),
                                    _result(
                                        "failed",
                                        3,
                                        stack=(
                                            "Error: expect(locator).toBeVisible() failed\n"
                                            "Locator: getByTestId('poll-insights')\n"
                                            "    at tests/app/polls/polls-onboarding.spec.ts:601:40"
                                        ),
                                    ),
                                ],
                            ),
                            _spec(
                                "person overlay shows constituent issues and activities",
                                ok=True,
                                line=772,
                                file=POLLS_FILE,
                                results=[_result("skipped", 0)],
                            ),
                        ],
                        "suites": [],
                    }
                ],
            }
        ],
        "errors": [],
    }


def pro_upgrade_report() -> dict:
    """pro-upgrade-happy-path.spec.ts — the tag is on the test title, with no
    describe wrapper at all."""
    return {
        "suites": [
            {
                "title": PRO_UPGRADE_FILE,
                "file": PRO_UPGRADE_FILE,
                "specs": [
                    _spec(
                        "filed candidate upgrades to Pro and reaches the post-payment PIN state @dev-only",
                        ok=False,
                        line=41,
                        file=PRO_UPGRADE_FILE,
                        results=[_result("failed", 0, message="isPro never flipped within 240s")],
                    )
                ],
                "suites": [],
            }
        ]
    }


def untagged_report() -> dict:
    """An ordinary failing spec. Its author sees it on their own PR, so it must
    not earn a ticket here."""
    return {
        "suites": [
            {
                "title": CONTACTS_FILE,
                "file": CONTACTS_FILE,
                "specs": [
                    _spec(
                        "contacts table paginates",
                        ok=False,
                        line=88,
                        file=CONTACTS_FILE,
                        results=[_result("failed", 0, message="boom")],
                    )
                ],
                "suites": [],
            }
        ]
    }


# --- the tag, at both levels it is actually used ---------------------------


def test_tag_on_describe_covers_the_tests_inside_it():
    specs = walk_specs(polls_report())
    failing = [s for s in specs if not s["ok"]]
    assert len(failing) == 1
    assert is_dev_only(failing[0])
    # The describe title is carried, and the file-level suite title is not.
    assert failing[0]["title_path"] == ["poll onboarding @dev-only", "poll onboarding and expansion"]


def test_tag_on_test_title_is_found_without_a_describe():
    specs = walk_specs(pro_upgrade_report())
    assert len(specs) == 1
    assert is_dev_only(specs[0])
    assert specs[0]["title_path"] == [
        "filed candidate upgrades to Pro and reaches the post-payment PIN state @dev-only"
    ]


def test_untagged_spec_is_not_dev_only():
    specs = walk_specs(untagged_report())
    assert not is_dev_only(specs[0])


def test_tag_match_is_case_insensitive():
    assert is_dev_only({"title_path": ["Poll onboarding @DEV-ONLY", "a test"]})


def test_file_path_is_not_searched_for_the_tag():
    """A file whose NAME contained the tag must not tag every spec inside it.
    Playwright's own --grep matches titles, not paths."""
    report = {
        "suites": [
            {
                "title": "app/dev-only-helpers.spec.ts",
                "file": "app/dev-only-helpers.spec.ts",
                "specs": [_spec("a test", ok=False, line=1, file="app/dev-only-helpers.spec.ts")],
                "suites": [],
            }
        ]
    }
    specs = walk_specs(report)
    assert specs[0]["title_path"] == ["a test"]
    assert not is_dev_only(specs[0])


def test_file_suite_detected_when_report_roots_differ():
    """rootDir has resolved both ways in practice, so the file-level suite is
    identified by comparing against the spec's file rather than by depth."""
    report = {
        "suites": [
            {
                "title": POLLS_FILE,
                "file": f"tests/{POLLS_FILE}",
                "specs": [_spec("a test", ok=False, line=1, file=f"tests/{POLLS_FILE}")],
                "suites": [],
            }
        ]
    }
    assert walk_specs(report)[0]["title_path"] == ["a test"]


# --- retries, serial skips, and what counts as a failure -------------------


def test_serial_block_skip_is_not_reported_as_a_failure():
    """One failure in a describe.serial block must file one ticket, not two."""
    result = triage({"report": polls_report()})
    assert len(result["failures"]) == 1
    assert "poll onboarding and expansion" in result["failures"][0]["full_title"]


def test_flaky_spec_that_eventually_passed_is_not_a_failure():
    """Playwright reports ok: true for a spec that passed on a retry. CI runs
    retries: 3, so treating a single red attempt as a failure would ticket
    every flake."""
    result = triage({"report": polls_report(first_ok=True)})
    assert result["failures"] == []
    assert result["other_failures"] == 0
    assert result["shards_ran"] is True


def test_attempts_counts_every_retry():
    result = triage({"report": polls_report()})
    assert result["failures"][0]["attempts"] == 4


def test_error_excerpt_is_the_last_attempt_not_the_first():
    """The earlier attempts here are a timeout; the final one is the real
    assertion. The last is the state the test actually ended in."""
    result = triage({"report": polls_report()})
    body = result["failures"][0]["ticket_body"]
    assert "toBeVisible() failed" in body
    assert "Timeout waiting for pollAnalysisComplete" not in body


def test_deterministic_failure_is_described_as_such():
    body = triage({"report": polls_report()})["failures"][0]["ticket_body"]
    assert "deterministic rather than flaky" in body


def test_single_attempt_failure_is_not_called_deterministic():
    report = pro_upgrade_report()
    body = triage({"report": report})["failures"][0]["ticket_body"]
    assert "deterministic rather than flaky" not in body
    assert "1 attempt(s)" in body


# --- the shards-ran guard --------------------------------------------------


def test_empty_report_is_not_reported_as_a_clean_suite():
    """A failed dev deploy skips the shards and the gate job is still named
    E2E. Reading that as 'no dev-only failures' reports a broken deploy as a
    healthy test suite."""
    result = triage({"report": {"suites": []}})
    assert result["shards_ran"] is False
    assert result["failures"] == []
    assert "did not run" in result["reason"]


def test_missing_report_is_not_reported_as_a_clean_suite():
    result = triage({"report": None})
    assert result["shards_ran"] is False
    assert result["failures"] == []
    assert "no readable" in result["reason"]


def test_passing_suite_ran_but_has_no_failures():
    result = triage({"report": polls_report(first_ok=True)})
    assert result["shards_ran"] is True
    assert result["total_specs"] == 2


# --- what gets a ticket and what does not ----------------------------------


def test_untagged_failure_is_counted_but_not_ticketed():
    result = triage({"report": untagged_report()})
    assert result["failures"] == []
    assert result["other_failures"] == 1


def test_mixed_run_tickets_only_the_tagged_failure():
    merged = {"suites": polls_report()["suites"] + untagged_report()["suites"]}
    result = triage({"report": merged})
    assert len(result["failures"]) == 1
    assert result["failures"][0]["file"] == POLLS_FILE
    assert result["other_failures"] == 1


# --- fingerprints, which are the dedup key --------------------------------


def test_fingerprint_combines_file_and_title_path():
    spec = walk_specs(polls_report())[0]
    assert fingerprint(spec) == f"{POLLS_FILE}::poll onboarding @dev-only › poll onboarding and expansion"


def test_fingerprint_is_stable_when_the_line_number_moves():
    """Any unrelated edit above the test moves its line. A fingerprint that
    changed would file a duplicate ticket for an already-open failure."""
    before = walk_specs(polls_report())[0]
    moved = polls_report()
    moved["suites"][0]["suites"][0]["specs"][0]["line"] = 999
    after = walk_specs(moved)[0]
    assert fingerprint(before) == fingerprint(after)


def test_fingerprint_changes_when_the_spec_moves_file():
    """Porting a spec to another file (d961dc105 did exactly that) is worth a
    fresh ticket."""
    before = walk_specs(polls_report())[0]
    ported = polls_report()
    ported["suites"][0]["suites"][0]["specs"][0]["file"] = CONTACTS_FILE
    assert fingerprint(before) != fingerprint(walk_specs(ported)[0])


def test_ticket_body_embeds_the_fingerprint_for_dedup():
    result = triage({"report": polls_report()})
    failure = result["failures"][0]
    assert f"<!-- gpbot-dev-test-fingerprint: {failure['fingerprint']} -->" in failure["ticket_body"]


# --- the repro command has to actually run ---------------------------------


def test_repro_command_prefixes_the_test_dir():
    cmd = repro_command({"file": POLLS_FILE})
    assert f"tests/{POLLS_FILE}" in cmd


def test_repro_command_does_not_double_prefix():
    cmd = repro_command({"file": f"tests/{POLLS_FILE}"})
    assert cmd.count("tests/") == 1


def test_repro_command_disables_retries_and_parallelism():
    cmd = repro_command({"file": POLLS_FILE})
    assert "--retries=0" in cmd
    assert "--workers=1" in cmd


def test_repro_command_uses_an_absolute_config():
    """A bare `npx playwright test` resolves against packages/gp-webapp and
    silently finds no config, per e2e-tests/AGENTS.md."""
    assert '--config="$PWD/playwright.config.ts"' in repro_command({"file": POLLS_FILE})


def test_repro_command_targets_dev():
    assert "BASE_URL=https://dev.goodparty.org" in repro_command({"file": POLLS_FILE})


# --- ticket presentation ---------------------------------------------------


def test_ticket_title_keeps_the_leaf_test_name():
    """The leaf distinguishes two failures in the same file, so it is the part
    that must survive truncation."""
    spec = {"file": POLLS_FILE, "title_path": ["poll onboarding @dev-only", "poll onboarding and expansion"]}
    assert ticket_title(spec).startswith("[dev-only E2E]")
    assert "poll onboarding and expansion" in ticket_title(spec)


def test_ticket_title_is_capped():
    spec = {"file": "a" * 200, "title_path": ["x" * 200]}
    assert len(ticket_title(spec)) <= MAX_TICKET_TITLE_CHARS


def test_a_long_file_path_loses_its_tail_rather_than_the_leaf():
    """The cap is spent on the leaf first. A file path long enough to fill it
    alone would otherwise leave a ticket named after a path and nothing else —
    and this name is the dedup key, so two specs under one long path would
    truncate to the same ticket and the second failure would never be filed."""
    leaf = "should keep the polls picker open while the filter is loading"
    title = ticket_title({"file": "a" * 110, "title_path": ["@dev-only Polls", leaf]})

    assert len(title) <= MAX_TICKET_TITLE_CHARS
    assert title.endswith(f"— {leaf}")
    assert "…" in title


def test_two_specs_under_one_long_path_get_different_ticket_names():
    long_path = f"e2e-tests/{'nested/' * 14}polls.spec.ts"
    first = ticket_title({"file": long_path, "title_path": ["opens the picker"]})
    second = ticket_title({"file": long_path, "title_path": ["closes the picker"]})

    assert first != second


def test_a_leaf_too_long_for_the_cap_loses_the_file_first():
    """The only case where the leaf is cut. Shortening both would spend the
    budget on a path that is already unreadable."""
    title = ticket_title({"file": POLLS_FILE, "title_path": ["x" * 200]})

    assert len(title) <= MAX_TICKET_TITLE_CHARS
    assert POLLS_FILE not in title
    assert title.startswith("[dev-only E2E] xxx")


def test_ticket_body_says_these_do_not_run_on_prs():
    """The single most important fact for whoever reads the ticket: this was
    never visible before the merge."""
    body = ticket_body({"file": POLLS_FILE, "title_path": ["t"], "attempts": 4}, {})
    assert "do not run on pull requests" in body


def test_ticket_body_carries_the_run_context():
    body = ticket_body(
        {"file": POLLS_FILE, "title_path": ["t"], "attempts": 4},
        {"run_url": "https://github.com/run/1", "report_url": "https://s3/report", "head_sha": "abc1234"},
    )
    assert "https://github.com/run/1" in body
    assert "https://s3/report" in body
    assert "abc1234" in body


def test_ticket_body_warns_against_hiding_a_flake():
    body = ticket_body({"file": POLLS_FILE, "title_path": ["t"], "attempts": 4}, {})
    assert "stabilized, never hidden" in body


# --- shape tolerance ------------------------------------------------------


def test_malformed_specs_do_not_abort_the_triage():
    """A merged report is assembled from four blobs. One bad entry must not
    strand a real failure in another."""
    report = {
        "suites": [
            "not a suite",
            {"title": None, "specs": ["nope", {"title": ""}], "suites": [None]},
            *polls_report()["suites"],
        ]
    }
    result = triage({"report": report})
    assert len(result["failures"]) == 1


def test_non_object_payload_raises():
    try:
        triage("nope")
    except ValueError:
        return
    raise AssertionError("expected ValueError")


def test_spec_with_no_results_is_still_reported():
    """An absent results array must not hide the failure — the error text is
    nice to have, the ticket is not optional."""
    report = {
        "suites": [
            {
                "title": PRO_UPGRADE_FILE,
                "file": PRO_UPGRADE_FILE,
                "specs": [_spec(f"a test {DEV_ONLY_TAG}", ok=False, line=1, file=PRO_UPGRADE_FILE, results=[])],
                "suites": [],
            }
        ]
    }
    result = triage({"report": report})
    assert len(result["failures"]) == 1
    assert result["failures"][0]["attempts"] == 0


# --- the CLI contract the workflow depends on -----------------------------


def test_main_round_trips_json(monkeypatch, capsys):
    import io

    payload = json.dumps({"report": polls_report(), "run_url": "https://github.com/run/1"})
    monkeypatch.setattr("sys.stdin", io.StringIO(payload))
    assert dev_test_triage.main() == 0
    parsed = json.loads(capsys.readouterr().out)
    assert parsed["shards_ran"] is True
    assert len(parsed["failures"]) == 1


def test_main_exits_1_on_unreadable_input(monkeypatch):
    import io

    monkeypatch.setattr("sys.stdin", io.StringIO("{not json"))
    assert dev_test_triage.main() == 1


def test_main_exits_0_when_the_shards_did_not_run(monkeypatch, capsys):
    """Exit 0, not 1: a red triage job on every dev-deploy failure would train
    everyone to ignore it, and the dev deploy already has its own alert."""
    import io

    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({"report": {"suites": []}})))
    assert dev_test_triage.main() == 0
    assert json.loads(capsys.readouterr().out)["shards_ran"] is False
