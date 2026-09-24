from datetime import date, timedelta

import anchor_alignment as aa
from sem_anchors import Leg

TODAY = date(2026, 9, 23)
M = "win_active_candidates_30d"
LIVE = Leg("Viewed", "/dashboard", None)
TRACKER = Leg("Campaign Plan - Campaign Tracker Viewed", None, None)
DEAD = Leg("Dashboard - Candidate Dashboard Viewed", None, "historical")


def _b(bid, metric, *surfaces):
    return {"id": bid, "metric": metric, "surfaces": [
        {"path": f"{i}.tsx", "label": f"s{i}", "instrumented_by": name,
         **({"page_path": pp} if pp else {})}
        for i, (name, pp) in enumerate(surfaces)
    ]}


def _rec(status="active", **kw):
    return {"status": status, "last_seen_date": TODAY, "call_site_count": 1, **kw}


def _series(key, n):
    return {key: [(TODAY - timedelta(days=7 * i), n) for i in range(1, 5)]}


def _align(behaviors, anchors, **kw):
    defaults = dict(records_by_type={}, series={}, code={}, watchlist_events=[], latches={}, today=TODAY)
    defaults.update(kw)
    return aa.align(behaviors, anchors, **defaults)


def test_no_anchors_means_no_findings():
    assert _align([_b("b", M, ("Anything", None))], {}) == []


def test_metric_nobody_declares_is_case_1():
    [f] = _align([_b("b", "pro_conversions", ("X", None))], {M: [LIVE]},
                 records_by_type={"X": _rec()})
    assert (f["case"], f["kind"], f["metric"]) == (1, "metric_undeclared", "pro_conversions")


def test_surface_on_a_historical_leg_is_case_1_and_names_the_live_legs():
    findings = _align([_b("b", M, (DEAD.event, None))], {M: [LIVE, DEAD, TRACKER]},
                      records_by_type={DEAD.event: _rec("retired")})
    [f] = [x for x in findings if x["kind"] == "surface_on_historical_leg"]
    assert f["case"] == 1 and f["kind"] == "surface_on_historical_leg"
    assert f["event_key"] == DEAD.event
    assert f["suggested"] == f"{TRACKER.key}, {LIVE.key}"


def test_all_historical_metric_produces_no_surface_finding():
    assert _align([_b("b", M, (DEAD.event, None))], {M: [DEAD]}) == []


def test_declared_live_leg_nobody_monitors_is_case_1():
    findings = _align([_b("b", M, ("Viewed", "/dashboard"))], {M: [LIVE, TRACKER]},
                      records_by_type={"Viewed": _rec()}, series=_series(LIVE.key, 5))
    [f] = [x for x in findings if x["kind"] == "declared_leg_unmonitored"]
    assert f["event_key"] == TRACKER.key and f["case"] == 1


def test_declared_leg_named_on_an_events_row_counts_as_monitored():
    findings = _align([_b("b", M, ("Viewed", "/dashboard"))], {M: [LIVE, TRACKER]},
                      records_by_type={"Viewed": _rec()}, series=_series(LIVE.key, 5),
                      watchlist_events=[TRACKER.event])
    assert not [x for x in findings if x["kind"] == "declared_leg_unmonitored"]


def test_live_instrument_the_declaration_lacks_is_case_3_with_the_leg_key():
    findings = _align([_b("b", M, ("Viewed", "/dashboard"), ("Viewed", "/polls"))], {M: [LIVE]},
                      records_by_type={"Viewed": _rec()},
                      series={**_series(LIVE.key, 5), **_series("Viewed[path=/polls]", 5)})
    [f] = [x for x in findings if x["kind"] == "live_instrument_not_declared"]
    assert f["case"] == 3 and f["event_key"] == "Viewed[path=/polls]"


def test_dead_undeclared_instrument_is_not_a_scope_question():
    findings = _align([_b("b", M, ("Viewed", "/dashboard"), ("Old", None))], {M: [LIVE]},
                      records_by_type={"Viewed": _rec(), "Old": _rec("retired")},
                      series=_series(LIVE.key, 5))
    assert not [x for x in findings if x["kind"] == "live_instrument_not_declared"]


def test_dead_declared_leg_with_a_live_successor_is_case_2():
    code = {TRACKER.event: {"retired_date": "2026-09-01"}}
    findings = _align([_b("b", M, (TRACKER.event, None), ("Campaign Plan - Tracker Opened", None))],
                      {M: [TRACKER]},
                      records_by_type={TRACKER.event: _rec("retired"),
                                       "Campaign Plan - Tracker Opened": _rec()},
                      code=code)
    [f] = [x for x in findings if x["kind"] == "declared_leg_dead_with_live_successor"]
    assert f["case"] == 2 and f["event_key"] == TRACKER.key
    assert f["suggested"] == "Campaign Plan - Tracker Opened"
    assert f["evidence"]["retired_date"] == "2026-09-01"
    # The successor is consumed by case 2, not re-reported as a case 3 scope question.
    assert not [x for x in findings if x["kind"] == "live_instrument_not_declared"]


