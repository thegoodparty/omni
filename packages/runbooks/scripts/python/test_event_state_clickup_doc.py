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
    assert "1 events" in md or "1 event" in md         # count surfaced


def test_render_markdown_escapes_pipes_in_cells():
    rows = [dict(SAMPLE_ROWS[0], description="a | b")]
    md = doc.render_markdown(rows, SAMPLE_META)
    # a literal pipe inside a cell must be escaped so it does not break the column
    assert "a \\| b" in md
