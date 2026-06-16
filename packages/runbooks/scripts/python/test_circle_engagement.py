from datetime import datetime, timedelta, timezone

from circle_engagement import (
    active_within,
    stickiness,
    contribution_buckets,
    cohort_retention,
)


NOW = datetime(2026, 4, 20, 12, 0, tzinfo=timezone.utc)


def iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%S.000Z')


def test_active_within_counts_last_seen_inside_window():
    members = [
        {"last_seen_at": iso(NOW - timedelta(hours=1))},
        {"last_seen_at": iso(NOW - timedelta(hours=23))},
        {"last_seen_at": iso(NOW - timedelta(days=2))},
        {"last_seen_at": iso(NOW - timedelta(days=40))},
        {"last_seen_at": None},
    ]
    assert active_within(members, NOW, days=1) == 2
    assert active_within(members, NOW, days=7) == 3
    assert active_within(members, NOW, days=30) == 3
    assert active_within(members, NOW, days=365) == 4


def test_stickiness_is_dau_over_mau():
    assert stickiness(dau=100, mau=500) == 0.2
    assert stickiness(dau=0, mau=0) == 0.0
    assert stickiness(dau=50, mau=0) == 0.0


def test_contribution_buckets_classify_by_lifetime_activity():
    members = [
        {"posts_count": 0, "comments_count": 0},
        {"posts_count": 0, "comments_count": 3},
        {"posts_count": 1, "comments_count": 0},
        {"posts_count": 5, "comments_count": 10},
    ]
    buckets = contribution_buckets(members)
    assert buckets == {"lurkers": 1, "commenters": 1, "creators": 2}


def test_report_handles_empty_community_without_crashing():
    from circle_engagement import report

    output = report(members=[], posts=[], now=NOW)
    assert "Total members:        0" in output
    assert "DAU" in output
    assert "MAU" in output


def test_report_handles_zero_mau_without_crashing():
    from circle_engagement import report

    members = [
        {"created_at": "2026-01-01T00:00:00.000Z", "last_seen_at": iso(NOW - timedelta(days=90)),
         "posts_count": 0, "comments_count": 0, "name": "old", "gamification_stats": {"total_points": 0}},
    ]
    output = report(members=members, posts=[], now=NOW)
    assert "MAU (30d): 0" in output
    assert "Stickiness (DAU/MAU): 0.0%" in output


def test_cohort_retention_groups_by_signup_month_and_measures_active_30d():
    members = [
        {"created_at": "2026-01-05T00:00:00.000Z", "last_seen_at": iso(NOW - timedelta(days=3))},
        {"created_at": "2026-01-20T00:00:00.000Z", "last_seen_at": iso(NOW - timedelta(days=45))},
        {"created_at": "2026-03-10T00:00:00.000Z", "last_seen_at": iso(NOW - timedelta(days=1))},
        {"created_at": "2026-03-15T00:00:00.000Z", "last_seen_at": iso(NOW - timedelta(days=10))},
    ]
    result = cohort_retention(members, NOW)
    assert result["2026-01"] == {"joined": 2, "active_30d": 1, "rate": 0.5}
    assert result["2026-03"] == {"joined": 2, "active_30d": 2, "rate": 1.0}
