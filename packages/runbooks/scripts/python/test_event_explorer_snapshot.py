"""The explorer page renders this JSON and nothing else, so every value in it has to be
JSON-safe. The assembler hands back real dates and Nones where the Google Sheet handed
back strings; that difference broke the build the first time the page read the pipeline
instead of the sheet, silently for every column a future change adds."""

import json
from datetime import date, datetime

import event_explorer_snapshot as ees
import event_state_assembler as esa


def test_cells_flatten_to_json_safe_values():
    assert ees._cell(None) == ""
    assert ees._cell(date(2026, 9, 24)) == "2026-09-24"
    assert ees._cell(datetime(2026, 9, 24, 11, 30)) == "2026-09-24T11:30:00"
    assert ees._cell(7) == 7
    assert ees._cell("Voter Data - List Exported") == "Voter Data - List Exported"


def _assembler_row(**over):
    """One row shaped like the assembler's, with the awkward types it really emits."""
    row = {c: "" for c in esa.COLUMNS}
    row.update({
        "event": "Voter Data - List Exported",
        "event_type": "Voter Data - List Exported",
        "status": "active",
        "event_count_30d": 12,
        "event_count": 340,
        "last_seen_date": date(2026, 9, 23),
        "first_seen_date": None,
        "tags": "product:win",
        "questions": "How many candidates export a voter file each week?",
    })
    row.update(over)
    return row


def test_every_event_field_survives_json_round_trip():
    events = ees.build_events(
        [{k: ees._cell(v) for k, v in _assembler_row().items()}], anchors={}, series={}
    )
    assert json.loads(json.dumps(events)) == events
    e = events[0]
    assert e["last_seen"] == "2026-09-23"
    assert e["first_seen"] == ""
    assert e["count_30d"] == 12
    assert e["tags"] == ["product:win"]


def test_a_new_assembler_column_cannot_smuggle_in_a_date():
    """The page's contract is not the column list, it is the types. A column added
    upstream arrives here without anyone editing this file, so assert on the shape."""
    row = _assembler_row(intent_date=date(2026, 1, 2))
    flat = {k: ees._cell(v) for k, v in row.items()}
    assert all(isinstance(v, (str, int, float)) for v in flat.values())
