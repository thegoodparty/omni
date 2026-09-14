"""Run a known cause's LogQL query and return the lines it matched.

WHY THE FILTER READS LOGS AT ALL: this is the load-bearing answer to what the
noise in #dev-alerts actually is. It is not repeat firings — Grafana already
groups and re-notifies on its own schedule. It is alerts that are
indistinguishable from a real incident until somebody opens Grafana and reads
one field. A pack build that timed out on an oversized district and a pack build
that hit an unhandled exception produce the same Slack message, because the
message is written from the rule and the rule counts events. So a filter that
only reads the notification can only ever guess, and a guessing filter has to
notify — which is no filter at all.

This module is what lets the filter do the log-reading step before a human is
asked to. It is deliberately dumb: it runs the query the registry gave it,
returns what came back, and makes no judgement about what the lines mean. The
judgement is the classifier's, and the routing is classify.py's.

COST IS THE REAL CONSTRAINT, not latency. A registry entry's `evidence` runs on
every firing of its alert, and Loki bills decompressed bytes — so an
under-narrowed query is a bill that arrives monthly rather than an error that
arrives now. Three things here exist for that reason and no other: the result
limit, the time window, and `MAX_QUERIES_PER_ALERT`. gp-api's
global-alerts.test.ts refuses an evidence query with no line filter for the same
reason, at the other end.

EVERY FAILURE IS REPORTED, NEVER SWALLOWED. A query that times out returns an
error rather than an empty result, because "no lines matched" and "we could not
look" mean opposite things to classify.py: the first is grounds to reject a
cause, the second is grounds to notify. Collapsing them would make a Loki
outage look like a week in which no known cause ever matched — which is a
correct-looking filter that has silently stopped filtering.
"""

import json
import time
import urllib.error
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# How far back an evidence query looks.
#
# WIDER THAN THE ALERT'S OWN WINDOW, on purpose. The rules this filter sits in
# front of evaluate over 10 minutes to 6 hours, and by the time a notification
# has been grouped, routed and delivered, the lines that caused it are already a
# few minutes behind. A window that only just covered the rule's would
# intermittently find nothing for a cause that was plainly true, and
# "intermittently finds nothing" reads as "rejected" — which notifies. Safe, but
# it would make the registry look useless.
LOOKBACK_SECONDS = 3600

# How many log lines one query may return.
#
# The classifier reads these, so this is a prompt-size limit as much as a Loki
# one. It is also why `confirmedBy` in the registry is phrased as a condition
# over every matched line rather than over "the logs": a sample is what the
# condition is actually checked against, and a condition that needs all of them
# cannot be checked here at any limit.
MAX_LINES = 50

# Bytes of any single log line passed on. A stack trace can be kilobytes and
# the discriminating field is almost always near the front; the whole trace in
# the prompt costs tokens on every firing and buys nothing the first 2KB did
# not already say.
MAX_LINE_BYTES = 2_000

# How many evidence queries one alert may run, however many causes it declares.
#
# A ceiling rather than a budget, and it is about the failure where somebody
# adds a twelfth cause to a chatty alert and the Loki bill moves without anyone
# connecting the two. Causes past the limit are reported as ungathered, which
# degrades the decision — so the filter notifies rather than deciding on a
# partial registry. Noisy in the right direction: it makes the ceiling visible
# in #dev-alerts instead of on an invoice.
MAX_QUERIES_PER_ALERT = 6

# Seconds to wait on one Loki query. Grafana's own webhook delivery gives up
# well before a Lambda's ceiling, so a slow query does not merely delay this
# decision — it risks Grafana retrying the delivery and the alert being posted
# twice. Better to degrade to NOTIFY quickly.
QUERY_TIMEOUT_SECONDS = 8


class EvidenceError(Exception):
    """A query that could not be run or read. Never raised past `gather`."""


def gather(
    causes: Any,
    *,
    query: Any = None,
    now: float | None = None,
) -> tuple[dict[str, dict], list[str]]:
    """Run each cause's evidence query. Returns (results, degraded).

    `results` maps cause id → {"lines": [...], "query": ...} for each cause that
    has an `evidence` query and got an answer, plus an entry with an empty
    `lines` list for a query that legitimately matched nothing.

    `degraded` lists what could not be gathered, in the shape classify.py reads:
    any non-empty list routes the alert to NOTIFY. This is the whole reason the
    function returns two values instead of raising — a partial answer is usable
    for the metric and for the Slack thread, it just must not be used to
    suppress anything.

    A CAUSE WITH NO `evidence` IS NOT A FAILURE and does not appear in either
    return value. Those are the causes a per-route alert's own labels already
    settle, which is cheaper and is the right call when there is nothing extra
    to learn from the logs.
    """
    causes = causes if isinstance(causes, list) else []
    query = query or _query_loki
    now = time.time() if now is None else now

    results: dict[str, dict] = {}
    degraded: list[str] = []
    queried = 0

    for cause in causes:
        if not isinstance(cause, dict):
            continue
        logql = cause.get("evidence")
        cause_id = cause.get("id")
        if not logql or not cause_id:
            continue

        if queried >= MAX_QUERIES_PER_ALERT:
            degraded.append(
                f"{cause_id}: not checked, this alert declares more than "
                f"{MAX_QUERIES_PER_ALERT} causes with evidence queries"
            )
            continue

        queried += 1
        try:
            lines = query(logql, start=now - LOOKBACK_SECONDS, end=now)
        except EvidenceError as e:
            # NOT an empty result. "No lines matched" is grounds to reject a
            # cause; "we could not look" is grounds to notify, and the two must
            # not arrive here looking the same.
            degraded.append(f"{cause_id}: evidence query failed ({e})")
            continue
        results[cause_id] = {"query": logql, "lines": lines}

    return results, degraded


