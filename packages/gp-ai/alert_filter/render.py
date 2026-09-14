"""Build the Slack posts for one classified alert.

WHY RENDERING IS SEPARATE FROM CLASSIFYING: the decision is about where an alert
goes; this is about what a reader sees when it gets there. Keeping them apart is
what lets the mention-stripping rule be stated once, in one function, and tested
against the real notification text — including the case that matters most, an
`URGENT` post whose mention must survive intact.

THE MESSAGE BODY IS GRAFANA'S, NOT OURS. The `description` annotation is written
by whoever owns the alert (gp-api's alerts.ts), and it already contains the
environment tag, the window, and the "click View in Grafana and search for X"
instructions that make the alert actionable. Rewriting it here would fork that
prose into a repo its author does not read. So this module only ever wraps it:
a prefix in front, the filter's own finding behind, and — for everything except
an urgent alert — the subteam mention taken out.
"""

import re
from typing import Any

from .classify import ANNOTATE, NOTIFY, SUPPRESS, URGENT

# What an urgent alert is prefixed with. Loud on purpose and first on the line:
# in a channel people have learned to skim, the discriminator has to be visible
# before any of the words are read.
URGENT_PREFIX = ":rotating_light: *URGENT*"

# Slack's subteam mention syntax, `<!subteam^S0AD54G9D3K>` and the rarely-used
# `<!subteam^ID|@handle>` form. Written by gp-api's `buildAlertDescription`.
#
# MATCHED BY SHAPE RATHER THAN BY ID LIST, deliberately. A list of the two group
# ids this repo knows about would silently stop stripping the moment a third
# team started owning an alert — and "silently stops stripping" means every
# routine alert pings a team again, which is the state this whole filter exists
# to end.
SUBTEAM_MENTION = re.compile(r"<!subteam\^[A-Z0-9]+(?:\|[^>]*)?>")

# `@here`/`@channel`/`@everyone`, which no alert in this repo uses today. Here
# for the same reason as the shape-matching above: the stripping rule is "a
# non-urgent alert does not ping", and an alert that started using `<!here>`
# would otherwise bypass it entirely.
BROADCAST_MENTION = re.compile(r"<!(?:here|channel|everyone)(?:\|[^>]*)?>")


def strip_mentions(text: str) -> str:
    """Remove every ping from an alert body, leaving the prose readable.

    WHY NOT JUST DELETE THE MATCH: `buildAlertDescription` joins the mention on
    with a blank line, so a bare deletion leaves the message ending in two
    newlines and — in the grouped case — a paragraph gap in the middle. The
    trailing whitespace is collapsed afterwards for that reason, not for tidiness.

    Leaves user mentions (`<@U...>`) alone. Nothing provisions one today, and if
    something starts to, a named individual in an alert body is a deliberate
    choice by its author rather than the blanket team ping this is about.
    """
    without = BROADCAST_MENTION.sub("", SUBTEAM_MENTION.sub("", text))
    # Collapse the gap the removal leaves, then the trailing one. Done in this
    # order so a mention that sat between two paragraphs does not fuse them.
    return re.sub(r"\n{3,}", "\n\n", without).strip()


def body(alert: dict) -> str:
    """The alert's own text, preferring the body over the title.

    `description` is the field `buildAlertDescription` writes, and it is the one
    that carries the environment tag and the instructions. `summary` is the
    title and is a fallback rather than a supplement: including both would
    repeat the rule name and the environment tag twice in a two-line message.

    Falls back to the rule name, then to a flat statement that something fired.
    That last case should be unreachable, and it is here because the alternative
    when it is reached is posting an empty message — which reads, to whoever is
    on call, exactly like nothing having fired.
    """
    for key in ("description", "summary", "name"):
        value = alert.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "An alert fired, but its notification carried no text."


def _link(alert: dict) -> str | None:
    url = alert.get("url")
    return f"<{url}|View in Grafana>" if isinstance(url, str) and url else None


def _finding(decision: dict, alert: dict) -> str | None:
    """What the filter itself concluded, in one line, after the alert's own text.

    AFTER, not before. The alert body is what a reader needs in order to act;
    the filter's finding is context for it, and a message that leads with the
    robot's opinion trains people to scroll past the first line.

    Silent on a plain `NOTIFY`. There is nothing to add there — "no known cause
    matched" is the default state of every alert that has ever fired, and
    stamping it on each one would be noise added by the thing hired to remove
    noise. The exception is a degraded decision, which is a real fact about how
    much to trust the routing.
    """
    outcome = decision.get("outcome")
    reason = decision.get("reason")
    cause_id = decision.get("cause_id")

    if decision.get("degraded"):
        return f"_gpbot could not fully check this one: {reason}._"
    if outcome == ANNOTATE:
        summary = _cause_summary(alert, cause_id)
        return f"_gpbot: this looks like a known issue — {summary}_" if summary else None
    if outcome == URGENT:
        return f"_gpbot flagged this as urgent: {reason}_"
    if outcome == SUPPRESS:
        summary = _cause_summary(alert, cause_id)
        return f"_gpbot: {summary}_" if summary else None
    return None


