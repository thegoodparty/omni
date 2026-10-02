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
