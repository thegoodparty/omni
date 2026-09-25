"""Unit tests for the semantic-layer anchor reader (DATA-2421).

Pure functions and a committed fixture only — no network.
"""

from __future__ import annotations

import http.client
import subprocess
from pathlib import Path

import pytest

import sem_anchors as sa

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sem_analytics__users_win.yml"


def test_parses_the_dashboard_anchor_from_the_real_shape():
    anchors = sa.parse_anchors(FIXTURE.read_text())
    legs = anchors["win_active_candidates_30d"]
    assert sa.Leg(event="Viewed", path="/dashboard", era=None) in legs


def test_path_leg_key_is_distinguishable_from_the_bare_event():
    assert sa.Leg("Viewed", "/dashboard", None).key == "Viewed[path=/dashboard]"
    assert sa.Leg("Viewed", None, None).key == "Viewed"


def test_the_excluding_qualifier_survives_the_parse():
    # Dropping it is what let the monitor watch the shared outreach terminal wider than
    # win_activated_users counts: the self-report path kept the bare event's counts up
    # after the in-product send stopped firing on 2026-09-08.
    anchors = sa.parse_anchors(FIXTURE.read_text())
    legs = {leg.event: leg for leg in anchors["win_activated_users"]}
    assert legs["Voter Outreach - Campaign Completed"].excluding == (("method", ("manual",)),)


def test_an_excluding_leg_gets_its_own_series_key():
    leg = sa.Leg("VO - Completed", None, None, (("method", ("manual",)),))
    assert leg.key == "VO - Completed[excluding method=manual]"
    assert leg.qualified is True


def test_an_excluding_leg_still_compares_equal_to_the_bare_registry_surface():
    # An exclusion narrows what the metric counts over one event; it does not change
    # which call site instruments the behavior. A path is the other way round.
    leg = sa.Leg("VO - Completed", None, None, (("method", ("manual",)),))
    assert leg.registry_key == "VO - Completed"
    assert sa.Leg("Viewed", "/dashboard", None).registry_key == "Viewed[path=/dashboard]"


def test_a_declared_exclusion_may_be_one_value_or_a_list():
    declared = (
        "metrics:\n  - name: m\n    config:\n      meta:\n        anchored_on:\n"
        "          - event: E\n            excluding:\n              method: [manual, native]\n"
    )
    leg = sa.parse_anchors(declared)["m"][0]
    assert leg.excluding == (("method", ("manual", "native")),)
    assert leg.key == "E[excluding method=manual,native]"


def test_excluding_normalises_to_a_stable_order():
    # Two declarations that mean the same thing must seal and key the same, or a YAML
    # reorder would read as a new instrument.
    a = sa.parse_anchors(
        "metrics:\n  - name: m\n    config:\n      meta:\n        anchored_on:\n"
        "          - event: E\n            excluding: {b: 1, a: 2}\n")["m"][0]
    b = sa.parse_anchors(
        "metrics:\n  - name: m\n    config:\n      meta:\n        anchored_on:\n"
        "          - event: E\n            excluding: {a: 2, b: 1}\n")["m"][0]
    assert a == b and a.key == b.key


def test_is_qualified_key_recognises_both_qualifier_shapes():
    assert sa.is_qualified_key("Viewed[path=/dashboard]")
    assert sa.is_qualified_key("E[excluding method=manual]")
    assert not sa.is_qualified_key("Voter Outreach - Campaign Completed")


def test_historical_legs_are_not_watched():
    assert sa.Leg("Dashboard - Campaign Plan Viewed", None, "historical").watched is False
    assert sa.Leg("Campaign Plan - Campaign Tracker Viewed", None, None).watched is True


def test_load_anchors_returns_empty_and_says_why_without_a_token(monkeypatch):
    # load_anchors(None) means "fall back to the environment" by design, so without
    # clearing the real env var this test would pass or fail on ambient shell state
    # (and start making a live GitHub call) rather than on the code under test.
    monkeypatch.delenv(sa.TOKEN_ENV, raising=False)
    # This test targets the "disabled entirely" path, not the gh fallback covered by
    # its own tests below, so the fallback is switched off here too, or a machine with
    # real gh auth would make a live call and break the module's no-network contract.
    monkeypatch.setenv(sa.GH_FALLBACK_ENV, "1")
    anchors, problems = sa.load_anchors(None)
    assert anchors == {}
    # The read disabling itself must never be silent — that is the original bug's shape.
    assert problems and "DISABLED" in problems[0]
    assert sa.GH_FALLBACK_ENV in problems[0]


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


def test_load_anchors_falls_back_to_gh_when_token_unset(monkeypatch):
    monkeypatch.delenv(sa.TOKEN_ENV, raising=False)
    monkeypatch.delenv(sa.GH_FALLBACK_ENV, raising=False)
    calls = []

    def fake_run(cmd, **kw):
        calls.append(cmd)
        text = FIXTURE.read_text() if "users_win" in cmd[-1] else "metrics: []\n"
        return subprocess.CompletedProcess(cmd, 0, stdout=text, stderr="")

    monkeypatch.setattr(sa.subprocess, "run", fake_run)
    anchors, problems = sa.load_anchors()
    assert problems == []
    assert "win_active_candidates_30d" in anchors
    assert all(c[:2] == ["gh", "api"] for c in calls)


def test_load_anchors_reports_when_gh_also_fails(monkeypatch):
    monkeypatch.delenv(sa.TOKEN_ENV, raising=False)
    monkeypatch.delenv(sa.GH_FALLBACK_ENV, raising=False)
    monkeypatch.setattr(
        sa.subprocess, "run",
        lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1, stdout="", stderr="gh: not logged in"),
    )
    anchors, problems = sa.load_anchors()
    assert anchors == {}
    assert any("gh api" in p for p in problems) and any("DISABLED" in p for p in problems)


def test_load_anchors_skips_gh_when_fallback_disabled(monkeypatch):
    monkeypatch.delenv(sa.TOKEN_ENV, raising=False)
    monkeypatch.setenv(sa.GH_FALLBACK_ENV, "1")
    monkeypatch.setattr(sa.subprocess, "run", lambda *a, **k: pytest.fail("gh must not run"))
    anchors, problems = sa.load_anchors()
    assert anchors == {} and any(sa.TOKEN_ENV in p for p in problems)