def queries_run(results: Any) -> int:
    """How many queries a gather actually made, for the metric."""
    return len(results) if isinstance(results, dict) else 0


def _truncate(line: Any) -> str:
    text = line if isinstance(line, str) else json.dumps(line, default=str)
    encoded = text.encode("utf-8", "replace")
    if len(encoded) <= MAX_LINE_BYTES:
        return text
    # Cut on a byte boundary and repair the edge, rather than slicing the string
    # by characters: the limit is about prompt bytes, and a JSON line full of
    # multi-byte content would otherwise pass a character check and blow the
    # byte one.
    return encoded[:MAX_LINE_BYTES].decode("utf-8", "ignore") + " …[truncated]"


def _query_loki(logql: str, *, start: float, end: float) -> list[str]:
    """One Loki range query against Grafana Cloud, over stdlib HTTP.

    Stdlib rather than a client library because this ships in a Lambda zip
    alongside clickup_bot's handler, which is stdlib + boto3 and nothing else.
    A dependency here would mean a layer to build and keep in step, for one
    GET.

    Reads its credentials from the environment at call time, not at import.
    Import-time reads make the module unimportable in a test that has not set
    them up, and the tests for this file exercise `gather` with a fake query
    precisely so that none of them need a Loki at all.
    """
    import os

    base = os.environ.get("LOKI_URL")
    user = os.environ.get("LOKI_USER")
    token = os.environ.get("LOKI_TOKEN")
    if not (base and user and token):
        raise EvidenceError("Loki credentials are not configured")

    params = urlencode(
        {
            "query": logql,
            # Nanoseconds; Loki accepts RFC3339 too, but an integer cannot be
            # mangled by a timezone assumption.
            "start": int(start * 1_000_000_000),
            "end": int(end * 1_000_000_000),
            "limit": MAX_LINES,
            # Newest first, so a truncated result is the recent end of the
            # window rather than an arbitrary slice of it. The lines that
            # explain a firing are the ones nearest to it.
            "direction": "backward",
        }
    )
    request = Request(
        f"{base.rstrip('/')}/loki/api/v1/query_range?{params}",
        headers={"Accept": "application/json"},
        method="GET",
    )
    # Basic auth, which is what Grafana Cloud's Loki datasource takes: the
    # numeric stack user and an access token as the password.
    import base64

    credentials = base64.b64encode(f"{user}:{token}".encode()).decode("ascii")
    request.add_header("Authorization", f"Basic {credentials}")

    try:
        with urlopen(request, timeout=QUERY_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        # The status, never the body. A Loki error body echoes the query, and
        # the query is registry text that reaches a prompt downstream.
        raise EvidenceError(f"Loki returned HTTP {e.code}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise EvidenceError(f"Loki unreachable ({type(e).__name__})") from e
    except json.JSONDecodeError as e:
        raise EvidenceError("Loki returned a body that was not JSON") from e

    return _lines_from(payload)


def _lines_from(payload: Any) -> list[str]:
    """The log lines out of Loki's query_range response.

    Shape: {"data": {"result": [{"stream": {...}, "values": [[ns, line], ...]}]}}
    for a log query, and a different shape entirely for a metric query. Only the
    log shape is read; a metric query yields no lines, which is honest — a
    registry entry whose evidence is a metric query has written something this
    module cannot check, and the classifier should see nothing rather than a
    number it will misread as a log line.
    """
    data = payload.get("data") if isinstance(payload, dict) else None
    result = data.get("result") if isinstance(data, dict) else None
    lines: list[str] = []
    for stream in result if isinstance(result, list) else []:
        values = stream.get("values") if isinstance(stream, dict) else None
        for entry in values if isinstance(values, list) else []:
            if isinstance(entry, (list, tuple)) and len(entry) >= 2:
                lines.append(_truncate(entry[1]))
            if len(lines) >= MAX_LINES:
                return lines
    return lines
