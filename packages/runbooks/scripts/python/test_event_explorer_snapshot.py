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


def test_a_declared_surface_tag_files_the_event():
    """The point of DATA-2532: an event's name and its filing are separate facts. Five
    events renamed in DATA-2525 fire from the dashboard while still called `Onboarding
    - …`, and the tag is what lets the card say so without renaming anything."""
    tagged = ees.area_of(
        "Onboarding - Office Step: Click Can't See Office", ["surface:campaign-details"]
    )
    assert tagged == "Campaign Details"
    # Same event, no tag: filed by what it is called, which is the wrong answer here and
    # is exactly why the tag exists.
    assert ees.area_of("Onboarding - Office Step: Click Can't See Office", []) == "Onboarding"


def test_the_prefix_still_files_the_events_nobody_has_tagged():
    assert ees.area_of("Voter Data - List Exported", ["product:win"]) == "Voter Data"
    assert ees.area_of("page", []) == "Uncategorised"
    # A tag reaches events whose names have no prefix at all — 99 of them today.
    assert ees.area_of("pro_upgrade_complete", ["surface:pro-upgrade"]) == "Pro Upgrade"


def test_an_empty_or_malformed_surface_tag_falls_back_rather_than_blanking_the_area():
    assert ees.area_of("Voter Data - List Exported", ["surface:"]) == "Voter Data"
    assert ees.area_of("Voter Data - List Exported", ["surface: "]) == "Voter Data"


def test_a_slug_is_capitalised_without_being_title_cased():
    """`10dlc` must not become `10Dlc`, and `v2` must not lose its shape."""
    assert ees.area_of("X - Y", ["surface:10dlc-compliance"]) == "10dlc Compliance"
    assert ees.area_of("X - Y", ["surface:onboarding-v2"]) == "Onboarding V2"


def test_the_first_surface_tag_wins_and_other_namespaces_are_ignored():
    area = ees.area_of("X - Y", ["product:win", "flag:beta", "surface:dashboard"])
    assert area == "Dashboard"


def test_the_tag_reaches_the_card_through_build_events():
    """area_of() being right is not enough: the tag has to survive the row-to-card
    projection, which is the line this change actually touched."""
    row = _assembler_row(
        event="Onboarding - Office Step: Click Can't See Office",
        event_type="Onboarding - Office Step: Click Can't See Office",
        tags="product:win, surface:campaign-details",
    )
    card = ees.build_events(
        [{k: ees._cell(v) for k, v in row.items()}], anchors={}, series={}
    )[0]
    assert card["area"] == "Campaign Details"
    # The tag is still on the card, so the page can show why it is filed there.
    assert "surface:campaign-details" in card["tags"]
