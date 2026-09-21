"""Unit tests for the semantic-layer anchor reader (DATA-2421).

Pure functions and a committed fixture only — no network.
"""

from __future__ import annotations

from pathlib import Path

import sem_anchors as sa

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sem_analytics__users_win.yml"


def test_parses_the_dashboard_anchor_from_the_real_shape():
    anchors = sa.parse_anchors(FIXTURE.read_text())
    legs = anchors["win_active_candidates_30d"]
    assert sa.Leg(event="Viewed", path="/dashboard", era=None) in legs


def test_path_leg_key_is_distinguishable_from_the_bare_event():
    assert sa.Leg("Viewed", "/dashboard", None).key == "Viewed[path=/dashboard]"
    assert sa.Leg("Viewed", None, None).key == "Viewed"


def test_historical_legs_are_not_watched():
    assert sa.Leg("Dashboard - Campaign Plan Viewed", None, "historical").watched is False
    assert sa.Leg("Campaign Plan - Campaign Tracker Viewed", None, None).watched is True


def test_load_anchors_returns_empty_and_says_why_without_a_token(monkeypatch):
    # load_anchors(None) means "fall back to the environment" by design, so without
    # clearing the real env var this test would pass or fail on ambient shell state
    # (and start making a live GitHub call) rather than on the code under test.
    monkeypatch.delenv(sa.TOKEN_ENV, raising=False)
    anchors, problems = sa.load_anchors(None)
    assert anchors == {}
    # The read disabling itself must never be silent — that is the original bug's shape.
    assert problems and "DISABLED" in problems[0]


def test_load_anchors_reports_when_reads_succeed_but_find_no_anchors(monkeypatch):
    # The live condition right now: gp-data-platform's Part A PR hasn't merged, so a
    # real, successful read finds zero anchored_on blocks. That must not come back as
    # a quiet ({}, []) — this is the exact silent-disable shape the ticket targets.
    monkeypatch.setattr(sa, "_fetch", lambda path, token: "metrics: []\n")
    anchors, problems = sa.load_anchors("fake-token")
    assert anchors == {}
    assert problems and "no anchored_on declarations" in problems[0]


def test_parse_anchors_rejects_a_leg_with_no_event():
    bad = "metrics:\n  - name: m\n    config:\n      meta:\n        anchored_on:\n          - path: /x\n"
    try:
        sa.parse_anchors(bad)
    except ValueError as exc:
        assert "event" in str(exc)
    else:
        raise AssertionError("expected ValueError")
