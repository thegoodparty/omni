import textwrap
from datetime import date

import behavior_registry as br

TODAY = date(2026, 8, 13)
VALID = {
    "id": "voter_file_exported",
    "question": "How many candidates export a voter file each week?",
    "question_ref": "86ak1111",
    "product": "win",
    "surfaces": [
        {"path": "a/b/One.tsx", "label": "crm", "instrumented_by": "Voter Data - List Exported"},
        {"path": "a/b/Two.tsx", "label": "outreach", "instrumented_by": None},
    ],
    "review": {"interval_days": 90, "last_reviewed": "2026-08-13", "reviewed_by": "t@goodparty.org"},
}
CATALOG = {"Voter Data - List Exported"}


def _errs(*behaviors, watchlist=()):
    return br.validate_behaviors(
        list(behaviors), catalog_event_types=CATALOG,
        watchlist_events=list(watchlist), today=TODAY,
    )


def test_load_behaviors_missing_key_returns_empty(tmp_path):
    path = tmp_path / "m.yaml"
    path.write_text("watched_families: []\nevents: []\n")
    assert br.load_behaviors(path) == []


def test_load_behaviors_reads_rows(tmp_path):
    path = tmp_path / "m.yaml"
    path.write_text(textwrap.dedent("""
        behaviors:
          - id: a
            question: Q
            product: win
            surfaces:
              - {path: x.tsx, label: one, instrumented_by: "E"}
            review: {interval_days: 90, last_reviewed: 2026-08-13, reviewed_by: t@goodparty.org}
    """))
    assert [r["id"] for r in br.load_behaviors(path)] == ["a"]


def test_valid_behavior_produces_no_errors():
    assert _errs(VALID) == []


def test_rule_1_duplicate_id():
    assert any("duplicate id" in e and "voter_file_exported" in e for e in _errs(VALID, VALID))


def test_rule_2_empty_surfaces():
    assert any("no surfaces" in e for e in _errs(VALID | {"surfaces": []}))


def test_rule_3_instrumented_by_absent_from_catalog():
    bad = VALID | {"surfaces": [{"path": "x.tsx", "label": "l", "instrumented_by": "Typo"}]}
    assert any("not in the Amplitude catalog" in e and "Typo" in e for e in _errs(bad))


def test_rule_4_okr_without_surfaces():
    assert any("okr" in e for e in _errs(VALID | {"surfaces": [], "okr": "Active Candidates"}))


def test_rule_5_future_last_reviewed():
    bad = VALID | {"review": dict(VALID["review"], last_reviewed="2099-01-01")}
    assert any("in the future" in e for e in _errs(bad))


def test_rule_6_unknown_field():
    assert any("unknown field" in e and "quesion" in e for e in _errs(VALID | {"quesion": "typo"}))


def test_rule_7_duplicate_okr_anchor():
    a = VALID | {"okr": "Active Candidates"}
    b = VALID | {"id": "other", "question_ref": "86ak2222", "okr": "Active Candidates"}
    assert any("duplicate okr anchor" in e for e in _errs(a, b))


def test_rule_8_event_already_migrated_must_leave_the_events_key():
    assert any("already migrated" in e
               for e in _errs(VALID, watchlist=["Voter Data - List Exported"]))


def test_rule_9_duplicate_question_ref():
    b = VALID | {"id": "other"}
    assert any("duplicate question_ref" in e for e in _errs(VALID, b))


def test_explicit_null_instrumented_by_is_valid_but_missing_key_is_not():
    bad = VALID | {"surfaces": [{"path": "x.tsx", "label": "l"}]}
    assert any("must set instrumented_by" in e for e in _errs(bad))


def test_instrumenting_events_skips_nulls():
    assert br.instrumenting_events(VALID) == ["Voter Data - List Exported"]
