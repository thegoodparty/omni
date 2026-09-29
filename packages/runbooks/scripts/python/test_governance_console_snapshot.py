"""Tests for the governance console snapshot builder (DATA-2546)."""

import importlib.util
import json
from pathlib import Path

import analytics_event_health as aeh
import governance_console_snapshot as gcs


def aeh_cause_labels():
    """Every cause key the monitor can emit, base form."""
    return set(aeh.CAUSE_LABELS)


def _record(**over):
    """A flagged record with every field the real report carries."""
    base = {
        "event_type": "E", "family": "f", "status": "dormant", "elevated": False,
        "on_watchlist": True, "okr": None, "event_count_30d": 0,
        "last_seen_date": "2026-08-01", "anomaly": None, "instrumented_pr": "",
        "call_site_count": None, "call_site_retired_date": None, "divergence": None,
        "gpmeta": {}, "has_description": True, "rank": 8, "watchlist_status": "tracked",
    }
    base.update(over)
    return base


# --- overview -----------------------------------------------------------------


def test_build_overview_carries_totals_status_and_areas():
    report = {
        "run_date": "2026-09-28",
        "total_events": 3,
        "status_counts": {"active": 2, "dormant": 1},
        "metadata_coverage": {
            "scored": 3, "with_description": 2,
            "elevated_missing": ["A"], "other_missing_count": 1,
        },
        "flagged": [], "records": [], "proposals": [], "anchor_alignment": [],
    }
    explorer = {
        "areas": [{"name": "Outreach", "total": 2, "counts": {"active": 2}},
                  {"name": "Profile", "total": 1, "counts": {"dormant": 1}}],
    }

    overview = gcs.build_overview(report, explorer)

    assert overview["totals"] == {"events": 3, "flagged": 0}
    assert overview["by_status"] == {"active": 2, "dormant": 1}
    assert [a["name"] for a in overview["by_area"]] == ["Outreach", "Profile"]
    assert overview["metadata_coverage"]["with_description"] == 2
    assert overview["metadata_coverage"]["described_pct"] == 67


def test_build_overview_tolerates_an_explorer_with_no_areas():
    report = {
        "total_events": 0, "status_counts": {}, "flagged": [],
        "metadata_coverage": {"scored": 0, "with_description": 0,
                              "elevated_missing": [], "other_missing_count": 0},
    }

    overview = gcs.build_overview(report, {})

    assert overview["by_area"] == []
    assert overview["metadata_coverage"]["described_pct"] == 0


# --- flags queue --------------------------------------------------------------


def test_build_flag_queue_groups_by_cause_and_keeps_the_digest_key():
    report = {"flagged": [
        _record(event_type="A", rank=2, status="dormant",
                call_site_count=0, call_site_retired_date="2026-09-01"),
        _record(event_type="B", rank=2, status="dormant",
                call_site_count=0, call_site_retired_date="2026-09-01"),
        _record(event_type="C", rank=7, status="instrumented_never_observed"),
    ], "dismissed_causes": {}}

    queue = gcs.build_flag_queue(report)

    assert [item["id"] for item in queue] == [
        "call_site_removed@2026-09-01", "never_observed"]
    assert queue[0]["count"] == 2
    assert queue[0]["events"] == ["A", "B"]
    assert queue[0]["label"] == "call sites removed on 2026-09-01"
    assert all(item["queue"] == "flags" for item in queue)


def test_build_flag_queue_marks_undismissable_causes():
    report = {"flagged": [
        _record(event_type="Counter", rank=0, status="active",
                call_site_count=0, event_count_30d=1471),
    ], "dismissed_causes": {}}

    [item] = gcs.build_flag_queue(report)

    assert item["id"] == "counter_blind_spot"
    assert item["dismissable"] is False


def test_build_flag_queue_marks_a_dated_call_site_cause_dismissable():
    report = {"flagged": [
        _record(event_type="A", rank=2, status="dormant",
                call_site_count=0, call_site_retired_date="2026-09-01"),
    ], "dismissed_causes": {}}

    [item] = gcs.build_flag_queue(report)

    assert item["id"] == "call_site_removed@2026-09-01"
    assert item["dismissable"] is True


