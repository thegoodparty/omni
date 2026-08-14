import json

import pytest

import event_state_gsheet as gs
import event_state_assembler as esa


class _FakeValues:
    def __init__(self, log):
        self._log = log

    def clear(self, **kw):
        self._log.append(("clear", kw))
        return self

    def update(self, **kw):
        self._log.append(("update", kw))
        return self

    def execute(self):
        return {}


class _FakeSheets:
    def __init__(self, log):
        self._values = _FakeValues(log)

    def values(self):
        return self._values


class _FakeService:
    def __init__(self):
        self.log = []

    def spreadsheets(self):
        return _FakeSheets(self.log)


SAMPLE = [
    {c: "" for c in esa.COLUMNS} | {"event": "A", "status": "active", "event_count_30d": 0},
    {c: "" for c in esa.COLUMNS} | {"event": "B", "status": "dormant", "event_count_30d": 5},
]


def test_build_values_header_then_stringified_rows():
    matrix = gs.build_values(SAMPLE)
    assert matrix[0] == list(esa.COLUMNS)            # header is COLUMNS
    assert len(matrix) == 3                           # header + 2 rows
    assert all(isinstance(cell, str) for row in matrix for cell in row)  # all strings
    # a numeric field is stringified, a None/blank renders ""
    ev_idx = esa.COLUMNS.index("event_count_30d")
    assert matrix[1][ev_idx] == "0"


def test_build_values_none_becomes_blank():
    row = {c: None for c in esa.COLUMNS}
    matrix = gs.build_values([row])
    assert matrix[1] == ["" for _ in esa.COLUMNS]


def test_write_sheet_updates_then_clears_trailing_and_returns_count():
    svc = _FakeService()
    n = gs.write_sheet(SAMPLE, service=svc, spreadsheet_id="sheet1", tab="events")
    assert n == 2
    kinds = [k for k, _ in svc.log]
    assert kinds == ["update", "clear"]              # update before clear, never empty
    update_kw = svc.log[0][1]
    clear_kw = svc.log[1][1]
    assert update_kw["spreadsheetId"] == "sheet1"
    assert update_kw["range"] == "events!A1"
    assert update_kw["valueInputOption"] == "RAW"
    assert update_kw["body"]["values"][0] == list(esa.COLUMNS)
    assert len(update_kw["body"]["values"]) == 3
    # trailing clear starts just below the written rows (header + 2 data = 3 rows)
    assert clear_kw["spreadsheetId"] == "sheet1" and clear_kw["range"] == "events!A4:ZZ"


