"""Build the analytics-event explorer's data file: everything the page renders, in one JSON.

Joins, all in one pass:
  - event_state_assembler.assemble() — the same rows the event-state sheet gets, so the
    page and the sheet cannot disagree, and no Google credential is involved
  - accepted rows of event_anchors.json (where_it_fires / url, where Govern has none)
  - monitored_events.yaml behaviors + derived coverage (the questions layer)
  - area rollup derived from the event display-name prefix
  - optional 9-week series per event from Databricks (--series)

Runs in the analytics-governance workflow, which commits the result, and by hand:

  uv run event_explorer_snapshot.py --series \
    -o ../../../prototypes/app/p/analytics-event-explorer/data/event-explorer.json
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from collections.abc import Sequence
from datetime import date, datetime
from pathlib import Path

PY = Path(__file__).resolve().parent
sys.path.insert(0, str(PY))

import analytics_event_health as aeh          # noqa: E402
import behavior_coverage as bcov              # noqa: E402
import behavior_registry as brg               # noqa: E402
import event_state_assembler as esa           # noqa: E402

ANCHORS = PY / "instrumentation_data" / "event_anchors.json"

PROVENANCE_COLS = (
    "instrumented_pr", "instrumented_date", "instrumented_author_email",
    "retired_pr", "retired_date", "retired_author_email",
)


# --- hand-kept consumer links -------------------------------------------------------
# Where a question has actually been answered, and where an event is consumed downstream.
# Hand-maintained until the registry carries an "Answer link" field and the data
# dictionary names its source events (see the DATA-2506 follow-ups). Empty entries
# simply render nothing, so a stale map degrades to the previous behaviour.

# question id -> the report or one-pager that answers it. Which questions DATA-2247
# actually closed is a judgement call, recorded here rather than inferred at render
# time so it is one line to correct.
ANSWERS: dict[str, dict] = {
    # The report's central claim: engagement against real electoral outcome.
    "usage_to_election_outcome": {
        "label": "Win engagement report (DATA-2247)", "url": "https://claude.ai/code/artifact/f9f3474a-d05f-4dcd-90da-bc9b2ee43aac"},
    # The report defines the sender/viewer engagement ladder, which is the
    # "what does active mean" half of this question.
    "weekly_active_candidates": {
        "label": "Win engagement report (DATA-2247)", "url": "https://claude.ai/code/artifact/f9f3474a-d05f-4dcd-90da-bc9b2ee43aac"},
    # The one-page framing note: who signs up has changed, and how.
    "acquisition_source_to_activation": {
        "label": "Who uses Win (one-pager)", "url": "https://claude.ai/code/artifact/1b812614-a5e2-41cf-a3dc-cfe9bd100553"},
}

# Events the report consumed. Its viewer leg rests on the DATA-2173 dashboard-event
# union, so all three legs of that union are consumers, including the retired one.
REPORT_CONSUMERS = [
    "Dashboard - Candidate Dashboard Viewed",
    "Dashboard - Campaign Plan Viewed",
    "Campaign Plan - Campaign Tracker Viewed",
]
_WIN_REPORT = {
    "kind": "report",
    "label": "Win engagement report (DATA-2247)",
    "url": "https://claude.ai/code/artifact/f9f3474a-d05f-4dcd-90da-bc9b2ee43aac",
}

# event display name -> the columns and reports that consume it. No column entries
# until the data dictionary names its source events (DATA-2473).
USED_BY: dict[str, list[dict]] = {name: [_WIN_REPORT] for name in REPORT_CONSUMERS}

# The Analytics Questions ClickUp form. It takes a measurement question ("can we tell
# whether users do X"), not an instrumentation request, which is why the page has no
# "request an event" exit: nobody arrives wanting an event. A filed question enters the
# registry through question_intake.py and comes back as a tracked question on this page.
REQUEST_FORM_URL = "https://goodparty.clickup.com/90132012119/v/fm/2ky4jq2q-134133"


def _cell(value):
    """The sheet stringified everything on the way out; the assembler hands back real
    dates and Nones. The page's fields are strings or numbers, so flatten here."""
    if value is None:
        return ""
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def assembled() -> tuple[list[dict], dict]:
    """The sheet's own rows, from the assembler rather than from the sheet. Reading the
    published tab would make this wait on the sheet step, need Google credentials, and
    leave the page one run behind whenever that step skips."""
    result = esa.assemble(date.today())
    rows = [{k: _cell(v) for k, v in row.items()} for row in result["rows"]]
    return rows, result["meta"]


