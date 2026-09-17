"""ClickUp object ids for the Analytics Questions list (DATA-2316).

Pointers, not credentials: a list id and five field/option ids, inert without
CLICKUP_API_KEY. They live here so the loop has no required configuration — the only
thing an operator supplies is the token — and so there is exactly one place to edit if
the list is ever rebuilt. Callers still let an env var of the same name win, which is
the escape hatch for pointing a run at a scratch list.
"""

from __future__ import annotations

LIST_ID = "901328192602"
STATE_FIELD_ID = "a70134c2-467d-4f9e-b14f-1530d796c35f"    # "answer state"
CHECKED_FIELD_ID = "e85b0387-00a5-4e24-9fed-08453ffcb7b3"  # "last checked"

# Keyed by question_writeback.STATE_LABELS' keys.
OPTION_IDS = {
    "answerable": "71093466-4a7c-4b39-8c1d-10507006a425",
    "partially_answerable": "5550de83-518e-444d-ac73-d13da170632a",
    "not_answerable": "d4228860-5d2a-4738-880f-6fb421529e04",
}
