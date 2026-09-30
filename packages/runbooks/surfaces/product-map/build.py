"""Build the product map page: the analytics event explorer's own template, with the
map's tree in place of the events table, producing the single-file artifact.

Usage:  python3 build.py   ->  product-map.html

One template for both pages is the point. The search, filters, question and area cards,
event card and "What's next" are the explorer's, so an improvement to any of them lands
on both pages from one change. What only the map has is `map.js` and `map.css` here,
passed in as page parts (see shared/partials.py).

Two inputs. The explorer snapshot, whole, because the map page searches every event the
explorer does. And `data/product-map.json`, the map's own rows: per-event status,
volume, route and anchor state for the events drawn on it.

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


def build() -> Path:
    own = json.loads((HERE / "data" / "product-map.json").read_text())
    doc = json.loads((EXPLORER / "data" / "event-explorer.json").read_text())
    doc["page"] = "map"
    doc["map"] = {"ev": own["ev"]}
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
    print(
        f"  snapshot {(doc.get('refreshed_at') or '')[:10]}: {len(own['ev'])} events on the map, "
        f"{len(doc['events'])} searchable"
    )
    return out


if __name__ == "__main__":
    build()
