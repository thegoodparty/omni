"""
qa_init.py — Scaffold an output/ folder with stub artifact files before a generation run.

Usage:
    uv run qa_init.py --product-id <id> --briefing-type <type> [--output-dir output/]

Creates output/ (or specified directory) with empty stubs for required artifacts.
Safe to re-run: existing files are NOT overwritten, so partial runs are not reset.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


REQUIRED_STUBS = ["briefing.json", "claims.json", "sources.json"]


def scaffold(product_id: str, briefing_type: str, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "source_snapshots").mkdir(exist_ok=True)

    audit_path = output_dir / "audit_meta.json"
    if not audit_path.exists():
        audit_meta = {
            "product_id": product_id,
            "briefing_type": briefing_type,
            "run_timestamp": datetime.now(timezone.utc).isoformat(),
            "generator": "",
            "briefing_path": str(output_dir / "briefing.json"),
            "claims_path": str(output_dir / "claims.json"),
            "sources_path": str(output_dir / "sources.json"),
            "qa_bundle_path": str(output_dir / "qa_bundle.json"),
            "final_status": None,
        }
        audit_path.write_text(json.dumps(audit_meta, indent=2))
        print(f"created {audit_path}")
    else:
        print(f"exists  {audit_path} (not overwritten)")

    for stub_file, stub_content in [
        ("briefing.json", {}),
        ("claims.json", []),
        ("sources.json", []),
    ]:
        path = output_dir / stub_file
        if not path.exists():
            path.write_text(json.dumps(stub_content, indent=2))
            print(f"created {path}")
        else:
            print(f"exists  {path} (not overwritten)")

    print(f"\nReady. Populate output artifacts during generation, then run:")
    print(f"  uv run qa_validate.py --output-dir {output_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--product-id", required=True, help="Unique run ID, e.g. chapel-hill-NC_2026-04-16")
    parser.add_argument("--briefing-type", required=True, help="Product type, e.g. meeting_briefing")
    parser.add_argument("--output-dir", default="output", help="Output directory to scaffold (default: output/)")
    args = parser.parse_args()

    scaffold(args.product_id, args.briefing_type, Path(args.output_dir))


if __name__ == "__main__":
    main()
