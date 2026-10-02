"""Weekly surface drift detector (DATA-2531).

Finds analytics events whose label (a `surface:` tag, else the name prefix) no longer
matches where the code can fire them, grades each finding by how much independent
evidence agrees, and records proposals in instrumentation_data/surface_drift.json for
the event health console's surface queue. Nothing here writes to Amplitude: triage
applies accepted rows through the event-metadata skill.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

PY = Path(__file__).resolve().parent
sys.path.insert(0, str(PY))

import event_reach as er  # noqa: E402
import governance_guard as gg  # noqa: E402

SURFACE_TAG = "surface:"
ACTIONABLE = frozenset({"moved", "stale_area_name"})


def claimed_label(display_name: str, tags: Sequence[str]) -> tuple[str, str] | None:
    for tag in tags:
        if tag.startswith(SURFACE_TAG) and tag[len(SURFACE_TAG):].strip():
            return ("tag", er.slug(tag[len(SURFACE_TAG):]))
    if " - " in display_name:
        return ("prefix", display_name.split(" - ", 1)[0].strip())
    return None


def names_match(label_slug: str, name: str) -> bool:
    want, have = label_slug.split("-"), name.split("-")
    return any(have[i:i + len(want)] == want for i in range(len(have) - len(want) + 1))


def classify(label: tuple[str, str] | None, reach: er.Reach | None, *, known: Sequence[er.Area],
             flow_prefixes: set[str], prefix_areas: Mapping[str, str], count_30d: int) -> str:
    if reach is None:
        return "unclear"
    if label is None:
        return "unmapped"
    kind, raw = label
    if kind == "prefix" and raw in flow_prefixes:
        return "flow"
    if reach.dashboard_wide:
        return "dashboard_wide"
    if reach.gap_files or not reach.areas:
        return "unclear"
    aliased = kind == "prefix" and raw in prefix_areas
    target = prefix_areas[raw] if aliased else (raw if kind == "tag" else er.slug(raw))

    def hits(area: er.Area) -> bool:
        return target in area.names if aliased else any(names_match(target, n) for n in area.names)

    if any(hits(a) for a in reach.areas):
        return "consistent"
    segments = {s for r in reach.live_routes for s in r.strip("/").split("/") if s and not s.startswith("[")}
    if target in segments:
        return "stale_area_name"
    if any(hits(a) for a in known):
        return "moved_then_quiet" if count_30d == 0 else "moved"
    return "stale_area_name" if kind == "tag" else "unmapped"


def proposed_display_name(display_name: str, area: er.Area | None) -> str:
    if area is None:
        return ""
    rest = display_name.split(" - ", 1)[1] if " - " in display_name else display_name
    return f"{area.label} - {rest}"


STATE = PY / "instrumentation_data" / "surface_drift.json"
EXPLORER = PY.parent.parent.parent / "prototypes/app/p/analytics-event-explorer/data/event-explorer.json"
AGREEMENT = 0.8
MIN_ATTRIBUTED = 10
MIN_COVERAGE = 0.5
OPEN = frozenset({"new", "open"})
DISPOSITIONS = frozenset({"accepted", "dismissed", "open", "applied"})


@dataclass(frozen=True)
class Signal:
    fires: int
    attributed: int
    on_reached: int
    impersonated: int

    @property
    def coverage(self) -> float:
        return self.attributed / self.fires if self.fires else 0.0

    @property
    def agreement(self) -> float:
        return self.on_reached / self.attributed if self.attributed else 0.0


# The app's own `Viewed` event carries the page path. Each fire is attributed to the
# latest Viewed by the same user within 30 minutes before it. A modal or client-side
# step may emit no Viewed, which is why coverage is measured and gated, not assumed.
SIGNAL_SQL = """
with ev as (
  select user_id, event_type, event_time,
    case when get_json_object(cast(event_properties as string), '$.impersonation') = 'true' then 1 else 0 end imp
  from {table}
  where event_time >= current_date() - interval 60 days and user_id is not null
    and event_type in ({events})),
pv as (
  select user_id, event_time, get_json_object(cast(event_properties as string), '$.path') path
  from {table}
  where event_time >= current_date() - interval 61 days and user_id is not null
    and event_type = 'Viewed'),
j as (
  select ev.event_type, ev.imp, pv.path,
    row_number() over (partition by ev.user_id, ev.event_type, ev.event_time
                       order by pv.event_time desc nulls last) rn
  from ev left join pv on pv.user_id = ev.user_id and pv.event_time <= ev.event_time
    and pv.event_time >= ev.event_time - interval 30 minutes)
