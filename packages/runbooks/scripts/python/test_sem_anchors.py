"""Unit tests for the semantic-layer anchor reader (DATA-2421).

Pure functions and a committed fixture only — no network.
"""

from __future__ import annotations

import http.client
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


def test_a_malformed_declaration_is_reported_rather_than_taking_the_run_down(monkeypatch):
    # A bad leg merged in gp-data-platform must not delete omni's governance digest.
    # Raising here is loud in the wrong place: it fails the CI step, so there is no
    # digest, no Slack post and no state write-back at all.
    bad = "metrics:\n  - name: m\n    config:\n      meta:\n        anchored_on:\n          - path: /x\n"
    monkeypatch.setattr(sa, "_fetch", lambda path, token: bad)
    anchors, problems = sa.load_anchors("fake-token")
    assert anchors == {}
    assert problems and any("malformed" in p for p in problems)


def test_one_malformed_file_does_not_cost_the_other_file_its_anchors(monkeypatch):
    bad = "metrics:\n  - name: m\n    config:\n      meta:\n        anchored_on:\n          - path: /x\n"
    good = (
        "metrics:\n  - name: serve_metric\n    config:\n      meta:\n"
        "        anchored_on:\n          - event: Some Event\n"
    )
    monkeypatch.setattr(
        sa, "_fetch", lambda path, token: bad if path == sa.SEM_PATHS[0] else good)
    anchors, problems = sa.load_anchors("fake-token")
    assert anchors["serve_metric"] == [sa.Leg("Some Event", None, None)]
    assert len(problems) == 1 and sa.SEM_PATHS[0] in problems[0]


def test_unparseable_yaml_is_reported_rather_than_taking_the_run_down(monkeypatch):
    # Same class of failure as a malformed declaration: another repo's file, our digest.
    monkeypatch.setattr(sa, "_fetch", lambda path, token: "metrics: [unclosed\n")
    anchors, problems = sa.load_anchors("fake-token")
    assert anchors == {}
    assert problems and any("malformed" in p for p in problems)


def test_an_incomplete_read_mid_fetch_is_reported_rather_than_taking_the_run_down(
    monkeypatch,
):
    # http.client.IncompleteRead is raised from INSIDE _fetch's `with` block (while
    # reading the response body), so it is not a urllib.error.URLError and used to
    # escape load_anchors entirely, killing the whole digest over a dropped connection.
    def _boom(path, token):
        raise http.client.IncompleteRead(b"")

    monkeypatch.setattr(sa, "_fetch", _boom)
    anchors, problems = sa.load_anchors("fake-token")
    assert anchors == {}
    assert problems and any("could not read" in p for p in problems)


def test_a_remote_disconnect_mid_fetch_is_reported_rather_than_taking_the_run_down(
    monkeypatch,
):
    def _boom(path, token):
        raise http.client.RemoteDisconnected("Remote end closed connection")

    monkeypatch.setattr(sa, "_fetch", _boom)
    anchors, problems = sa.load_anchors("fake-token")
    assert anchors == {}
    assert problems and any("could not read" in p for p in problems)


def test_parse_anchors_still_raises_for_direct_callers():
    # The catching lives in load_anchors; parse_anchors stays strict so a test or a
    # local caller sees the real error.
    bad = "metrics:\n  - name: m\n    config:\n      meta:\n        anchored_on:\n          - path: /x\n"
    try:
        sa.parse_anchors(bad)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")
