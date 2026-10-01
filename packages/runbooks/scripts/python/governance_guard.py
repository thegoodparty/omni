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
        "say why). If you removed it by mistake, restoring it clears this."
    )


def okr_findings(base: Snapshot, head: Snapshot, event_legs: Mapping[str, tuple[str, ...]],
                 path_legs: Mapping[tuple[str, str], tuple[str, ...]],
                 renames: Mapping[str, str]) -> list[Finding]:
    out = []
    for event, metrics in sorted(event_legs.items()):
        before, after = base.files_for(event), head.files_for(event)
        for path, n in sorted(before.items()):
            new = renames.get(path, path)
            now = after.get(new, 0)
            if now < n:
                out.append(Finding(
                    "okr_call_site_lost", "block", event,
                    f"{path} had {n} call site(s) of this OKR event and now has {now}.",
                    intent_fix(event, metrics), metrics))
            elif not _is_route_file(path) and new in head.files \
                    and base.importers(path) and not head.importers(new):
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


def _dir_prefixes(paths: Iterable[str]) -> set[str]:
    out: set[str] = set()
    for p in paths:
        parts = p.split("/")[:-1]
        prefix = ""
        for part in parts:
            prefix = f"{prefix}/{part}" if prefix else part
            out.add(prefix)
    return out


def _present(path: str, paths: set[str], dirs: set[str]) -> bool:
    """A surface path from monitored_events.yaml may name a directory (e.g. a whole
    feature folder), not just one file, so presence is file-or-directory-prefix."""
    return path in paths or path in dirs


def stale_surface_paths(base: Snapshot, head: Snapshot) -> list[Finding]:
    base_dirs, head_dirs = _dir_prefixes(base.all_paths), _dir_prefixes(head.all_paths)
    return [
        Finding("stale_surface_path", "block", "(registry)",
                f"monitored_events.yaml declares {p} as a surface, and this change removed that file.",
                "Update that surface's path: in monitored_events.yaml to where the code lives now.")
        for p in sorted(_surface_paths(head))
        if _present(p, base.all_paths, base_dirs) and not _present(p, head.all_paths, head_dirs)
    ]


INTENT_KINDS = frozenset({"retire_activity", "successor", "relocated", "not_a_change"})
_INTENT_REQUIRED = ("metric", "event", "intent", "reason", "date")


def intent_problems(row: Mapping) -> list[str]:
    if not isinstance(row, Mapping):
        return [f"intent row is not a mapping: {row!r}"]
    problems = [f"intent row for {row.get('event')!r} is missing {k}"
                for k in _INTENT_REQUIRED if not str(row.get(k) or "").strip()]
    kind = row.get("intent")
    if kind and kind not in INTENT_KINDS:
        problems.append(f"intent {kind!r} is not one of {sorted(INTENT_KINDS)}")
    if kind == "successor" and not row.get("successor"):
        problems.append(f"successor intent for {row.get('event')!r} needs successor:")
    if kind == "relocated" and not row.get("route"):
        problems.append(f"relocated intent for {row.get('event')!r} needs route:")
    return problems


def _intent_rows(snap: Snapshot) -> list[Mapping]:
    return [r for r in snap.watchlist.get("intents") or [] if isinstance(r, Mapping)]


def _row_key(row: Mapping) -> tuple:
    return tuple(str(row.get(k)) for k in ("metric", "event", "intent", "successor", "route", "reason"))


def apply_intents(findings: list[Finding], base: Snapshot, head: Snapshot
                  ) -> tuple[list[Finding], list[Finding]]:
    """Only rows this change adds can clear a finding. A row left on main from an earlier
    retirement would otherwise pre-approve every later break of the same event."""
    on_base = {_row_key(r) for r in _intent_rows(base)}
    added = [r for r in _intent_rows(head) if _row_key(r) not in on_base]
    remaining: list[Finding] = []
    cleared: list[Finding] = []
    usable = []
    for row in added:
        problems = intent_problems(row)
        if row.get("intent") == "successor" and row.get("successor") and head.count(str(row["successor"])) == 0:
            problems.append(f"successor {row['successor']!r} has no call site in this change, so nothing "
                            "would carry the activity forward")
        if problems:
            remaining.extend(Finding("invalid_intent", "block", str(row.get("event")), p,
                                     "Fix the row in monitored_events.yaml intents:.") for p in problems)
        else:
            usable.append(row)
    for f in findings:
        if f.rule.startswith("okr_"):
            covered = {str(r["metric"]) for r in usable if r["event"] == f.event}
            if set(f.metrics) <= covered:
                cleared.append(f)
                continue
        remaining.append(f)
    return remaining, cleared


class GuardError(Exception):
    pass


@dataclass
class Report:
    blocks: list[Finding]
    warns: list[Finding]
    cleared: list[Finding]
    examined: dict[str, object]


