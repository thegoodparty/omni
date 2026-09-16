"""The webhook Grafana posts every alert to, in front of #dev-alerts.

WHERE THIS SITS: Grafana's contact point for the dev-alerts route points here
instead of at Slack. Nothing else changes about how alerts are defined or
evaluated — the rules, their windows, their ownership and their message text all
stay in gp-api's alerts.ts, where the people who own them work. This function
only decides which channel each firing lands in and whether it pings anybody.

WHY INTERCEPT RATHER THAN TUNE THE RULES: because the noise is not a threshold
problem. A pack build that timed out on an oversized district and one that hit
an unhandled exception are the same event to the rule that counts them, and no
threshold separates them. Telling them apart means reading one field in Grafana,
which is work — so it did not get done, and the channel filled with alerts that
each needed five minutes before anyone could say whether they mattered. This
does that reading first.

THE FOUR INVARIANTS, in the order they matter:

  1. EVERY ALERT IS POSTED SOMEWHERE. The raw channel gets all of them,
     including suppressions, before any decision is made. There is no code path
     here in which an alert Grafana delivered reaches nobody.

  2. UNCERTAINTY NOTIFIES. Loki down, model down, payload unreadable, an
     exception in the middle — each of those posts the alert to the filtered
     channel with a note saying the filter could not decide. A filter that goes
     quiet when it breaks looks exactly like a filter that is working.

  3. A REPLAY IS NOT A SECOND ALERT. Grafana retries a delivery it did not get a
     2xx for, and it does so with the same fingerprints. Without dedup a slow
     Loki query turns one alert into three posts and three model calls.

  4. 200 EVEN ON FAILURE, once anything has been posted. Returning 5xx asks
     Grafana to redeliver, and a redelivery after a successful post is a
     duplicate in a channel people are being asked to trust. Failures go to the
     log, where the Lambda error alarm reads them.

SHADOW MODE is how this ships. With ALERT_FILTER_MODE=shadow the filtered
channel gets every alert exactly as it does today, mentions and all, while the
raw channel and the metrics record what the filter WOULD have done. So the
suppress list can be reviewed against a week of real firings before anything
starts being hidden — see the README.
"""

import base64
import hmac
import json
import os
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

# Added to sys.path by the zip layout: the filter's pure modules ship beside
# this file. Kept as a flat import so the zip needs no package directory, which
# is how clickup_bot's handler is packaged too.
from alert_filter import classifier, evidence, metrics, payload, render  # noqa: E402
from alert_filter.classify import SUPPRESS, classify, notifies  # noqa: E402

SLACK_API = "https://slack.com/api"

# Fail fast on Slack. This function runs inside Grafana's webhook delivery
# window, and a slow post is worse than a failed one: if Grafana gives up it
# redelivers, and invariant 3 only holds for deliveries we finished processing.
SLACK_TIMEOUT_SECONDS = 8

CLIENT_CONFIG = Config(retries={"max_attempts": 2, "mode": "standard"}, connect_timeout=2, read_timeout=5)

_dynamodb = None
_secrets: dict | None = None


def secret(name: str) -> str:
    """One credential, from the environment if set and otherwise from the
    AI_SECRETS bundle.

    ENVIRONMENT FIRST, and the order is about testability rather than
    precedence: it is what lets every test in this suite run with no AWS at all,
    and it is why the pure modules read their credentials through `os.environ`
    directly. In prod none of these are set, so every lookup goes to Secrets
    Manager.

    THE POINT OF THE BUNDLE is that the four credentials this function needs —
    Slack bot token, Anthropic key, Loki token, webhook shared secret — never
    appear in the function's environment, where `get-function-configuration`
    shows them to anyone with Lambda read access, nor in Terraform state, where
    they would sit in plaintext in S3.

    Cached at module scope, so the fetch is once per cold start rather than once
    per alert. A failure is NOT cached: a Secrets Manager blip during one
    invocation should not poison the container for the rest of its life.
    """
    from_env = os.environ.get(name)
    if from_env:
        return from_env

    global _secrets
    if _secrets is None:
        environment = os.environ.get("ENVIRONMENT", "prod").upper()
        try:
            response = boto3.client("secretsmanager", config=CLIENT_CONFIG).get_secret_value(
                SecretId=f"AI_SECRETS_{environment}"
            )
            _secrets = json.loads(response["SecretString"])
        except Exception as e:
            # Returned empty rather than raised, because every caller already
            # handles an absent credential: no Loki token degrades the decision
            # to notify, no Anthropic key does the same, and no webhook secret
            # rejects the delivery. Raising here would instead surface as a
            # Lambda error, which Grafana retries — and a retry cannot fix a
            # missing secret, so it would just multiply the failure.
            print(f"ERROR: could not load AI_SECRETS_{environment}: {type(e).__name__}: {e}")
            return ""
    return str(_secrets.get(name) or "")


