import csv
from datetime import date

import pandas as pd

import event_state_assembler as esa


def _record(event_type, status, **kw):
    base = {
        "event_type": event_type,
        "family": kw.get("family"),
        "status": status,
        "event_count_30d": kw.get("event_count_30d", 0),
        "last_seen_date": kw.get("last_seen_date"),
        "gpmeta": kw.get("gpmeta"),
    }
    return base


def test_columns_are_the_sixteen_in_order():
    assert esa.COLUMNS == [
        "event", "status", "supersession", "family", "first_seen_date",
        "last_seen_date", "event_count_30d", "event_count", "description", "tags",
        "instrumented_pr", "instrumented_date", "instrumented_author_email",
        "retired_pr", "retired_date", "retired_author_email",
    ]


def test_build_rows_projects_and_orders_by_last_code_change_desc():
    records = [
        _record("Old Event", "retired", event_count_30d=0),
        _record("New Event", "active", event_count_30d=50),
    ]
    catalog = {
        "Old Event": {"govern_display_name": "Old Event", "family": "win_x",
                      "first_seen_date": "2024-01-01", "last_seen_date": "2026-01-01",
                      "event_count_30d": 0, "event_count": 9, "govern_tags": ["product:win"]},
        "New Event": {"govern_display_name": "New Event", "family": "win_y",
                      "first_seen_date": "2026-05-01", "last_seen_date": "2026-06-30",
                      "event_count_30d": 50, "event_count": 50, "govern_tags": None},
    }
    code = {
        "Old Event": {"instrumented_pr": "p1", "instrumented_date": "2024-01-01",
                      "retired_pr": "p9", "retired_date": "2026-02-01",
                      "last_code_change_date": "2026-02-01"},
        "New Event": {"instrumented_pr": "p2", "instrumented_date": "2026-05-01",
                      "retired_pr": "", "retired_date": "",
                      "last_code_change_date": "2026-05-01"},
    }
    rows = esa.build_rows(records, catalog, code)
    # New Event last changed 2026-05-01, Old Event 2026-02-01 → most-recent-first.
    assert [r["event"] for r in rows] == ["New Event", "Old Event"]
    assert list(rows[0].keys()) == esa.COLUMNS
    assert rows[0]["tags"] == ""  # None tags render blank
    assert rows[1]["tags"] == "product:win"


def test_build_rows_blanks_supersession_when_original_and_fills_when_superseded():
    records = [
        _record("A", "active", gpmeta={"purpose": "does a thing", "supersession": "original"}),
        _record("B", "dormant", gpmeta={"purpose": "old thing",
                                         "supersession": "superseded by A (rebuild)"}),
    ]
    catalog = {"A": {"govern_display_name": "A"}, "B": {"govern_display_name": "B"}}
    code = {"A": {"last_code_change_date": "2026-06-01"},
            "B": {"last_code_change_date": "2026-05-01"}}
    rows = {r["event"]: r for r in esa.build_rows(records, catalog, code)}
    assert rows["A"]["supersession"] == ""
    assert rows["A"]["description"] == "does a thing"
    assert rows["B"]["supersession"] == "superseded by A (rebuild)"


def test_build_rows_handles_never_observed_and_missing_author_columns():
    # event present in code/records but not in catalog (instrumented_never_observed)
    records = [_record("Ghost", "instrumented_never_observed")]
    catalog = {}
    code = {"Ghost": {"instrumented_pr": "p3", "instrumented_date": "2026-03-01",
                      "last_code_change_date": "2026-03-01"}}  # no author columns
    rows = esa.build_rows(records, catalog, code)
    assert len(rows) == 1
    r = rows[0]
    assert r["event"] == "Ghost"          # falls back to event_type when no display name
    assert r["status"] == "instrumented_never_observed"
    assert r["family"] == ""
    assert r["instrumented_author_email"] == ""   # absent column → blank, no crash
    assert r["event_count_30d"] == 0


def test_format_tags():
    assert esa.format_tags(["a", "b"]) == "a, b"
    assert esa.format_tags(None) == ""
    assert esa.format_tags("solo") == "solo"


def test_build_rows_nulls_sort_last():
    records = [_record("HasDate", "active"), _record("NoProv", "code_unknown")]
    catalog = {"HasDate": {"govern_display_name": "HasDate"},
               "NoProv": {"govern_display_name": "NoProv"}}
    code = {"HasDate": {"last_code_change_date": "2026-01-01"}}  # NoProv absent
    rows = esa.build_rows(records, catalog, code)
    assert [r["event"] for r in rows] == ["HasDate", "NoProv"]


def test_build_rows_preserves_catalog_zero_counts():
    # Regression: old `or` chain treated 0 as falsy and fell through to the next value.
    # Catalog has event_count_30d=0 and event_count=0 (dormant event).
    # Record has event_count_30d=99 (from elsewhere).
    # Build must preserve catalog zeros, not use record's value.
    records = [
        _record("DormantEvent", "dormant", event_count_30d=99)
    ]
    catalog = {
        "DormantEvent": {
            "govern_display_name": "DormantEvent",
            "event_count_30d": 0,
            "event_count": 0,
        }
    }
    code = {"DormantEvent": {"last_code_change_date": "2026-01-01"}}
    rows = esa.build_rows(records, catalog, code)
    assert len(rows) == 1
    r = rows[0]
    assert r["event_count_30d"] == 0, "Catalog zero should be preserved, not replaced by record value"
    assert r["event_count"] == 0, "Catalog zero should be preserved"


def test_assemble_uses_real_reconcile_for_status(tmp_path):
    # Two catalog events: one firing (active), one quiet & code-present (dormant).
    catalog_df = pd.DataFrame(
        [
            {"event_type": "Live Event", "govern_display_name": "Live Event",
             "family": "win_x", "first_seen_date": "2026-01-01",
             "last_seen_date": "2026-06-30", "event_count": 100, "event_count_30d": 40,
             "govern_description": "<!-- gp-meta -->\nLive purpose. |\nsupersession: original |\nin use: 2026-01-01 (#1)\n<!-- /gp-meta -->",
             "govern_tags": ["product:win"]},
            {"event_type": "Quiet Event", "govern_display_name": "Quiet Event",
             "family": "win_y", "first_seen_date": "2025-01-01",
             "last_seen_date": "2025-12-01", "event_count": 5, "event_count_30d": 0,
             "govern_description": None, "govern_tags": None},
        ]
    )
    prov = tmp_path / "prov.csv"
    with prov.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=[
            "event_type", "instrumented_pr", "instrumented_date",
            "retired_pr", "retired_date", "last_code_change_date"])
        w.writeheader()
        w.writerow({"event_type": "Live Event", "instrumented_pr": "p1",
                    "instrumented_date": "2026-01-01", "retired_pr": "", "retired_date": "",
                    "last_code_change_date": "2026-01-01"})
        w.writerow({"event_type": "Quiet Event", "instrumented_pr": "p2",
                    "instrumented_date": "2025-01-01", "retired_pr": "", "retired_date": "",
                    "last_code_change_date": "2025-01-01"})

    result = esa.assemble(
        date(2026, 6, 30),
        run_query=lambda _sql: catalog_df,
        code_csv=prov,
    )
    rows = {r["event"]: r for r in result["rows"]}
    assert rows["Live Event"]["status"] == "active"
    assert rows["Quiet Event"]["status"] == "dormant"
    assert rows["Live Event"]["description"] == "Live purpose."
    assert result["meta"]["event_count"] == 2
    assert result["meta"]["refreshed_at"]  # ISO timestamp present
