import behavior_questions as bq


def _rec(name, status="active"):
    return {"event_type": name, "status": status}


def _b(bid, question, *surfaces, answers=None, asked_by=None, caveats=None, ref=None):
    row = {
        "id": bid, "question": question, "product": "win",
        "surfaces": [
            {"path": f"{bid}{i}.tsx", "label": f"l{i}", "instrumented_by": n}
            for i, n in enumerate(surfaces)
        ],
    }
    if answers:
        row["answers"] = answers
    if asked_by:
        row["asked_by"] = asked_by
    if caveats:
        row["caveats"] = caveats
    if ref:
        row["question_ref"] = ref
    return row


def test_single_covered_behavior_makes_its_question_answerable():
    rows = bq.question_rows([_b("a", "Q1", "E")], {"E": _rec("E")})
    assert [(r["question"], r["state"]) for r in rows] == [("Q1", "answerable")]


def test_partial_behavior_makes_its_question_partially_answerable():
    rows = bq.question_rows([_b("a", "Q1", "E", None)], {"E": _rec("E")})
    assert rows[0]["state"] == "partially_answerable"


def test_composite_question_needs_every_contributing_behavior_covered():
    behaviors = [
        _b("a", "Q1", "E", answers=["Composite"]),
        _b("b", "Q2", None, answers=["Composite"]),
    ]
    rows = {r["question"]: r for r in bq.question_rows(behaviors, {"E": _rec("E")})}
    assert rows["Q1"]["state"] == "answerable"
    assert rows["Q2"]["state"] == "not_answerable"
    assert rows["Composite"]["state"] == "not_answerable"
    assert rows["Composite"]["behaviors"] == ["a", "b"]


def test_row_lists_live_events_and_uninstrumented_paths():
    rows = bq.question_rows([_b("a", "Q1", "E", None)], {"E": _rec("E")})
    assert rows[0]["events"] == ["E"]
    assert rows[0]["gaps"] == ["a1.tsx"]


def test_caveats_and_ref_travel_with_the_question():
    behaviors = [_b("a", "Q1", "E", caveats="one list per abandoned attempt", ref="86ak1")]
    rows = bq.question_rows(behaviors, {"E": _rec("E")})
    assert rows[0]["caveats"] == ["one list per abandoned attempt"]
    assert rows[0]["question_ref"] == "86ak1"


def test_asked_by_is_carried_from_the_first_behavior_that_has_one():
    behaviors = [_b("a", "Q1", "E"), _b("b", "Q1", "E", asked_by="nate@goodparty.org")]
    rows = bq.question_rows(behaviors, {"E": _rec("E")})
    assert rows[0]["asked_by"] == "nate@goodparty.org"


def test_worst_state_sorts_first():
    behaviors = [_b("a", "Good", "E"), _b("b", "Bad", None)]
    rows = bq.question_rows(behaviors, {"E": _rec("E")})
    assert [r["question"] for r in rows] == ["Bad", "Good"]


def test_two_questions_on_the_same_behavior_set_are_reported_as_duplicates():
    behaviors = [_b("a", "Q1", "E", answers=["Q2"])]
    assert bq.duplicate_behavior_sets(behaviors, {"E": _rec("E")}) == [("Q1", "Q2")]


def test_questions_on_different_behavior_sets_are_not_duplicates():
    behaviors = [_b("a", "Q1", "E"), _b("b", "Q2", "F")]
    assert bq.duplicate_behavior_sets(behaviors, {"E": _rec("E"), "F": _rec("F")}) == []
