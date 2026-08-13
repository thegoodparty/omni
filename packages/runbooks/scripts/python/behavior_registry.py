"""The `behaviors:` key of monitored_events.yaml: what we are trying to measure (DATA-2316).

A behavior is a question plus the surfaces where it happens plus the event instrumenting each
surface. Validation fails the run loudly rather than degrading to empty coverage: silent
degradation is what made divergence() inert for a month, and a registry that quietly reports
zero surfaces would report perfect health.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import yaml

from analytics_event_health import WATCHLIST

BEHAVIOR_FIELDS = frozenset({
    "id", "question", "question_ref", "answers", "product", "okr", "surfaces",
    "superseded", "caveats", "asked_by", "review",
})
SURFACE_FIELDS = frozenset({"path", "label", "instrumented_by"})
PRODUCTS = frozenset({"win", "serve", "both"})


def load_behaviors(path: Path = WATCHLIST) -> list[dict]:
    """Absent key or absent file -> [], so the surface can land before any behavior exists."""
    path = Path(path)
    if not path.exists():
        return []
    doc = yaml.safe_load(path.read_text()) or {}
    return [row for row in (doc.get("behaviors", []) or []) if row.get("id")]


def instrumenting_events(behavior: dict) -> list[str]:
    """An explicit null instrumented_by means the surface is known-uninstrumented, which is
    how partial coverage is declared. It is a fact, not an absence to be filled in."""
    return [s["instrumented_by"] for s in behavior.get("surfaces") or [] if s.get("instrumented_by")]


def okr_list(behavior: dict) -> list[str]:
    okr = behavior.get("okr")
    if not okr:
        return []
    return [str(v) for v in okr] if isinstance(okr, list) else [str(okr)]


def _parse_date(value) -> date | None:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def validate_behaviors(
    behaviors: list[dict],
    *,
    catalog_event_types: set[str],
    watchlist_events: list[str],
    today: date | None = None,
) -> list[str]:
    """Return every problem found, so one run names all of them rather than one per fix cycle.

    Rule 8 is a hard failure and not a warning: during migration `events:` and `behaviors:`
    coexist, and a duplicated anchor is the one place they can silently contradict each other.
    """
    today = today or date.today()
    errors: list[str] = []
    seen_ids: set[str] = set()
    seen_refs: dict[str, str] = {}
    okr_seen: dict[str, str] = {}
    watchlist = set(watchlist_events)

    for b in behaviors:
        bid = b.get("id", "<missing id>")

        for field in sorted(set(b) - BEHAVIOR_FIELDS):
            errors.append(f"{bid}: unknown field {field!r}")

        if bid in seen_ids:
            errors.append(f"{bid}: duplicate id")
        seen_ids.add(bid)

        ref = b.get("question_ref")
        if ref:
            if ref in seen_refs and seen_refs[ref] != bid:
                errors.append(f"{bid}: duplicate question_ref {ref!r}, also on {seen_refs[ref]}")
            seen_refs.setdefault(ref, bid)

        surfaces = b.get("surfaces") or []
        # A behavior carrying a question_ref is an intake stub: the question was accepted before
        # anyone enumerated where it happens, which is legal and reads as uncovered downstream.
        # Without a ref there is no such excuse — the entry is just incomplete.
        if not surfaces and not ref:
            errors.append(f"{bid}: no surfaces declared")

        if b.get("product") not in PRODUCTS:
            errors.append(f"{bid}: product must be one of {sorted(PRODUCTS)}")

        if b.get("okr") and not surfaces:
            errors.append(f"{bid}: okr declared but the behavior has no surfaces")

        for okr in okr_list(b):
            if okr in okr_seen and okr_seen[okr] != bid:
                errors.append(f"{bid}: duplicate okr anchor {okr!r}, also on {okr_seen[okr]}")
            okr_seen.setdefault(okr, bid)

        for s in surfaces:
            for field in sorted(set(s) - SURFACE_FIELDS):
                errors.append(f"{bid}: surface has unknown field {field!r}")
            if not s.get("path"):
                errors.append(f"{bid}: surface missing path")
            if not s.get("label"):
                errors.append(f"{bid}: surface {s.get('path')} missing label")
            if "instrumented_by" not in s:
                errors.append(
                    f"{bid}: surface {s.get('path')} must set instrumented_by "
                    "(use null to declare it uninstrumented)"
                )
            name = s.get("instrumented_by")
            if name and name not in catalog_event_types:
                errors.append(f"{bid}: instrumented_by {name!r} is not in the Amplitude catalog")
            if name and name in watchlist:
                errors.append(
                    f"{bid}: {name!r} already migrated to a behavior; delete its events: row"
                )

        review = b.get("review") or {}
        last = _parse_date(review.get("last_reviewed"))
        if last is None:
            errors.append(f"{bid}: review.last_reviewed missing or not an ISO date")
        elif last > today:
            errors.append(f"{bid}: review.last_reviewed is in the future")
        if not review.get("reviewed_by"):
            errors.append(f"{bid}: review.reviewed_by missing")
        if not isinstance(review.get("interval_days"), int):
            errors.append(f"{bid}: review.interval_days must be an int")

    return errors
