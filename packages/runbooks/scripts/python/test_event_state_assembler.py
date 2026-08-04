import csv
from datetime import date

import numpy as np
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


def test_event_state_sql_reads_mart_analytics_catalog():
    # Guard the read target: the assembler tests inject run_query and discard the SQL,
    # so without this a revert to the dbt relation would pass silently.
    assert "mart_analytics.amplitude_event_catalog" in esa.EVENT_STATE_SQL
    assert "dbt." not in esa.EVENT_STATE_SQL


def test_columns_are_the_nineteen_in_order():
    assert esa.COLUMNS == [
        "event", "status", "declared_intent", "intent_date", "supersession",
        "family", "first_seen_date",
        "last_seen_date", "event_count_30d", "event_count", "description", "tags",
        "instrumented_pr", "instrumented_date", "instrumented_author_email",
        "retired_pr", "retired_date", "retired_author_email", "watchlist_status",
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


def test_build_rows_projects_declared_intent_and_date():
    records = [
        _record("Live", "active", gpmeta={"intent": "in_use", "intent_date": "2026-01-01"}),
        _record("Dead", "dormant", gpmeta={"intent": "not_in_use", "intent_date": "2026-05-05"}),
        _record("Unstamped", "active", gpmeta=None),
    ]
    catalog = {n: {"govern_display_name": n} for n in ("Live", "Dead", "Unstamped")}
    code = {n: {"last_code_change_date": "2026-06-01"} for n in ("Live", "Dead", "Unstamped")}
    rows = {r["event"]: r for r in esa.build_rows(records, catalog, code)}
    assert rows["Live"]["declared_intent"] == "in use"
    assert rows["Live"]["intent_date"] == "2026-01-01"
    assert rows["Dead"]["declared_intent"] == "not in use"
    assert rows["Dead"]["intent_date"] == "2026-05-05"
    assert rows["Unstamped"]["declared_intent"] == ""
    assert rows["Unstamped"]["intent_date"] == ""


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
    # Python list
    assert esa.format_tags(["a", "b"]) == "a, b"
    # None
    assert esa.format_tags(None) == ""
    # Plain string passthrough
    assert esa.format_tags("solo") == "solo"
    # numpy ndarray — empty (real-data case from Databricks connector)
    assert esa.format_tags(np.array([], dtype=object)) == ""
    # numpy ndarray — populated
    assert esa.format_tags(np.array(["product:serve"], dtype=object)) == "product:serve"
    # numpy ndarray — multiple values
    assert esa.format_tags(np.array(["product:win", "x"], dtype=object)) == "product:win, x"
    # pandas null scalar (float("nan"))
    assert esa.format_tags(float("nan")) == ""


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


def test_build_rows_coerces_nan_counts_to_zero():
    # Regression: Databricks returns float("nan") for SQL NULLs (the key is present, so
    # .get's default never applies). NaN would break json.dumps in the sinks and make the
    # sort non-deterministic, so _num must coerce it to 0 like format_tags does for tags.
    records = [_record("NullCounts", "active")]
    catalog = {
        "NullCounts": {
            "govern_display_name": "NullCounts",
            "event_count_30d": float("nan"),
            "event_count": float("nan"),
        }
    }
    code = {"NullCounts": {"last_code_change_date": "2026-01-01"}}
    rows = esa.build_rows(records, catalog, code)
    assert rows[0]["event_count_30d"] == 0
    assert rows[0]["event_count"] == 0


def test_apply_overrides_replaces_govern_fields_on_existing_row():
    catalog = [
        {
            "event_type": "Foo Event",
            "family": "win_onboarding",
            "govern_display_name": "Foo Event",
            "govern_description": "old desc",
            "govern_tags": ["product:win"],
            "event_count": 10,
            "event_count_30d": 5,
            "first_seen_date": "2026-01-01",
            "last_seen_date": "2026-06-01",
        }
    ]
    out = esa._apply_overrides(
        catalog,
        {"Foo Event": {"govern_description": "new desc", "govern_tags": ["product:serve"]}},
    )
    row = {r["event_type"]: r for r in out}["Foo Event"]
    assert row["govern_description"] == "new desc"
    assert row["govern_tags"] == ["product:serve"]
    # untouched fields survive
    assert row["event_count_30d"] == 5
    assert row["govern_display_name"] == "Foo Event"


def test_apply_overrides_injects_missing_event_with_reconcile_required_keys():
    catalog = []
    out = esa._apply_overrides(
        catalog,
        {
            "New Event": {
                "govern_display_name": "New Event",
                "govern_description": "brand new",
                "govern_tags": ["product:win"],
            }
        },
    )
    assert len(out) == 1
    row = out[0]
    # every field reconcile() subscripts directly must be present
    for key in ("event_type", "family", "govern_description", "event_count_30d", "last_seen_date"):
        assert key in row, f"injected row missing {key}"
    assert row["event_type"] == "New Event"
    assert row["govern_description"] == "brand new"
    assert row["family"] is None
    assert row["event_count_30d"] in (0, None)


def test_apply_overrides_none_is_noop():
    catalog = [{"event_type": "Foo", "family": None, "govern_description": None,
                "event_count_30d": 0, "last_seen_date": None}]
    assert esa._apply_overrides(catalog, None) is catalog


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


def test_assemble_override_reflects_new_description_without_databricks(tmp_path):
    catalog_df = pd.DataFrame(
        [
            {"event_type": "Foo Event", "govern_display_name": "Foo Event",
             "family": "win_onboarding", "first_seen_date": "2026-01-01",
             "last_seen_date": "2026-06-01", "event_count": 100, "event_count_30d": 40,
             "govern_description": "stale desc", "govern_tags": ["product:win"]},
        ]
    )
    prov = tmp_path / "prov.csv"
    with prov.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=[
            "event_type", "instrumented_pr", "instrumented_date",
            "retired_pr", "retired_date", "last_code_change_date"])
        w.writeheader()
        w.writerow({"event_type": "Foo Event", "instrumented_pr": "p1",
                    "instrumented_date": "2026-01-01", "retired_pr": "", "retired_date": "",
                    "last_code_change_date": "2026-01-01"})

    result = esa.assemble(
        date(2026, 6, 30),
        run_query=lambda _sql: catalog_df,
        code_csv=prov,
        overrides={"Foo Event": {"govern_description": "<!-- gp-meta -->\nfresh purpose\nsupersession: original\nin use: 2026-06-30\n<!-- /gp-meta -->"}},
    )
    foo = {r["event"]: r for r in result["rows"]}["Foo Event"]
    assert foo["description"] == "fresh purpose"


