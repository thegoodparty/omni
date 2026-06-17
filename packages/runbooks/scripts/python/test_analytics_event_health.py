"""Unit tests for the pure detection logic in analytics_event_health.py."""

from datetime import date, timedelta

from analytics_event_health import (
    build_daily_series,
    classify_code_status,
    evaluate_event,
    last_nonzero_date,
    parse_pr_number,
)

START = date(2026, 1, 1)


def series_from(counts):
    """Build a dense [(date, count)] series starting at START, one day apart."""
    return [(START + timedelta(days=i), c) for i, c in enumerate(counts)]


def evaluate(counts, recent_days=7, floor=None, drop_fraction=0.25,
             min_active_volume=10):
    return evaluate_event(series_from(counts), recent_days, floor,
                          drop_fraction, min_active_volume)


def test_build_daily_series_zero_fills_gaps():
    counts = {date(2026, 1, 1): 5, date(2026, 1, 3): 2}
    series = build_daily_series(counts, date(2026, 1, 1), date(2026, 1, 4))
    assert series == [
        (date(2026, 1, 1), 5),
        (date(2026, 1, 2), 0),
        (date(2026, 1, 3), 2),
        (date(2026, 1, 4), 0),
    ]


def test_last_nonzero_date():
    assert last_nonzero_date(series_from([1, 2, 0, 0])) == START + timedelta(days=1)
    assert last_nonzero_date(series_from([0, 0, 0])) is None


def test_flatline_when_active_baseline_goes_silent():
    # 30 active days (~10/day) then 7 zero days — the registration scenario.
    verdict = evaluate([10] * 30 + [0] * 7)
    assert verdict['flagged'] is True
    assert 'flatline' in verdict['flags']
    assert verdict['recent_sum'] == 0
    assert verdict['drop_pct'] == 100.0
    # drop started the day after the last non-zero day (index 29).
    assert verdict['drop_start_date'] == (START + timedelta(days=30)).isoformat()
    assert verdict['days_since_last_event'] == 7


def test_hard_drop_when_recent_far_below_baseline():
    # Baseline ~20/day, recent ~2/day → below the 25% fraction.
    verdict = evaluate([20] * 30 + [2] * 7)
    assert 'hard_drop' in verdict['flags']
    assert 'flatline' not in verdict['flags']


def test_spiky_recent_week_matching_baseline_rate_not_flagged():
    # Recent week is bursty (all volume on one day) but its daily RATE matches the
    # baseline. A median-based check would see recent median 0 and falsely flag a
    # 100% drop; the rate-based check must not.
    verdict = evaluate([2] * 30 + [0, 0, 0, 0, 0, 0, 14])
    assert verdict['flagged'] is False
    assert verdict['recent_rate'] == 2.0


def test_healthy_steady_event_not_flagged():
    verdict = evaluate([15] * 37)
    assert verdict['flagged'] is False
    assert verdict['flags'] == []


def test_sparse_event_below_min_volume_not_flagged():
    # Naturally sparse: only a handful of events all window, recent zero.
    # Baseline volume < min_active_volume → suppressed (no false flatline).
    verdict = evaluate([0, 1, 0, 0, 1, 0] + [0] * 7, min_active_volume=10)
    assert verdict['flagged'] is False


def test_floor_flag_independent_of_activity():
    verdict = evaluate([100] * 30 + [3] * 7, floor=5)
    assert 'below_floor' in verdict['flags']


def test_parse_pr_number():
    assert parse_pr_number('DT-72 Analytics / Segment (#708)') == '708'
    assert parse_pr_number('feat: add event (#1234)') == '1234'
    assert parse_pr_number('a plain commit with no pr') is None
    assert parse_pr_number('') is None


def test_classify_code_status():
    assert classify_code_status(True, True) == 'present'
    assert classify_code_status(True, False) == 'present'
    assert classify_code_status(False, True) == 'removed'        # was there, now gone
    assert classify_code_status(False, False) == 'not_found_in_code'
    assert classify_code_status(None, True) == 'unknown'         # git unavailable
