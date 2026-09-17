"""Derive behavior coverage from event health (DATA-2316).

Coverage is derived and never authored, because a hand-written "we cover this" is exactly the
metadata that rots. An instrument counts as live only when the health monitor already called
it active; reusing that verdict keeps this layer byte-consistent with the digest and inherits
the DATA-2046 / DATA-2106 / DATA-2140 false-positive guards instead of re-deriving them. In
particular the DATA-2140 grace window already lives inside classify_status, so a 30-day window
straddling a retirement cannot make a behavior flap here.
"""

from __future__ import annotations

from behavior_registry import instrumenting_events

_LIVE_STATUSES = frozenset({"active"})
_ORPHAN_STATUSES = frozenset({"orphaned_firing"})


def is_live(event_type: str, records_by_type: dict[str, dict]) -> bool:
    """Live means health classified it active. Everything else — dormant, deprecating,
    retired, orphaned_firing, or absent from the catalog — is not a working instrument for
    the question this behavior answers."""
    rec = records_by_type.get(event_type)
    return bool(rec) and rec.get("status") in _LIVE_STATUSES


def surface_states(behavior: dict, records_by_type: dict[str, dict]) -> list[dict]:
    """`gap` means we said up front there is no instrument here. `dead` means we named one and
    it stopped working. Keeping them distinct is what lets the digest tell "never built" from
    "broke", which are different asks of different people."""
    out: list[dict] = []
    for s in behavior.get("surfaces") or []:
        name = s.get("instrumented_by")
        if not name:
            state = "gap"
        elif is_live(name, records_by_type):
            state = "live"
        else:
            state = "dead"
        out.append({
            "label": s.get("label", ""), "path": s.get("path", ""),
            "instrumented_by": name, "state": state,
        })
    return out


def behavior_state(behavior: dict, records_by_type: dict[str, dict]) -> dict:
    """Roll surface states up to one verdict.

    `orphaned` is checked only when nothing is live: instruments still firing with no working
    surface means a number in a dashboard is being produced by something we no longer
    understand, which is worse than a number we know is missing. When something IS live the
    behavior is still partially answerable, so partial wins.
    """
    surfaces = surface_states(behavior, records_by_type)
    live = [s for s in surfaces if s["state"] == "live"]
    names = instrumenting_events(behavior)

    if not surfaces:
        coverage = "uncovered"
    elif not live:
        orphaned = any(
            (records_by_type.get(n) or {}).get("status") in _ORPHAN_STATUSES for n in names
        )
        coverage = "orphaned" if orphaned else "uncovered"
    elif len(live) == len(surfaces):
        coverage = "covered"
    else:
        coverage = "partial"

    return {"id": behavior.get("id", ""), "coverage": coverage, "surfaces": surfaces}
