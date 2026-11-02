from datetime import date

import pytest

import launch_watch as lw

CHECK = {
    "id": "notice-fires",
    "launch": "SMS compliance cutoff",
    "what": "The cutoff notice fires once candidates past their cutoff visit outreach",
    "prs": [2747],
    "active_from": "2026-11-04",
    "active_until": "2026-11-18",
    "window_days": 3,
    "min_exposed": 20,
    "sql": "select 1 where '{window_start}' <= '{window_end}'",
}


def test_fails_when_exposed_and_nothing_fired():
    assert lw.evaluate(CHECK, {"exposed": 120, "fired": 0}) == "fail"


def test_passes_once_anything_fired():
    assert lw.evaluate(CHECK, {"exposed": 120, "fired": 1}) == "pass"


def test_too_little_exposure_is_not_a_finding():
    assert lw.evaluate(CHECK, {"exposed": 19, "fired": 0}) == "low_exposure"


def test_window_is_inclusive_and_ends_the_day_before():
    assert lw.window(CHECK, date(2026, 11, 10)) == (
        date(2026, 11, 7),
        date(2026, 11, 9),
    )


@pytest.mark.parametrize(
    ("as_of", "active"),
    [
        (date(2026, 11, 4), False),  # the window would end before the launch
        (date(2026, 11, 5), True),
        (date(2026, 11, 19), True),  # the window ends on active_until
        (date(2026, 11, 20), False),
    ],
)
def test_runs_only_while_the_window_ends_inside_the_watch(as_of, active):
    assert lw.is_active(CHECK, as_of) is active


def test_renders_window_into_sql():
    sql = lw.render_sql(CHECK, date(2026, 11, 10))
    assert "'2026-11-07' <= '2026-11-09'" in sql


def _runner(results):
    """A query stub answering by window end, so a test can say what each day saw."""

    def run(sql):
        for end, row in results.items():
            if f"'{end}'" in sql:
                return row
        raise AssertionError(f"unexpected window in {sql}")

    return run


def test_posts_only_the_first_failing_day():
    query = _runner(
        {
            "2026-11-08": {"exposed": 100, "fired": 0},
            "2026-11-09": {"exposed": 100, "fired": 0},
        }
    )
    assert lw.run_check(CHECK, date(2026, 11, 10), query)["post"] is False


def test_posts_when_yesterday_passed():
    query = _runner(
        {
            "2026-11-08": {"exposed": 100, "fired": 4},
            "2026-11-09": {"exposed": 100, "fired": 0},
        }
    )
    result = lw.run_check(CHECK, date(2026, 11, 10), query)
    assert result["status"] == "fail"
    assert result["post"] is True


def test_posts_a_failure_on_the_first_watched_day():
    query = _runner({"2026-11-04": {"exposed": 100, "fired": 0}})
    assert lw.run_check(CHECK, date(2026, 11, 5), query)["post"] is True


def test_message_names_the_launch_and_the_evidence():
    text = lw.message(
        CHECK,
        {
            "status": "fail",
            "exposed": 117,
            "fired": 0,
            "window": (date(2026, 10, 14), date(2026, 10, 16)),
        },
    )
    assert "SMS compliance cutoff" in text
    assert "117" in text and "0" in text
    assert "https://github.com/thegoodparty/omni/pull/2747" in text


def test_committed_checks_are_well_formed():
    checks = lw.load_checks()
    assert checks, "launch_watch.yaml has no checks"
    ids = [c["id"] for c in checks]
    assert len(ids) == len(set(ids))
    for check in checks:
        lw.validate(check)
        assert "{window_start}" in check["sql"] and "{window_end}" in check["sql"]


def test_validate_rejects_a_missing_field():
    broken = {k: v for k, v in CHECK.items() if k != "min_exposed"}
    with pytest.raises(ValueError, match="min_exposed"):
        lw.validate(broken)
