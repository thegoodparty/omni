"""Read one Grafana webhook delivery into the facts a routing decision needs.

WHY THIS IS ITS OWN MODULE: Grafana's webhook body is a grouped notification,
not an alert. One POST carries a `status`, a set of group labels, and an
`alerts[]` array whose entries each have their own labels, annotations and
values — and the array contains RESOLVED entries alongside firing ones when a
group changes shape mid-evaluation. Every interesting mistake this filter could
make starts with reading that body wrong:

  * treating a delivery as one alert when the group holds four,
  * carrying a resolved entry into a firing decision,
  * reading the group's labels when the entry's own are what identify it,
  * finding no `known_causes` because it sits on the alert, not the group.

So the parsing is pure, total, and tested against captured bodies, and the
handler never touches raw payload keys. Anything this module cannot read is
reported as unreadable rather than defaulted, because the fallback for an
unreadable notification is to notify — and that only works if "unreadable" is a
state the caller can see.

THE PAYLOAD IS UNTRUSTED INPUT. The endpoint is reachable from the internet
(Grafana Cloud posts to it over the public ALB), so nothing here may assume a
type, and annotation text reaches an LLM prompt downstream. See `known_causes`
below for why the registry is read from the annotation despite that.
"""

import json
from typing import Any

# Grafana's own vocabulary for the two things a delivery can say. Matched
# case-insensitively: the value is `firing`/`resolved` in the documented schema
# and has shipped capitalised in at least one Grafana version's test webhook.
STATUS_FIRING = "firing"
STATUS_RESOLVED = "resolved"

# The annotation carrying the alert's known-cause registry, serialised by
# gp-api's deploy/components/alerting/alert-notification.ts. THE NAME IS A
# CONTRACT WITH THAT FILE: renaming it on either side makes every alert look
# like it has no known causes, which fails safe (everything notifies) but
# silently undoes the entire feature. A test asserts the literal on both sides.
KNOWN_CAUSES_ANNOTATION = "known_causes"

# Labels Grafana attaches to every rule this repo provisions, from
# `alertToRule`. `alert_slug` is the join key back to alerts.ts and is what the
# weekly digest groups by; `environment` decides which Loki stream the evidence
# queries read.
SLUG_LABEL = "alert_slug"
ENVIRONMENT_LABEL = "environment"

# Grafana's own label for which rule fired, present even on rules this repo did
# not provision. Used only as a fallback identity, never as the digest's key: a
# rule name is prose and gets reworded, and a metric dimension that changes when
# someone fixes a typo restarts its own history.
RULE_NAME_LABEL = "alertname"


def _text(value: Any) -> str | None:
    """A non-empty string, or None. Used everywhere a field feeds a decision."""
    return value if isinstance(value, str) and value else None


def _mapping(value: Any) -> dict[str, str]:
    """A label or annotation map, keeping only the entries that are text.

    Grafana sends both as string→string. A non-string value is dropped rather
    than coerced, because every consumer of these maps treats a present key as
    a fact — `environment` in particular picks the log stream an evidence query
    reads, and `str(None)` would quietly send it to a stream named "None".
    """
    if not isinstance(value, dict):
        return {}
    return {k: v for k, v in value.items() if isinstance(k, str) and isinstance(v, str) and v}


def known_causes(annotations: dict[str, str]) -> list[dict]:
    """The alert's known-cause registry, as provisioned onto the rule.

    READ FROM THE NOTIFICATION rather than from a copy this repo keeps, and that
    is the central design decision of the whole filter. The registry describes
    what an alert's noise IS, which is knowledge that belongs to whoever owns
    the alert; a second copy here would drift the first time a query was retuned
    in a repo nobody working on the filter reads, and it would drift silently in
    the direction of suppressing things nobody had reviewed.

    THE OBVIOUS OBJECTION, and why it is answered elsewhere: this is
    attacker-influenceable text that ends up in an LLM prompt. It is not
    attacker-influenceable in practice — reaching it means write access to
    Grafana's provisioned rules — but the filter does not rely on that. It
    relies on the fact that no `action` in this registry can cause anything to
    happen: `suppress` only ever means "post to the raw channel instead", the
    raw channel always gets everything regardless, and no registry value can
    make the filter run a command, open a PR, or write to a ticket. The worst a
    forged registry achieves is hiding an alert from one channel while it sits
    in the other, which is also what a bug in this file achieves.

    A malformed annotation yields no causes, which means "notify". That is the
    same outcome as an alert with no registry at all, and it is the right
    direction to fail in.
    """
    raw = annotations.get(KNOWN_CAUSES_ANNOTATION)
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(parsed, list):
        return []
    # Each cause is filtered for the fields a decision reads, not merely
    # type-checked: a cause with no `id` cannot be reported as a metric, and one
    # with no `confirmedBy` cannot be confirmed against anything, so both are
    # dropped rather than carried forward as a cause that can never match.
    causes = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        cause_id, summary = _text(item.get("id")), _text(item.get("summary"))
        confirmed_by, action = _text(item.get("confirmedBy")), _text(item.get("action"))
        if not (cause_id and summary and confirmed_by and action in ("suppress", "annotate")):
            continue
        causes.append(
            {
                "id": cause_id,
                "summary": summary,
                "evidence": _text(item.get("evidence")),
                "confirmed_by": confirmed_by,
                "action": action,
                "ticket": _text(item.get("ticket")),
            }
        )
    return causes