SURFACE_TAG = "surface:"


def _label(slug: str) -> str:
    """`campaign-details` -> `Campaign Details`, matching the prefix-derived areas.
    Capitalises rather than title-cases so `10dlc` is not mangled into `10Dlc`."""
    return " ".join(w[:1].upper() + w[1:] for w in slug.replace("-", " ").split())


def area_of(display_name: str, tags: Sequence[str] = ()) -> str:
    """Product area: a declared `surface:` tag when there is one, the nav-label prefix
    of the display name otherwise.

    The prefix files an event by what it is called, so renaming an event silently
    re-files it — and five events renamed in DATA-2525 needed exactly that separated
    (DATA-2532). A `surface:` tag says where the event fires independently of its name;
    `product:` already says which product owns it. The prefix stays as the fallback
    because it groups 449 of 592 events correctly with no tagging work at all."""
    for tag in tags:
        if tag.startswith(SURFACE_TAG):
            declared = _label(tag[len(SURFACE_TAG):].strip())
            if declared:
                return declared
    return display_name.split(" - ")[0].strip() if " - " in display_name else "Uncategorised"


def load_accepted_anchors() -> dict[str, dict]:
    state = json.loads(ANCHORS.read_text())
    return {k: v for k, v in state.items() if v.get("disposition") == "accepted"}


def build_events(rows: list[dict], anchors: dict, series: dict) -> list[dict]:
    out = []
    for r in rows:
        name = r["event"]
        # Anchors are keyed on the display name in the queue file.
        a = anchors.get(name) or anchors.get(r["event_type"]) or {}
        tags = [t for t in r["tags"].split(", ") if t]
        out.append({
            "event_type": r["event_type"],
            "display_name": name,
            "area": area_of(name, tags),
            "description": r["description"],
            "status": r["status"],
            "fires_on": r["where_it_fires"] or a.get("fires_on", ""),
            "url": r["url"] or a.get("url", ""),
            "fires_on_source": ("govern" if r["where_it_fires"]
                                else "anchor" if a.get("fires_on") else ""),
            "anchor_confidence": a.get("confidence", ""),
            "anchor_flag_reason": a.get("flag_reason", ""),
            # Call-site path: lets the page fall back to "which product owns this
            # directory" when nobody applied a product tag.
            "code_path": (a.get("evidence") or "").split(":")[0],
            "count_30d": int(r["event_count_30d"] or 0),
            "count_total": int(r["event_count"] or 0),
            "last_seen": r["last_seen_date"],
            "first_seen": r["first_seen_date"],
            "series": series.get(r["event_type"], []),
            "tags": tags,
            "okr": r["okr"],
            "supersession": r["supersession"],
            "declared_intent": r["declared_intent"],
            "watchlist_status": r["watchlist_status"],
            "questions": [q for q in r["questions"].split("; ") if q],
            "used_by": USED_BY.get(name, []),
            "provenance": {c: r[c] for c in PROVENANCE_COLS},
        })
    return out


def build_questions(by_type: dict[str, dict]) -> list[dict]:
    """One entry per behavior, keeping the human surface labels and the caveat that
    the sheet's questions tab drops. The headline is the readable half of that caveat;
    the prose stays, one click down, for whoever has to write the query."""
    behaviors = brg.load_validated_behaviors(aeh.WATCHLIST)
    out = []
    for b in behaviors:
        st = bcov.behavior_state(b, by_type)
        out.append({
            "id": b.get("id", ""),
            "question": b.get("question", ""),
            "also_answers": [str(a) for a in (b.get("answers") or [])],
            "coverage": st["coverage"],
            "product": b.get("product", ""),
            "asked_by": b.get("asked_by", ""),
            "headline": b.get("headline", ""),
            "caveats": b.get("caveats", ""),
            "okr": b.get("okr", ""),
            "clickup_task": b.get("question_ref", ""),
            "answer_url": ANSWERS.get(b.get("id", ""), {}).get("url", ""),
            "answer_label": ANSWERS.get(b.get("id", ""), {}).get("label", ""),
            "surfaces": st["surfaces"],
        })
    order = {"uncovered": 0, "orphaned": 0, "partial": 1, "covered": 2}
    out.sort(key=lambda q: (order.get(q["coverage"], 9), q["question"]))
    return out


