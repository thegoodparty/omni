"""Tests for the governance console snapshot builder (DATA-2546)."""

import governance_console_snapshot as gcs


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
    }]


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


def test_inline_payload_cannot_close_the_script_block():
    payload = gcs.inline_payload({"reason": "see </script> in the template"})

    assert "</script>" not in payload
    assert "<\\/script>" in payload
