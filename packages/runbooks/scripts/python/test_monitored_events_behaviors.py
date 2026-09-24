"""The committed registry must always be valid. A broken behaviors: block that only failed at
run time would take the weekly digest down; failing here fails the PR instead."""

from datetime import date
from pathlib import Path

import yaml

import analytics_event_health as aeh
import behavior_registry as br
import sem_anchors as sa


def test_no_behavior_or_row_carries_the_retired_okr_key():
    doc = yaml.safe_load(aeh.WATCHLIST.read_text())
    rows = [r["event"] for r in doc.get("events") or [] if "okr" in r]
    behaviors = [b["id"] for b in doc.get("behaviors") or [] if "okr" in b]
    assert rows == [] and behaviors == []


def test_every_metric_pointer_names_a_declared_metric():
    fixtures = Path(aeh.__file__).parent / "fixtures"
    declared: dict = {}
    for name in ("sem_analytics__users_win.yml", "sem_analytics__users_serve.yml"):
        declared.update(sa.parse_anchors((fixtures / name).read_text()))
    pointed = {m for b in br.load_behaviors(aeh.WATCHLIST) for m in br.metric_list(b)}
    assert pointed <= set(declared), pointed - set(declared)


def test_committed_behaviors_are_structurally_valid():
    behaviors = br.load_behaviors(aeh.WATCHLIST)
    assert behaviors, "the registry is seeded; an empty behaviors: key is a regression"
    # catalog_event_types is the set of names the registry itself uses: rule 3 needs
    # Databricks and this test must run offline. The scheduled run checks it for real.
    named = {n for b in behaviors for n in br.instrumenting_events(b)}
    assert br.validate_behaviors(
        behaviors, catalog_event_types=named, watchlist_events=[], today=date.today()
    ) == []


def test_no_instrument_is_also_a_watchlist_row():
    _, watchlist_events, _ = aeh.load_watchlist(aeh.WATCHLIST)
    behaviors = br.load_behaviors(aeh.WATCHLIST)
    named = {n for b in behaviors for n in br.instrumenting_events(b)}
    assert named & set(watchlist_events) == set()


def test_every_surface_path_exists_in_the_repo():
    repo = Path(aeh.__file__).resolve().parents[4]
    missing = [
        s["path"]
        for b in br.load_behaviors(aeh.WATCHLIST)
        for s in (b.get("surfaces") or [])
        if not (repo / s["path"]).exists()
    ]
    assert missing == [], f"declared surfaces no longer in the repo: {missing}"


def test_the_composite_funnel_question_spans_three_behaviors():
    behaviors = br.load_behaviors(aeh.WATCHLIST)
    composite = [b for b in behaviors
                 if any("outreach on our platform" in a for a in b.get("answers") or [])]
    assert len(composite) == 3
