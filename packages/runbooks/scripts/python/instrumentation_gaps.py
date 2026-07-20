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


# --- enumeration: routes ------------------------------------------------------

_APP_PREFIX = "packages/gp-webapp/app"


def route_pattern_from_page_path(rel_path: str) -> str:
    """`.../app/dashboard/[slug]/page.tsx` -> `/dashboard/[slug]`. Route groups like
    `(marketing)` are organizational, not URL segments, so they drop out."""
    inner = rel_path[len(_APP_PREFIX):].removeprefix("/")
    parts = inner.split("/")
    parts = parts[:-1]  # drop the trailing page.tsx
    segs = [p for p in parts if not (p.startswith("(") and p.endswith(")"))]
    return "/" + "/".join(segs) if segs else "/"


def enumerate_route_surfaces(
    page_rel_paths: Iterable[str], exclude_globs: Sequence[str]
) -> list[dict]:
    """Every non-excluded `app/**/page.tsx` becomes a route surface keyed by URL pattern."""
    out: list[dict] = []
    for rel in sorted(page_rel_paths):
        if not rel.endswith("/page.tsx") or is_excluded(rel, exclude_globs):
            continue
        out.append(
            {"id": route_pattern_from_page_path(rel), "surface_type": "route", "location": rel}
        )
    return out


# --- enumeration: in-file heuristic detectors --------------------------------
# Intentionally over-inclusive. False positives are expected and are the Phase-2 judgment
# pass's job to drop; here they only need to be caught, not adjudicated.

_WEBAPP_DETECTORS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("wizard_stage", re.compile(r"\bcurrentStep\b|\bsetCurrentStep\b|<Stepper\b|useWizard\b")),
    ("form_submit", re.compile(r"onSubmit=\{|\bhandleSubmit\b")),
    ("cta", re.compile(r"<Button\b[^>]*onClick=")),
)
_API_DETECTORS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("api_job", re.compile(r"@Processor\(|@Process\(|\.process\(")),
    ("api_webhook", re.compile(r"@Post\(\s*['\"][^'\"]*webhook", re.IGNORECASE)),
    ("api_status", re.compile(r"status\s*[:=]\s*['\"](COMPLETED|FAILED|REJECTED|APPROVED)['\"]")),
)


def detect_surfaces_in_file(rel_path: str, text: str) -> list[dict]:
    """Run the path-appropriate detectors over one file's text. One surface per matched
    detector type (not per match) — the coarse unit here is 'this file has a wizard', which
    the judgment pass later refines. In-file surfaces have no URL, so they key on
    path#surface_type (the spec's path-plus-symbol fallback)."""
    if rel_path.startswith("packages/gp-webapp/"):
        detectors = _WEBAPP_DETECTORS
    elif rel_path.startswith("packages/gp-api/"):
        detectors = _API_DETECTORS
    else:
        return []
    out: list[dict] = []
    for surface_type, pattern in detectors:
        if pattern.search(text):
            out.append(
                {
                    "id": f"{rel_path}#{surface_type}",
                    "surface_type": surface_type,
                    "location": rel_path,
                }
            )
    return out


# --- call-site diff -----------------------------------------------------------

_TRACKING_RE = re.compile(r"\btrackEvent\(|\bAnalyticsService\b|\.track\(")


def has_tracking_call(text: str) -> bool:
    """Whether a file fires any analytics event (frontend trackEvent or backend track)."""
    return _TRACKING_RE.search(text) is not None


def find_gaps(surfaces: Sequence[dict], files_with_tracking: set[str]) -> list[dict]:
    """A candidate surface whose file fires no event is a candidate gap (file-level, Phase 1)."""
    return [s for s in surfaces if s["location"] not in files_with_tracking]


# --- ranking (heuristic; replaced/augmented by the LLM judge in Phase 2) ------

_RANK_BY_TYPE = {
    "wizard_stage": 0,  # URL-stable stages RouteTracker cannot see — highest value
    "api_status": 1,
    "api_job": 1,
    "form_submit": 2,
    "api_webhook": 2,
    "route": 3,
    "cta": 4,
}


def rank_gap(gap: Mapping) -> int:
    """Lower = higher priority, ordered by the rubric's value hierarchy."""
    return _RANK_BY_TYPE.get(gap["surface_type"], 5)
