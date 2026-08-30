"""One structured line per agent run, so counting runs stops being an exercise
in log archaeology.

WHY THIS EXISTS: every number anyone has ever wanted about this bot — how many
tickets it looked at, what it concluded, what it cost — had to be scraped out of
prose. The verdict lived in one log group, the cost in another (`Agent
completed: ... Cost: $X`), and the two were joined on an 8-character run id.
Nothing declared that contract, so rewording either line would have broken every
query silently, and the breakage would have looked exactly like a quiet week.

That is not a hypothetical failure mode here. This system went dark from
2026-07-31 to 2026-08-14 — 26 tagged tickets, 3 analyzed — while every dashboard
read healthy, because the thing that stopped was the thing nobody was counting.

So the run states its own outcome, once, in a shape a query can read:

    GPBOT_METRIC {"task_id": ..., "label": ..., "verdict": ..., ...}

`aws logs filter-log-events --filter-pattern GPBOT_METRIC` is then the entire
query. No Insights query to start and poll, no join, and no second log group.
CloudWatch retention on this group is 400 days, so a week's runs are still there
on a Monday however late the digest runs.

The consumer is `clickup_bot/weekly_digest.py`. THE FIELD NAMES ARE A CONTRACT
WITH IT: adding a field is free, renaming or removing one silently drops a line
from the Monday digest and nothing goes red.
"""

import json
import math
from typing import Any

from .escalation import parse_verdict

# What the CloudWatch filter pattern matches. Nothing else in this repo may log
# this token: `filter-log-events` matches it as a bare substring anywhere in the
# message, so a second emitter would double-count every run in the digest rather
# than fail in any visible way.
METRIC_PREFIX = "GPBOT_METRIC"

# Cost is reported to the hundredth of a cent because that is what the SDK
# hands over and rounding it further would make a $0.23 run and a $0.234 run
# indistinguishable in a per-analysis median. Rounding at all is about the other
# end: repr of a float total prints 3.7100000000000004, which reads like
# precision the number does not have.
COST_DECIMAL_PLACES = 4

# Tenths of a second on a run measured in minutes. It is here to answer "how
# long does an analysis take", not to profile anything.
DURATION_DECIMAL_PLACES = 1


def _number(value: Any, places: int) -> float | None:
    """A JSON-safe number, or None when the value cannot be trusted as one.

    NONE RATHER THAN 0.0, and this is the whole reason the coercion is not
    inline. A cost of 0.0 is a claim — that run was free — and a duration of 0.0
    says it finished instantly. Neither is what an unreadable field means, and
    the digest sums these: one absent cost silently coerced to zero would
    understate the week's spend with nothing anywhere to say so.

    NaN and infinity are excluded for a duller reason: `json.dumps` emits them
    as bare `NaN` / `Infinity`, which is not JSON, and the digest's parser would
    drop the whole line rather than the one bad field.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value):
        return None
    return round(float(value), places)


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def format_metric_line(result: Any, label: Any, escalation: Any, duration_s: Any = None) -> str:
    """The one line a run emits about itself.

    Every field is always present, `null` when it does not apply. Omitting a key
    instead would leave the digest unable to tell "this run had no verdict" from
    "this line came from a build that predates the field", and those need
    different responses from whoever reads the Monday message.

    THE VERDICT IS `parse_verdict`'S, not a second regex over the same text. The
    digest's verdict counts have to be the verdicts the system actually acted
    on; a private copy of that parsing would eventually disagree with the one
    gating escalation, and the report would then describe a bot nobody is
    running.

    `escalation` is `maybe_escalate`'s own return string rather than a boolean,
    because the interesting cases are the ones between yes and no: a `fix`
    verdict that ended in "disabled", "already queued" or "escalation failed" is
    a ticket the bot decided to fix and then did not, which is invisible in
    every other signal the digest has.

    Total over any input, deliberately. This is called after the analysis has
    already been posted to the ticket, so an exception here would convert a
    useful run into a task-failure alarm — the same trade `maybe_escalate`
    makes, and for the same reason.
    """
    result = result if isinstance(result, dict) else {}

    fields = {
        "task_id": _text(result.get("task_id")),
        "label": _text(label),
        # Read off `result`, which only a successful run carries, so an errored
        # or deadline-killed run reports a null verdict rather than one parsed
        # out of a partial analysis nobody trusted enough to escalate.
        "verdict": parse_verdict(result.get("result")),
        "status": _text(result.get("status")),
        "cost_usd": _number(result.get("cost_usd"), COST_DECIMAL_PLACES),
        "duration_s": _number(duration_s, DURATION_DECIMAL_PLACES),
        "escalation": _text(escalation),
    }

    # One line, no indentation, prefix first. `filter-log-events` returns whole
    # messages, so the consumer splits on the prefix and parses the remainder;
    # a pretty-printed object would arrive as a dozen unrelated events.
    return f"{METRIC_PREFIX} {json.dumps(fields)}"
