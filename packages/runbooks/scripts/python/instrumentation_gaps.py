"""Instrumentation gap sweep (DATA-2151) — deterministic layer.

Enumerates candidate product surfaces in gp-webapp and gp-api, diffs them against
tracking call sites, and surfaces the ones with no nearby event as ranked recommendations
with disposition tracking. Recommendations only: never edits product packages.

Pure functions (config, enumeration, diff, id, rank, state merge, render) take plain data
and have no IO, so they are unit-tested with fixtures. Only the walk/IO/CLI layer touches
disk. Phase 1 (this module) is fully deterministic; the LLM rubric-judgment pass is Phase 2.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import sys
from collections.abc import Iterable, Mapping, Sequence
from datetime import date, datetime
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]  # python -> scripts -> runbooks -> packages -> omni
DATA_DIR = HERE / "instrumentation_data"
CONFIG_PATH = HERE / "instrumentation_gaps_config.yaml"
DEFAULT_STATE = DATA_DIR / "instrumentation_gaps.json"
DEFAULT_LOG = DATA_DIR / "instrumentation-gaps-log.md"


def load_gap_config(path: Path = CONFIG_PATH) -> dict:
    """Read the exclusion config. Missing file -> empty excludes (scan everything)."""
    if not path.exists():
        return {"exclude_globs": []}
    doc = yaml.safe_load(path.read_text()) or {}
    return {"exclude_globs": list(doc.get("exclude_globs", []) or [])}


def is_excluded(rel_path: str, exclude_globs: Sequence[str]) -> bool:
    """True if the repo-relative path matches any exclusion glob."""
    return any(fnmatch.fnmatch(rel_path, g) for g in exclude_globs)