select event_type, path, count(*) n, sum(imp) imp from j where rn = 1 group by 1, 2
"""


def fetch_signal_rows(names: Sequence[str]) -> list[tuple[str, str | None, int, int]]:
    import analytics_event_health as aeh
    import databricks_oauth as dbo

    quoted = ",".join("'" + n.replace("'", "''") + "'" for n in names)
    cur = dbo.get_connection().cursor()
    cur.execute(SIGNAL_SQL.format(table=aeh.STREAM_TABLE, events=quoted))
    return [(r[0], r[1], int(r[2]), int(r[3] or 0)) for r in cur.fetchall()]


def signals_from_rows(rows: Iterable[tuple[str, str | None, int, int]], reaches: Mapping[str, er.Reach],
                      areas: er.AreaIndex) -> dict[str, Signal]:
    acc: dict[str, list[int]] = {}
    for event, path, n, imp in rows:
        totals = acc.setdefault(event, [0, 0, 0, 0])
        totals[0] += n
        totals[3] += imp
        if path:
            totals[1] += n
            area = areas.area_for_path(path)
            if area and event in reaches and area.key in reaches[event].area_keys:
                totals[2] += n
    return {e: Signal(*t) for e, t in acc.items()}


def load_signals(names: Sequence[str], reaches: Mapping[str, er.Reach], areas: er.AreaIndex | None
                 ) -> tuple[dict[str, Signal], str]:
    if not names:
        return {}, "ok (no candidates)"
    try:
        rows = fetch_signal_rows(names)
    except Exception as exc:  # noqa: BLE001
        # Non-fatal by design: without the signal nothing can reach high confidence,
        # and meta.signals says why, so a quiet queue is never read as a clean one.
        return {}, f"failed: {type(exc).__name__}: {exc}"
    return signals_from_rows(rows, reaches, areas), "ok"


def _git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(gg.REPO_ROOT), *args], capture_output=True,
                          text=True, check=True).stdout


def removal_commit(stems: Iterable[str], git: Callable[..., str] = _git) -> str | None:
    best: tuple[str, str] | None = None
    for stem in sorted(set(stems)):
        removed = re.compile(rf"^-\s*import\b.*\b{re.escape(stem)}\b", re.M)
        for line in git("log", "--format=%H %cs", f"-S{stem}", "--", er.APP.rstrip("/")).splitlines():
            sha, day = line.split()
            if removed.search(git("show", "--format=", "-U0", sha, "--", er.APP.rstrip("/"))):
                if best is None or day > best[1]:
                    best = (sha[:9], day)
                break
    return f"{best[0]} {best[1]}" if best else None


def _stems(reach: er.Reach) -> list[str]:
    return sorted({p.rsplit("/", 1)[-1].rsplit(".", 1)[0] for p in reach.visited
                   if not er.route_kind(p)} - {"index"})


def confidence(verdict: str, reach: er.Reach, removal: str | None, signal: Signal | None, okr: bool) -> str:
    if verdict != "moved" or okr or reach.gap_files or len(reach.areas) != 1 or not removal:
        return "proposed"
    if signal is None or signal.attributed < MIN_ATTRIBUTED or signal.coverage < MIN_COVERAGE:
        return "proposed"
    return "high" if signal.agreement >= AGREEMENT else "proposed"


def build_row(name: str, verdict: str, label: tuple[str, str], reach: er.Reach, event: Mapping,
              removal: str | None, signal: Signal | None, today: str) -> dict:
    okr = bool(event.get("okr_metrics"))
    single = reach.areas[0] if len(reach.areas) == 1 else None
    display = event.get("display_name") or name
    routes = sorted(reach.live_routes)
    return {
        "verdict": verdict,
        "confidence": confidence(verdict, reach, removal, signal, okr),
        "claimed": label[1],
        "claimed_kind": label[0],
        "areas": [a.label for a in reach.areas],
        "area_keys": sorted(reach.area_keys),
        "live_routes": routes,
        "dead_routes": sorted(reach.dead_routes),
        "gap_files": sorted(reach.gap_files),
        "removal_commit": removal,
        "signal": (dict(asdict(signal), coverage=round(signal.coverage, 3), agreement=round(signal.agreement, 3))
                   if signal else None),
        "okr": okr,
        "display_name": display,
        "proposed_surface": sorted(single.names)[0] if single else "",
        "proposed_display_name": proposed_display_name(display, single),
        "proposed_fires_on": f"{single.label} ({', '.join(routes)})" if single else "",
        "proposed_url": routes[0] if single and len(routes) == 1 else "",
        "disposition": "new",
        "dismissed_areas": [],
        "reason": "",
        "source": "detector",
        "first_seen": today,
        "last_seen": today,
        "applied_date": "",
    }


def merge(prev: Mapping, fresh: Mapping, today: str) -> dict:
    out: dict[str, dict] = {}
    for name, row in fresh.items():
        old = prev.get(name)
        row = dict(row, last_seen=today)
        if old:
            row["first_seen"] = old.get("first_seen") or today
            kept = old.get("disposition")
            if kept == "dismissed" and sorted(old.get("dismissed_areas") or []) == sorted(row.get("area_keys") or []):
                row.update(disposition="dismissed", dismissed_areas=old["dismissed_areas"], reason=old.get("reason", ""))
            elif kept in ("accepted", "applied"):
                row.update(disposition=kept, applied_date=old.get("applied_date", ""), source=old.get("source", "detector"))
            elif kept in OPEN:
                row["disposition"] = kept
        out[name] = row
    for name, old in prev.items():
        if name not in out and old.get("disposition") not in OPEN:
            out[name] = dict(old)
    return out


def ingest_relabels(rows: dict, relabels: Sequence[Mapping], today: str) -> dict:
    for r in relabels:
        if not isinstance(r, Mapping) or not r.get("event") or not r.get("surface"):
            continue
        name = str(r["event"])
        cur = rows.get(name)
        if cur and cur.get("disposition") == "applied" and cur.get("proposed_surface") == r["surface"]:
            continue
        base = dict(cur or {"verdict": "relabel", "confidence": "proposed", "first_seen": today,
                            "area_keys": [], "dismissed_areas": [], "applied_date": ""})
        base.update(disposition="accepted", source="relabels", proposed_surface=str(r["surface"]),
                    proposed_display_name=str(r.get("display_name") or ""), reason=str(r.get("reason") or ""),
                    last_seen=today)
        rows[name] = base
    return rows


def dispose(state: dict, event: str, disposition: str, reason: str, today: str) -> dict:
    if disposition not in DISPOSITIONS:
        raise ValueError(f"disposition must be one of {sorted(DISPOSITIONS)}")
    row = state["rows"][event]
    row["disposition"] = disposition
    if reason:
        row["reason"] = reason
    if disposition == "dismissed":
        row["dismissed_areas"] = list(row.get("area_keys") or [])
    if disposition == "applied":
        row["applied_date"] = today
    return state


def run(no_signals: bool, today: str) -> dict:
    snap = gg.build_snapshot(gg.WorkTree(gg.REPO_ROOT))
    idx = er.ReachIndex(snap, gg._resolve)
    reaches = idx.reach_all()
    explorer = json.loads(EXPLORER.read_text())
    events = {e["event_type"]: e for e in explorer.get("events") or []}
    watch = snap.watchlist
    flows = set(watch.get("flow_prefixes") or [])
    aliases = dict(watch.get("prefix_areas") or {})
    known = idx.areas.all_areas()
    verdicts: Counter[str] = Counter()
    unmapped: Counter[str] = Counter()
    candidates = {}
    for name in sorted(snap.registries["web"]):
        ev = events.get(name, {})
        r = reaches.get(name)
        label = claimed_label(ev.get("display_name") or name, ev.get("tags") or [])
        v = classify(label, r, known=known, flow_prefixes=flows, prefix_areas=aliases,
                     count_30d=int(ev.get("count_30d") or 0))
        verdicts[v] += 1
        if v == "unmapped" and label:
            unmapped[label[1]] += 1
        if v in ACTIONABLE:
            candidates[name] = (v, label, r, ev)
    signals, status = ({}, "skipped (--no-signals)") if no_signals else load_signals(sorted(candidates), reaches, idx.areas)
    fresh = {}
    for name, (v, label, r, ev) in candidates.items():
        okr = bool(ev.get("okr_metrics"))
        wants_proof = v == "moved" and len(r.areas) == 1 and not r.gap_files and not okr
        fresh[name] = build_row(name, v, label, r, ev, removal_commit(_stems(r)) if wants_proof else None,
                                signals.get(name), today)
    prev = json.loads(STATE.read_text()) if STATE.exists() else {}
    rows = ingest_relabels(merge(prev.get("rows") or {}, fresh, today), watch.get("relabels") or [], today)
    return {
        "run_date": today,
        "meta": {
            "web_events": len(snap.registries["web"]),
            "traced": len(reaches),
            "backend_not_examined": len(snap.registries["api"]),
            "verdicts": dict(sorted(verdicts.items())),
            "unmapped_prefixes": dict(sorted(unmapped.items())),
            "signals": status,
            "thresholds": {"agreement": AGREEMENT, "min_attributed": MIN_ATTRIBUTED, "min_coverage": MIN_COVERAGE,
                           "dashboard_wide_areas": er.DASHBOARD_WIDE_AREAS},
        },
        "rows": dict(sorted(rows.items())),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run")
    r.add_argument("--no-signals", action="store_true")
    d = sub.add_parser("dispose")
    d.add_argument("event")
    d.add_argument("--as", dest="disposition", required=True, choices=sorted(DISPOSITIONS))
    d.add_argument("--reason", default="")
    args = parser.parse_args(argv)
    today = date.today().isoformat()
    if args.command == "run":
        state = run(args.no_signals, today)
        STATE.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n")
        m = state["meta"]
        open_rows = [n for n, row in state["rows"].items() if row["disposition"] in OPEN]
        high = [n for n in open_rows if state["rows"][n]["confidence"] == "high"]
        print(f"traced {m['traced']}/{m['web_events']} webapp events; {m['backend_not_examined']} backend not examined")
        print(f"verdicts: {m['verdicts']}")
        print(f"open proposals: {len(open_rows)} ({len(high)} high); signals: {m['signals']}")
        if m["unmapped_prefixes"]:
            print(f"unmapped prefixes: {m['unmapped_prefixes']}")
        return 0
    state = json.loads(STATE.read_text())
    dispose(state, args.event, args.disposition, args.reason, today)
    STATE.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n")
    print(f"{args.event}: {args.disposition}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