def _dynamodb_client():
    """Lazily cached, so tests can swap boto3.client for a fake.

    Same pattern and same reason as clickup_bot's handler: boto3.client re-runs
    endpoint resolution on every call, which is wasted milliseconds inside a
    delivery window.
    """
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.client("dynamodb", config=CLIENT_CONFIG)
    return _dynamodb


# How long a handled firing is remembered, for invariant 3.
#
# Grafana's own retry backoff is a few minutes, so this only has to outlast
# that. It must NOT outlast the alert's re-notify interval: Grafana re-notifies
# a still-firing alert on a schedule, and those are genuine repeat notifications
# that should be posted again. A dedup window longer than that interval would
# silently swallow them, which is the one way this function could drop an alert
# that Grafana intended to deliver.
DEDUP_TTL_SECONDS = 600

# The two modes. `shadow` is the ramp; `enforce` is the point of the exercise.
# Anything else is read as shadow, because an unrecognised mode is a
# misconfiguration and the safe reading of a misconfiguration is "change
# nothing".
MODE_SHADOW = "shadow"
MODE_ENFORCE = "enforce"


def mode() -> str:
    configured = (os.environ.get("ALERT_FILTER_MODE") or "").strip().lower()
    return MODE_ENFORCE if configured == MODE_ENFORCE else MODE_SHADOW


# Credentials the PURE modules read, which they do through `os.environ` so that
# neither of them needs boto3 or a test with an AWS client in it. The handler
# resolves them from the bundle and puts them there, which keeps the fetch in
# one place and keeps evidence.py and classifier.py importable anywhere.
_PURE_MODULE_SECRETS = ("LOKI_TOKEN", "ANTHROPIC_API_KEY")


def _hydrate_environment() -> None:
    """Put the pure modules' credentials where they look for them.

    Only fills what is missing, so a test or a local run that set one wins. Runs
    per invocation rather than at import: `secret` caches the bundle, so this
    costs a dict lookup after the first call, and doing it at import would make
    the module unimportable without AWS.
    """
    for name in _PURE_MODULE_SECRETS:
        if not os.environ.get(name):
            value = secret(name)
            if value:
                os.environ[name] = value


