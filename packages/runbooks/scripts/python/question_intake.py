"""Read the Analytics Questions ClickUp list into proposed behaviors (DATA-2316).

Intake is deliberately not applied live. An accepted task becomes a proposed YAML change on
the governance branch, so monitored_events.yaml stays the source of truth and a human still
approves what enters the registry. Stubs land with no surfaces, which makes them uncovered on
the next run: a question nobody has instrumented is exactly what the digest should be shouting
about, and guessing file paths here would manufacture false coverage instead.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path

import yaml

import clickup_api

ACCEPTED_STATUS = "accepted"
DEFAULT_INTERVAL_DAYS = 90
_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def _custom(task: dict, name: str) -> str:
    """ClickUp returns custom fields as a list, not a map, and person fields as a list of user
    objects. Flatten both here so nothing downstream knows the API shape."""
    for field in task.get("custom_fields") or []:
        if field.get("name") != name:
            continue
        value = field.get("value")
        if isinstance(value, list):
            first = value[0] if value else {}
            return str(first.get("email") or first.get("username") or "")
        return "" if value is None else str(value)
    return ""


def fetch_questions(api_key: str, list_id: str, *, requester=None) -> list[dict]:
    """Flatten the list's tasks. Closed tasks are excluded: a retired question should stop
    being asked about, and leaving them in would keep proposing dead behaviors."""
    kwargs = {"requester": requester} if requester else {}
    payload = clickup_api.get(
        f"list/{list_id}/task", api_key, params={"include_closed": "false"}, **kwargs
    ) or {}
    rows = []
    for task in payload.get("tasks") or []:
        rows.append({
            "id": str(task.get("id", "")),
            "name": str(task.get("name", "")),
            "status": str((task.get("status") or {}).get("status", "")).lower(),
            "product": _custom(task, "Product"),
            "asked_by": _custom(task, "Asked by"),
        })
    return rows


def slugify(question: str) -> str:
    slug = _SLUG_STRIP.sub("_", question.lower()).strip("_")
    return "_".join(slug.split("_")[:8])


def similar_questions(question: str, existing: list[str], *, threshold: float = 0.6) -> list[str]:
    """A wording prefilter, nothing more. It exists because a brand-new question has no
    behaviors yet, so the durable check in behavior_questions.duplicate_behavior_sets cannot
    apply until someone enumerates its surfaces. This only ever proposes; a human merges."""
    norm = question.lower().strip()
    return [
        other for other in existing
        if SequenceMatcher(None, norm, other.lower().strip()).ratio() >= threshold
    ]


def intake_to_behaviors(
    tasks: list[dict], *, today: date, existing_refs: set[str]
) -> list[dict]:
    """Only Accepted tasks enter the registry. Proposed ones are left alone so the accept gate
    is a real gate rather than a label."""
    out: list[dict] = []
    seen = set(existing_refs)
    for task in tasks:
        if task.get("status") != ACCEPTED_STATUS:
            continue
        question = (task.get("name") or "").strip()
        ref = str(task.get("id") or "")
        if not question or not ref or ref in seen:
            continue
        seen.add(ref)
        entry = {
            "id": slugify(question),
            "question": question,
            "question_ref": ref,
            "product": (task.get("product") or "").strip() or "both",
            "surfaces": [],
            "review": {
                "interval_days": DEFAULT_INTERVAL_DAYS,
                "last_reviewed": today.isoformat(),
                "reviewed_by": (task.get("asked_by") or "").strip() or "intake",
            },
        }
        if (task.get("asked_by") or "").strip():
            entry["asked_by"] = task["asked_by"].strip()
        out.append(entry)
    return out


def append_behaviors(path: Path, new: list[dict]) -> int:
    """Append to the behaviors: key, preserving every other key. Idempotent on question_ref.

    Rewrites the document through yaml.safe_dump, which drops the file's comments. Acceptable
    only because this key is machine-appended; if the schema comment above behaviors: starts
    disappearing in review, switch to a line-oriented insert.
    """
    path = Path(path)
    doc = yaml.safe_load(path.read_text()) or {}
    behaviors = doc.get("behaviors") or []
    have_refs = {b.get("question_ref") for b in behaviors if b.get("question_ref")}
    have_ids = {b.get("id") for b in behaviors}
    added = [
        b for b in new
        if b.get("question_ref") not in have_refs and b.get("id") not in have_ids
    ]
    if not added:
        return 0
    doc["behaviors"] = behaviors + added
    path.write_text(yaml.safe_dump(doc, sort_keys=False, width=100))
    return len(added)


def main(argv: list[str] | None = None) -> int:
    import analytics_event_health as aeh
    import behavior_registry as br

    parser = argparse.ArgumentParser(description="Read the Analytics Questions list.")
    parser.add_argument("--list-id", default=os.environ.get("GP_QUESTIONS_LIST_ID"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    api_key = os.environ.get("CLICKUP_API_KEY")
    if not api_key or not args.list_id:
        print("CLICKUP_API_KEY and --list-id/GP_QUESTIONS_LIST_ID required", file=sys.stderr)
        return 2

    tasks = fetch_questions(api_key, args.list_id)
    behaviors = br.load_behaviors(aeh.WATCHLIST)
    existing_refs = {b["question_ref"] for b in behaviors if b.get("question_ref")}
    stubs = intake_to_behaviors(tasks, today=date.today(), existing_refs=existing_refs)

    existing_questions = [b["question"] for b in behaviors if b.get("question")]
    for stub in stubs:
        dupes = similar_questions(stub["question"], existing_questions)
        if dupes:
            print(f"possible duplicate of {dupes!r}: {stub['question']!r} "
                  f"(task {stub['question_ref']}) — merge or accept as new")

    if args.dry_run:
        print(f"{len(tasks)} tasks; {len(stubs)} new behaviors would be added")
        return 0
    print(f"added {append_behaviors(aeh.WATCHLIST, stubs)} behaviors from intake")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
