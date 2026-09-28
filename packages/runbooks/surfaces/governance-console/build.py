"""Inline the snapshot into the console page, producing the single-file artifact.

Usage:  python3 build.py   ->  governance-console.html

Deliberately dependency-free: no uv, no credentials, no network. The scheduled
republish routine runs this with a bare interpreter, so it must not import the
governance modules (which pull in yaml, pandas and the Databricks SDK).
The snapshot itself is built separately by
scripts/python/governance_console_snapshot.py.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def inline_payload(doc) -> str:
    """JSON safe to embed in a <script> block. ``</`` would close the block early."""
    return json.dumps(doc, separators=(",", ":")).replace("</", "<\\/")


def build() -> Path:
    doc = json.loads((HERE / "data" / "governance-console.json").read_text())
    html = (HERE / "template.html").read_text().replace("__DATA__", inline_payload(doc))
    out = HERE / "governance-console.html"  # gitignored: derived from template + data
    out.write_text(html)

    counts = ", ".join(f"{q['queue']} {len(q['items'])}" for q in doc["queues"])
    print(f"wrote {out}  ({out.stat().st_size / 1024:.0f} KB)")
    print(f"  run {doc['run_date']}: {counts}")
    return out


if __name__ == "__main__":
    build()