def test_build_flag_queue_carries_an_existing_dismissal_rather_than_hiding_it():
    report = {"flagged": [
        _record(event_type="A", rank=7, status="instrumented_never_observed",
                dismissed_cause="Serve has not shipped yet"),
    ], "dismissed_causes": {"never_observed": "Serve has not shipped yet"}}

    [item] = gcs.build_flag_queue(report)

    assert item["dismissed"] == {"reason": "Serve has not shipped yet"}
    assert item["count"] == 1


def test_build_flag_queue_evidence_carries_what_a_ruling_needs():
    report = {"flagged": [
        _record(event_type="A", rank=1, status="orphaned_firing",
                event_count_30d=373, last_seen_date="2026-09-13",
                divergence="declared not-in-use but still firing"),
    ], "dismissed_causes": {}}

    [item] = gcs.build_flag_queue(report)

    assert item["evidence"] == [{
        "event_type": "A", "status": "orphaned_firing", "event_count_30d": 373,
        "last_seen_date": "2026-09-13",
        "divergence": "declared not-in-use but still firing",
        "instrumented_pr": "", "okr": None, "elevated": False,
        "instrumented_date": None, "days_since_instrumented": None,
        "provenance": "not found in code",
    }]


# --- recommendations ----------------------------------------------------------


def test_stranded_call_sites_recommend_a_govern_write_not_an_investigation():
    report = {"flagged": [
        _record(event_type="A", rank=2, status="dormant",
                call_site_count=0, call_site_retired_date="2026-09-01"),
    ], "dismissed_causes": {}}

    [item] = gcs.build_flag_queue(report)

    assert item["recommended"] == "govern"
    assert "Retiring them is the fix" in item["recommendation_reason"]


def test_orphaned_firing_recommends_looking_because_it_points_both_ways():
    report = {"flagged": [
        _record(event_type="A", rank=1, status="orphaned_firing",
                divergence="declared not-in-use but still firing"),
    ], "dismissed_causes": {}}

    [item] = gcs.build_flag_queue(report)

    assert item["recommended"] == "investigate"


def test_the_judgment_causes_get_no_recommendation():
    report = {"flagged": [
        _record(event_type="A", rank=7, status="instrumented_never_observed"),
        _record(event_type="B", rank=8, status="dormant"),
        _record(event_type="C", rank=6, status="dormant", elevated=True),
    ], "dismissed_causes": {}}

    queue = gcs.build_flag_queue(report)

    assert [item["recommended"] for item in queue] == ["", "", ""]


def test_an_undismissable_cause_is_not_offered_the_dismiss_verb():
    report = {"flagged": [
        _record(event_type="Counter", rank=0, status="active",
                call_site_count=0, event_count_30d=1471),
    ], "dismissed_causes": {}}

    [item] = gcs.build_flag_queue(report)

    assert "dismiss" not in item["verbs"]
    assert set(item["verbs"]) == {"govern", "ticket", "investigate"}
    assert item["recommended"] == "ticket"


# --- event cards --------------------------------------------------------------


def _explorer_event(event_type, **over):
    base = {
        "event_type": event_type, "display_name": event_type, "area": "A",
        "description": "d", "status": "active", "fires_on": "somewhere",
        "url": "", "fires_on_source": "", "anchor_confidence": "",
        "anchor_flag_reason": "", "count_30d": 5, "count_total": 50,
        "last_seen": "2026-09-20", "first_seen": "2026-01-01", "series": [1, 2],
        "tags": [], "okr": "", "supersession": "", "declared_intent": "",
        "watchlist_status": "", "questions": [], "used_by": [],
        "provenance": {"instrumented_date": "2026-01-01"},
        "internal_only": "must not travel",
    }
    base.update(over)
    return base


def test_queue_event_types_collects_flag_members_and_proposed_events():
    queues = [
        {"queue": "flags", "items": [{"id": "c", "events": ["A", "B"]}]},
        {"queue": "proposals", "items": [{"id": "C"}]},
        {"queue": "gaps", "items": [{"id": "some/path#form"}]},
    ]

    assert gcs.queue_event_types(queues) == {"A", "B", "C"}