def handler(event: Any, _context: Any = None) -> dict:
    """One Grafana webhook delivery.

    Returns an ALB-shaped response. The status code is load-bearing in exactly
    one direction — see invariant 4 — so it is 401 for a request that failed
    authentication and 200 for everything else, including our own failures.
    """
    if not _authenticated(event):
        # The only 4xx here. A wrong secret is not a delivery to retry, and
        # saying so plainly is better than letting a misconfigured contact point
        # look like a filter that has stopped working.
        print("ERROR: rejected a webhook delivery with a missing or wrong shared secret")
        return _response(401, {"error": "unauthorized"})

    try:
        body = _body(event)
    except ValueError as e:
        # Loud, because this is either a Grafana schema change or a bug in the
        # ALB integration, and both mean every alert is currently going
        # unfiltered. Nothing was posted, so there is nothing to duplicate —
        # but a 200 is still right: a redelivery would fail identically.
        print(f"ERROR: could not read the webhook body: {e}")
        return _response(200, {"handled": 0, "error": "unreadable body"})

    if payload.is_resolved(body):
        # Nothing to do, and deliberately not logged as an error. An alert
        # recovering is the system working.
        return _response(200, {"handled": 0, "resolved": True})

    alerts = payload.firings(body)
    if not alerts:
        # Distinct from the resolved case above: this is a firing delivery we
        # could not find any alerts in, which means the parser and Grafana
        # disagree about the schema. Every alert in this delivery has just been
        # dropped, so it is an error even though there is nothing to post.
        print("ERROR: a firing delivery contained no readable alerts")
        return _response(200, {"handled": 0, "error": "no readable alerts"})

    # AFTER authentication, deliberately. An unauthenticated request must not be
    # able to make this function fetch secrets — it is the one operation here
    # that costs money per call and can be rate-limited by AWS, so it is also
    # the one an open endpoint could be used to exhaust.
    _hydrate_environment()

    handled = 0
    for alert in alerts:
        try:
            _handle_one(alert)
            handled += 1
        except Exception as e:
            # PER ALERT, not per delivery. A grouped delivery carries several
            # alerts and one of them failing must not discard the rest —
            # dropping four alerts because the first hit an unexpected shape is
            # the worst outcome available here.
            #
            # The fallback is to post it unfiltered, which honours invariant 2
            # even when the failure is inside the code that implements it.
            print(f"ERROR: failed to handle an alert ({type(e).__name__}: {e}); posting it unfiltered")
            _post_unfiltered(alert)

    return _response(200, {"handled": handled})


def _handle_one(alert: dict) -> None:
    """Gather, decide, post, record — in that order, for one alert.

    THE ORDER IS THE POLICY. The raw post happens before the decision is acted
    on, so invariant 1 holds even if the filtered post fails. The metric is
    written last, after everything a human can see, because a failure to record
    a decision is much cheaper than a failure to deliver one.

    IT IS ALSO WHAT BOUNDS THE DEDUP CLAIM. `_claim` writes before the raw post,
    so a container killed between the two leaves a claim with no post beneath
    it, and Grafana's retry is deduped away — that alert reaches nobody. The
    mitigation is the adjacency: the raw post is the very next statement, so the
    window is one Slack call wide, while everything that can actually consume
    the 60s budget (the Loki queries, the model call) runs after it. A timeout
    will land in the slow half, by which point the post has already happened.

    CLAIMING AFTER THE RAW POST WAS REJECTED. It closes a window of milliseconds
    by opening one that is certain: every retry would re-post the full alert to
    the audit channel and return before writing a disposition under it, so the
    channel whose entire purpose is an auditable record fills with duplicates
    carrying no decision. A lease-then-extend claim would close both, at the
    cost of a second write per alert and a correctness dependency on Grafana's
    retry backoff being longer than the lease — too much machinery for a
    millisecond window.

    So the adjacency is load-bearing rather than incidental, and
    `TestTheClaimToRawPostWindow` pins it: move anything slow above the raw post
    and the exposure stops being theoretical.
    """
    if not _claim(alert):
        # A retry of a delivery already handled. Silent: Grafana retrying is
        # normal, and a log line per retry would train whoever reads this log
        # group to ignore it.
        return

    # Posted first and always, so the channel that hides nothing cannot be
    # affected by anything that happens below it.
    raw_ts = _post(os.environ.get("RAW_CHANNEL_ID"), render.raw_post(alert))

    gathered, evidence_degraded = evidence.gather(alert.get("known_causes"))
    verdicts, urgency, classifier_degraded, cost = classifier.classify_alert(alert, gathered)
    decision = classify(
        alert,
        verdicts,
        urgency=urgency,
        degraded=evidence_degraded + classifier_degraded,
    )

    if mode() == MODE_ENFORCE:
        if notifies(decision):
            _post(os.environ.get("FILTERED_CHANNEL_ID"), render.filtered_post(alert, decision))
        if decision.get("urgent"):
            _post(
                os.environ.get("URGENT_CHANNEL_ID"),
                render.urgent_mirror(alert, decision, _permalink(os.environ.get("RAW_CHANNEL_ID"), raw_ts)),
            )
    else:
        # SHADOW: the filtered channel keeps behaving exactly as it does today,
        # mention and all, whatever the filter concluded. The decision is still
        # recorded in the thread below and in the metric, which is what makes a
        # week of shadow data reviewable — without it, "would this have
        # suppressed something it should not have" is unanswerable except by
        # turning it on and finding out.
        #
        # `shadow_post` rather than `body`, because the Grafana link is on the
        # notification and not in the description annotation, and the channel is
        # only unchanged if it still has the link people click.
        _post(os.environ.get("FILTERED_CHANNEL_ID"), render.shadow_post(alert))

    if raw_ts:
        # The audit trail, and the reason every firing carries its disposition:
        # without it the raw channel is a firehose with no record of a decision,
        # and the suppress list in the weekly digest is a claim nobody can check.
        _post(
            os.environ.get("RAW_CHANNEL_ID"),
            render.disposition_reply(decision, alert),
            thread_ts=raw_ts,
        )

    print(
        metrics.format_metric_line(
            alert,
            # Recorded as what the filter DECIDED, not as what happened to the
            # channel. In shadow mode those differ by design, and a metric that
            # reported the posting instead of the decision would make a week of
            # shadow data indistinguishable from a week with no filter at all.
            decision,
            cost_usd=cost,
            evidence_queries=evidence.queries_run(gathered),
        )
    )
    if mode() == MODE_SHADOW and decision.get("outcome") == SUPPRESS:
        # Named separately so a shadow week's suppressions are greppable
        # without parsing the metric, which is what the first review of the
        # suppress list will actually be done with.
        print(f"SHADOW: would have suppressed {alert.get('slug')} as {decision.get('cause_id')}")


