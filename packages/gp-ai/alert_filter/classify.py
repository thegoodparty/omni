"""Turn one firing alert plus its log evidence into a routing decision.

WHY THE DECISION IS A PURE FUNCTION: this module is the only place in the system
that can stop a human being told about a production alert. That power needs to
be exercised somewhere a test can hold it still — so every judgement lives here,
over plain dicts, and the handler does nothing but gather inputs and carry out
the `Decision` this returns. Nothing here opens a socket.

THE FOUR OUTCOMES, and why there are four rather than two:

  URGENT     notify, keep the subteam mention, prefix it, mirror to #bot-urgent
  NOTIFY     notify, mention stripped
  ANNOTATE   notify, mention stripped, and say which known cause this looks like
  SUPPRESS   raw channel only, answered in thread with which cause matched

`ANNOTATE` is the one that would be easy to leave out and is the reason the
registry is worth having at all. Most of the noise in #dev-alerts is not
repetition — it is alerts that read exactly like an incident until somebody
opens Grafana. A cause can be completely understood and still need a person:
a spike of a known-benign shape is what a real regression looks like on its way
in. `ANNOTATE` is how the filter hands over what it learned without deciding on
the reader's behalf that nothing happened.

TWO RULES THAT ARE NOT NEGOTIABLE, both about failing in the safe direction:

  Everything is posted to the raw channel, including suppressions. There is no
  outcome in which an alert Grafana sent reaches nobody, so the worst bug in
  this file costs a reader a channel switch rather than an incident.

  Uncertainty notifies. An unavailable classifier, a Loki query that errored, a
  cause whose evidence could not be read — every one of those routes to NOTIFY
  with a stated reason, never to SUPPRESS. A filter that goes quiet when it
  breaks is indistinguishable from a filter that is working, which is this
  organisation's signature failure mode (see clickup_bot/weekly_digest.py).

URGENCY IS JUDGED, NOT DECLARED. There is deliberately no `escalate` action in
the registry: whoever writes down a known cause is describing the past, and
urgency is a property of the firing in front of us. It comes from the alert's
own ownership and from what the evidence says, below.
"""

from typing import Any

# The four outcomes. Strings rather than an enum because they are reported as a
# metric dimension and read back by weekly_digest.py, so the wire format is the
# thing that matters and an enum would just be a second name for it.
URGENT = "urgent"
NOTIFY = "notify"
ANNOTATE = "annotate"
SUPPRESS = "suppress"

# Outcomes that reach the filtered channel. `SUPPRESS` is the only one that does
# not, and it is defined by exclusion here so that adding a fifth outcome
# defaults it to being seen rather than to being hidden.
NOTIFYING = (URGENT, NOTIFY, ANNOTATE)

# What the classifier is allowed to conclude about a cause. Anything else in its
# response is treated as `unclear`, which notifies.
CONFIRMED = "confirmed"
REJECTED = "rejected"
UNCLEAR = "unclear"


class Decision(dict):
    """A routing decision, as a dict so it serialises into the metric as-is.

    Fields:
      outcome       one of the four above
      reason        why, in a sentence, for the metric and the Slack thread
      cause_id      the known cause that matched, or None
      mention       whether the alert's subteam mention survives into the post
      urgent        whether this also mirrors to the urgent channel
      degraded      whether the decision was made on incomplete inputs
    """


