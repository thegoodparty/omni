"""Roll behavior coverage up to the question (DATA-2316).

A question can span several behaviors: "are people creating and downloading lists but never
doing outreach" needs three. Rather than a separate questions: registry, a behavior declares
the extra questions it contributes to in `answers:`, and a question is answerable only when
every behavior naming it is covered. That keeps one authored artifact instead of two that can
silently disagree.
"""

from __future__ import annotations

from behavior_coverage import behavior_state

_ORDER = {"not_answerable": 0, "partially_answerable": 1, "answerable": 2}


def _as_list(value) -> list[str]:
    if not value:
        return []
    return [str(v) for v in value] if isinstance(value, list) else [str(value)]


def _questions_of(behavior: dict) -> list[str]:
    out = [str(behavior["question"])] if behavior.get("question") else []
    out.extend(_as_list(behavior.get("answers")))
    return out


def _state_for(coverages: list[str]) -> str:
    if any(c in ("uncovered", "orphaned") for c in coverages):
        return "not_answerable"
    if all(c == "covered" for c in coverages):
        return "answerable"
    return "partially_answerable"


def question_rows(behaviors: list[dict], records_by_type: dict[str, dict]) -> list[dict]:
    """One row per distinct question, worst state first so the surface opens on what is broken."""
    grouped: dict[str, dict] = {}
    for b in behaviors:
        state = behavior_state(b, records_by_type)
        own = str(b["question"]) if b.get("question") else None
        for q in _questions_of(b):
            row = grouped.setdefault(q, {
                "question": q, "behaviors": [], "_coverages": [], "events": [],
                "gaps": [], "caveats": [], "asked_by": "", "question_ref": "",
            })
            row["behaviors"].append(b.get("id", ""))
            row["_coverages"].append(state["coverage"])
            row["events"].extend(
                s["instrumented_by"] for s in state["surfaces"] if s["state"] == "live"
            )
            row["gaps"].extend(s["path"] for s in state["surfaces"] if s["state"] != "live")
            row["caveats"].extend(_as_list(b.get("caveats")))
            if b.get("asked_by") and not row["asked_by"]:
                row["asked_by"] = str(b["asked_by"])
            # Only the behavior's own question, never one it merely `answers:`. The ref is the
            # task that asked that question, and the write-back stamps the row's state onto it;
            # a composite inheriting it would post the composite's state to someone else's task.
            if q == own and b.get("question_ref") and not row["question_ref"]:
                row["question_ref"] = str(b["question_ref"])

    rows = []
    for row in grouped.values():
        row["state"] = _state_for(row.pop("_coverages"))
        rows.append(row)
    rows.sort(key=lambda r: (_ORDER[r["state"]], r["question"]))
    return rows


def duplicate_behavior_sets(
    behaviors: list[dict], records_by_type: dict[str, dict]
) -> list[tuple[str, str]]:
    """Questions resolving to an identical behavior set are the same question in different
    words, whatever their wording overlap. This is the durable duplicate check; the wording
    comparison at intake time is only a prefilter, because a brand-new question has no
    behaviors yet and so cannot be compared this way."""
    by_set: dict[tuple[str, ...], list[str]] = {}
    for row in question_rows(behaviors, records_by_type):
        key = tuple(sorted(row["behaviors"]))
        by_set.setdefault(key, []).append(row["question"])
    pairs: list[tuple[str, str]] = []
    for questions in by_set.values():
        ordered = sorted(questions)
        for i, first in enumerate(ordered):
            for second in ordered[i + 1:]:
                pairs.append((first, second))
    return pairs
