"""Weekly surface drift detector (DATA-2531).

Finds analytics events whose label (a `surface:` tag, else the name prefix) no longer
matches where the code can fire them, grades each finding by how much independent
evidence agrees, and records proposals in instrumentation_data/surface_drift.json for
the event health console's surface queue. Nothing here writes to Amplitude: triage
applies accepted rows through the event-metadata skill.
"""

from __future__ import annotations

import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

PY = Path(__file__).resolve().parent
sys.path.insert(0, str(PY))

import event_reach as er  # noqa: E402

SURFACE_TAG = "surface:"
ACTIONABLE = frozenset({"moved", "stale_area_name"})


def claimed_label(display_name: str, tags: Sequence[str]) -> tuple[str, str] | None:
    for tag in tags:
        if tag.startswith(SURFACE_TAG) and tag[len(SURFACE_TAG):].strip():
            return ("tag", er.slug(tag[len(SURFACE_TAG):]))
    if " - " in display_name:
        return ("prefix", display_name.split(" - ", 1)[0].strip())
    return None


def names_match(label_slug: str, name: str) -> bool:
    want, have = label_slug.split("-"), name.split("-")
    return any(have[i:i + len(want)] == want for i in range(len(have) - len(want) + 1))


def classify(label: tuple[str, str] | None, reach: er.Reach | None, *, known: Sequence[er.Area],
             flow_prefixes: set[str], prefix_areas: Mapping[str, str], count_30d: int) -> str:
    if reach is None:
        return "unclear"
    if label is None:
        return "unmapped"
    kind, raw = label
    if kind == "prefix" and raw in flow_prefixes:
        return "flow"
    if reach.dashboard_wide:
        return "dashboard_wide"
    if reach.gap_files or not reach.areas:
        return "unclear"
    aliased = kind == "prefix" and raw in prefix_areas
    target = prefix_areas[raw] if aliased else (raw if kind == "tag" else er.slug(raw))

    def hits(area: er.Area) -> bool:
        return target in area.names if aliased else any(names_match(target, n) for n in area.names)

    if any(hits(a) for a in reach.areas):
        return "consistent"
    segments = {s for r in reach.live_routes for s in r.strip("/").split("/") if s and not s.startswith("[")}
    if target in segments:
        return "stale_area_name"
    if any(hits(a) for a in known):
        return "moved_then_quiet" if count_30d == 0 else "moved"
    return "stale_area_name" if kind == "tag" else "unmapped"


def proposed_display_name(display_name: str, area: er.Area | None) -> str:
    if area is None:
        return ""
    rest = display_name.split(" - ", 1)[1] if " - " in display_name else display_name
    return f"{area.label} - {rest}"
