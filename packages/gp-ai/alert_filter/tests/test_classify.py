import pytest

from alert_filter.classify import ANNOTATE, NOTIFY, SUPPRESS, URGENT, classify, notifies
from alert_filter.payload import firings


@pytest.fixture
def alert(webhook):
    return firings(webhook())[0]


def cause(**overrides):
    base = {
        "id": "known",
        "summary": "A known thing.",
        "evidence": '{env="prod"} |= "x"',
        "confirmed_by": "Every line has Code: 57014.",
        "action": "suppress",
        "ticket": None,
    }
    base.update(overrides)
    return base


CONFIRMED = {"state": "confirmed"}
REJECTED = {"state": "rejected"}
UNCLEAR = {"state": "unclear"}


class TestNothingIsEverHiddenFromEverybody:
    # The strongest guarantee this module makes, and the reason the worst bug in
    # it costs a reader a channel switch rather than an incident. Asserted as a
    # property over every input shape rather than per-case, because the failure
    # would arrive as a new outcome someone added without thinking about it.
    @pytest.mark.parametrize(
        "kwargs",
        [
            {},
            {"verdicts": {"known": CONFIRMED}},
            {"urgency": {"urgent": True, "reason": "prod is down"}},
            {"degraded": ["loki timed out"]},
        ],
        ids=["default", "confirmed", "urgent", "degraded"],
    )
    def test_every_outcome_is_one_of_the_four(self, alert, kwargs):
        alert = {**alert, "known_causes": [cause()]}

        assert classify(alert, **kwargs)["outcome"] in (URGENT, NOTIFY, ANNOTATE, SUPPRESS)

    # `SUPPRESS` is the only outcome that does not reach the filtered channel,
    # and `notifies` defines that by exclusion so a fifth outcome defaults to
    # being seen rather than to being hidden.
    def test_suppress_is_the_only_outcome_that_is_not_notified(self):
        assert notifies({"outcome": SUPPRESS}) is False
        for outcome in (URGENT, NOTIFY, ANNOTATE):
            assert notifies({"outcome": outcome}) is True

    def test_an_outcome_nobody_recognises_is_treated_as_hidden_nowhere(self):
        # A new outcome that has not been wired into NOTIFYING reads as
        # not-notifying here, which sends it to the raw channel only — so the
        # test exists to make that visible, not to bless it.
        assert notifies({"outcome": "something-new"}) is False


class TestUncertaintyNotifies:
    # A filter that goes quiet when it breaks is indistinguishable from a filter
    # that is working. That is this organisation's signature failure mode and
    # the reason for the whole degraded path.
    def test_incomplete_inputs_notify_and_say_so(self, alert):
        decision = classify(alert, {"people-db-statement-timeout": CONFIRMED}, degraded=["loki query timed out"])

        assert decision["outcome"] == NOTIFY
        assert decision["degraded"] is True
        assert "loki query timed out" in decision["reason"]

    # The tempting bug: letting a confirmed cause suppress on evidence that only
    # half-arrived. The degraded check runs before anything else is consulted
    # precisely so that a decision made on partial evidence is not a decision.
    def test_a_confirmed_suppression_does_not_survive_degraded_inputs(self, alert):
        alert = {**alert, "known_causes": [cause(action="suppress")]}

        decision = classify(alert, {"known": CONFIRMED}, degraded=["model unavailable"])

        assert decision["outcome"] == NOTIFY

    @pytest.mark.parametrize("degraded", [None, [], [None], ["", None]], ids=["none", "empty", "null", "blanks"])
    def test_an_empty_degraded_list_is_not_a_degradation(self, alert, degraded):
        alert = {**alert, "known_causes": [cause()]}

        decision = classify(alert, {"known": CONFIRMED}, degraded=degraded)

        assert decision["outcome"] == SUPPRESS
        assert decision["degraded"] is False

    @pytest.mark.parametrize("verdicts", [None, {}, "nonsense", [], {"known": "garbage"}])
    def test_unreadable_verdicts_notify(self, alert, verdicts):
        alert = {**alert, "known_causes": [cause()]}

        assert classify(alert, verdicts)["outcome"] == NOTIFY