def test_build_event_cards_carries_only_the_events_under_a_decision():
    """The whole catalog would be most of a megabyte of page nobody opens."""
    explorer = {"events": [_explorer_event("A"), _explorer_event("Unrelated")]}

    cards = gcs.build_event_cards(explorer, {"A"})

    assert set(cards) == {"A"}
    assert "internal_only" not in cards["A"]
    assert cards["A"]["description"] == "d"


def test_an_event_the_catalog_never_saw_simply_has_no_card():
    """Normal for anything declared in Govern and never observed, which is a third of
    the flagged set. The page falls back to the evidence row it already shows."""
    explorer = {"events": [_explorer_event("A")]}

    cards = gcs.build_event_cards(explorer, {"A", "NeverArrived"})

    assert set(cards) == {"A"}


def test_the_snapshot_carries_cards_for_its_own_queues():
    report = _min_report(flagged=[_record(event_type="A")])
    explorer = {"events": [_explorer_event("A"), _explorer_event("B")],
                "series_weeks": ["2026-09-14"]}

    snapshot = gcs.build_snapshot(report, {}, explorer, None)

    assert set(snapshot["event_cards"]) == {"A"}
    assert snapshot["series_weeks"] == ["2026-09-14"]


# --- what a verb does ---------------------------------------------------------


def test_every_verb_on_every_queue_says_what_it_does():
    """A verb with no effect line is a button whose consequence is unreadable."""
    verbs = {
        "flags": set(gcs.FLAG_VERBS),
        "gaps": set(gcs.GAP_VERBS),
        "proposals": set(gcs.PROPOSAL_VERBS),
        "alignment": set(gcs.ALIGNMENT_VERBS),
    }

    for queue, expected in verbs.items():
        # A key with a colon is a variant of a verb, not a verb: `govern:correction` is
        # what `govern` reads as once the operator declares it is not a retirement.
        plain = {k for k in gcs.VERB_EFFECTS[queue] if ":" not in k}
        assert plain == expected, queue


def test_a_govern_correction_is_not_described_as_a_retirement():
    retire = gcs.VERB_EFFECTS["flags"]["govern"]
    correct = gcs.VERB_EFFECTS["flags"]["govern:correction"]

    assert "dead" in retire
    assert "dead" not in correct
    assert "Nothing is retired" in correct


def test_a_permanent_verb_says_that_it_is_permanent():
    """Permanence is the property that decides how carefully a row is worth reading."""
    for queue, effects in gcs.VERB_EFFECTS.items():
        assert "no expiry" in effects["dismiss"] or "Permanent" in effects["dismiss"], (
            f"{queue} dismiss does not say it is permanent"
        )


def test_the_snapshot_carries_the_effects_once_not_per_item():
    report = _min_report(flagged=[_record(event_type="A")])

    snapshot = gcs.build_snapshot(report, {}, {}, None)

    assert snapshot["verb_effects"] == gcs.VERB_EFFECTS
    assert "verb_effects" not in snapshot["queues"][0]["items"][0]


# --- signal caveats -----------------------------------------------------------


def test_the_counter_canary_carries_its_blind_spot_and_how_to_check():
    """The worked example: the row that cost forty minutes on the first real run."""
    report = {"flagged": [
        _record(event_type="Counter", rank=0, status="active",
                call_site_count=0, event_count_30d=1471),
    ], "dismissed_causes": {}}

    [item] = gcs.build_flag_queue(report)
    caveat = item["caveat"]

    assert "nothing in the code sends it" in caveat["means"]
    assert "really was deleted" in caveat["wrong"]
    assert "removal date" in caveat["check"]
    assert "count_call_sites" in caveat["names"]


PROSE_FIELDS = ("measured", "means", "wrong", "check")


def test_no_internal_name_leaks_into_the_prose():
    """The prose is for someone who has never worked on the pipeline.

    Every column, function and ticket belongs in `names`, which the page renders as its
    own line. A caveat only its author can read has not been written down -- which is
    the whole reason these exist.
    """
    jargon = (
        "_", "()", "instrumentation_gaps", "sem_", ".py", ".yaml",
        "DATA-21", "DATA-24", "DATA-25",
    )
    caveats = list(gcs.CAUSE_CAVEATS.items()) + list(gcs.QUEUE_CAVEATS.items())

    for name, caveat in caveats:
        for field in PROSE_FIELDS:
            text = caveat[field] or ""
            for token in jargon:
                assert token not in text, f"{name}.{field} leaks {token!r}: {text}"


