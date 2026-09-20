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
import re
from typing import Any

# What the CloudWatch filter pattern matches. A DIFFERENT token from
# engineer_agent's GPBOT_METRIC on purpose: `filter-log-events` matches a bare
# substring anywhere in the message, and these two systems' runs must never be
# summed into one count.
METRIC_PREFIX = "AUTOPILOT_METRIC"

# The only repo autopilot ever clones or opens a PR against (see main.py's
# BASE_PROMPT) — scoped rather than a bare "any github.com/.../pull/N", so an
# unrelated PR link a stage's final message happens to mention (a linked
# issue, a cited fix from another repo) is never mistaken for this run's own.
PR_URL_PATTERN = re.compile(r"https://github\.com/thegoodparty/omni/pull/\d+")

# First line of every run-summary comment (ENG-11151) — duplicated in
# lambda/router.py, which cannot import this module (see that module's
# RUN_SUMMARY_MARKER_PATTERN for why); a contract test pins the two
# character-identical. Cost is the ONLY field the sweep's status card needs
# back out of it (outcome and stage it already has from board state / the
# claim); duration and the PR link are for a human reading the thread, never
# re-parsed, so they stay out of the marker line.
RUN_SUMMARY_MARKER_PATTERN = re.compile(
    r"\[autopilot:run-summary stage=([a-z0-9][a-z0-9-]*) outcome=([a-z_]+)(?: cost_usd=([0-9]*\.?[0-9]+))?\]"
)

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


def _pr_url(result: dict) -> str | None:
    text = result.get("result")
    if not isinstance(text, str):
        return None
    match = PR_URL_PATTERN.search(text)
    return match.group(0) if match else None


def run_summary(result: Any, stage: Any, duration_s: Any = None, epic_task_id: Any = None) -> dict:
    """The one dict a run reports about itself — fed to BOTH sinks (the
    CloudWatch metric line and the ClickUp run-summary comment) so they can
    never drift into disagreeing about what a run's own outcome/cost/duration
    were. See format_metric_line and main.format_run_summary_comment.

    Every field is always present, `null` when it does not apply — so a
    reader can tell "this run had no epic" from "this line predates the
    field", which need different responses.

    Total over any input, deliberately: this runs after the stage's own work
    is already done, so an exception here would turn a useful run into a
    task-failure alarm.
    """
    result = result if isinstance(result, dict) else {}

    return {
        "task_id": _text(result.get("task_id")),
        "stage": _text(stage),
        "outcome": _outcome(result),
        "cost_usd": _number(result.get("cost_usd"), COST_DECIMAL_PLACES),
        "duration_s": _number(duration_s, DURATION_DECIMAL_PLACES),
        "epic_task_id": _text(epic_task_id),
        "pr_url": _pr_url(result),
    }


def format_metric_line(result: Any, stage: Any, duration_s: Any = None, epic_task_id: Any = None) -> str:
    """The one line a run emits about itself.

    One line, no indentation, prefix first — filter-log-events returns whole
    messages, so the consumer splits on the prefix and parses the remainder.
    """
    return f"{METRIC_PREFIX} {json.dumps(run_summary(result, stage, duration_s, epic_task_id))}"


def format_run_summary_marker(stage: str, outcome: str, cost_usd: float | None) -> str:
    marker = f"[autopilot:run-summary stage={stage} outcome={outcome}"
    if cost_usd is not None:
        marker += f" cost_usd={cost_usd}"
    return marker + "]"


def _format_usd(value: float | None) -> str:
    return f"${value:.2f}" if value is not None else "unknown"


def _format_duration(value: float | None) -> str:
    return f"{value:.1f}s" if value is not None else "unknown"


def format_run_summary_comment(summary: dict) -> str:
    """The ClickUp comment a run posts about itself at the end of every stage
    run (main.post_run_summary_comment). The marker line is the ONLY part
    another reader (sweep.py's status card, via router.latest_run_summary)
    parses back; everything below it is prose for a human in the thread.

    MUST NEVER carry a `[autopilot:parked ...]` or
    `[autopilot:slack-answer ...]` marker of its own — both the self-resume
    guard (router.route()'s commentPosted handling) and the sweep's
    reply-after-park check (sweep.auto_resume_actionable_parks) key off those
    exact markers to tell a genuine human answer from the bot's own writes,
    and a run-summary comment landing after a park is always the latter (see
    router.RUN_SUMMARY_MARKER_PATTERN's docstring for the reading half of
    this contract).
    """
    stage = summary.get("stage") or "unknown"
    outcome = summary.get("outcome") or "unknown"
    lines = [
        format_run_summary_marker(stage, outcome, summary.get("cost_usd")),
        "",
        f"**Outcome:** {outcome}",
        f"**Cost:** {_format_usd(summary.get('cost_usd'))}",
        f"**Duration:** {_format_duration(summary.get('duration_s'))}",
    ]
    if summary.get("pr_url"):
        lines.append(f"**PR:** {summary['pr_url']}")
    return "\n".join(lines)
