import behavior_coverage as bc


def _rec(event_type, status="active"):
    return {"event_type": event_type, "status": status}


def _behavior(*surfaces):
    return {
        "id": "b",
        "surfaces": [
            {"path": f"p{i}.tsx", "label": f"s{i}", "instrumented_by": name}
            for i, name in enumerate(surfaces)
        ],
    }


def test_active_event_is_live():
    assert bc.is_live("E", {"E": _rec("E")}) is True


def test_event_absent_from_the_catalog_is_not_live():
    assert bc.is_live("E", {}) is False


def test_dormant_deprecating_and_retired_are_not_live():
    for status in ("dormant", "deprecating", "retired", "code_unknown"):
        assert bc.is_live("E", {"E": _rec("E", status)}) is False, status


def test_all_surfaces_live_is_covered():
    by_type = {"E": _rec("E"), "F": _rec("F")}
    assert bc.behavior_state(_behavior("E", "F"), by_type)["coverage"] == "covered"


def test_one_surface_uninstrumented_is_partial():
    assert bc.behavior_state(_behavior("E", None), {"E": _rec("E")})["coverage"] == "partial"


def test_no_surface_instrumented_is_uncovered():
    assert bc.behavior_state(_behavior(None, None), {})["coverage"] == "uncovered"


def test_named_instrument_that_died_is_uncovered_not_covered():
    by_type = {"E": _rec("E", "retired")}
    assert bc.behavior_state(_behavior("E"), by_type)["coverage"] == "uncovered"


def test_instruments_firing_with_no_working_surface_is_orphaned():
    by_type = {"E": _rec("E", "orphaned_firing")}
    assert bc.behavior_state(_behavior("E"), by_type)["coverage"] == "orphaned"


def test_partial_outranks_orphaned():
    by_type = {"E": _rec("E", "orphaned_firing"), "F": _rec("F")}
    assert bc.behavior_state(_behavior("E", "F"), by_type)["coverage"] == "partial"


def test_surface_states_distinguish_gap_from_dead():
    by_type = {"E": _rec("E"), "F": _rec("F", "retired")}
    states = bc.surface_states(_behavior("E", None, "F"), by_type)
    assert [(s["label"], s["state"]) for s in states] == [
        ("s0", "live"), ("s1", "gap"), ("s2", "dead"),
    ]


def test_behavior_with_no_surfaces_is_uncovered_not_covered():
    assert bc.behavior_state({"id": "b", "surfaces": []}, {})["coverage"] == "uncovered"