def _post_unfiltered(alert: dict) -> None:
    """The last-resort path: get the alert in front of someone, verbatim.

    Reached only from the per-alert exception handler, so it must not use
    anything that could have been the thing that threw. No classification, no
    evidence, no rendering beyond the body — and a note saying the filter fell
    over, because an alert that arrives looking normal after the filter crashed
    would misrepresent how much to trust the rest of the channel.
    """
    try:
        _post(
            os.environ.get("FILTERED_CHANNEL_ID"),
            f"{render.body(alert)}\n\n_gpbot could not process this alert, so it is posted unfiltered._",
        )
    except Exception as e:
        # Nothing left to try. Logged rather than raised so the remaining alerts
        # in the delivery still get their turn.
        print(f"ERROR: could not post an alert even unfiltered: {type(e).__name__}: {e}")


def _claim(alert: dict) -> bool:
    """Whether this firing has already been handled. True = go ahead.

    Keyed on Grafana's fingerprint plus `startsAt`, not on the fingerprint
    alone. The fingerprint identifies the label set and is stable across
    firings, so on its own it would suppress the SECOND time an alert fired for
    real. `startsAt` changes when an alert goes from resolved back to firing,
    which is exactly the boundary that makes two firings two alerts.

    FAIL-OPEN, on the same reasoning as clickup_bot's dedup: a broken table
    costs a duplicate post, while a table that fails closed costs every alert in
    #dev-alerts. A firing with no fingerprint at all also proceeds — it cannot
    be deduped, and refusing to handle it would be choosing to drop it.
    """
    table = os.environ.get("DEDUP_TABLE_NAME")
    fingerprint = alert.get("fingerprint")
    if not table or not fingerprint:
        return True

    key = f"{fingerprint}#{alert.get('started_at') or ''}"
    try:
        _dynamodb_client().put_item(
            TableName=table,
            Item={"pk": {"S": f"alert#{key}"}, "expires_at": {"N": str(int(time.time() + DEDUP_TTL_SECONDS))}},
            # The expired arm matters for the same reason it does in
            # clickup_bot: DynamoDB TTL deletion can lag hours, and without it a
            # stale item would swallow a genuine re-notify.
            ConditionExpression="attribute_not_exists(pk) OR #exp < :now",
            ExpressionAttributeNames={"#exp": "expires_at"},
            ExpressionAttributeValues={":now": {"N": str(int(time.time()))}},
        )
        return True
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        print(f"ERROR: dedup table unavailable, handling without dedup: {e}")
        return True
    except Exception as e:
        print(f"ERROR: dedup table unavailable, handling without dedup: {e}")
        return True


