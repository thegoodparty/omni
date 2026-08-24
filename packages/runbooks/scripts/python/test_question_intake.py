from datetime import date

import question_intake as qi
import yaml

TODAY = date(2026, 8, 13)


class _FakeResponse:
    status_code = 200
    content = b"{}"

    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _requester(payload):
    def fake(method, url, **kwargs):
        assert method == "GET"
        if (kwargs.get("params") or {}).get("page", "0") != "0":
            return _FakeResponse({"tasks": [], "last_page": True})
        return _FakeResponse(payload)
    return fake


def _paged_requester(pages):
    def fake(method, url, **kwargs):
        page = int((kwargs.get("params") or {}).get("page", "0"))
        return _FakeResponse(pages[page])
    return fake


TASKS = {"tasks": [
    {"id": "86ak1111", "name": "Are people exporting voter files?",
     "status": {"status": "in progress"},
     "custom_fields": [
         {"name": "stage", "value": "accepted"},
         {"name": "Product", "value": "win"},
         {"name": "Asked by", "value": [{"email": "nate@goodparty.org"}]},
     ]},
    {"id": "86ak2222", "name": "Do candidates read the plan?",
     "status": {"status": "in progress"},
     "custom_fields": [{"name": "stage", "value": "proposed"}]},
]}


def test_fetch_questions_follows_pagination_until_last_page():
    pages = [
        {"tasks": [{"id": "1", "name": "Q1?", "status": {"status": "in progress"},
                    "custom_fields": []}], "last_page": False},
        {"tasks": [{"id": "2", "name": "Q2?", "status": {"status": "in progress"},
                    "custom_fields": []}], "last_page": True},
    ]
    rows = qi.fetch_questions("k", "list1", requester=_paged_requester(pages))
    assert [r["id"] for r in rows] == ["1", "2"]


def test_fetch_questions_stops_on_an_empty_page_without_last_page():
    pages = [
        {"tasks": [{"id": "1", "name": "Q1?", "status": {"status": "in progress"},
                    "custom_fields": []}]},
        {"tasks": []},
    ]
    rows = qi.fetch_questions("k", "list1", requester=_paged_requester(pages))
    assert [r["id"] for r in rows] == ["1"]


def test_fetch_questions_flattens_tasks_and_custom_fields():
    rows = qi.fetch_questions("k", "list1", requester=_requester(TASKS))
    assert rows[0] == {"id": "86ak1111", "name": "Are people exporting voter files?",
                       "stage": "accepted", "product": "win",
                       "asked_by": "nate@goodparty.org"}
    assert rows[1]["stage"] == "proposed"


def test_custom_field_names_match_case_insensitively():
    # The live list's fields are lowercase; an exact match on "Product" read as blank and
    # normalized every question to "both".
    payload = {"tasks": [{"id": "86ak7777", "name": "Q?", "custom_fields": [
        {"name": "stage", "value": "accepted"},
        {"name": "product", "value": "serve"},
        {"name": "asked by", "value": [{"email": "nate@goodparty.org"}]},
    ]}]}
    rows = qi.fetch_questions("k", "L", requester=_requester(payload))
    assert rows[0]["product"] == "serve"
    assert rows[0]["asked_by"] == "nate@goodparty.org"


def test_native_task_status_does_not_gate_intake():
    # The Data Team space enforces a shared status group, so the list cannot carry its own
    # Accepted status. Both fixture tasks sit in "in progress"; only stage decides.
    rows = qi.fetch_questions("k", "list1", requester=_requester(TASKS))
    out = qi.intake_to_behaviors(rows, today=TODAY, existing_refs=set())
    assert [b["question_ref"] for b in out] == ["86ak1111"]


def test_only_accepted_tasks_become_behaviors():
    rows = qi.fetch_questions("k", "list1", requester=_requester(TASKS))
    out = qi.intake_to_behaviors(rows, today=TODAY, existing_refs=set())
    assert [b["question_ref"] for b in out] == ["86ak1111"]


def test_stub_carries_the_task_id_and_no_surfaces():
    rows = qi.fetch_questions("k", "list1", requester=_requester(TASKS))
    b = qi.intake_to_behaviors(rows, today=TODAY, existing_refs=set())[0]
    assert b["id"] == "are_people_exporting_voter_files"
    assert b["question_ref"] == "86ak1111"
    assert b["surfaces"] == []
    assert b["asked_by"] == "nate@goodparty.org"
    assert b["review"]["last_reviewed"] == "2026-08-13"


def test_already_ingested_ref_is_skipped_so_reruns_are_noops():
    rows = qi.fetch_questions("k", "list1", requester=_requester(TASKS))
    assert qi.intake_to_behaviors(rows, today=TODAY, existing_refs={"86ak1111"}) == []