class TestTheRegistryCannotVetoAPing:
    # A known cause that has become urgent is exactly the case where the
    # registry is out of date, so urgency is checked before the registry is
    # consulted at all.
    def test_urgency_wins_over_a_confirmed_suppression(self, alert):
        alert = {**alert, "known_causes": [cause(action="suppress")]}

        decision = classify(
            alert,
            {"known": CONFIRMED},
            urgency={"urgent": True, "reason": "error rate is 40% and climbing"},
        )

        assert decision["outcome"] == URGENT
        assert "40%" in decision["reason"]

    # Demanding the reason is not decoration: it is the only field that makes an
    # urgent call reviewable afterwards, and a model that cannot say why
    # something is urgent has not established that it is.
    @pytest.mark.parametrize(
        "urgency",
        [
            {"urgent": True},
            {"urgent": True, "reason": ""},
            {"urgent": "yes", "reason": "prod is down"},
            {"reason": "prod is down"},
            "urgent",
            None,
        ],
        ids=["no-reason", "blank-reason", "not-a-bool", "no-flag", "a-string", "absent"],
    )
    def test_an_unsubstantiated_urgency_claim_is_not_urgent(self, alert, urgency):
        assert classify(alert, urgency=urgency)["outcome"] != URGENT

    # ...and it still gets seen. The fallback for an unsubstantiated urgency
    # claim is a normal notification, never a suppression.
    def test_an_unsubstantiated_urgency_claim_still_notifies(self, alert):
        assert classify(alert, urgency={"urgent": True})["outcome"] == NOTIFY


class TestTheMentionIsTheUrgencySignal:
    # #dev-alerts became unreadable partly because every rule with an owner
    # pinged that owner every time. An alert worth a ping and an alert worth
    # reading are different things.
    def test_only_an_urgent_alert_keeps_its_mention(self, alert):
        alert = {**alert, "known_causes": [cause(action="annotate")]}

        urgent = classify(alert, urgency={"urgent": True, "reason": "prod is down"})
        annotated = classify(alert, {"known": CONFIRMED})
        plain = classify(alert)

        assert urgent["mention"] is True
        assert annotated["mention"] is False
        assert plain["mention"] is False

    def test_the_mirror_and_the_mention_are_the_same_decision(self, alert):
        # Two fields, one judgement. They are separate on the wire because the
        # handler acts on them in different places, and a test that lets them
        # drift would let an urgent alert ping without being mirrored.
        for kwargs in ({}, {"urgency": {"urgent": True, "reason": "r"}}, {"degraded": ["x"]}):
            decision = classify(alert, **kwargs)
            assert decision["mention"] == decision["urgent"]


