import json

import event_state_clickup_doc as doc


SAMPLE_ROWS = [
    {"event": "Live Event", "status": "active", "supersession": "", "family": "win_x",
     "first_seen_date": "2026-01-01", "last_seen_date": "2026-06-30", "event_count_30d": 40,
     "event_count": 100, "description": "Live purpose.", "tags": "product:win",
     "instrumented_pr": "https://github.com/thegoodparty/omni/pull/1", "instrumented_date": "2026-01-01",
     "instrumented_author_email": "", "retired_pr": "", "retired_date": "", "retired_author_email": ""},
]
SAMPLE_META = {"refreshed_at": "2026-06-30T12:00:00+00:00", "event_count": 1,
               "provenance_path": "instrumentation_data/amplitude_event_provenance.csv"}


def test_render_markdown_has_header_legend_and_table():
    md = doc.render_markdown(SAMPLE_ROWS, SAMPLE_META)
    assert "# Analytics event state" in md
    assert "2026-06-30T12:00:00+00:00" in md          # refresh stamp
    assert "orphaned_firing" in md                     # status legend present
    assert "| event | status | supersession |" in md.replace("  ", " ") or "| event |" in md
    assert "Live Event" in md and "active" in md
    assert "1 events" in md                             # count surfaced


def test_render_markdown_escapes_pipes_in_cells():
    rows = [dict(SAMPLE_ROWS[0], description="a | b")]
    md = doc.render_markdown(rows, SAMPLE_META)
    # a literal pipe inside a cell must be escaped so it does not break the column
    assert "a \\| b" in md


def test_doc_state_round_trip(tmp_path):
    p = tmp_path / "state.json"
    assert doc.load_doc_state(p) == {}
    doc.save_doc_state(p, "page-123")
    assert doc.load_doc_state(p)["page_id"] == "page-123"


def test_upsert_creates_page_when_no_state(tmp_path):
    calls = []

    def fake_requester(method, url, headers=None, params=None, json=None, timeout=None):
        calls.append((method, url, json))
        class R:
            status_code = 200
            content = b"{}"
            def raise_for_status(self): pass
            def json(self): return {"id": "new-page-1"}
        return R()

    page_id = doc.upsert_page(
        "# md", api_key="k", team_id="900", doc_id="d1",
        state_path=tmp_path / "s.json", requester=fake_requester,
    )
    assert page_id == "new-page-1"
    assert calls[0][0] == "POST"                       # create path
    assert "workspaces/900/docs/d1/pages" in calls[0][1]
    assert doc.load_doc_state(tmp_path / "s.json")["page_id"] == "new-page-1"


def test_upsert_updates_page_when_state_exists(tmp_path):
    state = tmp_path / "s.json"
    doc.save_doc_state(state, "existing-page")
    calls = []

    def fake_requester(method, url, headers=None, params=None, json=None, timeout=None):
        calls.append((method, url))
        class R:
            status_code = 200
            content = b"{}"
            def raise_for_status(self): pass
            def json(self): return {"id": "existing-page"}
        return R()

    page_id = doc.upsert_page(
        "# md2", api_key="k", team_id="900", doc_id="d1",
        state_path=state, requester=fake_requester,
    )
    assert page_id == "existing-page"
    assert calls[0][0] == "PUT"                         # update path
    assert "pages/existing-page" in calls[0][1]


def test_main_dry_run_prints_markdown_and_does_not_write(monkeypatch, capsys):
    monkeypatch.setattr(doc.esa, "assemble", lambda *a, **k: {"rows": [], "meta": {
        "refreshed_at": "2026-06-30T00:00:00+00:00", "event_count": 0,
        "provenance_path": "p.csv"}})
    rc = doc.main(["refresh", "--dry-run"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "# Analytics event state" in out


def test_main_missing_env_returns_2_and_no_clickup_write(monkeypatch):
    monkeypatch.delenv("CLICKUP_API_KEY", raising=False)
    monkeypatch.delenv("CLICKUP_TEAM_ID", raising=False)
    monkeypatch.setattr(doc.esa, "assemble", lambda *a, **k: {"rows": [], "meta": {
        "refreshed_at": "2026-06-30T00:00:00+00:00", "event_count": 0,
        "provenance_path": "p.csv"}})
    calls = []
    monkeypatch.setattr(doc, "upsert_page", lambda *a, **k: calls.append(1) or "")
    rc = doc.main(["refresh"])
    assert rc == 2
    assert calls == []