def _cause_summary(alert: dict, cause_id: Any) -> str | None:
    for cause in alert.get("known_causes") or []:
        if isinstance(cause, dict) and cause.get("id") == cause_id:
            summary = cause.get("summary")
            return summary if isinstance(summary, str) and summary else None
    return None


def filtered_post(alert: dict, decision: dict) -> str:
    """What goes to the filtered channel.

    The mention survives only for `URGENT`, which is the single most important
    line in this module: `classify` decides whether an alert is worth a ping,
    and this is where that decision becomes true or not.
    """
    text = body(alert)
    if not decision.get("mention"):
        text = strip_mentions(text)

    parts = [f"{URGENT_PREFIX} {text}"] if decision.get("outcome") == URGENT else [text]
    finding = _finding(decision, alert)
    if finding:
        parts.append(finding)
    link = _link(alert)
    if link:
        parts.append(link)
    return "\n\n".join(parts)


def raw_post(alert: dict) -> str:
    """What goes to the raw channel: the alert exactly as Grafana sent it, minus
    the ping.

    UNFILTERED BUT NOT UNMODIFIED, and the difference is the point of the
    channel. Its job is to be the place where nothing is hidden — so the body is
    verbatim and every alert appears, suppressed ones included. But a channel
    that pings a subteam on every firing is a channel nobody can stay in, and
    the mention is the one thing that would make the raw channel as unusable as
    the filtered one was. Urgency lives in the filtered channel and in
    #bot-urgent; the raw channel is for reading, not for being woken by.
    """
    text = strip_mentions(body(alert))
    link = _link(alert)
    return f"{text}\n\n{link}" if link else text


def disposition_reply(decision: dict, alert: dict) -> str:
    """The thread reply under the raw post saying what the filter did with this.

    WHY EVERY ALERT GETS ONE: without it the raw channel is a firehose with no
    record of a decision, and there is no way to audit the filter except by
    diffing two channels by eye. With it, every firing carries its own
    disposition — so "what did gpbot hide last week, and was it right" is
    answerable by reading threads, which is also what makes the suppress list in
    the weekly digest checkable rather than merely reported.

    It names the cause id rather than only the summary. The id is what the
    metric is keyed on, so a reader who disagrees with a suppression can find
    every other firing it covered.
    """
    outcome = decision.get("outcome")
    reason = decision.get("reason")
    cause_id = decision.get("cause_id")

    if outcome == SUPPRESS:
        headline = f":mute: *suppressed* — `{cause_id}`"
    elif outcome == ANNOTATE:
        headline = f":information_source: *notified with context* — `{cause_id}`"
    elif outcome == URGENT:
        headline = ":rotating_light: *notified as urgent*"
    else:
        headline = ":bell: *notified*"

    lines = [f"{headline}\n{reason}"]
    if outcome != SUPPRESS:
        lines.append("_Posted to the filtered channel._")
    if decision.get("degraded"):
        # Said in the thread as well as in the post, because this is the line
        # that tells someone auditing the filter that a NOTIFY was a fallback
        # rather than a judgement — and the two need different follow-up.
        lines.append("_This was a fallback, not a judgement: the filter notified because it could not decide._")
    return "\n".join(lines)


def urgent_mirror(alert: dict, decision: dict, raw_permalink: Any = None) -> str:
    """The copy that goes to the urgent channel.

    Carries the mention and a link back to the raw post rather than repeating
    the full body, so the urgent channel stays scannable as a list of "things
    that needed someone" — which is the only thing it is for.
    """
    text = body(alert)
    parts = [f"{URGENT_PREFIX} {text}", f"_{decision.get('reason')}_"]
    for url, label in ((alert.get("url"), "View in Grafana"), (raw_permalink, "Full alert")):
        if isinstance(url, str) and url:
            parts.append(f"<{url}|{label}>")
    return "\n\n".join(parts)


# Re-exported so the handler never has to import `classify` just to ask whether
# a decision is a plain notify.
__all__ = [
    "ANNOTATE",
    "NOTIFY",
    "SUPPRESS",
    "URGENT",
    "URGENT_PREFIX",
    "body",
    "disposition_reply",
    "filtered_post",
    "raw_post",
    "strip_mentions",
    "urgent_mirror",
]
