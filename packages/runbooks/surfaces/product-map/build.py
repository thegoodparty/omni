"""Build the product map page: the analytics event explorer's own template, with the
map's tree in place of the events table, producing the single-file artifact.

Usage:  python3 build.py   ->  product-map.html

One template for both pages is the point. The search, filters, question and area cards,
event card and "What's next" are the explorer's, so an improvement to any of them lands
on both pages from one change. What only the map has is `map.js` and `map.css` here,
passed in as page parts (see shared/partials.py).

Two inputs, both refreshed by the governance run. The explorer snapshot, whole: the map
searches every event the explorer does, and each step's status, volume and route come
from the same rows its cards render. And `event_anchors.json`, for the one fact the
snapshot does not carry: whether an event has an anchor record, and what kind.

Deliberately dependency-free, like the other two builds: a bare interpreter, no
credentials, no network.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "shared"))
from partials import inline, inline_payload  # noqa: E402

EXPLORER = HERE.parents[2] / "prototypes/app/p/analytics-event-explorer"
ANCHORS = HERE.parents[1] / "scripts/python/instrumentation_data/event_anchors.json"


def anchor_state(record) -> str:
    """ok | none | nosite | noroute, for the map's anchor tag.

    Any anchor that has not been dismissed counts, including ones still under review: the
    tag answers "is there a record of where this fires", and an open record is one. The
    kind is read from the record's own `url`, which says "n/a (...)" when there is no route
    and names the reason. Checked against all 105 hand-seeded rows it replaced: 105 agree.
    """
    if not record or record.get("disposition") == "dismissed":
        return "none"
    url = (record.get("url") or "").lower()
    if url.startswith("n/a"):
        return "nosite" if any(w in url for w in ("call site", "dynamic", "dispatch")) else "noroute"
    return "ok"


def build() -> Path:
    doc = json.loads((EXPLORER / "data" / "event-explorer.json").read_text())
    anchors = json.loads(ANCHORS.read_text())
    doc["page"] = "map"
    doc["map"] = {
        "anchor_state": {
            e["event_type"]: anchor_state(anchors.get(e["event_type"])) for e in doc["events"]
        }
    }
    html = inline(
        (EXPLORER / "standalone" / "template.html").read_text(),
        {
            "__PAGE_TITLE__": "Product map",
            "/* __MAP_CSS__ */": (HERE / "map.css").read_text(),
            "// __MAP_JS__": (HERE / "map.js").read_text(),
        },
    )
    html = html.replace("__DATA__", inline_payload(doc))
    out = HERE / "product-map.html"  # gitignored: derived from template + data
    out.write_text(html)
    print(f"wrote {out}  ({out.stat().st_size / 1024:.0f} KB)")
    print(f"  snapshot {(doc.get('refreshed_at') or '')[:10]}: {len(doc['events'])} events")
    return out


if __name__ == "__main__":
    build()
