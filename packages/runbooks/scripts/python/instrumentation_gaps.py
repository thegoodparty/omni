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

_TRACKING_RE = re.compile(r"\btrackEvent\s*\(|\bAnalyticsService\b|\.track\(")


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


# --- state + dispositions -----------------------------------------------------

_PERSISTENT = {"accepted", "dismissed"}


def merge_state(
    prior: Mapping[str, dict], gaps: Sequence[dict], today: date
) -> dict[str, dict]:
    """Fold this run's gaps into the prior disposition state. New surfaces enter as `new`;
    dismissed/accepted are never downgraded or resurrected; a surface absent this run is
    retained untouched (except it keeps its old last_seen). Keyed by user-facing surface id."""
    iso = today.isoformat()
    out: dict[str, dict] = {k: dict(v) for k, v in prior.items()}
    for gap in gaps:
        gid = gap["id"]
        rank = rank_gap(gap)
        if gid not in out:
            out[gid] = {
                "id": gid,
                "surface_type": gap["surface_type"],
                "location": gap["location"],
                "disposition": "new",
                "reason": "",
                "rank": rank,
                "first_seen": iso,
                "last_seen": iso,
            }
            continue
        entry = out[gid]
        entry["last_seen"] = iso
        entry["location"] = gap["location"]
        entry["surface_type"] = gap["surface_type"]
        entry["rank"] = rank
        # disposition is preserved for all states: new stays new until triaged, open/
        # accepted/dismissed are human decisions the sweep never overwrites.
    return out


def is_visible(entry: Mapping) -> bool:
    """The digest shows only untriaged (`new`) gaps. open collapses to a count line;
    accepted/dismissed are suppressed."""
    return entry.get("disposition") == "new"


def coverage_stats(state: Mapping[str, dict]) -> dict:
    counts = {"new": 0, "open": 0, "accepted": 0, "dismissed": 0}
    for entry in state.values():
        d = entry.get("disposition", "new")
        if d in counts:
            counts[d] += 1
    return {"tracked_gaps": len(state), **counts}


# --- digest rendering ---------------------------------------------------------


def render_gap_section(state: Mapping[str, dict], run_date: str, top_n: int = 10) -> str:
    """One dated markdown section for the gap sweep. Coverage line + ranked new-gaps table."""
    cov = coverage_stats(state)
    visible = sorted(
        (e for e in state.values() if is_visible(e)),
        key=lambda e: (e.get("rank", 5), e["id"]),
    )
    lines = [
        f"## {run_date}",
        "",
        "### Potential instrumentation gaps",
        "",
        f"Coverage: {cov['tracked_gaps']} tracked — {cov['new']} new, {cov['open']} open, "
        f"{cov['accepted']} accepted, {cov['dismissed']} dismissed.",
        "",
    ]
    if not visible:
        lines += ["No new gaps.", ""]
        return "\n".join(lines)
    shown = visible[:top_n]
    lines += [
        "| rank | surface | type | location |",
        "| --- | --- | --- | --- |",
    ]
    for e in shown:
        lines.append(f"| {e.get('rank', 5)} | {e['id']} | {e['surface_type']} | {e['location']} |")
    if len(visible) > top_n:
        lines.append(f"\n({len(visible) - top_n} more new gaps — see the state file.)")
    lines.append("")
    return "\n".join(lines)


# --- IO + CLI -----------------------------------------------------------------

_WEBAPP_ROOT = "packages/gp-webapp"
_API_ROOT = "packages/gp-api/src"
_SCAN_SUFFIXES = (".ts", ".tsx")


def load_state(path: Path | None) -> dict[str, dict]:
    """Read the disposition state, keyed by id. Missing/corrupt -> {} (never raises), so a
    bad hand-edit degrades to 'treat everything as new' instead of bricking the run."""
    if not path or not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


def _iter_files(repo_root: Path, sub: str, exclude_globs: Sequence[str]):
    base = repo_root / sub
    if not base.exists():
        return
    for p in base.rglob("*"):
        if not p.is_file() or p.suffix not in _SCAN_SUFFIXES:
            continue
        rel = p.relative_to(repo_root).as_posix()
        if is_excluded(rel, exclude_globs):
            continue
        yield rel, p


def scan_repo(repo_root: Path, exclude_globs: Sequence[str]) -> tuple[list[dict], set[str]]:
    """Walk gp-webapp + gp-api, returning all candidate surfaces and the set of files that
    fire at least one event."""
    surfaces: list[dict] = []
    files_with_tracking: set[str] = set()
    page_paths: list[str] = []
    for sub in (_WEBAPP_ROOT, _API_ROOT):
        for rel, path in _iter_files(repo_root, sub, exclude_globs):
            text = path.read_text(errors="replace")
            if has_tracking_call(text):
                files_with_tracking.add(rel)
            if rel.endswith("/page.tsx"):
                page_paths.append(rel)
            surfaces.extend(detect_surfaces_in_file(rel, text))
    surfaces.extend(enumerate_route_surfaces(page_paths, exclude_globs))
    return surfaces, files_with_tracking


def run_sweep(
    repo_root: Path, config_path: Path, state_path: Path | None, today: date
) -> tuple[dict, list[dict]]:
    cfg = load_gap_config(config_path)
    surfaces, tracked = scan_repo(repo_root, cfg["exclude_globs"])
    gaps = find_gaps(surfaces, tracked)
    new_state = merge_state(load_state(state_path), gaps, today)
    return new_state, gaps


def prepend_log(log_path: Path, section: str) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    existing = log_path.read_text() if log_path.exists() else ""
    match = re.search(r"^## \d{4}-\d{2}-\d{2}$", existing, re.MULTILINE)
    if match:
        log_path.write_text(existing[: match.start()] + section + "\n" + existing[match.start():])
    else:
        log_path.write_text(existing + ("\n" if existing else "") + section)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Instrumentation gap sweep (DATA-2151).")
    parser.add_argument("--repo", type=Path, default=None, help="repo root (default: $OMNI_REPO or inferred)")
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG)
    parser.add_argument("--no-log", action="store_true")
    parser.add_argument("--json", type=Path, help="also write the full state JSON here")
    parser.add_argument("--today", help="override run date YYYY-MM-DD")
    args = parser.parse_args(argv)

    repo_root = args.repo or Path(os.environ.get("OMNI_REPO", REPO_ROOT))
    today = datetime.strptime(args.today, "%Y-%m-%d").date() if args.today else date.today()

    # Graceful-skip contract: a scan/walk failure must never fail the governance run.
    try:
        new_state, _gaps = run_sweep(repo_root, args.config, args.state, today)
    except Exception as exc:  # noqa: BLE001 — unattended cron must not crash on a scan error
        print(f"gap-sweep: scan failed ({exc}); skipping this run, state untouched.", file=sys.stderr)
        return 0

    section = render_gap_section(new_state, today.isoformat())
    sys.stdout.write(section)
    if not args.no_log:
        prepend_log(args.log, section)
    _atomic_write(args.state, json.dumps(new_state, indent=2, sort_keys=True) + "\n")
    if args.json:
        args.json.write_text(json.dumps(new_state, indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