def test_no_internal_name_leaks_into_a_suggestion_either():
    """The suggestion sits directly under the caveat, so it is held to the same bar.

    A row that explains itself plainly and then justifies its suggestion in our own
    vocabulary reads worse than one that does neither.
    """
    reasons = [why for _, why in gcs.FLAG_RECOMMENDATIONS.values()]
    reasons += [why for _, why in gcs.ALIGNMENT_RECOMMENDATIONS.values()]

    for why in reasons:
        for token in ("_", "()", ".py", ".yaml"):
            assert token not in why, f"suggestion leaks {token!r}: {why}"


def test_no_caveat_renders_a_literal_double_hyphen():
    """The page shows this prose verbatim, and `--` reads as a typo on screen."""
    caveats = list(gcs.CAUSE_CAVEATS.items()) + list(gcs.QUEUE_CAVEATS.items())

    for name, caveat in caveats:
        for field in PROSE_FIELDS:
            assert "--" not in (caveat[field] or ""), f"{name}.{field}"


def test_every_caveat_says_what_was_measured_and_what_it_means():
    caveats = list(gcs.CAUSE_CAVEATS.items()) + list(gcs.QUEUE_CAVEATS.items())

    for name, caveat in caveats:
        assert caveat["measured"], name
        assert caveat["means"], name
        assert caveat["names"], name


def test_a_dated_call_site_cause_carries_the_same_caveat_as_an_undated_one():
    """The qualifier separates two decisions, not two signals."""
    report = {"flagged": [
        _record(event_type="A", rank=2, status="dormant",
                call_site_count=0, call_site_retired_date="2026-09-01"),
        _record(event_type="B", rank=2, status="dormant",
                call_site_count=0, call_site_retired_date="2026-07-14"),
    ], "dismissed_causes": {}}

    first, second = gcs.build_flag_queue(report)

    assert first["id"] != second["id"]
    assert first["caveat"] == second["caveat"] == gcs.CAUSE_CAVEATS["call_site_removed"]


def test_every_cause_the_monitor_can_raise_has_a_caveat():
    """A row with no caveat is a row whose signal has to be re-derived by hand."""
    missing = set(aeh_cause_labels()) - set(gcs.CAUSE_CAVEATS)

    assert not missing, f"no signal caveat for {sorted(missing)}"


def test_a_known_problem_always_comes_with_a_way_to_check():
    """A warning with no way to act on it just makes the reader anxious."""
    for cause, caveat in gcs.CAUSE_CAVEATS.items():
        if caveat["wrong"]:
            assert caveat["check"], f"{cause} says it can be wrong and not how to tell"


def test_the_proposal_queue_says_its_signal_is_clean():
    """The absence of a residual is the load-bearing half: it says stop looking."""
    report = {"proposals": [{"event_type": "A", "family": "f",
                             "first_seen_date": "2026-09-01"}]}

    [item] = gcs.build_proposal_queue(report)

    assert item["caveat"]["wrong"] is None


def test_the_gap_queue_carries_the_blind_backend_detectors():
    gaps = {"a#b": {"id": "a#b", "disposition": "new", "rank": 0,
                    "dashboard_question": "q", "location": "a", "surface_type": "b",
                    "judge_reason": "r", "reason": ""}}

    [item] = gcs.build_gap_queue(gaps)

    assert "weak evidence, not proof" in item["caveat"]["check"]


def test_the_alignment_queue_carries_the_unqualified_leg_trap():
    report = {"anchor_alignment": [
        {"key": "m", "metric": "m", "case": 2, "summary": "s"},
    ]}

    [item] = gcs.build_alignment_queue(report)

    assert "one slice of a busy event" in item["caveat"]["wrong"]