def test_missing_product_defaults_to_both():
    rows = [{"id": "1", "name": "Q?", "stage": "accepted", "product": "", "asked_by": ""}]
    assert qi.intake_to_behaviors(rows, today=TODAY, existing_refs=set())[0]["product"] == "both"


def test_product_is_lowercased_and_unknown_values_fall_back_to_both():
    rows = [
        {"id": "1", "name": "Q one?", "stage": "accepted", "product": "Win", "asked_by": ""},
        {"id": "2", "name": "Q two?", "stage": "accepted", "product": "campaign",
         "asked_by": ""},
    ]
    out = qi.intake_to_behaviors(rows, today=TODAY, existing_refs=set())
    assert [b["product"] for b in out] == ["win", "both"]


_PRODUCT_TYPE_CONFIG = {"options": [
    {"id": "opt-win", "name": "Win", "orderindex": 0},
    {"id": "opt-serve", "name": "Serve", "orderindex": 1},
]}


def _dropdown_task(value):
    return {"tasks": [{
        "id": "86ak5555", "name": "Q?", "status": {"status": "in progress"},
        "custom_fields": [
            {"name": "stage", "value": "accepted"},
            {"name": "Product", "type_config": _PRODUCT_TYPE_CONFIG, "value": value},
        ],
    }]}


def test_dropdown_orderindex_zero_resolves_to_its_option_name_not_both():
    # orderindex 0 is a real selection; reading the raw value made it unrecognized, so
    # normalize_product turned every Win question into "both" and the field was decorative.
    rows = qi.fetch_questions("k", "L", requester=_requester(_dropdown_task(0)))
    assert rows[0]["product"] == "Win"
    out = qi.intake_to_behaviors(rows, today=TODAY, existing_refs=set())
    assert out[0]["product"] == "win"


def test_dropdown_uuid_value_resolves_to_its_option_name():
    rows = qi.fetch_questions("k", "L", requester=_requester(_dropdown_task("opt-serve")))
    assert rows[0]["product"] == "Serve"


def test_append_behaviors_tolerates_a_trailing_comment_on_the_key_line(tmp_path):
    path = tmp_path / "m.yaml"
    path.write_text("behaviors: []  # schema described above\ndismissed: []\n")
    n = qi.append_behaviors(path, [{"id": "q1", "question": "Q?", "question_ref": "r1"}])
    assert n == 1
    doc = yaml.safe_load(path.read_text())
    assert [b["id"] for b in doc["behaviors"]] == ["q1"]


def test_append_behaviors_survives_a_column_zero_comment_inside_the_block(tmp_path):
    path = tmp_path / "m.yaml"
    path.write_text(
        "behaviors:\n"
        "  - {id: q1, question: 'Q1?', question_ref: 'r1'}\n"
        "# interior note a human left\n"
        "  - {id: q2, question: 'Q2?', question_ref: 'r2'}\n"
        "# trailing comment introducing the next key\n"
        "dismissed: []\n"
    )
    n = qi.append_behaviors(path, [{"id": "q3", "question": "Q3?", "question_ref": "r3"}])
    assert n == 1
    text = path.read_text()
    assert "# interior note a human left" in text
    assert "# trailing comment introducing the next key" in text
    doc = yaml.safe_load(text)
    assert [b["id"] for b in doc["behaviors"]] == ["q1", "q2", "q3"]
    assert doc["dismissed"] == []
    assert text.index("q3") < text.index("# trailing comment")


def test_dropdown_value_returned_as_an_option_object_resolves_to_its_name():
    rows = qi.fetch_questions(
        "k", "L", requester=_requester(_dropdown_task({"id": "opt-x", "name": "Win"}))
    )
    assert rows[0]["product"] == "Win"


def test_an_unresolvable_dropdown_value_still_falls_back_to_both():
    rows = qi.fetch_questions("k", "L", requester=_requester(_dropdown_task("opt-gone")))
    out = qi.intake_to_behaviors(rows, today=TODAY, existing_refs=set())
    assert out[0]["product"] == "both"


def test_same_slug_in_one_batch_lands_twice_with_distinct_ids():
    rows = [
        {"id": "1", "name": "Are people exporting voter files?", "stage": "accepted",
         "product": "", "asked_by": ""},
        {"id": "2", "name": "Are people exporting voter files???", "stage": "accepted",
         "product": "", "asked_by": ""},
    ]
    out = qi.intake_to_behaviors(rows, today=TODAY, existing_refs=set())
    assert [b["id"] for b in out] == ["are_people_exporting_voter_files",
                                      "are_people_exporting_voter_files_2"]


