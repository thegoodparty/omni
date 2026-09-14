"""One structured line per alert the filter handled.

SAME CONTRACT, SAME REASONS as engineer_agent/agent/metrics.py — read that
module's header for the full argument. The short version is that this system has
already gone dark for a fortnight while every dashboard read healthy, because
the thing that stopped was the thing nobody was counting.

    GPALERT_METRIC {"slug": ..., "outcome": ..., "cause_id": ..., ...}

A SEPARATE PREFIX FROM GPBOT_METRIC, and it has to be: `filter-log-events`
matches the token as a bare substring, so a shared prefix would put alert
decisions into the digest's verdict counts and its cost total. Naming it
`GPBOT_ALERT_METRIC` would have done exactly that, since that string contains
`GPBOT_METRIC`... no, it does not — but `GPBOT_METRIC_ALERT` would, and the
mistake is one character away either direction. `GPALERT_METRIC` shares no
prefix with it at all, which is the only version of this that cannot go wrong.

WHAT THIS IS FOR, concretely: the weekly digest has to answer two questions that
nothing else can. "What did we suppress, and how often" — which is the list of
things humans stopped seeing, and the only way anyone can review whether that
was right. And "is the filter still filtering" — a filter that has quietly
started notifying on everything looks, from inside #dev-alerts, like a busy
week.

THE FIELD NAMES ARE A CONTRACT with clickup_bot/weekly_digest.py. Adding a field
is free; renaming or removing one silently drops a line from the Monday message
and nothing goes red.
"""

import json
from typing import Any

# See the header: this must share no prefix with GPBOT_METRIC.
METRIC_PREFIX = "GPALERT_METRIC"

# Cents. The classifier runs a small model against a notification and a page of
# logs, so a single decision costs a fraction of a cent and a week of them
# should cost less than one gpbot analysis. That is a claim the digest ought to
# be able to check, which is the only reason cost is recorded at all.
COST_DECIMAL_PLACES = 6


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _cost(value: Any) -> float | None:
    """None rather than 0.0 for an unreadable cost.

    A 0.0 is a claim that the decision was free, and the digest sums these: one
    absent cost coerced to zero understates the week with nothing to say so.
    Same rule, same reasoning as the gpbot metric's `_number`.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        if value != value or value in (float("inf"), float("-inf")):  # NaN / inf
            return None
    except TypeError:
        return None
    return round(float(value), COST_DECIMAL_PLACES)


def format_metric_line(alert: Any, decision: Any, *, cost_usd: Any = None, evidence_queries: Any = None) -> str:
    """The one line a handled alert emits about itself.

    Every field is always present, `null` when it does not apply — so the digest
    can tell "this alert had no matching cause" from "this line predates the
    field", which need different responses from whoever reads the Monday message.

    TOTAL OVER ANY INPUT, deliberately, and this one matters more than gpbot's
    equivalent. This is called after the alert has already been posted to Slack.
    An exception here would turn a correctly-routed alert into a Lambda error —
    and Grafana retries a webhook that errors, so the alert would then be posted
    a second time. Failing to record a decision is much cheaper than
    double-posting one.
    """
    alert = alert if isinstance(alert, dict) else {}
    decision = decision if isinstance(decision, dict) else {}

    fields = {
        # The join key back to gp-api's alerts.ts, and what the digest groups by.
        # Null for a rule this repo did not provision, rather than backfilled
        # from the rule name: a prose-derived key changes when someone fixes a
        # typo, which would restart that alert's history.
        "slug": _text(alert.get("slug")),
        "name": _text(alert.get("name")),
        "environment": _text(alert.get("environment")),
        "outcome": _text(decision.get("outcome")),
        "cause_id": _text(decision.get("cause_id")),
        "reason": _text(decision.get("reason")),
        # Whether this routing was a judgement or a fallback. The digest reports
        # these separately, because a week of NOTIFY decisions means one thing if
        # the filter chose them and something entirely different if it spent the
        # week unable to reach Loki.
        "degraded": bool(decision.get("degraded")),
        # Whether a human was pinged. Derivable from `outcome` today, recorded
        # anyway: it is the single number that says how loud this system was,
        # and it should not depend on the digest agreeing with this module about
        # which outcomes ping.
        "mentioned": bool(decision.get("mention")),
        "cost_usd": _cost(cost_usd),
        # How many Loki queries this decision ran. The registry's per-cause
        # `evidence` runs on every firing of its alert, so this is what turns
        # "narrow your queries" from advice into something observable before the
        # bill arrives.
        "evidence_queries": evidence_queries if isinstance(evidence_queries, int) else None,
        # Grafana's fingerprint for this alert instance, so a replay that slipped
        # past dedup is identifiable in the digest rather than showing up as a
        # genuinely busier week.
        "fingerprint": _text(alert.get("fingerprint")),
    }

    return f"{METRIC_PREFIX} {json.dumps(fields)}"