def _post(channel: Any, text: str, thread_ts: Any = None) -> str | None:
    """One chat.postMessage. Returns the message ts, or None.

    NEVER RAISES. Every caller is in the middle of a sequence whose later steps
    still matter — a failed raw post must not stop the filtered post, and a
    failed thread reply must not stop the metric. So a failure is logged and
    reported as None, and the callers are written to cope with None.

    `unfurl_links` is off because an alert body is mostly one Grafana deep link,
    and Slack's unfurl of those is a large grey box with no information in it.
    """
    token = secret("SLACK_BOT_TOKEN")
    if not channel or not token:
        print(f"ERROR: cannot post to Slack: {'no channel configured' if not channel else 'no bot token'}")
        return None

    body = {"channel": channel, "text": text, "unfurl_links": False, "unfurl_media": False}
    if thread_ts:
        body["thread_ts"] = thread_ts

    request = Request(
        f"{SLACK_API}/chat.postMessage",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=SLACK_TIMEOUT_SECONDS) as response:
            parsed = json.loads(response.read().decode("utf-8", "replace"))
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
        print(f"ERROR: Slack post failed: {type(e).__name__}: {e}")
        return None

    if not parsed.get("ok"):
        # Slack's own error string, which is the actionable part:
        # `not_in_channel` and `channel_not_found` are the two setup mistakes
        # this will actually hit, and both are invisible without this line.
        print(f"ERROR: Slack rejected the post: {parsed.get('error')}")
        return None
    ts = parsed.get("ts")
    return ts if isinstance(ts, str) else None


def _permalink(channel: Any, ts: Any) -> str | None:
    """A link to the raw post, built rather than fetched.

    `chat.getPermalink` would be authoritative and costs a round trip inside the
    delivery window for a link that only garnishes the urgent mirror. The
    constructed form works for any public channel in the workspace.
    """
    workspace = os.environ.get("SLACK_WORKSPACE_DOMAIN")
    if not (workspace and channel and isinstance(ts, str) and ts):
        return None
    return f"https://{workspace}.slack.com/archives/{channel}/p{ts.replace('.', '')}"


def _authenticated(event: Any) -> bool:
    """Whether this delivery carries the shared secret.

    HTTP basic auth, because that is what Grafana's webhook contact point can
    send without a custom notifier. Compared with `hmac.compare_digest` rather
    than `==`: the endpoint is on the public internet, and a timing-comparable
    secret check on a public endpoint is a real weakness even when the payload
    behind it is only alerts.

    NO SECRET CONFIGURED MEANS NOTHING IS ACCEPTED. Every other failure in this
    file fails open, and this is the one that must not: an open endpoint here
    lets anyone post arbitrary text into an engineering Slack channel, which is
    a phishing primitive rather than an inconvenience.
    """
    expected = secret("WEBHOOK_SECRET")
    if not expected:
        print("ERROR: WEBHOOK_SECRET is not configured, so no delivery can be authenticated")
        return False

    headers = event.get("headers") if isinstance(event, dict) else None
    header = (headers or {}).get("authorization") or (headers or {}).get("Authorization") or ""
    if not header.lower().startswith("basic "):
        return False
    try:
        decoded = base64.b64decode(header[6:].strip(), validate=True).decode("utf-8", "replace")
    except (ValueError, UnicodeDecodeError):
        return False
    _, _, password = decoded.partition(":")
    return hmac.compare_digest(password, expected)


def _body(event: Any) -> Any:
    """The JSON Grafana posted, out of an ALB event."""
    if not isinstance(event, dict):
        raise ValueError("event was not an object")
    raw = event.get("body")
    if event.get("isBase64Encoded") and isinstance(raw, str):
        raw = base64.b64decode(raw).decode("utf-8", "replace")
    if not isinstance(raw, str) or not raw:
        raise ValueError("event carried no body")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"body was not JSON: {e}") from e


def _response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "statusDescription": f"{status} OK" if status == 200 else f"{status} Unauthorized",
        "isBase64Encoded": False,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
