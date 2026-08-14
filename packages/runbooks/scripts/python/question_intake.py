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
PRODUCTS = frozenset({"win", "serve", "both"})
_SLUG_STRIP = re.compile(r"[^a-z0-9]+")
_BEHAVIORS_KEY = re.compile(r"^behaviors:(.*)$")


def _custom(task: dict, name: str) -> str:
    """ClickUp returns custom fields as a list, not a map; person fields as a list of user
    objects; and drop_down fields as the chosen option's uuid or orderindex, with the names in
    type_config.options. Flatten and resolve all three here so nothing downstream knows the API
    shape — an unresolved orderindex 0 reads as an unrecognized product and silently becomes
    "both", which makes the form field decorative."""
    for field in task.get("custom_fields") or []:
        if field.get("name") != name:
            continue
        value = field.get("value")
        if isinstance(value, list):
            first = value[0] if value else {}
            return str(first.get("email") or first.get("username") or "")
        if value is None:
            return ""
        target = str(value)
        for option in (field.get("type_config") or {}).get("options") or []:
            if target in (str(option.get("id")), str(option.get("orderindex"))):
                return str(option.get("name", ""))
        return target
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


def normalize_product(value) -> str:
    """A ClickUp dropdown comes back as the raw label ("Win") or as an ordinal index, neither of
    which is a registry product. Anything unrecognized becomes "both" rather than a stub that
    fails validation on arrival."""
    product = str(value or "").strip().lower()
    return product if product in PRODUCTS else "both"


def slugify(question: str) -> str:
    slug = _SLUG_STRIP.sub("_", question.lower()).strip("_")
    return "_".join(slug.split("_")[:8])


def _uniquify(candidate: str, taken: set[str]) -> str:
    """Two differently worded questions can slugify identically. Suffix rather than drop: a
    dropped stub is re-proposed and re-dropped on every run, forever and silently."""
    if candidate not in taken:
        return candidate
    n = 2
    while f"{candidate}_{n}" in taken:
        n += 1
    return f"{candidate}_{n}"


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
    tasks: list[dict], *, today: date, existing_refs: set[str],
    existing_ids: set[str] | None = None,
) -> list[dict]:
    """Only Accepted tasks enter the registry. Proposed ones are left alone so the accept gate
    is a real gate rather than a label."""
    out: list[dict] = []
    seen = set(existing_refs)
    taken_ids = set(existing_ids or ())
    for task in tasks:
        if task.get("status") != ACCEPTED_STATUS:
            continue
        question = (task.get("name") or "").strip()
        ref = str(task.get("id") or "")
        if not question or not ref:
            print(f"skipped task {ref or '<no id>'}: blank question or task id", file=sys.stderr)
            continue
        if ref in seen:
            continue
        base = slugify(question)
        if not base:
            print(f"skipped task {ref}: question {question!r} slugifies to nothing",
                  file=sys.stderr)
            continue
        seen.add(ref)
        bid = _uniquify(base, taken_ids)
        if bid != base:
            print(f"task {ref}: id {base!r} is taken, filing it as {bid!r}", file=sys.stderr)
        taken_ids.add(bid)
        entry = {
            "id": bid,
            "question": question,
            "question_ref": ref,
            "product": normalize_product(task.get("product")),
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


def _render_entry(entry: dict) -> list[str]:
    body = yaml.safe_dump(
        entry, sort_keys=False, width=100, allow_unicode=True
    ).rstrip("\n").split("\n")
    return ["  - " + body[0]] + ["    " + line for line in body[1:]]


def _insert_behaviors(text: str, added: list[dict]) -> str:
    """Splice list items into the behaviors: block and leave every other byte alone."""
    lines = text.splitlines()
    trailing_newline = text.endswith("\n")

    key = next((i for i, line in enumerate(lines) if _BEHAVIORS_KEY.match(line)), None)
    if key is None:
        lines.append("behaviors:")
        key, inline = len(lines) - 1, ""
    else:
        inline = (_BEHAVIORS_KEY.match(lines[key]).group(1) or "").strip()
        if inline and inline != "[]":
            raise ValueError(f"cannot append to an inline behaviors list: {lines[key]!r}")
    if inline == "[]":
        lines[key] = "behaviors:"

    at, blank_first = key + 1, False
    for i in range(key + 1, len(lines)):
        if lines[i].strip() and not lines[i].startswith((" ", "\t")):
            break
        if lines[i].strip():
            at, blank_first = i + 1, True

    out = lines[:at]
    for i, entry in enumerate(added):
        if blank_first or i:
            out.append("")
        out.extend(_render_entry(entry))
    out.extend(lines[at:])
    return "\n".join(out) + ("\n" if trailing_newline else "")


def append_behaviors(path: Path, new: list[dict]) -> int:
    """Append under the behaviors: key, leaving every other byte of the file untouched.
    Idempotent on question_ref; an id already in the registry is suffixed, never dropped.

    The insert is line-oriented rather than a yaml round-trip because this file's comments are
    its schema documentation, and the PR that carries an intake change auto-merges.
    """
    path = Path(path)
    text = path.read_text()
    doc = yaml.safe_load(text) or {}
    behaviors = doc.get("behaviors") or []
    have_refs = {b.get("question_ref") for b in behaviors if b.get("question_ref")}
    have_ids = {b.get("id") for b in behaviors if b.get("id")}

    added: list[dict] = []
    for entry in new:
        ref = entry.get("question_ref")
        if ref and ref in have_refs:
            print(f"skipped {entry.get('id')!r}: question_ref {ref!r} is already in the registry",
                  file=sys.stderr)
            continue
        bid = _uniquify(str(entry.get("id") or "behavior"), have_ids)
        if bid != entry.get("id"):
            print(f"renamed {entry.get('id')!r} to {bid!r}: id is already in the registry",
                  file=sys.stderr)
            entry = dict(entry, id=bid)
        have_ids.add(bid)
        if ref:
            have_refs.add(ref)
        added.append(entry)

    if not added:
        return 0
    path.write_text(_insert_behaviors(text, added))
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
    try:
        behaviors = br.load_validated_behaviors(aeh.WATCHLIST)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 1
    existing_refs = {b["question_ref"] for b in behaviors if b.get("question_ref")}
    existing_ids = {b["id"] for b in behaviors if b.get("id")}
    stubs = intake_to_behaviors(
        tasks, today=date.today(), existing_refs=existing_refs, existing_ids=existing_ids
    )

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
