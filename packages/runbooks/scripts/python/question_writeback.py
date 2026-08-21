"""Write answer state back onto each Analytics Questions task (DATA-2316).

This is what makes the ClickUp list a complete surface for someone who does not open the
sheet: their question, its state, and when we last checked. It writes exactly two custom
fields and nothing else — no comments, no status changes, no task creation — so a governance
run can never be mistaken for a human working the list.

Unchanged states are skipped so a quiet week produces no task activity and therefore no
notification noise, which is the difference between a signal and a thing people mute.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import clickup_api

STATE_LABELS = {
    "answerable": "answerable",
    "partially_answerable": "partially answerable",
    "not_answerable": "not answerable",
}

# Worst first. An unknown state sorts worst of all so it survives the dedupe and reaches
# write_answer_state, which is where it is meant to raise.
_SEVERITY = {"not_answerable": 0, "partially_answerable": 1, "answerable": 2}


def _worst_by_ref(rows: list[dict]) -> list[dict]:
    """One row per task, worst state winning. A behavior contributes a row for its own question
    and for every question it `answers:`, so several rows can carry the same question_ref; writing
    them all would post to one task N times and leave whichever row happened to be last showing on
    it."""
    out: dict[str, dict] = {}
    for row in rows:
        ref = row.get("question_ref")
        if not ref:
            continue
        kept = out.get(ref)
        new_sev = _SEVERITY.get(row.get("state"))
        kept_sev = _SEVERITY.get(kept.get("state")) if kept is not None else None
        # An unknown state loses to any known one (it must never evict a valid answer) but
        # survives when alone, so write_answer_state still raises instead of writing nothing.
        if kept is None or (new_sev is not None and (kept_sev is None or new_sev < kept_sev)):
            out[ref] = row
    return list(out.values())


def changed_rows(rows: list[dict], current: dict[str, str]) -> list[dict]:
    """One row per task to write to, whose state differs from what the task already says."""
    return [r for r in _worst_by_ref(rows) if current.get(r["question_ref"]) != r.get("state")]


def _epoch_ms(day: date) -> int:
    """Noon UTC, not local midnight. The scheduled run is a UTC runner and the workspace renders
    dates in a US timezone, so a midnight anchor shows "Last checked" as the previous day."""
    return int(datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc).timestamp() * 1000)


def _option_label(field: dict) -> str:
    """The display name behind a drop_down custom field's value. ClickUp returns the value as the
    chosen option's uuid (or its orderindex) and keeps the names in type_config.options, so a field
    this module wrote never reads back as a label unless we resolve it here."""
    value = field.get("value")
    if value is None:
        return ""
    target = str(value)
    for option in (field.get("type_config") or {}).get("options") or []:
        if target in (str(option.get("id")), str(option.get("orderindex"))):
            return str(option.get("name", ""))
    if isinstance(value, dict):
        return str(value.get("name", ""))
    return target


def fetch_current_state(
    api_key: str, list_id: str, *, state_field_name: str = "Answer state", requester=None
) -> dict[str, str]:
    """{task_id: state key} from the list as it stands, so we only write real changes."""
    kwargs = {"requester": requester} if requester else {}
    label_to_key = {v: k for k, v in STATE_LABELS.items()}
    wanted = state_field_name.strip().lower()
    out: dict[str, str] = {}
    page = 0
    while True:
        payload = clickup_api.get(
            f"list/{list_id}/task", api_key,
            params={"include_closed": "false", "page": str(page)}, **kwargs
        ) or {}
        tasks = payload.get("tasks") or []
        for task in tasks:
            for field in task.get("custom_fields") or []:
                # Case-insensitive: an exact match against a differently-cased field name yields
                # an empty map, which reads as "nothing has a state yet" and rewrites every task
                # on every run — the notification churn this map exists to prevent.
                if str(field.get("name") or "").strip().lower() != wanted:
                    continue
                label = _option_label(field)
                if label in label_to_key:
                    out[str(task.get("id"))] = label_to_key[label]
        # A task past page 1 that we miss here reads as state-less and is rewritten every run,
        # which is the notification churn this map exists to prevent. Empty page also
        # terminates so a response missing last_page cannot loop forever.
        if payload.get("last_page") or not tasks:
            break
        page += 1
    return out


def write_answer_state(
    api_key: str,
    rows: list[dict],
    *,
    state_field_id: str,
    checked_field_id: str,
    option_ids: dict[str, str],
    today: date,
    current: dict[str, str],
    requester=None,
) -> int:
    """Returns the number of tasks updated. An unknown state key raises rather than writing a
    wrong value: a silently mislabelled question is worse than a failed run."""
    kwargs = {"requester": requester} if requester else {}
    updated = 0
    for row in changed_rows(rows, current):
        ref = row["question_ref"]
        option = option_ids[row["state"]]
        clickup_api.post(f"task/{ref}/field/{state_field_id}", api_key, {"value": option}, **kwargs)
        clickup_api.post(
            f"task/{ref}/field/{checked_field_id}", api_key, {"value": _epoch_ms(today)}, **kwargs
        )
        updated += 1
    return updated