def firings(payload: Any) -> list[dict]:
    """The firing alerts in one delivery, one dict per alert.

    A LIST, NOT AN ALERT, and it is the reason this function exists rather than
    a `parse_alert`. Grafana groups notifications: the controller alerts fire
    once per route, so a single delivery routinely carries several alerts that
    differ only in a label. Collapsing a delivery to its first entry would
    suppress a real regression whenever it happened to be grouped behind a known
    one, which is both the most likely way this filter hurts someone and
    completely invisible when it does.

    RESOLVED ENTRIES ARE DROPPED. They appear in the array when a group changes
    shape, and every one of them is an alert that has stopped being true — so
    classifying one would spend an LLM call and a Loki query to decide whether
    to notify somebody about a thing that is over. The delivery-level status is
    checked too, because a wholly-resolved delivery is Grafana telling us the
    group is clear.

    Anything unparseable yields an empty list. The handler distinguishes that
    from a genuinely resolved delivery — see `is_resolved`.
    """
    if not isinstance(payload, dict):
        return []
    if _status(payload.get("status")) == STATUS_RESOLVED:
        return []

    group_labels = _mapping(payload.get("groupLabels"))
    common_annotations = _mapping(payload.get("commonAnnotations"))

    raw_alerts = payload.get("alerts")
    parsed = []
    for alert in raw_alerts if isinstance(raw_alerts, list) else []:
        if not isinstance(alert, dict):
            continue
        if _status(alert.get("status")) == STATUS_RESOLVED:
            continue

        # The alert's own labels win, with the group's as fallback. That order
        # matters for exactly the fields the decision turns on: a grouped
        # delivery's `groupLabels` hold only what the group is keyed by, so a
        # per-route alert's `request_endpoint` lives on the alert alone — and
        # reading the group first would make four routes indistinguishable.
        labels = {**group_labels, **_mapping(alert.get("labels"))}
        annotations = {**common_annotations, **_mapping(alert.get("annotations"))}

        parsed.append(
            {
                "slug": labels.get(SLUG_LABEL),
                # Falls back to the rule name so an alert from a rule this repo
                # did not provision is still classifiable. `slug` stays None in
                # that case rather than being filled from the name, because the
                # digest keys on it and a prose-derived key is not a key.
                "name": labels.get(RULE_NAME_LABEL),
                "environment": labels.get(ENVIRONMENT_LABEL),
                "labels": labels,
                "summary": annotations.get("summary"),
                "description": annotations.get("description"),
                "known_causes": known_causes(annotations),
                # Grafana's per-alert deep link, which is what makes the Slack
                # message actionable. Absent on some delivery shapes, so every
                # renderer has to cope without it.
                "url": _text(alert.get("generatorURL")) or _text(alert.get("silenceURL")),
                # The fingerprint Grafana assigns to this label set. Stable
                # across firings of the same alert instance, which is what the
                # handler dedups replays on — Grafana retries a webhook that
                # times out, and a retry must not post twice or bill twice.
                "fingerprint": _text(alert.get("fingerprint")),
                "started_at": _text(alert.get("startsAt")),
                "values": alert.get("values") if isinstance(alert.get("values"), dict) else {},
            }
        )
    return parsed


def is_resolved(payload: Any) -> bool:
    """Whether this delivery says a group has cleared.

    Separate from `firings` returning empty, because the two need different
    responses: a resolved delivery is nothing to do, while an unparseable one is
    a bug in this file or a Grafana schema change, and the handler has to be
    able to notify loudly about the second without doing it every time an alert
    recovers.
    """
    return isinstance(payload, dict) and _status(payload.get("status")) == STATUS_RESOLVED


def _status(value: Any) -> str | None:
    text = _text(value)
    return text.strip().lower() if text else None