def build_areas(events: list[dict]) -> list[dict]:
    by = collections.defaultdict(collections.Counter)
    for e in events:
        by[e["area"]][e["status"]] += 1
    areas = [{"name": k, "total": sum(c.values()), "counts": dict(c)} for k, c in by.items()]
    areas.sort(key=lambda a: -a["total"])
    return areas


def fetch_series() -> tuple[list[str], dict[str, list[int]]]:
    """Dense 9-week series per event, ascending, from the monitor's existing query.

    weekly_series returns [(week_start, n)] and omits weeks with no rows entirely, so a
    silent week would otherwise vanish rather than render as a zero — the exact shape a
    sparkline exists to show. Densify against the full week axis."""
    from datetime import timedelta

    from databricks_query import execute_query

    rows = aeh.fetch_weekly(execute_query)
    monday = date.today() - timedelta(days=date.today().weekday())
    raw = aeh.weekly_series(rows, monday)
    weeks = sorted({w for pairs in raw.values() for w, _ in pairs})
    axis = {w: i for i, w in enumerate(weeks)}
    dense = {}
    for et, pairs in raw.items():
        vec = [0] * len(weeks)
        for w, n in pairs:
            vec[axis[w]] = int(n)
        dense[et] = vec
    return [w.isoformat() for w in weeks], dense


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--series", action="store_true", help="also query Databricks for weekly volume")
    ap.add_argument("-o", "--out", default="event-explorer.json")
    args = ap.parse_args()

    print("assembling event state...", flush=True)
    rows, meta = assembled()
    anchors = load_accepted_anchors()
    print(f"  {len(rows)} events, {len(anchors)} accepted anchors", flush=True)

    series, weeks = {}, []
    if args.series:
        print("querying Databricks for weekly series...", flush=True)
        try:
            weeks, series = fetch_series()
            print(f"  series for {len(series)} events", flush=True)
        except Exception as exc:                      # noqa: BLE001 - see below
            # Fail the run rather than write a sparkline-less file. The workflow commits
            # whatever this writes and the republish puts it on the live page, so
            # degrading here would silently replace every working sparkline with "no
            # data" until the next good run. A failed step keeps the last good page and
            # notifies Slack, which is the better trade for a transient query error.
            print(f"  SERIES FAILED: {exc}", file=sys.stderr, flush=True)
            return 1

    events = build_events(rows, anchors, series)
    by_type = {e["event_type"]: {"status": e["status"]} for e in events}
    questions = build_questions(by_type)
    areas = build_areas(events)

    doc = {
        "refreshed_at": meta.get("refreshed_at", ""),
        "generated_at": date.today().isoformat(),
        "source": "assembled event state + accepted anchors + question registry",
        "series_weeks": weeks,
        "request_form_url": REQUEST_FORM_URL,
        "events": events,
        "questions": questions,
        "areas": areas,
    }
    Path(args.out).write_text(json.dumps(doc, indent=1))
    kb = Path(args.out).stat().st_size / 1024

    filled = sum(1 for e in events if e["fires_on"])
    print(f"\nwrote {args.out}  ({kb:.0f} KB)")
    print(f"  events    {len(events)}   fires_on filled {filled} ({100*filled//len(events)}%)")
    print(f"  questions {len(questions)}  " +
          str(dict(collections.Counter(q['coverage'] for q in questions))))
    print(f"  areas     {len(areas)}")
    print(f"  series    {'yes' if series else 'no'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
