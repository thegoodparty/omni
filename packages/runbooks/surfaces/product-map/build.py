"""Inline the map's data and the shared partials into the product map page, producing
the single-file artifact.

Usage:  python3 build.py   ->  product-map.html

Two inputs. `data/product-map.json` is the map's own: the per-event row data the
prototype was seeded with (status, volume, route, anchor state) and the week labels.
The event cards come from the explorer snapshot, lifted the same way the console lifts
them, so the card a person opens here is the card they would open there.

Deliberately dependency-free, like the other two builds: a bare interpreter, no
credentials, no network.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "shared"))
from partials import inline, inline_payload  # noqa: E402

EXPLORER = (
    HERE.parents[2] / "prototypes/app/p/analytics-event-explorer/data/event-explorer.json"
)

# The same fields the console carries on its cards (governance_console_snapshot.CARD_FIELDS).
# Copied rather than imported because that module pulls in the governance stack.
CARD_FIELDS = (
    "display_name", "area", "description", "status", "fires_on", "url",
    "fires_on_source", "anchor_confidence", "anchor_flag_reason",
    "count_30d", "count_total", "last_seen", "first_seen", "series",
    "tags", "okr", "supersession", "declared_intent", "watchlist_status",
    "questions", "used_by", "provenance",
)


def event_cards(explorer: dict, wanted: set[str]) -> dict:
    cards = {}
    for event in explorer.get("events") or []:
        name = event.get("event_type")
        if name in wanted:
            cards[name] = {k: event[k] for k in CARD_FIELDS if k in event}
    return cards


def build() -> Path:
    own = json.loads((HERE / "data" / "product-map.json").read_text())
    explorer = json.loads(EXPLORER.read_text())
    doc = {
        "weeks": own["weeks"],
        "ev": own["ev"],
        "series_weeks": explorer.get("series_weeks") or own["weeks"],
        "event_cards": event_cards(explorer, set(own["ev"])),
        "snapshot": (explorer.get("refreshed_at") or "")[:10],
    }
    html = inline((HERE / "template.html").read_text())
    html = html.replace("__DATA__", inline_payload(doc))
    out = HERE / "product-map.html"  # gitignored: derived from template + data
    out.write_text(html)
    print(f"wrote {out}  ({out.stat().st_size / 1024:.0f} KB)")
    print(
        f"  snapshot {doc['snapshot']}: {len(doc['ev'])} events on the map, "
        f"{len(doc['event_cards'])} with a card"
    )
    return out


if __name__ == "__main__":
    build()
