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


def test_partial_read_suppresses_metric_undeclared_only():
    # One sem file failed to read, so "no sem file declares this metric" is unknowable
    # and would accuse a correct pointer. Every other comparison still holds.
    findings = _align(
        [_b("undeclared", "pro_conversions", ("X", None)),
         _b("historical", M, (DEAD.event, None))],
        {M: [LIVE, DEAD, TRACKER]},
        records_by_type={"X": _rec(), DEAD.event: _rec("retired")},
        partial_read=True,
    )
    assert not [f for f in findings if f["kind"] == "metric_undeclared"]
    [f] = [x for x in findings if x["kind"] == "surface_on_historical_leg"]
    assert f["case"] == 1 and f["behavior_id"] == "historical"


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


def test_a_quiet_path_leg_is_dead_even_when_the_bare_event_is_active():
    # The site-wide 'Viewed' record is active because other pages still fire it. The
    # /dashboard slice fired and stopped, and the slice is what the declaration names.
    findings = _align(
        [_b("b", M, ("Viewed", "/dashboard"), ("Dashboard - Home Viewed", None))],
        {M: [LIVE]},
        records_by_type={"Viewed": _rec(), "Dashboard - Home Viewed": _rec()},
        series={LIVE.key: [(TODAY - timedelta(days=7 * i), 5) for i in range(5, 9)]})
    [f] = [x for x in findings if x["kind"] == "declared_leg_dead_with_live_successor"]
    assert f["case"] == 2 and f["event_key"] == LIVE.key
    assert f["suggested"] == "Dashboard - Home Viewed"
    assert f["evidence"]["status"] is None


def test_a_quiet_path_leg_reports_the_last_week_it_fired():
    # The rows already hold the answer: the last week the slice fired is the date
    # the triage skill's historical-era comment should carry.
    findings = _align(
        [_b("b", M, ("Viewed", "/dashboard"), ("Dashboard - Home Viewed", None))],
        {M: [LIVE]},
        records_by_type={"Viewed": _rec(), "Dashboard - Home Viewed": _rec()},
        series={LIVE.key: [(TODAY - timedelta(days=7 * i), 5 if i >= 6 else 0)
                            for i in range(1, 9)]})
    [f] = [x for x in findings if x["kind"] == "declared_leg_dead_with_live_successor"]
    assert f["evidence"]["last_seen_date"] == TODAY - timedelta(days=42)


def test_a_firing_path_leg_is_not_dead_even_if_the_bare_event_is_retired():
    # A retired_date on the bare 'Viewed' provenance row is not evidence for the
    # /dashboard slice: the slice's own rows are still firing, so it is not dead, and
    # the undeclared 'Dashboard - Home Viewed' surface still surfaces as a case 3.
    code = {"Viewed": {"retired_date": "2026-09-01"}}
    findings = _align(
        [_b("b", M, ("Viewed", "/dashboard"), ("Dashboard - Home Viewed", None))],
        {M: [LIVE]},
        records_by_type={"Viewed": _rec("retired"), "Dashboard - Home Viewed": _rec()},
        code=code,
        series=_series(LIVE.key, 5))
    assert not [x for x in findings if x["kind"] == "declared_leg_dead_with_live_successor"]
    [f] = [x for x in findings if x["kind"] == "live_instrument_not_declared"]
    assert f["case"] == 3 and f["event_key"] == "Dashboard - Home Viewed"


def test_a_never_observed_path_leg_is_not_dead():
    # No rows at all is the first run after a leg is declared, or a pipeline delay. A
    # leg that has never been observed has not died.
    findings = _align(
        [_b("b", M, ("Viewed", "/dashboard"), ("Dashboard - Home Viewed", None))],
        {M: [LIVE]},
        records_by_type={"Viewed": _rec(), "Dashboard - Home Viewed": _rec()},
        series={})
    assert not [x for x in findings if x["kind"] == "declared_leg_dead_with_live_successor"]


def test_a_firing_path_leg_is_not_dead():
    findings = _align(
        [_b("b", M, ("Viewed", "/dashboard"), ("Dashboard - Home Viewed", None))],
        {M: [LIVE]},
        records_by_type={"Viewed": _rec(), "Dashboard - Home Viewed": _rec()},
        series=_series(LIVE.key, 5))
    assert not [x for x in findings if x["kind"] == "declared_leg_dead_with_live_successor"]


def test_two_dead_legs_pair_with_distinct_successors():
    # Each dead leg consumes the successor it pairs with. Re-reading the first one would
    # tell the reader to replace both legs with the same event.
    code = {"A": {"retired_date": "2026-09-01"}, "B": {"retired_date": "2026-09-01"}}
    findings = _align(
        [_b("b", M, ("A", None), ("B", None), ("NewA", None), ("NewB", None))],
        {M: [Leg("A"), Leg("B")]},
        records_by_type={"A": _rec("retired"), "B": _rec("retired"),
                         "NewA": _rec(), "NewB": _rec()},
        code=code)
    case2 = [x for x in findings if x["kind"] == "declared_leg_dead_with_live_successor"]
    assert [f["event_key"] for f in case2] == ["A", "B"]
    assert [f["suggested"] for f in case2] == ["NewA", "NewB"]
    assert not [x for x in findings if x["kind"] == "live_instrument_not_declared"]


def test_a_second_dead_leg_with_no_successor_left_emits_nothing():
    code = {"A": {"retired_date": "2026-09-01"}, "B": {"retired_date": "2026-09-01"}}
    findings = _align(
        [_b("b", M, ("A", None), ("B", None), ("NewA", None))],
        {M: [Leg("A"), Leg("B")]},
        records_by_type={"A": _rec("retired"), "B": _rec("retired"), "NewA": _rec()},
        code=code)
    case2 = [x for x in findings if x["kind"] == "declared_leg_dead_with_live_successor"]
    assert [(f["event_key"], f["suggested"]) for f in case2] == [("A", "NewA")]


