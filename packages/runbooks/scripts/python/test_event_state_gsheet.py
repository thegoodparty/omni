import json

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
