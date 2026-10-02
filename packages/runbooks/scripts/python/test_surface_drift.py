"""surface_drift (DATA-2531): labels and verdicts. Pure; no git, no network."""

import event_reach as er
import surface_drift as sd

PROFILE = er.Area("/dashboard/profile", "Profile", frozenset({"profile", "my-profile"}))
QUESTIONS = er.Area("/dashboard/questions", "Additional Questions", frozenset({"additional-questions"}))
ONBOARDING = er.Area("/onboarding", "Candidate Onboarding", frozenset({"candidate-onboarding"}))
ACCOUNT = er.Area("/dashboard/account", "Account Settings", frozenset({"account-settings"}))
CONTACTS = er.Area("/dashboard/contacts", "Voter Data", frozenset({"voter-data", "constituent-data"}))
PLAN = er.Area("/dashboard/campaign-plan", "Campaign Plan", frozenset({"campaign-plan"}))
KNOWN = [PROFILE, QUESTIONS, ONBOARDING, ACCOUNT, CONTACTS, PLAN]


def reach(*areas, routes=None, gaps=(), wide=False):
    return er.Reach(areas=tuple(areas), live_routes=frozenset(routes or [a.key for a in areas]),
                    dead_routes=frozenset(), gap_files=frozenset(gaps), dashboard_wide=wide, visited=frozenset())


def verdict(name, r, tags=(), count=10, flows=(), aliases=None):
    return sd.classify(sd.claimed_label(name, tags), r, known=KNOWN, flow_prefixes=set(flows),
                       prefix_areas=aliases or {}, count_30d=count)


def test_claimed_label_prefers_the_surface_tag():
    assert sd.claimed_label("Onboarding - X", ["product:win", "surface:campaign-details"]) == ("tag", "campaign-details")
    assert sd.claimed_label("Onboarding - X", []) == ("prefix", "Onboarding")
    assert sd.claimed_label("question_complete", []) is None


def test_names_match_is_a_contiguous_word_match():
    assert sd.names_match("onboarding", "candidate-onboarding")
    assert sd.names_match("settings", "account-settings")
    assert not sd.names_match("onboarding-v2", "candidate-onboarding")
    assert not sd.names_match("data", "metadata")


def test_the_five_onboarding_events_moved():
    assert verdict("Onboarding - Candidate Office Searched", reach(PROFILE)) == "moved"


def test_running_against_moved_to_additional_questions():
    assert verdict("Profile - Running Against: Click Save", reach(QUESTIONS)) == "moved"


def test_settings_upload_moved_to_profile():
    assert verdict("Settings - Personal Info: Click Upload", reach(PROFILE)) == "moved"


def test_moved_with_no_recent_fires_is_quiet_not_a_relabel():
    assert verdict("Profile - Top Issues: Cancel Edit", reach(QUESTIONS), count=0) == "moved_then_quiet"


def test_old_vocabulary_on_the_right_page_is_stale_area_name():
    assert verdict("Contacts - Segment Created", reach(CONTACTS)) == "stale_area_name"
    assert verdict("Dashboard - Campaign Plan: Plan Shared", reach(PLAN, routes=["/dashboard/campaign-plan"])) == "stale_area_name"


def test_a_tag_naming_an_area_that_no_longer_exists_is_stale():
    assert verdict("Profile - Office Details: Click Edit", reach(PROFILE), tags=["surface:campaign-details"]) == "stale_area_name"


def test_a_matching_label_is_consistent():
    assert verdict("Profile - Campaign Details: Click Save", reach(PROFILE)) == "consistent"
    assert verdict("Onboarding V2 - Office Completed", reach(ONBOARDING), aliases={"Onboarding V2": "candidate-onboarding"}) == "consistent"


def test_flow_prefixes_dashboard_wide_gaps_and_unknowns():
    assert verdict("Pro Upgrade - Banner Viewed", reach(PROFILE), flows=["Pro Upgrade"]) == "flow"
    assert verdict("Navigation - Click", reach(PROFILE, wide=True)) == "dashboard_wide"
    assert verdict("Onboarding - X", reach(PROFILE, gaps=["a.tsx"])) == "unclear"
    assert verdict("Onboarding - X", None) == "unclear"
    assert verdict("Candidacy - Did You Win Modal Viewed", reach(QUESTIONS)) == "unmapped"


def test_proposed_display_name_swaps_only_the_prefix():
    assert sd.proposed_display_name("Profile - Running Against: Click Save", QUESTIONS) == "Additional Questions - Running Against: Click Save"
    assert sd.proposed_display_name("Profile - X", None) == ""


import json

import pytest


def test_signal_agreement_counts_only_attributed_fires_on_reached_areas():
    idx = er.AreaIndex("", {"/dashboard/questions": "title: 'Additional Questions'", "/dashboard/content": "title: 'Content'"})
    r = {"E": reach(idx.area("/dashboard/questions"), routes=["/dashboard/questions"])}
    rows = [("E", "/dashboard/questions", 8, 0), ("E", "/dashboard/content", 2, 1), ("E", None, 5, 0)]
    s = sd.signals_from_rows(rows, r, idx)["E"]
    assert (s.fires, s.attributed, s.on_reached, s.impersonated) == (15, 10, 8, 1)
    assert s.coverage == pytest.approx(10 / 15)
    assert s.agreement == pytest.approx(0.8)