def evaluate(base: Snapshot, head: Snapshot, anchors: Mapping[str, Sequence[sa.Leg]],
             sem_date: str | None, renames: Mapping[str, str]) -> Report:
    event_legs, path_legs = watched_legs(anchors)
    if not event_legs and not path_legs:
        raise GuardError("no watched OKR legs loaded from instrumentation_data/sem; refusing to report a pass")
    found = (okr_findings(base, head, event_legs, path_legs, renames) + dead_listings(base, head)
             + stale_surface_paths(base, head) + hubspot_warnings(base, head) + new_key_warnings(base, head))
    remaining, cleared = apply_intents(found, base, head)
    # A path leg whose route matches no page is silently unguarded by okr_findings (which only
    # reacts to a route disappearing between base and head), so surface it explicitly: a
    # disabled check must not look like a passing one.
    unmatched = sorted(f"{event}@{route}" for (event, route) in path_legs if route not in base.page_routes)
    return Report(
        blocks=[f for f in remaining if f.level == "block"],
        warns=[f for f in remaining if f.level == "warn"],
        cleared=cleared,
        examined={"events_compared": len(base.registered() | head.registered()),
                  "okr_legs": len(event_legs) + len(path_legs),
                  "files_scanned": len(head.files), "sem_copy_date": sem_date,
                  "unmatched_path_legs": unmatched},
    )


_TITLES = {
    "okr_call_site_lost": "OKR activity lost a call site",
    "okr_file_unused": "OKR call site no longer runs",
    "okr_page_removed": "OKR page removed",
    "dead_listing": "Event removed but still listed",
    "stale_surface_path": "Registry points at a deleted file",
    "invalid_intent": "Intent row is not valid",
    "hubspot_event_removed": "HubSpot event removed",
    "naming": "Event name",
    "no_provenance_row": "No provenance row",
}


def render_markdown(report: Report) -> str:
    lines = ["<!-- analytics-guard -->", "### Analytics guard", ""]
    if not report.blocks and not report.warns:
        lines.append("No analytics governance problems found.")
    for heading, items in (("Blocks merge", report.blocks), ("Warnings", report.warns)):
        if not items:
            continue
        lines += [f"**{heading}**", ""]
        for f in items:
            lines += [f"- **{_TITLES.get(f.rule, f.rule)}**: `{f.event}`. {f.detail}",
                      "", "  " + f.fix.replace("\n", "\n  "), ""]
    if report.cleared:
        lines += ["**Cleared by an intent row in this change**", ""]
        lines += [f"- `{f.event}` ({', '.join(f.metrics)})" for f in report.cleared] + [""]
    e = report.examined
    lines.append(f"_Examined {e['events_compared']} events, {e['okr_legs']} OKR legs, "
                 f"{e['files_scanned']} files. OKR definitions as of {e['sem_copy_date']}._")
    if e["unmatched_path_legs"]:
        lines.append("_Path legs with no matching page (not guarded): "
                     f"{', '.join(e['unmatched_path_legs'])}._")
    return "\n".join(lines) + "\n"


def git_renames(repo: Path, base: str, head: str | None) -> dict[str, str]:
    args = ["diff", "-M50%", "--name-status", base] + ([head] if head else [])
    out = {}
    for line in _git(repo, *args).decode().splitlines():
        parts = line.split("\t")
        if parts[0].startswith("R") and len(parts) == 3:
            out[parts[1]] = parts[2]
    return out


def _run(args: argparse.Namespace) -> Report:
    repo = Path(args.repo)
    anchors, sem_date = sa.load_vendored_anchors()
    anchors = {m: list(legs) for m, legs in anchors.items()}
    for spec in args.extra_leg:
        event, _, metric = spec.rpartition("=")
        anchors.setdefault(metric, []).append(sa.Leg(event))
    base = build_snapshot(GitTree(repo, args.base))
    head = build_snapshot(GitTree(repo, args.head) if args.head else WorkTree(repo))
    return evaluate(base, head, anchors, sem_date, git_renames(repo, args.base, args.head))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check")
    check.add_argument("--base", required=True)
    check.add_argument("--head")
    check.add_argument("--repo", default=str(REPO_ROOT))
    check.add_argument("--json")
    check.add_argument("--markdown")
    check.add_argument("--extra-leg", action="append", default=[])
    args = parser.parse_args(argv)
    try:
        report = _run(args)
    # Wide on purpose: principle 1 of the design. A guard bug must surface as an error the
    # workflow can pass loudly, never as a block a developer cannot clear.
    except Exception as exc:  # noqa: BLE001
        message = f"GUARD ERROR: {type(exc).__name__}: {exc}"
        print(message, file=sys.stderr)
        if args.json:
            Path(args.json).write_text(json.dumps({"status": "error", "error": message}))
        return 1
    md = render_markdown(report)
    print(md)
    if args.markdown:
        Path(args.markdown).write_text(md)
    if args.json:
        Path(args.json).write_text(json.dumps({
            "status": "block" if report.blocks else "pass",
            "blocks": [asdict(f) for f in report.blocks], "warns": [asdict(f) for f in report.warns],
            "cleared": [asdict(f) for f in report.cleared], "examined": report.examined,
        }, indent=1))
    return 2 if report.blocks else 0


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


if __name__ == "__main__":
    raise SystemExit(main())