class TestWhatAConfirmedCauseDoes:
    def test_a_confirmed_suppressing_cause_suppresses(self, alert):
        alert = {**alert, "known_causes": [cause(action="suppress", ticket="ENG-1234")]}

        decision = classify(alert, {"known": CONFIRMED})

        assert decision["outcome"] == SUPPRESS
        assert decision["cause_id"] == "known"
        assert "ENG-1234" in decision["reason"]

    # A suppression with no ticket is a real state the weekly digest reports on
    # by name, so it is recorded rather than refused. Refusing it here would be
    # a different policy than the registry's own documentation states, and would
    # split that policy across two repos.
    def test_a_suppression_with_no_ticket_says_so_rather_than_refusing(self, alert):
        alert = {**alert, "known_causes": [cause(action="suppress", ticket=None)]}

        decision = classify(alert, {"known": CONFIRMED})

        assert decision["outcome"] == SUPPRESS
        assert "no ticket" in decision["reason"]

    # The outcome that would be easy to leave out, and the reason the registry
    # is worth having: a cause can be completely understood and still need a
    # person, because a spike of a known-benign shape is what a real regression
    # looks like on its way in.
    def test_a_confirmed_annotating_cause_still_notifies(self, alert):
        alert = {**alert, "known_causes": [cause(action="annotate")]}

        decision = classify(alert, {"known": CONFIRMED})

        assert decision["outcome"] == ANNOTATE
        assert decision["cause_id"] == "known"
        assert notifies(decision)

    @pytest.mark.parametrize("verdict", [REJECTED, UNCLEAR], ids=["rejected", "unclear"])
    def test_a_cause_that_was_not_confirmed_does_nothing(self, alert, verdict):
        alert = {**alert, "known_causes": [cause()]}

        decision = classify(alert, {"known": verdict})

        assert decision["outcome"] == NOTIFY
        assert decision["cause_id"] is None

    def test_an_alert_with_no_registry_notifies(self, alert):
        alert = {**alert, "known_causes": []}

        assert classify(alert, {"anything": CONFIRMED})["outcome"] == NOTIFY

    # The classifier is told which ids exist, so a response naming another one
    # is a hallucinated id — and honouring it would suppress on a cause nobody
    # ever wrote down.
    def test_a_verdict_for_an_unknown_cause_id_is_ignored(self, alert):
        alert = {**alert, "known_causes": [cause(id="real")]}

        decision = classify(alert, {"invented-by-the-model": CONFIRMED})

        assert decision["outcome"] == NOTIFY

    # Two causes both confirmed means the evidence did not separate them.
    # Picking by score would invent a distinction the evidence does not support,
    # so declaration order decides — which at least puts the choice with
    # whoever wrote the registry.
    def test_the_first_declared_confirmed_cause_wins(self, alert):
        alert = {
            **alert,
            "known_causes": [cause(id="first", action="annotate"), cause(id="second", action="suppress")],
        }

        decision = classify(alert, {"first": CONFIRMED, "second": CONFIRMED})

        assert decision["outcome"] == ANNOTATE
        assert decision["cause_id"] == "first"

    def test_a_later_cause_can_still_match_when_the_earlier_one_did_not(self, alert):
        alert = {
            **alert,
            "known_causes": [cause(id="first", action="annotate"), cause(id="second", action="suppress")],
        }

        decision = classify(alert, {"first": REJECTED, "second": CONFIRMED})

        assert decision["cause_id"] == "second"

    # A bare string verdict is accepted as well as the dict form, because the
    # classifier's response shape is the least stable input this module has and
    # the two readings must not disagree about what "confirmed" means.
    def test_a_bare_string_verdict_is_read_the_same_as_a_dict(self, alert):
        alert = {**alert, "known_causes": [cause()]}

        assert classify(alert, {"known": "confirmed"})["outcome"] == SUPPRESS
        assert classify(alert, {"known": "rejected"})["outcome"] == NOTIFY


class TestEveryDecisionCanBeExplained:
    # The reason is reported into the metric and into the Slack thread, which is
    # what makes "what did gpbot hide last week, and was it right" answerable at
    # all. A decision with no reason is unauditable.
    @pytest.mark.parametrize(
        "kwargs",
        [
            {},
            {"verdicts": {"known": CONFIRMED}},
            {"urgency": {"urgent": True, "reason": "prod is down"}},
            {"degraded": ["loki timed out"]},
        ],
        ids=["notify", "suppress", "urgent", "degraded"],
    )
    def test_no_decision_is_made_without_a_reason(self, alert, kwargs):
        alert = {**alert, "known_causes": [cause()]}

        assert classify(alert, **kwargs)["reason"]

    def test_only_a_matched_cause_sets_a_cause_id(self, alert):
        alert = {**alert, "known_causes": [cause()]}

        assert classify(alert)["cause_id"] is None
        assert classify(alert, {"known": CONFIRMED})["cause_id"] == "known"
