"""Pre-merge analytics governance guard (DATA-2432).

Compares the repo at the merge base with the PR head (or the working tree) and stops a
change that silently breaks an OKR instrument or leaves a dead event listing behind.

Blocks: any file losing a call site of a watched OKR leg; the page behind a path-qualified
leg removed; an OKR call-site file no longer imported; an event's last call site removed
while its registry key survives; a monitored_events.yaml surface path this change made
stale. Warns: a HubSpot-used backend event removed from the registry; a new event key with
a malformed name or no provenance row.

Exit codes: 0 nothing blocking, 2 blocking findings, 1 the guard itself failed. A guard
failure must never block a merge: CI and the hook both treat 1 as pass-with-alert.

Usage:
    uv run governance_guard.py check --base <ref> [--head <ref>] [--markdown out.md] [--json out.json]
    (no --head: compare against the working tree)
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import posixpath
import re
import subprocess
import sys
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Protocol

import yaml

import amplitude_event_provenance_backfill as prov
import guard_refs as gr
import sem_anchors as sa

REPO_ROOT = Path(__file__).resolve().parents[4]
WEB_REGISTRY = "packages/gp-webapp/helpers/analyticsHelper.ts"
API_REGISTRY = "packages/gp-api/src/vendors/segment/segment.types.ts"
WATCHLIST = "packages/runbooks/scripts/python/monitored_events.yaml"
PROVENANCE = "packages/runbooks/scripts/python/instrumentation_data/amplitude_event_provenance.csv"
SCAN_ROOTS = ("packages/gp-webapp/", "packages/gp-api/", "packages/gp-admin/")
SOURCE_SUFFIXES = (".ts", ".tsx", ".js", ".jsx")
# Same exclusions as the provenance walk and the anchor locator, so the guard and the
# weekly monitor agree on what a call site is.
_TEST_DIRS = frozenset({"node_modules", ".next", "__tests__", "__mocks__", "tests", "e2e"})
_TEST_SUFFIXES = (".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx", ".test.js", ".test.jsx")
_TEST_PREFIXES = ("test-", "test_")
_ROUTE_FILE_STEMS = frozenset({"page", "layout", "template", "default", "error", "loading",
                               "not-found", "route", "global-error"})
_WEB_APP = "packages/gp-webapp/app/"


class Tree(Protocol):
    def paths(self) -> set[str]: ...
    def read_many(self, paths: Iterable[str]) -> dict[str, str]: ...


class DictTree:
    def __init__(self, files: Mapping[str, str]):
        self._files = dict(files)

    def paths(self) -> set[str]:
        return set(self._files)

    def read_many(self, paths: Iterable[str]) -> dict[str, str]:
        return {p: self._files[p] for p in paths if p in self._files}


def _git(repo: Path, *args: str, stdin: bytes | None = None) -> bytes:
    return subprocess.run(["git", "-C", str(repo), *args], input=stdin,
                          capture_output=True, check=True).stdout


class GitTree:
    def __init__(self, repo: Path, ref: str):
        self.repo, self.ref = repo, ref
        self._paths = set(_git(repo, "ls-tree", "-r", "--name-only", ref).decode().splitlines())

    def paths(self) -> set[str]:
        return self._paths

    def read_many(self, paths: Iterable[str]) -> dict[str, str]:
        wanted = [p for p in paths if p in self._paths]
        if not wanted:
            return {}
        raw = _git(self.repo, "cat-file", "--batch",
                   stdin="".join(f"{self.ref}:{p}\n" for p in wanted).encode())
        out: dict[str, str] = {}
        pos = 0
        for p in wanted:
            end = raw.index(b"\n", pos)
            header = raw[pos:end].decode()
            pos = end + 1
            if header.endswith(" missing"):
                continue
            size = int(header.split()[2])
            out[p] = raw[pos:pos + size].decode("utf-8", "replace")
            pos += size + 1
        return out


class WorkTree:
    def __init__(self, root: Path):
        self.root = root
        listed = _git(root, "ls-files", "--cached", "--others", "--exclude-standard").decode()
        self._paths = {p for p in listed.splitlines() if (root / p).is_file()}

    def paths(self) -> set[str]:
        return self._paths

    def read_many(self, paths: Iterable[str]) -> dict[str, str]:
        return {p: (self.root / p).read_text(errors="replace") for p in paths if p in self._paths}


def _in_scope(path: str) -> bool:
    return path.startswith(SCAN_ROOTS) and path.endswith(SOURCE_SUFFIXES)


def _is_test(path: str) -> bool:
    name = path.rsplit("/", 1)[-1]
    return bool(_TEST_DIRS & set(path.split("/"))) or name.endswith(_TEST_SUFFIXES) \
        or name.startswith(_TEST_PREFIXES)


def _scope(path: str) -> str:
    return "api" if path.startswith("packages/gp-api/") else "web"


def _is_route_file(path: str) -> bool:
    stem = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return path.startswith(_WEB_APP) and stem in _ROUTE_FILE_STEMS


def page_route(path: str) -> str | None:
    if not path.startswith(_WEB_APP) or path.rsplit("/", 1)[-1].rsplit(".", 1)[0] != "page":
        return None
    parts = path[len(_WEB_APP):].split("/")[:-1]
    segs = [p for p in parts if not (p.startswith("(") and p.endswith(")"))]
    return "/" + "/".join(segs)


def hubspot_protected(text: str) -> set[str]:
    """Event names in segment.types.ts under a DO NOT MODIFY comment, at leaf or group."""
    out: set[str] = set()
    pending, depth, group_depth = False, 0, None
    for line in text.splitlines():
        st = line.strip()
        if st.startswith(("//", "*", "/*")):
            pending = pending or "DO NOT MODIFY" in st
            continue
        if re.match(r"[A-Za-z0-9_]+\s*:\s*\{", st):
            depth += 1
            if pending and group_depth is None:
                group_depth = depth
            pending = False
            continue
        if st.startswith("}"):
            if group_depth is not None and depth == group_depth:
                group_depth = None
            depth -= 1
            continue
        leaf = re.search(r"'([^']+)'", st)
        if leaf and (pending or group_depth is not None):
            out.add(leaf.group(1))
        if leaf:
            pending = False
    return out


def _resolve(importer: str, spec: str, paths: set[str]) -> str | None:
    root = "/".join(importer.split("/")[:2])
    if spec.startswith("."):
        cands = [posixpath.normpath(posixpath.join(posixpath.dirname(importer), spec))]
    elif spec.startswith("@/"):
        cands = [f"{root}/src/{spec[2:]}", f"{root}/{spec[2:]}"]
    elif spec.startswith("@shared/"):
        cands = [f"packages/gp-webapp/app/shared/{spec[len('@shared/'):]}"]
    else:
        cands = [f"{root}/{spec}", f"{root}/src/{spec}"]
    for c in cands:
        for suffix in ("", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"):
            if c + suffix in paths:
                return c + suffix
    return None


@dataclass
class Snapshot:
    files: dict[str, gr.FileRefs]
    all_paths: set[str]
    registries: dict[str, dict[str, str]]
    hubspot: set[str]
    watchlist: dict
    provenance_events: set[str]
    page_routes: set[str]
    _by_literal: dict[str, dict[str, int]] = field(default_factory=dict, repr=False)
    _by_key: dict[tuple[str, str], dict[str, int]] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        lit: dict[str, dict[str, int]] = defaultdict(dict)
        key: dict[tuple[str, str], dict[str, int]] = defaultdict(dict)
        for path, refs in self.files.items():
            for value, n in refs.literals.items():
                lit[value][path] = n
            for k, n in refs.key_paths.items():
                if n:
                    key[(_scope(path), k)][path] = n
        self._by_literal, self._by_key = dict(lit), dict(key)

    def registered(self) -> set[str]:
        return set(self.registries["web"]) | set(self.registries["api"])

    def has_key(self, name: str) -> bool:
        return name in self.registries["web"] or name in self.registries["api"]

    def files_for(self, name: str) -> dict[str, int]:
        out: Counter[str] = Counter(self._by_literal.get(name, {}))
        for scope, reg in self.registries.items():
            if name in reg:
                out.update(self._by_key.get((scope, reg[name]), {}))
        return {p: n for p, n in out.items() if n > 0}

    def count(self, name: str) -> int:
        return sum(self.files_for(name).values())

    def importers(self, target: str) -> list[str]:
        stem = target.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        parent = target.rsplit("/", 2)[-2]
        out = []
        for path, refs in self.files.items():
            if path == target:
                continue
            for spec in refs.imports:
                last = spec.rstrip("/").rsplit("/", 1)[-1]
                if last != stem and not (stem == "index" and last == parent):
                    continue
                if _resolve(path, spec, self.all_paths) == target:
                    out.append(path)
                    break
        return out


def build_snapshot(tree: Tree) -> Snapshot:
    paths = tree.paths()
    scan = sorted(p for p in paths if _in_scope(p) and not _is_test(p)
                  and p not in (WEB_REGISTRY, API_REGISTRY))
    texts = tree.read_many([*scan, WEB_REGISTRY, API_REGISTRY, WATCHLIST, PROVENANCE])
    api_text = texts.get(API_REGISTRY, "")
    provenance = {row["event_type"] for row in csv.DictReader(io.StringIO(texts.get(PROVENANCE, "")))
                  if row.get("event_type")}
    return Snapshot(
        files={p: gr.extract(texts[p]) for p in scan if p in texts},
        all_paths=paths,
        registries={"web": prov.parse_events_map(texts.get(WEB_REGISTRY, "")),
                    "api": prov.parse_events_map(api_text)},
        hubspot=hubspot_protected(api_text),
        watchlist=yaml.safe_load(texts.get(WATCHLIST, "")) or {},
        provenance_events=provenance,
        page_routes={r for p in paths if (r := page_route(p))},
    )


@dataclass(frozen=True)
class Finding:
    rule: str
    level: str
    event: str
    detail: str
    fix: str
    metrics: tuple[str, ...] = ()


_RETIRE_FIX = (
    "Delete its key from the EVENTS registry in this PR, then follow the "
    "instrument-analytics-event skill's 'When a change removes an event' steps "
    "(provenance upsert --direction retire, event-metadata RETIRE)."
)


def dead_listings(base: Snapshot, head: Snapshot) -> list[Finding]:
    out = []
    for name in sorted(head.registered()):
        if base.count(name) >= 1 and head.count(name) == 0:
            detail = "Its last call site was removed, but its registry key is still there."
            if name in head.hubspot:
                detail += " HubSpot workflows use this event; check them before merging."
            out.append(Finding("dead_listing", "block", name, detail, _RETIRE_FIX))
    return out


def hubspot_warnings(base: Snapshot, head: Snapshot) -> list[Finding]:
    return [
        Finding("hubspot_event_removed", "warn", name,
                "This backend event is used by HubSpot workflows and was removed from the registry.",
                "Check the HubSpot workflow that triggers on it (see segment.types.ts) before merging.")
        for name in sorted(base.hubspot) if not head.has_key(name)
    ]


def watched_legs(anchors: Mapping[str, Sequence[sa.Leg]]
                 ) -> tuple[dict[str, tuple[str, ...]], dict[tuple[str, str], tuple[str, ...]]]:
    """Event legs are guarded by call site; path legs by the page that serves the path. A
    path leg like `Viewed` on `/dashboard` is a generic page event, so counting its name
    across the codebase would measure nothing."""
    events: dict[str, set[str]] = defaultdict(set)
    paths: dict[tuple[str, str], set[str]] = defaultdict(set)
    for metric, legs in anchors.items():
        for leg in legs:
            if not leg.watched:
                continue
            if leg.path:
                paths[(leg.event, leg.path)].add(metric)
            else:
                events[leg.event].add(metric)
    return ({e: tuple(sorted(m)) for e, m in events.items()},
            {k: tuple(sorted(m)) for k, m in paths.items()})


def intent_fix(event: str, metrics: Sequence[str]) -> str:
    rows = "\n".join(
        f'  - {{metric: {m}, event: "{event}", intent: retire_activity, reason: "<why>", date: "YYYY-MM-DD"}}'
        for m in metrics
    )
    return (
        "This event counts toward an OKR, so say what is happening to the activity. Add one "
        "line per metric to the intents: block of packages/runbooks/scripts/python/"
        f"monitored_events.yaml:\n{rows}\n"
        "intent is one of: retire_activity (stop counting it), successor (add successor: "
        '"<event>"), relocated (add route: "/path"), not_a_change (the guard is wrong; '
        "say why). If the call site moved on purpose, restoring it also clears this."
    )


def okr_findings(base: Snapshot, head: Snapshot, event_legs: Mapping[str, tuple[str, ...]],
                 path_legs: Mapping[tuple[str, str], tuple[str, ...]],
                 renames: Mapping[str, str]) -> list[Finding]:
    out = []
    for event, metrics in sorted(event_legs.items()):
        before, after = base.files_for(event), head.files_for(event)
        for path, n in sorted(before.items()):
            now = after.get(renames.get(path, path), 0)
            if now < n:
                out.append(Finding(
                    "okr_call_site_lost", "block", event,
                    f"{path} had {n} call site(s) of this OKR event and now has {now}.",
                    intent_fix(event, metrics), metrics))
            elif not _is_route_file(path) and path in head.files \
                    and base.importers(path) and not head.importers(path):
                out.append(Finding(
                    "okr_file_unused", "block", event,
                    f"{path} still sends this OKR event, but nothing imports it any more, so it never runs.",
                    intent_fix(event, metrics), metrics))
    for (event, route), metrics in sorted(path_legs.items()):
        if route in base.page_routes and route not in head.page_routes:
            out.append(Finding(
                "okr_page_removed", "block", event,
                f"The page for {route} was removed or moved; this OKR counts '{event}' on that path.",
                intent_fix(event, metrics), metrics))
    return out


def _surface_paths(snap: Snapshot) -> set[str]:
    return {s["path"] for b in snap.watchlist.get("behaviors") or []
            for s in b.get("surfaces") or [] if s.get("path")}


def stale_surface_paths(base: Snapshot, head: Snapshot) -> list[Finding]:
    return [
        Finding("stale_surface_path", "block", "(registry)",
                f"monitored_events.yaml declares {p} as a surface, and this change removed that file.",
                "Update that surface's path: in monitored_events.yaml to where the code lives now.")
        for p in sorted(_surface_paths(head)) if p in base.all_paths and p not in head.all_paths
    ]


def new_key_warnings(base: Snapshot, head: Snapshot) -> list[Finding]:
    out = []
    for name in sorted(head.registered() - base.registered()):
        if ":" in name or re.search(r"\bClick\b", name):
            out.append(Finding("naming", "warn", name,
                               "New event names use 'Area - Object Action' with no colon and no 'Click'.",
                               "Rename it per the instrument-analytics-event skill before it ships."))
        if name not in head.provenance_events:
            out.append(Finding("no_provenance_row", "warn", name,
                               "New event with no provenance row.",
                               "Run the instrument-analytics-event skill's provenance upsert step."))
    return out
