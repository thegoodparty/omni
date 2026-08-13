"""Write answer state back onto each Analytics Questions task (DATA-2316).

This is what makes the ClickUp list a complete surface for someone who does not open the
sheet: their question, its state, and when we last checked. It writes exactly two custom
fields and nothing else — no comments, no status changes, no task creation — so a governance
run can never be mistaken for a human working the list.

Unchanged states are skipped so a quiet week produces no task activity and therefore no
notification noise, which is the difference between a signal and a thing people mute.
"""

from __future__ import annotations

from datetime import date, datetime

import clickup_api

STATE_LABELS = {
    "answerable": "answerable",
    "partially_answerable": "partially answerable",
    "not_answerable": "not answerable",
}


def changed_rows(rows: list[dict], current: dict[str, str]) -> list[dict]:
    """Rows with a task to write to, whose state differs from what the task already says."""
    out = []
    for row in rows:
        ref = row.get("question_ref")
        if not ref:
            continue
        if current.get(ref) == row.get("state"):
            continue
        out.append(row)
    return out


def _epoch_ms(day: date) -> int:
    return int(datetime(day.year, day.month, day.day).timestamp() * 1000)


def fetch_current_state(
    api_key: str, list_id: str, *, state_field_name: str = "Answer state", requester=None
) -> dict[str, str]:
    """{task_id: state key} from the list as it stands, so we only write real changes."""
    kwargs = {"requester": requester} if requester else {}
    payload = clickup_api.get(
        f"list/{list_id}/task", api_key, params={"include_closed": "false"}, **kwargs
    ) or {}
    label_to_key = {v: k for k, v in STATE_LABELS.items()}
    out: dict[str, str] = {}
    for task in payload.get("tasks") or []:
        for field in task.get("custom_fields") or []:
            if field.get("name") != state_field_name:
                continue
            value = field.get("value")
            label = ""
            if isinstance(value, dict):
                label = str(value.get("name", ""))
            elif value is not None:
                label = str(value)
            if label in label_to_key:
                out[str(task.get("id"))] = label_to_key[label]
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