def test_latched_declared_leg_counts_as_dead():
    findings = _align([_b("b", M, (TRACKER.event, None), ("New", None))], {M: [TRACKER]},
                      records_by_type={TRACKER.event: _rec("active"), "New": _rec()},
                      latches={TRACKER.key: {"latched": True, "metric": M}})
    assert [x["kind"] for x in findings] == ["declared_leg_dead_with_live_successor"]
    assert findings[0]["evidence"]["latched"] is True


def test_findings_sort_by_case_then_metric():
    findings = _align(
        [_b("b", M, ("Viewed", "/dashboard"), ("Viewed", "/polls")),
         _b("c", "nope", ("Viewed", "/dashboard"))],
        {M: [LIVE]}, records_by_type={"Viewed": _rec()},
        series={**_series(LIVE.key, 5), **_series("Viewed[path=/polls]", 5)})
    assert [f["case"] for f in findings] == sorted(f["case"] for f in findings)


def test_a_dismissed_successor_suppresses_the_case_2_finding():
    code = {TRACKER.event: {"retired_date": "2026-09-01"}}
    behaviors = [_b("b", M, (TRACKER.event, None), ("Campaign Plan - Tracker Opened", None))]
    records = {TRACKER.event: _rec("retired"), "Campaign Plan - Tracker Opened": _rec()}
    without = _align(behaviors, {M: [TRACKER]}, records_by_type=records, code=code)
    assert [f["kind"] for f in without] == ["declared_leg_dead_with_live_successor"]
    with_dismissal = _align(
        behaviors, {M: [TRACKER]}, records_by_type=records, code=code,
        dismissed=[{"event": "Campaign Plan - Tracker Opened", "metric": M, "reason": "r", "date": "2026-09-23"}],
    )
    assert with_dismissal == []


def test_a_dismissed_surface_suppresses_the_case_3_finding_by_leg_key():
    behaviors = [_b("b", M, ("Viewed", "/dashboard"), ("Viewed", "/polls"))]
    series = {**_series(LIVE.key, 5), **_series("Viewed[path=/polls]", 5)}
    without = _align(behaviors, {M: [LIVE]}, records_by_type={"Viewed": _rec()}, series=series)
    assert [f["kind"] for f in without] == ["live_instrument_not_declared"]
    with_dismissal = _align(
        behaviors, {M: [LIVE]}, records_by_type={"Viewed": _rec()}, series=series,
        dismissed=[{"event": "Viewed[path=/polls]", "metric": M, "reason": "r", "date": "2026-09-23"}],
    )
    assert with_dismissal == []


def test_a_dismissal_for_another_metric_does_not_suppress():
    behaviors = [_b("b", M, ("Viewed", "/dashboard"), ("Viewed", "/polls"))]
    series = {**_series(LIVE.key, 5), **_series("Viewed[path=/polls]", 5)}
    findings = _align(
        behaviors, {M: [LIVE]}, records_by_type={"Viewed": _rec()}, series=series,
        dismissed=[{"event": "Viewed[path=/polls]", "metric": "other_metric"}],
    )
    assert [f["kind"] for f in findings] == ["live_instrument_not_declared"]


def test_case_1_findings_ignore_dismissals():
    findings = _align(
        [_b("b", M, (DEAD.event, None))], {M: [LIVE, DEAD]},
        records_by_type={DEAD.event: _rec("retired")},
        dismissed=[{"event": DEAD.event, "metric": M}],
    )
    assert any(f["kind"] == "surface_on_historical_leg" for f in findings)


def test_load_dismissals_returns_only_rows_with_a_metric(tmp_path):
    y = tmp_path / "w.yaml"
    y.write_text(
        "dismissed:\n"
        '  - {event: "Queue B row", reason: "r", date: "2026-08-06"}\n'
        '  - {event: "Viewed[path=/polls]", reason: "r", date: "2026-09-23", metric: win_active_candidates_30d}\n'
    )
    assert aa.load_dismissals(y) == [
        {"event": "Viewed[path=/polls]", "reason": "r", "date": "2026-09-23", "metric": "win_active_candidates_30d"}
    ]
    assert aa.load_dismissals(tmp_path / "absent.yaml") == []


def _f(case, headline="h"):
    return {"case": case, "kind": "k", "behavior_id": "b", "metric": "m", "surface_label": None,
            "event_key": "E", "suggested": "", "evidence": {}, "headline": headline}


def test_render_section_is_empty_without_findings_and_lists_each_case():
    assert aa.render_section([]) == []
    lines = aa.render_section([_f(1, "h1"), _f(3, "h3")])
    assert lines[1] == "### Registry vs semantic layer"
    assert any("h1" in l for l in lines) and any("h3" in l for l in lines)
    assert any("Case 1" in l for l in lines) and not any("Case 2" in l for l in lines)


def test_slack_items_carry_only_case_2_as_yellow():
    items = aa.slack_items([_f(1, "a"), _f(2, "b"), _f(3, "c")])
    assert [i["headline"] for i in items] == ["b"] and items[0]["tier"] == "yellow"