def test_gap_verbs_are_the_literals_the_gap_parser_validates():
    gaps = {"a#b": {"id": "a#b", "disposition": "new", "rank": 0,
                    "dashboard_question": "q", "location": "a", "surface_type": "b",
                    "judge_reason": "submit handler with no track call", "reason": ""}}

    [item] = gcs.build_gap_queue(gaps)

    assert set(item["verbs"]) == {"accept", "dismiss", "defer"}
    assert item["recommended"] == "accept"
    assert item["recommendation_reason"] == "submit handler with no track call"


def test_a_prior_ruling_overrides_the_judge_and_says_so():
    gaps = {"a#b": {
        "id": "a#b", "disposition": "new", "rank": 0, "dashboard_question": "q",
        "location": "a", "surface_type": "b", "judge_reason": "j", "reason": "",
        "prior_ruling": {"id": "a#old", "disposition": "dismissed",
                         "reason": "belongs in Grafana", "ruled_on": "2026-08-06"},
    }}

    [item] = gcs.build_gap_queue(gaps)

    assert item["recommended"] == "dismiss"
    assert "2026-08-06" in item["recommendation_reason"]
    assert "belongs in Grafana" in item["recommendation_reason"]


def test_alignment_case_1_is_omnis_to_fix_and_cannot_be_dismissed():
    report = {"anchor_alignment": [
        {"key": "k", "case": 1, "metric": "win_activated_users", "summary": "s"},
    ]}

    [item] = gcs.build_alignment_queue(report)

    assert item["recommended"] == "fix_omni"
    assert "dismiss" not in item["verbs"]


def test_alignment_case_2_drafts_upstream_rather_than_editing_here():
    report = {"anchor_alignment": [
        {"key": "k", "case": 2, "metric": "win_activated_users", "summary": "s"},
    ]}

    [item] = gcs.build_alignment_queue(report)

    assert item["recommended"] == "draft_upstream"
    assert "dismiss" in item["verbs"]


# --- provenance + elevation evidence ------------------------------------------


def test_provenance_state_distinguishes_the_four_walk_outcomes():
    assert gcs.provenance_state({
        "instrumented_commit": "abc", "instrumented_pr": "12",
        "instrumented_date": "2026-09-01"}) == "full"
    # Pre-monorepo: the walk found the commit, but its (#123) does not resolve in omni.
    assert gcs.provenance_state({
        "instrumented_commit": "abc", "instrumented_pr": "",
        "instrumented_date": "2026-09-01"}) == "commit only"
    # Written by the instrument-analytics-event skill, not yet verified by the walk.
    assert gcs.provenance_state({
        "instrumented_commit": "", "instrumented_pr": "12",
        "instrumented_date": "2026-09-01"}) == "provisional"
    # The pickaxe never found the literal: a runtime-built name, or a backend event.
    assert gcs.provenance_state({
        "instrumented_commit": "", "instrumented_pr": "",
        "instrumented_date": ""}) == "not found in code"
    assert gcs.provenance_state(None) == "not found in code"


def test_evidence_carries_when_it_was_instrumented_and_how_long_ago():
    report = {
        "run_date": "2026-09-28",
        "flagged": [_record(event_type="A", rank=7,
                            status="instrumented_never_observed")],
        "dismissed_causes": {},
    }
    code = {"A": {"instrumented_commit": "abc", "instrumented_pr": "2002",
                  "instrumented_date": "2026-09-25"}}

    [item] = gcs.build_flag_queue(report, code)

    [row] = item["evidence"]
    assert row["instrumented_date"] == "2026-09-25"
    assert row["days_since_instrumented"] == 3
    assert row["provenance"] == "full"


def test_days_since_is_none_when_nothing_knows_the_date():
    report = {
        "run_date": "2026-09-28",
        "flagged": [_record(event_type="A", rank=7,
                            status="instrumented_never_observed")],
        "dismissed_causes": {},
    }

    [item] = gcs.build_flag_queue(report, {})

    [row] = item["evidence"]
    assert row["instrumented_date"] is None
    assert row["days_since_instrumented"] is None
    assert row["provenance"] == "not found in code"


def test_a_never_fired_cause_explains_why_none_of_it_is_elevated():
    report = {
        "run_date": "2026-09-28",
        "flagged": [_record(event_type="A", rank=7, family=None,
                            status="instrumented_never_observed")],
        "dismissed_causes": {},
    }

    [item] = gcs.build_flag_queue(report, {})

    assert "never fired" in item["elevated_note"]


