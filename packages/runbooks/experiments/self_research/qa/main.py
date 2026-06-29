"""self_research deterministic QA gate entrypoint (PMF QA-gate contract B/C).

OBSERVE-ONLY. This stage never blocks: it always exits 0 (a nonzero exit is
reserved for an actual crash) and prints a contract-C fragment array on stdout.

What it checks, mechanically and cheaply:
  1. Schema validity against the runner-written contract schema.
  2. Finding shape integrity — each finding carries a non-empty `source_extract`
     and an http(s) `source_url` (the sourced-or-silent floor the schema also
     enforces; re-asserted here so the grounding-rate metric is meaningful).
  3. Grounding rate — the fraction of findings whose `source_extract` is a
     verbatim (whitespace-normalized, case-folded) substring of an embedded
     source body, when the artifact carries one. The self_research artifact does
     NOT embed source bodies (the contract is claim + source_url + extract), so
     in the common case there is nothing on-artifact to substring-check against;
     the metric is reported as not-applicable rather than failed. The literal
     extract-on-page verification is the agent's own `verify_quote` gate at
     emit time (see instruction.md) — this stage reports, it does not re-fetch.

The gate runs `python3 main.py --artifact <p> --workspace <root>` with cwd set
to this materialized qa directory.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import jsonschema

STDOUT_CAP_BYTES = 1_000_000


def normalize(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


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
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"artifact at {artifact_path} is not valid JSON: {e}") from e


def check_finding_shape(findings: list[dict]) -> tuple[bool, str]:
    """Each finding must carry a non-empty source_extract and an http(s) source_url."""
    bad: list[int] = []
    for i, f in enumerate(findings):
        extract = (f.get("source_extract") or "").strip()
        url = (f.get("source_url") or "").strip()
        if not extract or not re.match(r"^https?://", url):
            bad.append(i)
    if bad:
        return False, f"findings missing source_extract / http(s) source_url at indices {bad[:10]}"
    return True, ""


def grounding_rate(findings: list[dict]) -> tuple[int, int]:
    """Count findings whose source_extract is a verbatim substring of an embedded
    source body, over the number that carry an embedded body to check against.

    self_research does not embed source bodies, so `checkable` is normally 0 and
    the rate is reported as not-applicable upstream.
    """
    grounded = 0
    checkable = 0
    for f in findings:
        body = f.get("source_body") or f.get("retrieved_text_or_snapshot")
        extract = f.get("source_extract")
        if not body or not extract:
            continue
        checkable += 1
        if normalize(extract) in normalize(body):
            grounded += 1
    return grounded, checkable


def build_fragments(artifact: dict, schema: dict) -> list[dict]:
    fragments: list[dict] = []

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

    findings = artifact.get("findings") or []

    shape_ok, shape_detail = check_finding_shape(findings)
    shape_frag: dict = {
        "name": "finding_shape",
        "passed": shape_ok,
        "type": "deterministic",
    }
    if not shape_ok:
        shape_frag["severity"] = "error"
        shape_frag["detail"] = shape_detail
    fragments.append(shape_frag)

    grounded, checkable = grounding_rate(findings)
    rate = grounded / checkable if checkable else None
    grounding_frag: dict = {
        "name": "grounding_rate",
        "passed": True,
        "type": "deterministic",
        "severity": "warning",
        "detail": (
            f"{grounded}/{checkable} findings grounded ({rate:.0%})"
            if checkable
            else f"not applicable — {len(findings)} findings carry no embedded source body to substring-check"
        ),
    }
    fragments.append(grounding_frag)

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
        description="self_research deterministic QA gate entrypoint.",
    )
    parser.add_argument("--artifact", required=True, help="Path to the artifact JSON to grade.")
    parser.add_argument("--workspace", required=True, help="Workspace root holding contract_schema.json.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    schema = load_schema(Path(args.workspace))
    artifact = load_artifact(Path(args.artifact))
    fragments = build_fragments(artifact, schema)
    print(cap_stdout(fragments))
    return 0


if __name__ == "__main__":
    sys.exit(main())
