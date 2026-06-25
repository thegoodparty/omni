"""meeting_briefing deterministic QA gate entrypoint (PMF QA-gate contract B/C).

THIN orchestrator. The checks themselves live in `qa_checks.py` (the single
source of truth, a sibling in this `qa/` folder); this file imports them and
shapes their output into the contract-C fragment array. It does NOT duplicate
any check logic.

At gate time the engine runs `python3 main.py --artifact <p> --workspace <root>`
with cwd set to this materialized qa directory, so the sibling `import qa_checks`
resolves with no path juggling.

What this orchestrator does:
  1. Parse `--artifact` / `--workspace`.
  2. Load the artifact JSON from `--artifact` (a read error is a crash:
     RuntimeError(...) from e, surfaced as a nonzero exit with a greppable lead
     line — the engine turns that into a synthetic `main_py_exit` fragment).
  3. Load the runner-written output schema from `<workspace>/contract_schema.json`
     (contract B guarantees it is present at gate time).
  4. Validate the artifact against the schema with qa_checks.validate_schema and,
     if schema-valid, run qa_checks.CHECKS to build the findings. This reuses
     qa_checks's pure pieces directly — it does NOT call qa_checks.run() (which
     carries the old hardcoded /workspace artifact path and a different signature).
  5. Map the Report to the contract-C fragment array: a `schema_valid` fragment;
     an error-severity finding -> passed:false; a warning-severity finding ->
     passed:true with a severity/detail note kept OUT of the pass calculation
     (preserving qa_checks's Report.passed semantics, where warnings never block).
  6. Print the array on stdout, capped at 1 MB (drop per-fragment detail if over).
  7. Exit 0 even when checks fail; a nonzero exit is reserved for an actual crash.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import qa_checks

# Reuse qa_checks's pure pieces BY IDENTITY — the single-source link. No copy of
# any check, dataclass, or the schema validator lives here.
Finding = qa_checks.Finding
Report = qa_checks.Report
validate_schema = qa_checks.validate_schema
CHECKS = qa_checks.CHECKS

STDOUT_CAP_BYTES = 1_000_000


def run_checks(artifact: dict, schema: dict) -> Report:
    """Build a Report by validating the artifact against the schema and, when
    schema-valid, running qa_checks.CHECKS. Mirrors qa_checks.run()'s phasing
    (schema gate first, then the 10 checks) WITHOUT calling it — qa_checks.run()
    reads the artifact off disk via a hardcoded path and has a different
    signature. We feed it the already-loaded artifact + the workspace-resolved
    schema instead.
    """
    report = Report(artifact_path="", schema_valid=False)
    report.schema_errors = validate_schema(artifact, schema)
    report.schema_valid = not report.schema_errors
    if report.schema_valid:
        for check in CHECKS:
            check(artifact, report.findings)
    return report


def load_schema(workspace_root: Path) -> dict:
    """Resolve the runner-written output schema from <workspace>/contract_schema.json.

    Contract B guarantees this file is present at gate time: the runner extracts
    it from manifest.output_schema during the agent phase and it persists on disk
    through the gate. A missing schema is a crash (nonzero exit).
    """
    schema_path = workspace_root / "contract_schema.json"
    if not schema_path.exists():
        raise RuntimeError(f"contract schema not found at {schema_path}")
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    if not isinstance(schema, dict):
        raise RuntimeError(f"{schema_path} did not contain a dict-valued JSON schema.")
    return schema


def load_artifact(artifact_path: Path) -> dict:
    """Read and parse the artifact JSON. A read/parse error becomes a RuntimeError
    carrying a greppable lead line (the path + cause) so the engine's nonzero-exit
    `main_py_exit` fragment has actionable context in stderr."""
    try:
        text = artifact_path.read_text(encoding="utf-8")
    except FileNotFoundError as e:
        raise RuntimeError(f"artifact not found at {artifact_path}") from e
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"artifact at {artifact_path} is not valid JSON: {e}") from e


def report_to_fragments(report: Report) -> list[dict]:
    """Map a Report to contract-C check fragments.

    - schema_valid: a deterministic fragment, passed iff the schema validated.
      When invalid (passed:false) the 10 checks were skipped upstream, so its
      detail carries the (truncated) schema errors and no check fragments follow.
    - error-severity Finding   -> passed:false fragment (severity 'error').
    - warning-severity Finding -> passed:true  fragment (severity 'warning';
      advisory, kept out of the pass calculation).
    """
    fragments: list[dict] = []

    schema_frag: dict = {
        "name": "schema_valid",
        "passed": report.schema_valid,
        "type": "deterministic",
    }
    if not report.schema_valid:
        schema_frag["severity"] = "error"
        schema_frag["detail"] = "; ".join(report.schema_errors[:20])
    fragments.append(schema_frag)

    if not report.schema_valid:
        return fragments

    for f in report.findings:
        is_error = f.severity == "error"
        fragments.append({
            "name": f.check,
            "passed": not is_error,
            "type": "deterministic",
            "severity": f.severity,
            "detail": f.message,
        })

    return fragments


def cap_stdout(fragments: list[dict]) -> str:
    """Serialize fragments to JSON, capped at STDOUT_CAP_BYTES (contract B).

    If the serialized payload exceeds the cap, the per-fragment `detail` field is
    dropped (the only unbounded passthrough field), keeping the load-bearing
    `name`/`passed`/`type`/`severity` fields. Returns the JSON string.
    """
    out = json.dumps(fragments)
    if len(out.encode("utf-8")) > STDOUT_CAP_BYTES:
        for frag in fragments:
            frag.pop("detail", None)
        out = json.dumps(fragments)
    return out


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="main.py",
        description="meeting_briefing deterministic QA gate entrypoint.",
    )
    parser.add_argument("--artifact", required=True, help="Path to the artifact JSON to grade.")
    parser.add_argument("--workspace", required=True, help="Workspace root holding contract_schema.json.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)

    schema = load_schema(Path(args.workspace))
    artifact = load_artifact(Path(args.artifact))

    report = run_checks(artifact, schema)
    fragments = report_to_fragments(report)

    print(cap_stdout(fragments))
    return 0


if __name__ == "__main__":
    sys.exit(main())