def test_a_partly_elevated_cause_says_how_many_and_why():
    report = {
        "run_date": "2026-09-28",
        "flagged": [
            _record(event_type="A", rank=2, family="win_onboarding", elevated=True,
                    call_site_count=0, call_site_retired_date="2026-09-01"),
            _record(event_type="B", rank=2, family="win_outreach", elevated=False,
                    call_site_count=0, call_site_retired_date="2026-09-01"),
        ],
        "dismissed_causes": {},
    }

    [item] = gcs.build_flag_queue(report, {})

    assert item["elevated_note"].startswith("1 of 2")


def test_evidence_puts_the_oldest_first_and_the_undated_last():
    report = {
        "run_date": "2026-09-28",
        "flagged": [
            _record(event_type="fresh", rank=7,
                    status="instrumented_never_observed"),
            _record(event_type="undated", rank=7,
                    status="instrumented_never_observed"),
            _record(event_type="ancient", rank=7,
                    status="instrumented_never_observed"),
        ],
        "dismissed_causes": {},
    }
    code = {
        "fresh": {"instrumented_commit": "a", "instrumented_pr": "1",
                  "instrumented_date": "2026-09-25"},
        "ancient": {"instrumented_commit": "b", "instrumented_pr": "2",
                    "instrumented_date": "2026-06-28"},
    }

    [item] = gcs.build_flag_queue(report, code)

    assert [r["event_type"] for r in item["evidence"]] == [
        "ancient", "fresh", "undated"]


# --- changes ------------------------------------------------------------------


def test_build_changes_treats_a_first_run_as_all_new():
    report = {"flagged": [_record(event_type="A", status="dormant")]}

    changes = gcs.build_changes(report, None)

    assert changes == {"new": ["A"], "resolved": [], "still_open": [], "escalated": []}


def test_build_changes_reads_the_previous_snapshot_as_its_own_prior_state():
    previous = {"prior_flagged": {"A": "dormant", "B": "dormant", "D": "dormant"}}
    report = {"flagged": [
        _record(event_type="A", status="dormant"),
        _record(event_type="B", status="orphaned_firing"),
        _record(event_type="C", status="dormant"),
    ]}

    changes = gcs.build_changes(report, previous)

    assert changes["still_open"] == ["A"]
    assert changes["escalated"] == ["B"]
    assert changes["new"] == ["C"]
    assert changes["resolved"] == ["D"]


def test_current_flagged_map_maps_event_type_to_status():
    report = {"flagged": [
        _record(event_type="A", status="dormant"),
        _record(event_type="B", status="active"),
    ]}

    assert gcs.current_flagged_map(report) == {"A": "dormant", "B": "active"}


# --- the other three queues ---------------------------------------------------


def test_build_gap_queue_returns_only_untriaged_rows_worst_rank_first():
    gaps = {
        "a.tsx#form_submit": {
            "id": "a.tsx#form_submit", "disposition": "new", "rank": 1,
            "dashboard_question": "Do people finish this form?",
            "location": "a.tsx", "surface_type": "form_submit",
            "judge_reason": "submit handler with no track call", "reason": "",
        },
        "b.tsx#wizard_stage": {
            "id": "b.tsx#wizard_stage", "disposition": "new", "rank": 0,
            "dashboard_question": "Where do people drop out?",
            "location": "b.tsx", "surface_type": "wizard_stage",
            "judge_reason": "multi-step flow, no step events", "reason": "",
        },
        "c.tsx#form_submit": {
            "id": "c.tsx#form_submit", "disposition": "dismissed", "rank": 1,
            "dashboard_question": "q", "location": "c.tsx",
            "surface_type": "form_submit", "judge_reason": "j",
            "reason": "belongs in Grafana",
        },
    }

    queue = gcs.build_gap_queue(gaps)

    assert [item["id"] for item in queue] == ["b.tsx#wizard_stage", "a.tsx#form_submit"]
    assert queue[0]["queue"] == "gaps"
    assert queue[0]["label"] == "Where do people drop out?"
    assert queue[0]["dismissable"] is True
    assert queue[0]["count"] == 1


