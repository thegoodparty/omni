"""Inline the snapshot into the standalone page, producing the shareable artifact.

The Next.js prototype at ../ and this standalone page render the same snapshot; the
standalone one exists because it can be published as a single file and sent to
someone, with no server and no login. Every page change has to land in both.

Usage:  python3 build.py   ->  analytics-event-explorer.html
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data" / "event-explorer.json"

doc = json.loads(DATA.read_text())

payload = json.dumps(doc, separators=(",", ":"))
# </script> inside a JSON string would close the block early.
payload = payload.replace("</", "<\\/")

html = (HERE / "template.html").read_text().replace("__DATA__", payload)
out = HERE / "analytics-event-explorer.html"  # gitignored: derived from template + data
out.write_text(html)
print(f"wrote {out}  ({out.stat().st_size/1024:.0f} KB)")
print(f"  events {len(doc['events'])}, questions {len(doc['questions'])}, areas {len(doc['areas'])}")
