"""Build the product map page: the analytics event explorer's own template, with the
map's tree in place of the events table, producing the single-file artifact.

Usage:  python3 build.py   ->  product-map.html

One template for both pages is the point. The search, filters, question and area cards,
event card and "What's next" are the explorer's, so an improvement to any of them lands
on both pages from one change. What only the map has is `map.js` and `map.css` here,
passed in as page parts (see shared/partials.py).

One input, refreshed by the governance run: the explorer snapshot, whole. The map
searches every event the explorer does, and each step's status, volume and route come
from the same rows its cards render.

Deliberately dependency-free, like the other two builds: a bare interpreter, no
credentials, no network.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "shared"))
from partials import inline, inline_payload  # noqa: E402

EXPLORER = HERE.parent / "event-explorer"
# The app's own list of dashboard areas. CI fails a PR that adds a nav tab without
# an entry here, so releases keep it current; the map takes its areas from it.
PRODUCT_MAP_TS = (
    HERE.parents[2] / "gp-api/src/chats/general/product-knowledge/productMap.ts"
)
AREA_BLOCKS = ("WIN_AREAS", "SERVE_AREAS", "CROSS_PRODUCT_AREAS", "SHARED_AREAS")
_STR = r"'((?:[^'\\]|\\.)*)'"


def product_areas(ts: str) -> list[dict]:
    """Each area's name, path and modes, read from productMap.ts.

    A regex read, not a TypeScript parse, so the build stays dependency-free. It
    raises rather than returning a short list, because an empty map looks like a
    product with no areas instead of a broken build.
    """
    areas = []
    for block in AREA_BLOCKS:
        m = re.search(rf"^const {block}: ProductArea\[\] = \[\n(.*?)^\]", ts, re.S | re.M)
        if not m:
            raise ValueError(f"productMap.ts: no {block} array")
        for obj in re.split(r"^  \{\n", m.group(1), flags=re.M)[1:]:
            name = re.search(rf"^    name: {_STR},$", obj, re.M)
            path = re.search(rf"^    path: {_STR},$", obj, re.M)
            modes = re.search(r"^    modes: \[([^\]]*)\],$", obj, re.M)
            if not (name and path and modes):
                raise ValueError(f"productMap.ts: an area in {block} lacks name, path or modes")
            if re.search(r"^    aliasOf:", obj, re.M):
                continue
            areas.append(
                {
                    "name": name.group(1).replace("\\'", "'"),
                    "path": path.group(1).replace("\\'", "'"),
                    "modes": re.findall(r"'(win|serve)'", modes.group(1)),
                }
            )
    if len(areas) < 10:
        raise ValueError(f"productMap.ts: only {len(areas)} areas read; the parser has drifted")
    return areas


def build() -> Path:
    doc = json.loads((EXPLORER / "data" / "event-explorer.json").read_text())
    doc["page"] = "map"
    doc["product_areas"] = product_areas(PRODUCT_MAP_TS.read_text())
    html = inline(
        (EXPLORER / "template.html").read_text(),
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