def test_removal_commit_finds_the_newest_commit_dropping_an_import():
    logs = {"RunningAgainstSection": "93cb4a414aaa 2026-06-19\nc9682908d000 2026-02-08\n", "QuestionsPage": ""}
    diffs = {"93cb4a414aaa": "-import RunningAgainstSection from './RunningAgainstSection'\n",
             "c9682908d000": "+import RunningAgainstSection from './RunningAgainstSection'\n"}

    def git(*args):
        if args[0] == "log":
            return logs[next(a for a in args if a.startswith("-S"))[2:]]
        return diffs[args[3]]

    assert sd.removal_commit(["RunningAgainstSection", "QuestionsPage"], git) == "93cb4a414 2026-06-19"
    assert sd.removal_commit(["QuestionsPage"], git) is None


def _sig(fires=20, attributed=15, on=14):
    return sd.Signal(fires, attributed, on, 0)


def test_high_confidence_needs_every_kind_of_evidence():
    one = reach(QUESTIONS)
    assert sd.confidence("moved", one, "93cb4a414 2026-06-19", _sig(), okr=False) == "high"
    assert sd.confidence("moved", one, None, _sig(), okr=False) == "proposed"
    assert sd.confidence("moved", one, "x", None, okr=False) == "proposed"
    assert sd.confidence("moved", one, "x", _sig(attributed=5, on=5), okr=False) == "proposed"
    assert sd.confidence("moved", one, "x", _sig(fires=40, attributed=15, on=15), okr=False) == "proposed"
    assert sd.confidence("moved", one, "x", _sig(on=10), okr=False) == "proposed"
    assert sd.confidence("moved", one, "x", _sig(), okr=True) == "proposed"
    assert sd.confidence("moved", reach(QUESTIONS, PROFILE), "x", _sig(), okr=False) == "proposed"
    assert sd.confidence("stale_area_name", one, "x", _sig(), okr=False) == "proposed"


def test_build_row_proposes_surface_display_name_and_fires_on():
    row = sd.build_row("Profile - Running Against: Click Save", "moved", ("prefix", "Profile"), reach(QUESTIONS),
                       {"display_name": "Profile - Running Against: Click Save", "okr_metrics": []},
                       "93cb4a414 2026-06-19", _sig(), "2026-10-02")
    assert row["proposed_surface"] == "additional-questions"
    assert row["proposed_display_name"] == "Additional Questions - Running Against: Click Save"
    assert row["proposed_url"] == "/dashboard/questions"
    assert row["confidence"] == "high"
    assert row["disposition"] == "new"
    assert json.dumps(row)


def test_merge_keeps_rulings_and_reraises_a_dismissal_only_when_areas_change():
    prev = {"A": {"disposition": "dismissed", "dismissed_areas": ["/dashboard/questions"], "first_seen": "2026-09-01"},
            "B": {"disposition": "open", "first_seen": "2026-09-01"},
            "C": {"disposition": "new", "first_seen": "2026-09-01"},
            "D": {"disposition": "applied", "first_seen": "2026-08-01", "applied_date": "2026-09-02"}}
    fresh = {"A": {"area_keys": ["/dashboard/questions"], "disposition": "new"},
             "B": {"area_keys": ["/x"], "disposition": "new"}}
    out = sd.merge(prev, fresh, "2026-10-02")
    assert out["A"]["disposition"] == "dismissed"
    assert out["B"]["disposition"] == "open" and out["B"]["first_seen"] == "2026-09-01"
    assert "C" not in out
    assert out["D"]["disposition"] == "applied"
    moved_again = sd.merge(prev, {"A": {"area_keys": ["/elsewhere"], "disposition": "new"}}, "2026-10-02")
    assert moved_again["A"]["disposition"] == "new"


def test_ingest_relabels_turns_pr_rows_into_accepted_proposals_once():
    rows = sd.ingest_relabels({}, [{"event": "E", "surface": "profile", "display_name": "Profile - E", "reason": "r", "date": "2026-10-02"}], "2026-10-02")
    assert rows["E"]["disposition"] == "accepted" and rows["E"]["source"] == "relabels"
    rows["E"]["disposition"] = "applied"
    again = sd.ingest_relabels(rows, [{"event": "E", "surface": "profile", "display_name": "Profile - E", "reason": "r", "date": "2026-10-02"}], "2026-10-09")
    assert again["E"]["disposition"] == "applied"


def test_dispose_records_dismissed_areas_and_applied_date():
    state = {"rows": {"E": {"area_keys": ["/q"], "disposition": "new"}}}
    sd.dispose(state, "E", "dismissed", "label is right", "2026-10-02")
    assert state["rows"]["E"]["dismissed_areas"] == ["/q"]
    sd.dispose(state, "E", "applied", "", "2026-10-03")
    assert state["rows"]["E"]["applied_date"] == "2026-10-03"
    with pytest.raises(KeyError):
        sd.dispose(state, "missing", "open", "", "2026-10-03")


def test_signals_failure_leaves_everything_proposed(monkeypatch, tmp_path):
    def boom(names):
        raise RuntimeError("warehouse asleep")
    monkeypatch.setattr(sd, "fetch_signal_rows", boom)
    signals, status = sd.load_signals(["E"], {}, None)
    assert signals == {} and status.startswith("failed: RuntimeError")
