"""race_opponent_summary deterministic QA gate entrypoint (PMF QA-gate contract).

OBSERVE-ONLY. Always exits 0 (a nonzero exit is reserved for an actual crash:
a missing schema file or a non-JSON / non-dict artifact root) and prints a
contract fragment array on stdout. Grading a successfully-loaded artifact is
wrapped so any degenerate-but-parseable shape degrades to a gate_error fragment
rather than crashing the gate.

What it checks, mechanically and cheaply, against the artifact alone:
  1. Schema validity against the runner-written contract schema.
  2. Attribution shape — every NON-null overview / background and every
     key_positions item carries at least one http(s) source_url. This is the
     sourced-or-silent invariant the schema requires (minItems:1, pattern), so
     a passing schema implies this; the explicit fragment makes the metric
     visible in the verdict.
  3. Attribution rate — fraction of emitted sections (overview, background, each
     key_positions item across all opponents) that carry at least one source.
     Metric only. The stronger "source_url is one of the INPUT source URLs"
     check the agent runs as its own spot-check needs the dispatch params, which
     this stage is not given; this stage reports what is checkable from the
     artifact and never re-fetches.

The gate runs `python3 main.py --artifact <p> --workspace <root>` with cwd set
to this materialized qa directory.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# jsonschema is a dev-group dependency; the deterministic runner may invoke this
# under a --no-dev environment. Degrade to skipping the schema fragment rather
# than crashing — the gate is observe-only and must still exit 0.
try:
    import jsonschema
except ImportError:
    jsonschema = None

STDOUT_CAP_BYTES = 1_000_000
HTTP_URL = re.compile(r"^https?://")


def validate_schema(artifact: dict, schema: dict) -> list[str]:
    validator = jsonschema.Draft7Validator(schema)
    return [
        f"{'/'.join(str(p) for p in e.path) or '<root>'}: {e.message}"
        for e in sorted(validator.iter_errors(artifact), key=lambda e: list(e.path))
    ]


def load_schema(workspace_root: Path) -> dict:
    schema_path = workspace_root / "contract_schema.json"
    if not schema_path.exists():
        raise RuntimeError(f"contract schema not found at {schema_path}")
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    if not isinstance(schema, dict):
        raise RuntimeError(f"{schema_path} did not contain a dict-valued JSON schema.")
    return schema


def load_artifact(artifact_path: Path) -> dict:
    try:
        text = artifact_path.read_text(encoding="utf-8")
    except FileNotFoundError as e:
        raise RuntimeError(f"artifact not found at {artifact_path}") from e
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"artifact at {artifact_path} is not valid JSON: {e}") from e
    if not isinstance(parsed, dict):
        raise RuntimeError(
            f"artifact at {artifact_path} is valid JSON but not a dict "
            f"(got {type(parsed).__name__})"
        )
    return parsed


def has_valid_sources(section: dict) -> bool:
    if not isinstance(section, dict):
        return False
    sources = section.get("sources") or []
    return bool(sources) and all(
        isinstance(u, str) and bool(HTTP_URL.match(u)) for u in sources
    )


def collect_sections(artifact: dict) -> list[dict]:
    """Every emitted (non-null) section that must carry attribution."""
    sections: list[dict] = []
    for opp in artifact.get("opponents") or []:
        if not isinstance(opp, dict):
            continue
        for key in ("overview", "background"):
            section = opp.get(key)
            if section is not None:
                sections.append(section)
        sections.extend(opp.get("key_positions") or [])
    return sections


def collect_analysis_items(artifact: dict) -> list[dict]:
    """The Phase 3 analytical items whose sourcing is RELAXED (cite where
    direct). Unlike collect_sections these may legitimately carry no source,
    so they feed an observe-only rate metric, never the strict shape check."""
    items: list[dict] = []
    for opp in artifact.get("opponents") or []:
        if not isinstance(opp, dict):
            continue
        items.extend(opp.get("where_soft") or [])
        items.extend(opp.get("what_you_need_to_know") or [])
        for contrast in opp.get("issue_contrasts") or []:
            if isinstance(contrast, dict):
                items.append({"sources": contrast.get("opponent_sources")})
    return items


def build_fragments(artifact: dict, schema: dict) -> list[dict]:
    fragments: list[dict] = []

    if jsonschema is None:
        fragments.append({
            "name": "schema_valid",
            "passed": False,
            "type": "deterministic",
            "severity": "warning",
            "detail": "skipped — jsonschema not installed in the gate environment",
        })
        if not isinstance(artifact.get("opponents"), list):
            fragments.append({
                "name": "opponents_present",
                "passed": False,
                "type": "deterministic",
                "severity": "error",
                "detail": "opponents field is missing or not a list — cannot grade further without schema validation",
            })
            return fragments
    else:
        schema_errors = validate_schema(artifact, schema)
        schema_valid = not schema_errors
        schema_frag: dict = {
            "name": "schema_valid",
            "passed": schema_valid,
            "type": "deterministic",
        }
        if not schema_valid:
            schema_frag["severity"] = "error"
            schema_frag["detail"] = "; ".join(schema_errors[:20])
        fragments.append(schema_frag)
        if not schema_valid:
            return fragments

    # An empty opponents array clears the schema fragment when jsonschema is
    # unavailable; fail it explicitly so a truncated response that drops every
    # opponent never reads as a clean pass.
    opponents = artifact.get("opponents") or []
    present_ok = len(opponents) > 0
    present_frag: dict = {
        "name": "opponents_present",
        "passed": present_ok,
        "type": "deterministic",
    }
    if not present_ok:
        present_frag["severity"] = "error"
        present_frag["detail"] = "artifact has zero opponents"
        fragments.append(present_frag)
        return fragments
    fragments.append(present_frag)

    sections = collect_sections(artifact)
    attributed = sum(1 for s in sections if has_valid_sources(s))
    total = len(sections)
    shape_ok = attributed == total

    shape_frag: dict = {
        "name": "attribution_shape",
        "passed": shape_ok,
        "type": "deterministic",
    }
    if not shape_ok:
        shape_frag["severity"] = "error"
        shape_frag["detail"] = (
            f"{total - attributed}/{total} emitted sections lack a valid http(s) source_url"
        )
    fragments.append(shape_frag)

    rate = attributed / total if total else None
    fragments.append({
        "name": "attribution_rate",
        "passed": True,
        "type": "deterministic",
        "severity": "warning",
        "detail": (
            f"{attributed}/{total} emitted sections carry a source ({rate:.0%})"
            if total
            else "not applicable — no sections emitted (all opponents ungroundable)"
        ),
    })

    # Phase 3 analytical items (where_soft, what_you_need_to_know,
    # issue_contrasts) use relaxed sourcing — cite where direct. Report the
    # citation rate as an observe-only metric; never fail the shape check on a
    # relaxed item that legitimately omits a source.
    analysis_items = collect_analysis_items(artifact)
    analysis_sourced = sum(1 for s in analysis_items if has_valid_sources(s))
    analysis_total = len(analysis_items)
    analysis_rate = analysis_sourced / analysis_total if analysis_total else None
    fragments.append({
        "name": "analysis_sourcing_rate",
        "passed": True,
        "type": "deterministic",
        "severity": "warning",
        "detail": (
            f"{analysis_sourced}/{analysis_total} analytical items "
            f"(where_soft + what_you_need_to_know + issue contrasts) cite a "
            f"source ({analysis_rate:.0%}) — relaxed, optional by design"
            if analysis_total
            else "not applicable — no analytical items emitted"
        ),
    })

    # The "exactly one primary_threat for a normal field" invariant the
    # instruction states. JSON Schema draft-07 can't express a cross-item count,
    # so this deterministic fragment is the only enforcement layer (the LLM judge
    # scores it editorially but is not a gate).
    primary_threat_count = sum(
        1
        for opp in opponents
        if isinstance(opp, dict) and opp.get("threat_tier") == "primary_threat"
    )
    primary_threat_ok = primary_threat_count == 1
    primary_frag: dict = {
        "name": "primary_threat_count",
        "passed": primary_threat_ok,
        "type": "deterministic",
    }
    if not primary_threat_ok:
        primary_frag["severity"] = "error"
        primary_frag["detail"] = (
            f"expected exactly 1 primary_threat across the field, "
            f"got {primary_threat_count}"
        )
    fragments.append(primary_frag)

    return fragments


def cap_stdout(fragments: list[dict]) -> str:
    out = json.dumps(fragments)
    if len(out.encode("utf-8")) > STDOUT_CAP_BYTES:
        for frag in fragments:
            frag.pop("detail", None)
        out = json.dumps(fragments)
    return out


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="main.py",
        description="race_opponent_summary deterministic QA gate entrypoint.",
    )
    parser.add_argument("--artifact", required=True, help="Path to the artifact JSON to grade.")
    parser.add_argument("--workspace", required=True, help="Workspace root holding contract_schema.json.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    # load_schema / load_artifact raise on a missing file or non-JSON / non-dict
    # input — those are real crashes the engine records (nonzero exit). Grading a
    # successfully-loaded artifact must NOT crash on any degenerate-but-parseable
    # shape: the gate is observe-only, so wrap it and degrade to a gate_error
    # fragment at exit 0 rather than letting an unexpected exception escape.
    schema = load_schema(Path(args.workspace))
    artifact = load_artifact(Path(args.artifact))
    try:
        fragments = build_fragments(artifact, schema)
    except Exception as e:  # noqa: BLE001 — observe-only: never crash on grading
        fragments = [{
            "name": "gate_error",
            "passed": False,
            "type": "deterministic",
            "severity": "error",
            "detail": f"{type(e).__name__}: {e}",
        }]
    print(cap_stdout(fragments))
    return 0


if __name__ == "__main__":
    sys.exit(main())
