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
        return _FakeResponse(payload)
    return fake


TASKS = {"tasks": [
    {"id": "86ak1111", "name": "Are people exporting voter files?",
     "status": {"status": "accepted"},
     "custom_fields": [
         {"name": "Product", "value": "win"},
         {"name": "Asked by", "value": [{"email": "nate@goodparty.org"}]},
     ]},
    {"id": "86ak2222", "name": "Do candidates read the plan?",
     "status": {"status": "proposed"}, "custom_fields": []},
]}


def test_fetch_questions_flattens_tasks_and_custom_fields():
    rows = qi.fetch_questions("k", "list1", requester=_requester(TASKS))
    assert rows[0] == {"id": "86ak1111", "name": "Are people exporting voter files?",
                       "status": "accepted", "product": "win",
                       "asked_by": "nate@goodparty.org"}
    assert rows[1]["status"] == "proposed"


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
    rows = [{"id": "1", "name": "Q?", "status": "accepted", "product": "", "asked_by": ""}]
    assert qi.intake_to_behaviors(rows, today=TODAY, existing_refs=set())[0]["product"] == "both"


def test_product_is_lowercased_and_unknown_values_fall_back_to_both():
    rows = [
        {"id": "1", "name": "Q one?", "status": "accepted", "product": "Win", "asked_by": ""},
        {"id": "2", "name": "Q two?", "status": "accepted", "product": "0", "asked_by": ""},
    ]
    out = qi.intake_to_behaviors(rows, today=TODAY, existing_refs=set())
    assert [b["product"] for b in out] == ["win", "both"]


def test_same_slug_in_one_batch_lands_twice_with_distinct_ids():
    rows = [
        {"id": "1", "name": "Are people exporting voter files?", "status": "accepted",
         "product": "", "asked_by": ""},
        {"id": "2", "name": "Are people exporting voter files???", "status": "accepted",
         "product": "", "asked_by": ""},
    ]
    out = qi.intake_to_behaviors(rows, today=TODAY, existing_refs=set())
    assert [b["id"] for b in out] == ["are_people_exporting_voter_files",
                                      "are_people_exporting_voter_files_2"]


def test_slug_colliding_with_an_existing_id_is_suffixed_not_dropped():
    rows = [{"id": "9", "name": "Are people exporting voter files?", "status": "accepted",
             "product": "", "asked_by": ""}]
    out = qi.intake_to_behaviors(rows, today=TODAY, existing_refs=set(),
                                 existing_ids={"are_people_exporting_voter_files"})
    assert [b["id"] for b in out] == ["are_people_exporting_voter_files_2"]


def test_blank_question_name_is_skipped():
    rows = [{"id": "1", "name": "   ", "status": "accepted", "product": "", "asked_by": ""}]
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