def test_a_path_surface_does_not_count_as_monitoring_the_bare_event():
    # A '/dashboard' surface watches one slice of Viewed. The declared site-wide leg is
    # a different series, and nothing is checking it.
    findings = _align([_b("b", M, ("Viewed", "/dashboard"))], {M: [Leg("Viewed")]},
                      records_by_type={"Viewed": _rec()}, series=_series(LIVE.key, 5))
    [f] = [x for x in findings if x["kind"] == "declared_leg_unmonitored"]
    assert f["event_key"] == "Viewed" and f["case"] == 1


def test_a_path_surface_does_not_cover_a_different_path_leg():
    home = Leg("Viewed", "/home", None)
    findings = _align([_b("b", M, ("Viewed", "/dashboard"))], {M: [LIVE, home]},
                      records_by_type={"Viewed": _rec()}, series=_series(LIVE.key, 5))
    [f] = [x for x in findings if x["kind"] == "declared_leg_unmonitored"]
    assert f["event_key"] == home.key and f["case"] == 1


def test_latched_declared_leg_counts_as_dead():
    findings = _align([_b("b", M, (TRACKER.event, None), ("New", None))], {M: [TRACKER]},
                      records_by_type={TRACKER.event: _rec("active"), "New": _rec()},
                      latches={TRACKER.key: {"latched": True, "metric": M}})
    assert [x["kind"] for x in findings] == ["declared_leg_dead_with_live_successor"]
    assert findings[0]["evidence"]["latched"] is True


def test_a_latched_path_leg_with_no_firing_week_carries_the_latch_date():
    # Every row is zero, so there is no last firing week to report. The latch still
    # knows when the slice went quiet, and the historical era needs a date.
    findings = _align(
        [_b("b", M, ("Viewed", "/dashboard"), ("Dashboard - Home Viewed", None))],
        {M: [LIVE]},
        records_by_type={"Viewed": _rec(), "Dashboard - Home Viewed": _rec()},
        series=_series(LIVE.key, 0),
        latches={LIVE.key: {"latched": True, "metric": M, "since": "2026-08-10"}})
    [f] = [x for x in findings if x["kind"] == "declared_leg_dead_with_live_successor"]
    assert f["case"] == 2
    assert f["evidence"]["latched"] is True
    assert f["evidence"]["last_seen_date"] is None
    assert f["evidence"]["latched_since"] == "2026-08-10"


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


def test_a_dismissed_first_candidate_yields_to_the_next_successor():
    # A dismissal says "not this one", not "stop looking". The next live undeclared
    # surface is still a candidate for the dead leg.
    code = {TRACKER.event: {"retired_date": "2026-09-01"}}
    findings = _align(
        [_b("b", M, (TRACKER.event, None), ("NewA", None), ("NewB", None))],
        {M: [TRACKER]},
        records_by_type={TRACKER.event: _rec("retired"), "NewA": _rec(), "NewB": _rec()},
        code=code,
        dismissed=[{"event": "NewA", "metric": M}],
    )
    case2 = [x for x in findings if x["kind"] == "declared_leg_dead_with_live_successor"]
    assert [(f["event_key"], f["suggested"]) for f in case2] == [(TRACKER.key, "NewB")]
    assert not [x for x in findings if x["kind"] == "live_instrument_not_declared"]


def test_a_dismissed_candidate_is_excluded_from_case_3_by_the_dismissal_not_by_consumption():
    # The dismissal says NewA is not part of the metric, for either case. It is never
    # chosen as a successor, so consumption is not what keeps it out of case 3.
    code = {TRACKER.event: {"retired_date": "2026-09-01"}}
    findings = _align(
        [_b("b", M, (TRACKER.event, None), ("NewA", None))],
        {M: [TRACKER]},
        records_by_type={TRACKER.event: _rec("retired"), "NewA": _rec()},
        code=code,
        dismissed=[{"event": "NewA", "metric": M}],
    )
    assert findings == []


def test_an_unchosen_undeclared_surface_still_reaches_case_3():
    # Only the chosen successor is consumed. The surface the dead leg did not pair with
    # is still an undeclared live instrument.
    code = {TRACKER.event: {"retired_date": "2026-09-01"}}
    findings = _align(
        [_b("b", M, (TRACKER.event, None), ("NewA", None), ("NewB", None))],
        {M: [TRACKER]},
        records_by_type={TRACKER.event: _rec("retired"), "NewA": _rec(), "NewB": _rec()},
        code=code)
    case2 = [x for x in findings if x["kind"] == "declared_leg_dead_with_live_successor"]
    case3 = [x for x in findings if x["kind"] == "live_instrument_not_declared"]
    assert [f["suggested"] for f in case2] == ["NewA"]
    assert [f["event_key"] for f in case3] == ["NewB"]


def test_two_behaviors_on_one_metric_emit_one_unmonitored_finding():
    # The leg is unmonitored once, not once per behavior that points at the metric.
    findings = _align(
        [_b("a", M, ("Viewed", "/dashboard")), _b("b", M, ("Viewed", "/dashboard"))],
        {M: [LIVE, TRACKER]},
        records_by_type={"Viewed": _rec()}, series=_series(LIVE.key, 5))
    unmonitored = [x for x in findings if x["kind"] == "declared_leg_unmonitored"]
    assert [f["event_key"] for f in unmonitored] == [TRACKER.key]


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