def _decision(
    outcome: str,
    reason: str,
    *,
    cause_id: str | None = None,
    degraded: bool = False,
) -> Decision:
    return Decision(
        outcome=outcome,
        reason=reason,
        cause_id=cause_id,
        # THE MENTION IS THE URGENCY SIGNAL, so it is derived here rather than
        # passed in. A subteam mention pings phones; an alert worth a ping and an
        # alert worth reading are different things, and #dev-alerts became
        # unreadable partly because every rule with an owner pinged that owner
        # every time. Only `URGENT` keeps it.
        mention=outcome == URGENT,
        urgent=outcome == URGENT,
        degraded=degraded,
    )


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def matched_cause(alert: dict, verdicts: Any) -> dict | None:
    """The first known cause the classifier confirmed, with its registry entry.

    FIRST IN DECLARED ORDER, not "best match", and the registry preserves
    declaration order for this reason. Two causes both confirmed means the
    evidence did not separate them, and picking between them by score would be
    inventing a distinction the evidence does not support. Declaration order at
    least puts the choice in the hands of whoever wrote the registry.

    A verdict for a cause id that is not in this alert's registry is ignored.
    The classifier is told which ids exist, so a response naming another one is
    a hallucinated id, and honouring it would suppress on a cause nobody wrote.
    """
    if not isinstance(verdicts, dict):
        return None
    for cause in alert.get("known_causes") or []:
        if not isinstance(cause, dict):
            continue
        verdict = verdicts.get(cause["id"])
        state = _text(verdict.get("state")) if isinstance(verdict, dict) else _text(verdict)
        if state == CONFIRMED:
            return cause
    return None


def classify(alert: dict, verdicts: Any = None, *, urgency: Any = None, degraded: Any = None) -> Decision:
    """Where this firing goes, and with what attached.

    `verdicts` maps cause id → {"state": confirmed|rejected|unclear, ...}, one
    per cause whose evidence was gathered. `urgency` is the classifier's
    separate judgement about the firing itself. `degraded` is any list of things
    that could not be gathered — a Loki timeout, an unavailable model.

    THE ORDER OF THE CHECKS IS THE POLICY, and it reads bottom-up from the
    safest outcome:

      1. degraded inputs      -> NOTIFY. Decided before anything else is
                                 consulted, because a decision made on partial
                                 evidence is not a decision, and the tempting
                                 bug is to let a confirmed cause suppress on
                                 evidence that half-arrived.
      2. judged urgent        -> URGENT. Ahead of the registry: a known cause
                                 that has become urgent is exactly the case
                                 where the registry is out of date, and the
                                 registry must not be able to veto a ping.
      3. confirmed suppress   -> SUPPRESS.
      4. confirmed annotate   -> ANNOTATE.
      5. otherwise            -> NOTIFY.
    """
    missing = [item for item in (degraded or []) if item]
    if missing:
        return _decision(
            NOTIFY,
            f"classified on incomplete inputs ({'; '.join(str(m) for m in missing)}), so notifying",
            degraded=True,
        )

    if _is_urgent(urgency):
        return _decision(URGENT, _urgency_reason(urgency))

    cause = matched_cause(alert, verdicts)
    if cause is None:
        return _decision(NOTIFY, "no known cause matched the evidence")

    if cause["action"] == SUPPRESS:
        # The ticket is named in the reason rather than checked for, because a
        # suppression with no ticket is a real state that the weekly digest
        # reports on by name. Refusing to suppress without one would be a
        # different policy than the one the registry's own docs state, and
        # putting it here would split that policy across two repos.
        tracked = f", tracked by {cause['ticket']}" if cause["ticket"] else ", tracked by no ticket"
        return _decision(SUPPRESS, f"known cause confirmed{tracked}", cause_id=cause["id"])

    return _decision(ANNOTATE, "known cause confirmed, but still worth a human", cause_id=cause["id"])


def _is_urgent(urgency: Any) -> bool:
    """Whether the classifier judged this firing urgent enough to ping.

    Requires an explicit `urgent` boolean AND a reason. Demanding the reason is
    not decoration: it is the only field that makes an urgent call reviewable
    after the fact, and a model that cannot say why something is urgent has not
    established that it is. Absent either, this is not urgent — which routes to
    NOTIFY, so the alert is still seen.
    """
    if not isinstance(urgency, dict):
        return False
    return urgency.get("urgent") is True and bool(_text(urgency.get("reason")))


def _urgency_reason(urgency: Any) -> str:
    return _text(urgency.get("reason")) or "judged urgent"


def notifies(decision: dict) -> bool:
    """Whether the filtered channel sees this. The raw channel always does."""
    return decision.get("outcome") in NOTIFYING