def test_build_proposal_queue_one_row_per_proposed_event():
    report = {"proposals": [
        {"event_type": "Robocall - Hold Failed", "family": "win_voter_outreach",
         "first_seen_date": "2026-09-26"},
    ]}

    [item] = gcs.build_proposal_queue(report)

    assert item["id"] == "Robocall - Hold Failed"
    assert item["queue"] == "proposals"
    assert item["dismissable"] is True


def test_build_alignment_queue_is_empty_when_there_are_no_findings():
    assert gcs.build_alignment_queue({"anchor_alignment": []}) == []


def test_build_alignment_queue_refuses_to_offer_dismissal_on_a_case_1_finding():
    report = {"anchor_alignment": [
        {"key": "win_activated_users:Door Knocking - List Created", "case": 1,
         "metric": "win_activated_users", "summary": "omni is behind the declaration"},
    ]}

    [item] = gcs.build_alignment_queue(report)

    assert item["dismissable"] is False


# --- the whole snapshot -------------------------------------------------------


def _min_report(**over):
    base = {
        "run_date": "2026-09-28", "total_events": 0, "status_counts": {},
        "flagged": [], "proposals": [], "anchor_alignment": [],
        "metadata_coverage": {"scored": 0, "with_description": 0,
                              "elevated_missing": [], "other_missing_count": 0},
    }
    base.update(over)
    return base


def test_build_snapshot_refuses_a_report_that_predates_the_gaps_state():
    report = _min_report(run_date="2026-09-21")
    gaps = {"a#b": {"id": "a#b", "disposition": "new", "rank": 0,
                    "dashboard_question": "q", "location": "a",
                    "surface_type": "b", "judge_reason": "j", "reason": "",
                    "last_seen": "2026-09-28"}}

    try:
        gcs.build_snapshot(report, gaps, {}, None)
    except gcs.StaleReport as exc:
        assert "2026-09-21" in str(exc)
    else:
        raise AssertionError("expected StaleReport")


def test_build_snapshot_stamps_its_own_prior_flagged_for_the_next_run():
    report = _min_report(
        total_events=1, status_counts={"dormant": 1},
        flagged=[_record(event_type="A", status="dormant")],
        metadata_coverage={"scored": 1, "with_description": 1,
                           "elevated_missing": [], "other_missing_count": 0},
    )

    snapshot = gcs.build_snapshot(report, {}, {}, None)

    assert snapshot["prior_flagged"] == {"A": "dormant"}
    assert snapshot["run_date"] == "2026-09-28"
    assert [q["queue"] for q in snapshot["queues"]] == [
        "flags", "gaps", "proposals", "alignment"]


def test_build_snapshot_counts_open_decisions_across_every_queue():
    report = _min_report(
        flagged=[_record(event_type="A", rank=7,
                         status="instrumented_never_observed")],
        proposals=[{"event_type": "P", "family": "f",
                    "first_seen_date": "2026-09-26"}],
    )
    gaps = {"a#b": {"id": "a#b", "disposition": "new", "rank": 0,
                    "dashboard_question": "q", "location": "a",
                    "surface_type": "b", "judge_reason": "j", "reason": ""}}

    snapshot = gcs.build_snapshot(report, gaps, {}, None)

    assert snapshot["overview"]["totals"]["open_decisions"] == 3


# --- page payload -------------------------------------------------------------

# The page builder is deliberately dependency-free (the republish routine runs it with a
# bare interpreter), so it lives outside this package and is loaded by path.
_BUILD = importlib.util.spec_from_file_location(
    "governance_console_build",
    Path(__file__).resolve().parents[2] / "surfaces/governance-console/build.py",
)
console_build = importlib.util.module_from_spec(_BUILD)
_BUILD.loader.exec_module(console_build)


def test_inline_payload_cannot_close_the_script_block():
    payload = console_build.inline_payload({"reason": "see </script> in the template"})

    assert "</script>" not in payload
    assert "<\\/script>" in payload


def test_inline_payload_round_trips_through_the_browser_unescape():
    doc = {"label": "a </div> and a — dash", "n": 3}

    payload = console_build.inline_payload(doc)

    assert json.loads(payload.replace("<\\/", "</")) == doc
