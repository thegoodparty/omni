"""Stub Fargate entrypoint for the Reader.

This story (the case scout service scaffold) wires the task definition and
IAM role the Reader runs under — see infrastructure/modules/case-scout — but
not the Reader's own logic: reading the Databricks view, segmenting sessions,
scoring on Opus, drafting and gating (TDD section 3) all arrive with the
Reader stories that follow. Until then this entrypoint only confirms the
container starts, runs under its own task role, and exits cleanly, so the
task definition itself is exercised end to end.
"""

import os


def main() -> None:
    environment = os.environ.get("ENVIRONMENT", "unknown")
    print(f"case_scout Reader ({environment}): stub entrypoint, no pipeline wired yet.")


if __name__ == "__main__":
    main()
