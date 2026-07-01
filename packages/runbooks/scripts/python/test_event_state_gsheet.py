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