def test_slug_colliding_with_an_existing_id_is_suffixed_not_dropped():
    rows = [{"id": "9", "name": "Are people exporting voter files?", "stage": "accepted",
             "product": "", "asked_by": ""}]
    out = qi.intake_to_behaviors(rows, today=TODAY, existing_refs=set(),
                                 existing_ids={"are_people_exporting_voter_files"})
    assert [b["id"] for b in out] == ["are_people_exporting_voter_files_2"]


def test_blank_question_name_is_skipped():
    rows = [{"id": "1", "name": "   ", "stage": "accepted", "product": "", "asked_by": ""}]
    assert qi.intake_to_behaviors(rows, today=TODAY, existing_refs=set()) == []


def test_similar_questions_flags_reworded_duplicates():
    existing = ["Are people exporting voter files?"]
    assert qi.similar_questions("are people exporting voter file", existing) == existing


def test_similar_questions_ignores_unrelated_ones():
    assert qi.similar_questions("Do candidates read the plan?",
                                ["Are people exporting voter files?"]) == []


def test_append_behaviors_preserves_other_keys(tmp_path):
    path = tmp_path / "m.yaml"
    path.write_text("watched_families: [win_dashboard]\nevents: []\nbehaviors: []\n")
    n = qi.append_behaviors(path, [{"id": "q1", "question": "Q?", "question_ref": "86ak1",
                                    "product": "win", "surfaces": [], "review": {}}])
    assert n == 1
    doc = yaml.safe_load(path.read_text())
    assert [b["id"] for b in doc["behaviors"]] == ["q1"]
    assert doc["watched_families"] == ["win_dashboard"]


def test_append_behaviors_is_idempotent_on_question_ref(tmp_path):
    path = tmp_path / "m.yaml"
    path.write_text("behaviors:\n  - {id: q1, question: 'Q?', question_ref: '86ak1'}\n")
    assert qi.append_behaviors(path, [{"id": "other", "question_ref": "86ak1"}]) == 0


def test_append_behaviors_suffixes_an_id_already_in_the_registry(tmp_path):
    path = tmp_path / "m.yaml"
    path.write_text("behaviors:\n  - {id: q1, question: 'Q?', question_ref: '86ak1'}\n")
    n = qi.append_behaviors(path, [
        {"id": "q1", "question": "Second?", "question_ref": "86ak2"},
        {"id": "q1", "question": "Third?", "question_ref": "86ak3"},
    ])
    assert n == 2
    doc = yaml.safe_load(path.read_text())
    assert [b["id"] for b in doc["behaviors"]] == ["q1", "q1_2", "q1_3"]


_DUP_ID_REGISTRY = """events: []
behaviors:
  - id: dup
    question: "Q one?"
    product: win
    surfaces:
      - {path: "a.tsx", label: "a", instrumented_by: null}
    review: {last_reviewed: 2026-08-01, reviewed_by: t, interval_days: 90}
  - id: dup
    question: "Q two?"
    product: win
    surfaces:
      - {path: "b.tsx", label: "b", instrumented_by: null}
    review: {last_reviewed: 2026-08-01, reviewed_by: t, interval_days: 90}
"""


def test_main_exits_nonzero_on_an_invalid_registry(monkeypatch, tmp_path, capsys):
    # Intake appends to the registry, so it must refuse to write on top of a broken one.
    import analytics_event_health as aeh

    mon = tmp_path / "mon.yaml"
    mon.write_text(_DUP_ID_REGISTRY)
    monkeypatch.setattr(aeh, "WATCHLIST", mon)
    monkeypatch.setenv("CLICKUP_API_KEY", "k")
    monkeypatch.setattr(qi, "fetch_questions", lambda *a, **k: [])
    assert qi.main(["--list-id", "L"]) == 1
    assert "duplicate id" in capsys.readouterr().err
    assert mon.read_text() == _DUP_ID_REGISTRY


COMMENTED = """# hand-maintained header
watched_families: [win_dashboard]

# schema note above the key
behaviors:
  - id: existing
    question: "Q?"          # trailing note
    question_ref: '86ak1'

# note above the next key
dismissed: []
"""


def test_append_behaviors_keeps_every_comment_in_the_file(tmp_path):
    path = tmp_path / "m.yaml"
    path.write_text(COMMENTED)
    n = qi.append_behaviors(path, [{"id": "new_q", "question": "New?", "question_ref": "86ak2",
                                    "product": "win", "surfaces": []}])
    assert n == 1
    text = path.read_text()
    head, _, tail = COMMENTED.partition("    question_ref: '86ak1'\n")
    assert text.startswith(head + "    question_ref: '86ak1'\n")
    assert text.endswith(tail)
    doc = yaml.safe_load(text)
    assert [b["id"] for b in doc["behaviors"]] == ["existing", "new_q"]
