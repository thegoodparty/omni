"""Inline the snapshot and the shared partials into the standalone page, producing the
shareable artifact.

The Next.js prototype at ../ and this standalone page render the same snapshot; the
standalone one exists because it can be published as a single file and sent to
someone, with no server and no login. The palette, the event card and the usage
script come from packages/runbooks/surfaces/shared, so they are the same on the
product map and the event health console.

Usage:  python3 build.py   ->  analytics-event-explorer.html
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data" / "event-explorer.json"
SHARED = HERE.parents[4] / "runbooks" / "surfaces" / "shared"
sys.path.insert(0, str(SHARED))
from partials import inline, inline_payload  # noqa: E402

doc = json.loads(DATA.read_text())

html = inline((HERE / "template.html").read_text())
html = html.replace("__DATA__", inline_payload(doc))
out = HERE / "analytics-event-explorer.html"  # gitignored: derived from template + data
out.write_text(html)
print(f"wrote {out}  ({out.stat().st_size/1024:.0f} KB)")
print(f"  events {len(doc['events'])}, questions {len(doc['questions'])}, areas {len(doc['areas'])}")
