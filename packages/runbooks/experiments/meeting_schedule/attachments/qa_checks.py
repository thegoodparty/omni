"""meeting_schedule deep QA — schema + deterministic checks the runner's shim can't express.

Ships as a manifest attachment (`experiments/meeting_schedule/attachments/qa_checks.py`),
gets dropped into `/workspace/qa_checks.py` by the runner. The agent runs this AFTER the
generic schema-only validator at /workspace/validate_output.py for full coverage.

Why a separate file: the runner reserves `/workspace/validate_output.py` for its own
generic schema-validation shim. Experiment-specific deterministic QA — semantic checks
the JSON Schema cannot express — has to live under a non-reserved basename and be
invoked separately.

Two phases:
  1. JSON Schema validation (re-runs the generic check so this file is sufficient on its own).
  2. Deterministic QA checks the schema cannot express:
       - discovered_schedule_location quality (no placeholders, no per-meeting deep links)

No LLM calls. No external API requirements. Runs in well under a second.

Exit codes:
  0  artifact is schema-valid AND all deterministic QA checks passed
  1  schema validation failed
  2  schema valid but one or more QA checks failed

Run:
  python3 /workspace/qa_checks.py                              # defaults to /workspace/output/meeting_schedule.json
  python3 /workspace/qa_checks.py path/to/artifact.json
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import jsonschema
except ImportError:
    print("FATAL: jsonschema not installed. Run: uv add jsonschema", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Locate inputs
#
# Runtime: at /workspace/qa_checks.py, schema is at /workspace/contract_schema.json
# (the runner extracts it from manifest.output_schema and writes it there).
#
# CI / local dev: this file lives at experiments/meeting_schedule/attachments/qa_checks.py,
# the manifest is two parents up at experiments/meeting_schedule/manifest.json. We try
# the runtime path first and fall back to the dev path so the same file works in both.
# ---------------------------------------------------------------------------

RUNTIME_SCHEMA_PATH = Path("/workspace/contract_schema.json")
DEV_MANIFEST_PATH = Path(__file__).resolve().parent.parent / "manifest.json"
DEFAULT_ARTIFACT_PATH = Path("/workspace/output/meeting_schedule.json")


def load_schema_from_manifest(manifest_path: Path | None = None) -> dict:
    """Load the output schema for validation.

    Argument is kept for backward compat with the test suite — callers can pass
    a specific manifest.json. Default resolution: prefer the runtime
    /workspace/contract_schema.json (already-extracted schema), otherwise fall
    back to manifest.json's output_schema field for dev/CI runs.
    """
    if manifest_path is not None:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        schema = manifest.get("output_schema")
        if not isinstance(schema, dict):
            raise RuntimeError(
                f"manifest.json at {manifest_path} is missing a dict-valued 'output_schema' field."
            )
        return schema

    if RUNTIME_SCHEMA_PATH.exists():
        schema = json.loads(RUNTIME_SCHEMA_PATH.read_text(encoding="utf-8"))
        if not isinstance(schema, dict):
            raise RuntimeError(
                f"{RUNTIME_SCHEMA_PATH} did not contain a dict-valued JSON schema."
            )
        return schema

    if DEV_MANIFEST_PATH.exists():
        manifest = json.loads(DEV_MANIFEST_PATH.read_text(encoding="utf-8"))
        schema = manifest.get("output_schema")
        if not isinstance(schema, dict):
            raise RuntimeError(
                f"manifest.json at {DEV_MANIFEST_PATH} is missing a dict-valued 'output_schema' field."
            )
        return schema

    raise RuntimeError(
        f"no schema source found: tried {RUNTIME_SCHEMA_PATH} and {DEV_MANIFEST_PATH}"
    )


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


@dataclass
class Finding:
    check: str
    severity: str  # "error" or "warning"
    message: str
    detail: Any = None


@dataclass
class Report:
    artifact_path: str
    schema_valid: bool
    schema_errors: list[str] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "error"]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "warning"]

    @property
    def passed(self) -> bool:
        return self.schema_valid and not self.errors


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------


def validate_schema(artifact: dict, schema: dict) -> list[str]:
    """Return a list of human-readable schema error messages. Empty list = valid."""
    validator = jsonschema.Draft7Validator(schema)
    errors = sorted(validator.iter_errors(artifact), key=lambda e: list(e.path))
    return [_format_schema_error(e) for e in errors]


def _format_schema_error(e: jsonschema.ValidationError) -> str:
    path = "/".join(str(p) for p in e.absolute_path) or "(root)"
    return f"[{path}] {e.message}"


# ---------------------------------------------------------------------------
# Deterministic checks
# ---------------------------------------------------------------------------


# Per-meeting deep-link signals. The schedule location should point at the
# PARENT page that lists the recurring schedule (city's meetings index, the
# municipal-code section, the streaming-platform calendar), NOT at one
# specific meeting's agenda PDF or one calendar event. Municipal-code PDFs
# (which sometimes ARE .pdf files) are fine, so a bare `.pdf` suffix isn't
# enough signal on its own — we match the per-meeting URL shapes specifically.
_PLACEHOLDER_LOCATIONS = frozenset({"tbd", "unknown", "n/a", "na", "none", "?", "-"})
_DEEP_LINK_HINTS = (
    "metaviewer.php",
    "meta_id=",
    "matters/",
    "legislationdetail.aspx",
    "eventitems",
    "meetingdetail.aspx",
    "/event/",
)


def check_discovered_schedule_location(artifact: dict, findings: list[Finding]) -> None:
    """discovered_schedule_location is the hint gp-api hands to the next run
    for the same office. Optional, but worth nudging when it looks wrong:
    missing on a found run, placeholder text, or a deep link to one specific
    meeting (instead of the parent page where the schedule lives).
    """
    status = artifact.get("status")
    location = artifact.get("discovered_schedule_location")

    if location is None:
        if status == "found":
            findings.append(Finding(
                "discovered_schedule_location.missing",
                "warning",
                "status='found' but discovered_schedule_location is null. "
                "Subsequent runs for this office will start from scratch. Set it to the "
                "parent page where the schedule was found (city's meetings index, the "
                "municipal-code section, or the streaming platform's calendar).",
            ))
        return

    if not isinstance(location, str):
        return

    stripped = location.strip()
    if stripped.lower() in _PLACEHOLDER_LOCATIONS or len(stripped) < 8:
        findings.append(Finding(
            "discovered_schedule_location.placeholder",
            "warning",
            f"discovered_schedule_location looks like a placeholder ('{stripped[:50]}'). "
            f"Either provide a real URL/prose or set it to null.",
        ))
        return

    low = stripped.lower()
    if any(hint in low for hint in _DEEP_LINK_HINTS):
        findings.append(Finding(
            "discovered_schedule_location.deep_link",
            "warning",
            f"discovered_schedule_location looks like a deep link to one specific "
            f"meeting ('{stripped[:120]}'). Prefer the parent page that codifies "
            f"the recurring schedule (municipal code section, city's meetings index, "
            f"or the streaming platform's calendar) so future runs can re-find the schedule.",
        ))


CHECKS = [
    check_discovered_schedule_location,
]


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def run(artifact_path: Path, manifest_path: Path | None = None) -> Report:
    schema = load_schema_from_manifest(manifest_path)
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))

    report = Report(artifact_path=str(artifact_path), schema_valid=False)

    report.schema_errors = validate_schema(artifact, schema)
    report.schema_valid = not report.schema_errors

    if report.schema_valid:
        for check in CHECKS:
            check(artifact, report.findings)

    return report


def print_report(report: Report) -> None:
    print(f"Artifact: {report.artifact_path}")
    print(f"Schema:   {'OK' if report.schema_valid else 'FAILED'}")

    if report.schema_errors:
        print()
        print(f"Schema errors ({len(report.schema_errors)}):")
        for err in report.schema_errors[:20]:
            print(f"  - {err}")
        if len(report.schema_errors) > 20:
            print(f"  ... and {len(report.schema_errors) - 20} more")
        return

    errors = report.errors
    warnings = report.warnings
    print(f"QA:       {len(errors)} error(s), {len(warnings)} warning(s)")

    if errors:
        print()
        print(f"Errors ({len(errors)}):")
        for f in errors:
            print(f"  - [{f.check}] {f.message}")

    if warnings:
        print()
        print(f"Warnings ({len(warnings)}):")
        for f in warnings:
            print(f"  - [{f.check}] {f.message}")

    print()
    if report.passed:
        print("VERDICT: PASS")
    else:
        print("VERDICT: FAIL")


def main() -> int:
    artifact_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_ARTIFACT_PATH
    if not artifact_path.exists():
        print(f"FATAL: artifact not found: {artifact_path}", file=sys.stderr)
        return 1

    report = run(artifact_path)
    print_report(report)

    if not report.schema_valid:
        return 1
    if report.errors:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
