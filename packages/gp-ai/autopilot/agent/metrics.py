"""One structured line per stage run, so counting autopilot runs stops being an
exercise in log archaeology.

Modeled on engineer_agent/agent/metrics.py — same worry (a number scraped out
of prose drifts silently the moment the prose is reworded), adapted for
autopilot's stage runs, which have no analyze/implement "verdict" to parse: a
stage run either finished, parked itself waiting on a human, exhausted its
budget, hit its deadline, or errored. That is `outcome` below, computed from
the same fields `run_agent` already returns (main.py stamps a successful run's
result with `parked_stage` via feedback.apply_park_outcome before this runs)
rather than re-derived from a second source of truth.

    AUTOPILOT_METRIC {"task_id": ..., "stage": ..., "outcome": ..., ...}

`aws logs filter-log-events --filter-pattern AUTOPILOT_METRIC` is then the
entire query — no Insights query to start and poll, no join, no second log
group.
"""

import json
import math
from typing import Any

# What the CloudWatch filter pattern matches. A DIFFERENT token from
# engineer_agent's GPBOT_METRIC on purpose: `filter-log-events` matches a bare
# substring anywhere in the message, and these two systems' runs must never be
# summed into one count.
METRIC_PREFIX = "AUTOPILOT_METRIC"

# Cost is reported to the hundredth of a cent because that is what the SDK
# hands over and rounding it further would make a $0.23 run and a $0.234 run
# indistinguishable in a per-stage median. Rounding at all is about the other
# end: repr of a float total prints 3.7100000000000004, which reads like
# precision the number does not have.
COST_DECIMAL_PLACES = 4

# Tenths of a second on a run measured in minutes.
DURATION_DECIMAL_PLACES = 1


def _number(value: Any, places: int) -> float | None:
    """A JSON-safe number, or None when the value cannot be trusted as one.

    NONE RATHER THAN 0.0: a cost of 0.0 is a claim (that run was free), and a
    missing/unreadable value coerced to it would understate spend with nothing
    anywhere to say so. NaN/infinity are excluded because json.dumps writes
    them as bare, non-JSON tokens that would break the whole line for a reader
    parsing it back.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value):
        return None
    return round(float(value), places)


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _outcome(result: dict) -> str:
    """The one-word verdict on how the run ended.

    Read off `error_subtype`, which is `_consume_agent_stream`'s own
    classification, rather than re-inspecting cost/duration here — a second
    heuristic would eventually disagree with the one that actually ended the
    run. `parked_stage` is the same idea applied to parking: main.py sets it
    (see feedback.apply_park_outcome) rather than this function re-deriving
    "did this run park" from anything else.
    """
    if result.get("status") == "success":
        return "feedback_parked" if result.get("parked_stage") else "success"
    subtype = result.get("error_subtype")
    if subtype == "error_max_budget_usd":
        return "budget_exhausted"
    if subtype == "error_deadline_exceeded":
        return "deadline_exceeded"
    return "error"


def format_metric_line(result: Any, stage: Any, duration_s: Any = None, epic_task_id: Any = None) -> str:
    """The one line a run emits about itself.

    Every field is always present, `null` when it does not apply — so a
    reader can tell "this run had no epic" from "this line predates the
    field", which need different responses.

    Total over any input, deliberately: this runs after the stage's own work
    is already done, so an exception here would turn a useful run into a
    task-failure alarm.
    """
    result = result if isinstance(result, dict) else {}

    fields = {
        "task_id": _text(result.get("task_id")),
        "stage": _text(stage),
        "outcome": _outcome(result),
        "cost_usd": _number(result.get("cost_usd"), COST_DECIMAL_PLACES),
        "duration_s": _number(duration_s, DURATION_DECIMAL_PLACES),
        "epic_task_id": _text(epic_task_id),
    }

    # One line, no indentation, prefix first — filter-log-events returns whole
    # messages, so the consumer splits on the prefix and parses the remainder.
    return f"{METRIC_PREFIX} {json.dumps(fields)}"