def test_main_dry_run_prints_dims_no_auth(monkeypatch, capsys):
    monkeypatch.setattr(gs.esa, "assemble", lambda *a, **k: {"rows": SAMPLE, "meta": {}})
    rc = gs.main(["refresh", "--dry-run"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "2 events" in out


def test_main_missing_sheet_id_returns_2(monkeypatch):
    monkeypatch.setattr(gs.esa, "assemble", lambda *a, **k: {"rows": SAMPLE, "meta": {}})
    monkeypatch.delenv("GP_EVENT_STATE_SHEET_ID", raising=False)
    assert gs.main(["refresh"]) == 2


def test_main_override_threads_into_assemble(tmp_path, monkeypatch, capsys):
    override = {"New Event": {"govern_display_name": "New Event",
                              "govern_description": "brand new", "govern_tags": ["product:win"]}}
    ov_file = tmp_path / "override.json"
    ov_file.write_text(json.dumps(override))

    seen = {}
    def fake_assemble(today, **kwargs):
        seen["overrides"] = kwargs.get("overrides")
        return {"rows": [], "meta": {}}
    monkeypatch.setattr(gs.esa, "assemble", fake_assemble)

    rc = gs.main(["refresh", "--dry-run", "--override", str(ov_file)])
    assert rc == 0
    assert seen["overrides"] == override


def test_build_gap_values_header_sorted_rows_and_surface_maps_to_id():
    state = {
        "/b": {"id": "/b", "surface_type": "route", "disposition": "new", "reason": "",
               "judge_reason": "jr", "rubric_rule": "rr", "dashboard_question": "q",
               "location": "b.tsx", "first_seen": "2026-07-01", "last_seen": "2026-07-21",
               "rank": 3},
        "/a": {"id": "/a", "surface_type": "wizard_stage", "disposition": "dismissed",
               "reason": "chrome", "judge_reason": "jr2", "rubric_rule": "flow",
               "dashboard_question": "q2", "location": "a.tsx", "first_seen": "2026-07-01",
               "last_seen": "2026-07-21", "rank": 0},
    }
    values = gs.build_gap_values(state)
    assert values[0] == list(gs.GAPS_COLUMNS)
    # sorted by (rank, id): /a (rank 0) before /b (rank 3)
    assert values[1][gs.GAPS_COLUMNS.index("surface")] == "/a"
    assert values[1][gs.GAPS_COLUMNS.index("rank")] == "0"
    assert values[2][gs.GAPS_COLUMNS.index("surface")] == "/b"


def test_build_gap_values_missing_cell_becomes_blank():
    state = {"/a": {"id": "/a", "rank": 1}}  # most fields absent
    values = gs.build_gap_values(state)
    row = values[1]
    assert row[gs.GAPS_COLUMNS.index("reason")] == ""
    assert row[gs.GAPS_COLUMNS.index("surface")] == "/a"


def test_write_gaps_sheet_updates_then_clears_and_returns_count():
    svc = _FakeService()
    state = {"/a": {"id": "/a", "rank": 0}, "/b": {"id": "/b", "rank": 1}}
    n = gs.write_gaps_sheet(state, service=svc, spreadsheet_id="SID", tab="gaps")
    assert n == 2  # excludes header
    kinds = [k for k, _ in svc.log]
    assert kinds == ["update", "clear"]              # update before clear, never empty
    update_kw = svc.log[0][1]
    clear_kw = svc.log[1][1]
    assert update_kw["spreadsheetId"] == "SID"
    assert update_kw["range"] == "gaps!A1"
    assert update_kw["body"]["values"][0] == list(gs.GAPS_COLUMNS)
    assert len(update_kw["body"]["values"]) == 3     # header + 2 data rows
    assert clear_kw["spreadsheetId"] == "SID" and clear_kw["range"] == "gaps!A4:ZZ"


def test_write_gaps_sheet_default_tab_is_GAPS_TAB():
    svc = _FakeService()
    gs.write_gaps_sheet({}, service=svc, spreadsheet_id="SID")
    assert svc.log[0][1]["range"] == f"{gs.GAPS_TAB}!A1"


def test_load_gaps_state_missing_is_empty_and_corrupt_is_none(tmp_path):
    assert gs.load_gaps_state(tmp_path / "nope.json") == {}
    bad = tmp_path / "bad.json"
    bad.write_text("{ not json")
    assert gs.load_gaps_state(bad) is None
    notdict = tmp_path / "arr.json"
    notdict.write_text("[]")
    assert gs.load_gaps_state(notdict) is None


def test_load_gaps_state_reads_valid_dict(tmp_path):
    good = tmp_path / "state.json"
    good.write_text(json.dumps({"/a": {"id": "/a", "rank": 0}}))
    assert gs.load_gaps_state(good) == {"/a": {"id": "/a", "rank": 0}}


def test_main_refresh_gaps_writes_state_rows(monkeypatch, tmp_path, capsys):
    state = {"/a": {"id": "/a", "rank": 0, "disposition": "new"}}
    state_file = tmp_path / "instrumentation_gaps.json"
    state_file.write_text(json.dumps(state))
    svc = _FakeService()
    monkeypatch.setattr(gs, "get_sheets_service", lambda **kw: svc)
    rc = gs.main(["refresh-gaps", "--spreadsheet-id", "SID", "--state", str(state_file)])
    assert rc == 0
    assert any(c[0] == "update" for c in svc.log)


def test_main_refresh_gaps_skips_on_corrupt_state(monkeypatch, tmp_path, capsys):
    state_file = tmp_path / "instrumentation_gaps.json"
    state_file.write_text("{ broken")
    monkeypatch.setattr(gs, "get_sheets_service",
                        lambda **kw: (_ for _ in ()).throw(AssertionError("must not auth")))
    rc = gs.main(["refresh-gaps", "--spreadsheet-id", "SID", "--state", str(state_file)])
    assert rc == 0
    assert "skipping" in capsys.readouterr().err.lower()


_WRITEBACK_ENV = {
    "CLICKUP_API_KEY": "k", "GP_QUESTIONS_LIST_ID": "L",
    "GP_QUESTIONS_STATE_FIELD_ID": "f-state", "GP_QUESTIONS_CHECKED_FIELD_ID": "f-date",
    "GP_QUESTIONS_OPT_ANSWERABLE": "opt-a", "GP_QUESTIONS_OPT_PARTIAL": "opt-p",
    "GP_QUESTIONS_OPT_NOT": "opt-n",
}


def test_main_writeback_questions_exits_2_when_an_env_var_is_missing(monkeypatch, capsys):
    for name, value in _WRITEBACK_ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("GP_QUESTIONS_OPT_PARTIAL")
    rc = gs.main(["writeback-questions"])
    assert rc == 2
    assert "GP_QUESTIONS_OPT_" in capsys.readouterr().err


def test_main_writeback_questions_dry_run_reports_changed_count(monkeypatch, capsys):
    import question_writeback as qwb

    for name, value in _WRITEBACK_ENV.items():
        monkeypatch.setenv(name, value)
    rows = [
        {"question": "Q1", "state": "answerable", "question_ref": "t1"},
        {"question": "Q2", "state": "not_answerable", "question_ref": "t2"},
    ]
    monkeypatch.setattr(gs, "question_rows_for_refresh", lambda: rows)
    monkeypatch.setattr(qwb, "fetch_current_state", lambda *a, **k: {"t1": "answerable"})
    monkeypatch.setattr(qwb, "write_answer_state",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("dry run wrote")))
    rc = gs.main(["writeback-questions", "--dry-run"])
    assert rc == 0
    assert "1 of 2 questions changed" in capsys.readouterr().out


def test_main_writeback_questions_writes_through_the_module(monkeypatch, capsys):
    import question_writeback as qwb

    for name, value in _WRITEBACK_ENV.items():
        monkeypatch.setenv(name, value)
    rows = [{"question": "Q1", "state": "answerable", "question_ref": "t1"}]
    monkeypatch.setattr(gs, "question_rows_for_refresh", lambda: rows)
    monkeypatch.setattr(qwb, "fetch_current_state", lambda *a, **k: {})
    seen = {}
    def fake_write(api_key, got_rows, **kwargs):
        seen.update(kwargs, api_key=api_key, rows=got_rows)
        return 1
    monkeypatch.setattr(qwb, "write_answer_state", fake_write)
    rc = gs.main(["writeback-questions"])
    assert rc == 0
    assert seen["rows"] == rows
    assert seen["state_field_id"] == "f-state"
    assert seen["option_ids"] == {"answerable": "opt-a", "partially_answerable": "opt-p",
                                  "not_answerable": "opt-n"}
    assert "updated answer state on 1" in capsys.readouterr().out


def test_build_meta_values_includes_refresh_and_clickup():
    meta = {"refreshed_at": "2026-08-03T12:00:00", "event_count": 472,
            "provenance_path": "/x/prov.csv"}
    rows = gs.build_meta_values(meta, clickup_url="https://app.clickup.com/t/abc")
    flat = {r[0]: r[1] for r in rows[1:]}
    assert flat["last_refreshed"] == "2026-08-03T12:00:00"
    assert flat["event_count"] == "472"
    assert flat["clickup_page"] == "https://app.clickup.com/t/abc"


def test_build_meta_values_omits_clickup_when_absent():
    rows = gs.build_meta_values({"refreshed_at": "2026-08-03T12:00:00"}, clickup_url=None)
    keys = {r[0] for r in rows}
    assert "clickup_page" not in keys
    assert ["last_refreshed", "2026-08-03T12:00:00"] in rows


def test_write_meta_sheet_updates_then_clears_and_returns_count():
    svc = _FakeService()
    meta = {"refreshed_at": "2026-08-03T12:00:00", "event_count": 2,
            "provenance_path": "/x/prov.csv"}
    n = gs.write_meta_sheet(
        meta, service=svc, spreadsheet_id="sheet1",
        clickup_url="https://app.clickup.com/t/abc",
    )
    kinds = [k for k, _ in svc.log]
    assert kinds == ["update", "clear"]              # update before clear, never empty
    update_kw = svc.log[0][1]
    assert update_kw["spreadsheetId"] == "sheet1"
    assert update_kw["range"] == f"{gs.META_TAB}!A1"
    assert update_kw["valueInputOption"] == "RAW"
    values = update_kw["body"]["values"]
    assert values[0] == ["key", "value"]
    flat = {r[0]: r[1] for r in values[1:]}
    assert flat["last_refreshed"] == "2026-08-03T12:00:00"
    assert flat["clickup_page"] == "https://app.clickup.com/t/abc"
    assert n == len(values) - 1                       # data-row count excludes header
    clear_kw = svc.log[1][1]
    assert clear_kw["range"] == f"{gs.META_TAB}!A{len(values) + 1}:ZZ"


def test_write_meta_sheet_default_tab_is_META_TAB():
    svc = _FakeService()
    gs.write_meta_sheet({"refreshed_at": "x"}, service=svc, spreadsheet_id="s")
    assert svc.log[0][1]["range"] == f"{gs.META_TAB}!A1"


QUESTION_ROWS = [
    {"question": "Are people exporting voter files?", "state": "partially_answerable",
     "asked_by": "nate@goodparty.org", "question_ref": "86ak1111",
     "behaviors": ["voter_file_exported"], "events": ["Voter Data - List Exported"],
     "gaps": ["DownloadStep.tsx"], "caveats": []},
    {"question": "Are people creating lists?", "state": "answerable", "asked_by": "",
     "question_ref": "", "behaviors": ["voter_file_created"],
     "events": ["Voter Data - List Created"], "gaps": [],
     "caveats": ["one list per abandoned attempt (DATA-2308)"]},
]


def test_build_question_values_header_then_rows():
    matrix = gs.build_question_values(QUESTION_ROWS)
    assert matrix[0] == gs.QUESTIONS_COLUMNS
    assert len(matrix) == 3
    assert all(isinstance(cell, str) for row in matrix for cell in row)


def test_build_question_values_joins_list_cells():
    matrix = gs.build_question_values(QUESTION_ROWS)
    gaps_idx = gs.QUESTIONS_COLUMNS.index("uninstrumented_surfaces")
    assert matrix[1][gaps_idx] == "DownloadStep.tsx"
    caveat_idx = gs.QUESTIONS_COLUMNS.index("caveats")
    assert matrix[2][caveat_idx] == "one list per abandoned attempt (DATA-2308)"


def test_build_question_values_maps_renamed_columns_to_row_keys():
    # answering_events/clickup_task read row keys events/question_ref; without the
    # _QUESTION_COL_KEY remap each column silently renders blank.
    matrix = gs.build_question_values(QUESTION_ROWS)
    events_idx = gs.QUESTIONS_COLUMNS.index("answering_events")
    assert matrix[1][events_idx] == "Voter Data - List Exported"
    task_idx = gs.QUESTIONS_COLUMNS.index("clickup_task")
    assert matrix[1][task_idx] == "86ak1111"


def test_build_question_values_blank_for_missing_keys():
    matrix = gs.build_question_values([{"question": "Q"}])
    assert matrix[1][gs.QUESTIONS_COLUMNS.index("state")] == ""


def test_write_questions_sheet_updates_then_clears():
    svc = _FakeService()
    n = gs.write_questions_sheet(QUESTION_ROWS, service=svc, spreadsheet_id="s1")
    assert n == 2
    assert [k for k, _ in svc.log] == ["update", "clear"]
    assert svc.log[0][1]["range"] == f"{gs.QUESTIONS_TAB}!A1"


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


def test_question_rows_for_refresh_raises_on_an_invalid_registry(monkeypatch, tmp_path):
    # The registry's rules only bind the scheduled loop if a live caller runs them.
    import analytics_event_health as aeh

    mon = tmp_path / "mon.yaml"
    mon.write_text(_DUP_ID_REGISTRY)
    monkeypatch.setattr(aeh, "WATCHLIST", mon)
    monkeypatch.setattr(gs.esa, "assemble", lambda *a, **k: {"rows": [], "meta": {}})
    with pytest.raises(ValueError, match="duplicate id"):
        gs.question_rows_for_refresh()


def test_question_rows_for_refresh_accepts_the_committed_registry(monkeypatch):
    monkeypatch.setattr(gs.esa, "assemble", lambda *a, **k: {"rows": [], "meta": {}})
    assert gs.question_rows_for_refresh()