def test_assemble_override_injects_event_absent_from_catalog_and_csv(tmp_path):
    # Override event present in NEITHER the fake catalog NOR the provenance CSV — the
    # exact KeyError-guard path _INJECT_SKELETON exists for. Must not raise, and the
    # injected event must still land as a row (in_code=None → status "code_unknown",
    # per classify_status in analytics_event_health.py:227-242).
    catalog_df = pd.DataFrame(
        [
            {"event_type": "Foo Event", "govern_display_name": "Foo Event",
             "family": "win_onboarding", "first_seen_date": "2026-01-01",
             "last_seen_date": "2026-06-01", "event_count": 100, "event_count_30d": 40,
             "govern_description": "stale desc", "govern_tags": ["product:win"]},
        ]
    )
    prov = tmp_path / "prov.csv"
    with prov.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=[
            "event_type", "instrumented_pr", "instrumented_date",
            "retired_pr", "retired_date", "last_code_change_date"])
        w.writeheader()
        w.writerow({"event_type": "Foo Event", "instrumented_pr": "p1",
                    "instrumented_date": "2026-01-01", "retired_pr": "", "retired_date": "",
                    "last_code_change_date": "2026-01-01"})

    result = esa.assemble(
        date(2026, 6, 30),
        run_query=lambda _sql: catalog_df,
        code_csv=prov,
        overrides={
            "Brand New Event": {
                "govern_display_name": "Brand New Event",
                "govern_description": "<!-- gp-meta -->\nfresh purpose\nsupersession: original\nin use: 2026-06-30\n<!-- /gp-meta -->",
                "govern_tags": ["product:win"],
            }
        },
    )
    rows = {r["event"]: r for r in result["rows"]}
    assert "Brand New Event" in rows
    brand_new = rows["Brand New Event"]
    assert brand_new["status"] == "code_unknown"
    assert brand_new["description"] == "fresh purpose"
    assert brand_new["event_count_30d"] == 0
    assert brand_new["event_count"] == 0
    assert brand_new["family"] == ""


def test_assembled_rows_carry_watchlist_status(monkeypatch, tmp_path):
    mon = tmp_path / "mon.yaml"
    mon.write_text(
        "watched_families: [win_onboarding]\n"
        'events:\n  - {event: "Sign Up Clicked", product: win, family: win_onboarding}\n'
        "dismissed: []\n"
    )
    monkeypatch.setattr(esa.aeh, "WATCHLIST", mon)

    # Empty code axis keeps this hermetic — assemble()'s code_csv=None path otherwise falls
    # through to the real committed provenance CSV, which may not exist in the test env.
    code_csv = tmp_path / "code.csv"
    code_csv.write_text("event_type\n")

    def fake_query(sql):
        return pd.DataFrame([
            {"event_type": "Sign Up Clicked", "govern_display_name": "Sign Up Clicked",
             "family": "win_onboarding", "first_seen_date": "2024-01-01",
             "last_seen_date": "2026-08-01", "event_count": 100, "event_count_30d": 5,
             "govern_description": "", "govern_tags": None},
        ])

    out = esa.assemble(date(2026, 8, 3), run_query=fake_query, code_csv=code_csv)
    assert "watchlist_status" in esa.COLUMNS
    assert out["rows"][0]["watchlist_status"] == "tracked"
