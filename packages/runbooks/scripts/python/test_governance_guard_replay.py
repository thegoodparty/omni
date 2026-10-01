"""Replays the breaks that motivated DATA-2432 against real history. Skips when the
commits are not in the local clone (a shallow CI checkout); the guard workflow uses a full
clone, so it runs there."""

import subprocess

import pytest

import governance_guard as gg
import sem_anchors as sa

REPO = gg.REPO_ROOT


def _has(sha: str) -> bool:
    return subprocess.run(["git", "-C", str(REPO), "cat-file", "-e", f"{sha}^{{commit}}"],
                          capture_output=True).returncode == 0


def _replay(sha: str, extra: dict[str, str]) -> gg.Report:
    if not _has(sha):
        pytest.skip(f"{sha} not in this clone")
    anchors, date = sa.load_vendored_anchors()
    anchors = {m: list(legs) for m, legs in anchors.items()}
    for event, metric in extra.items():
        anchors.setdefault(metric, []).append(sa.Leg(event))
    base = gg.build_snapshot(gg.GitTree(REPO, f"{sha}^1"))
    head = gg.build_snapshot(gg.GitTree(REPO, sha))
    return gg.evaluate(base, head, anchors, date, gg.git_renames(REPO, f"{sha}^1", sha))


def _hits(report: gg.Report, rule: str) -> set[str]:
    return {f.event for f in report.blocks if f.rule == rule}


def test_taskflow_delete_flags_campaign_completed_and_the_dead_listings():
    r = _replay("278df5131", {"Voter Outreach - Campaign Completed": "win_activated_users",
                              "Voter Data - List Exported": "win_product_output_users"})
    assert "Voter Outreach - Campaign Completed" in _hits(r, "okr_call_site_lost")
    assert "Voter Data - List Exported" in _hits(r, "okr_call_site_lost")
    assert "Schedule Text Campaign - Audience: Check Age" in _hits(r, "dead_listing")


def test_flag_removal_flags_campaign_plan():
    r = _replay("0dfc79022", {"Dashboard - Campaign Plan Viewed": "win_active_candidates_30d"})
    assert "Dashboard - Campaign Plan Generation Completed" in _hits(r, "dead_listing")
    assert "Dashboard - Campaign Plan Viewed" in _hits(r, "okr_call_site_lost")


def test_voter_records_removal_flags_the_nav_click():
    r = _replay("db838077b", {})
    assert "Navigation - Dashboard: Click Voter Data" in _hits(r, "dead_listing")


def test_dashboard_view_first_break_fires():
    r = _replay("88aedb541", {"Dashboard - Candidate Dashboard Viewed": "win_active_candidates_30d"})
    assert "Dashboard - Candidate Dashboard Viewed" in _hits(r, "okr_call_site_lost")
