import json

import pytest

from alert_filter import metrics
from alert_filter.classify import SUPPRESS, URGENT, classify
from alert_filter.metrics import METRIC_PREFIX, format_metric_line
from alert_filter.payload import firings

# The consumer's copy of the token. Imported from the digest rather than
# retyped, so the contract is asserted against the thing that actually reads it.
from clickup_bot import weekly_digest


def line(alert=None, decision=None, **kwargs):
    return json.loads(format_metric_line(alert, decision, **kwargs).partition(METRIC_PREFIX + " ")[2])


class TestTheTwoPrefixesCannotCollide:
    # `filter-log-events` matches the token as a bare substring anywhere in the
    # message, so a shared prefix would put alert decisions into the gpbot
    # digest's verdict counts and its cost total. Sharing no prefix at all is
    # the only version of this that cannot go wrong.
    def test_neither_metric_token_contains_the_other(self):
        assert METRIC_PREFIX not in weekly_digest.METRIC_PREFIX
        assert weekly_digest.METRIC_PREFIX not in METRIC_PREFIX

    def test_the_alert_metric_token_is_the_one_the_digest_looks_for(self):
        assert METRIC_PREFIX == "GPALERT_METRIC"


class TestTheLineIsOneParseableRecord:
    # `filter-log-events` returns whole messages, so the consumer splits on the
    # prefix and parses the remainder. A pretty-printed object would arrive as a
    # dozen unrelated events.
    def test_it_is_a_single_line_with_the_prefix_first(self, webhook):
        alert = firings(webhook())[0]

        rendered = format_metric_line(alert, classify(alert))

        assert "\n" not in rendered
        assert rendered.startswith(METRIC_PREFIX + " ")
        json.loads(rendered.partition(METRIC_PREFIX + " ")[2])

    # Every field always present, `null` when it does not apply — so the digest
    # can tell "this alert had no matching cause" from "this line predates the
    # field", which need different responses from whoever reads the Monday
    # message.
    def test_every_field_is_present_even_when_nothing_is_known(self):
        recorded = line(None, None)

        assert set(recorded) == {
            "slug",
            "name",
            "environment",
            "outcome",
            "cause_id",
            "reason",
            "degraded",
            "mentioned",
            "cost_usd",
            "evidence_queries",
            "fingerprint",
        }

    # TOTAL OVER ANY INPUT, and this matters more than gpbot's equivalent: it is
    # called after the alert has already been posted to Slack, and Grafana
    # retries a webhook that errors — so an exception here would post the alert
    # a second time.
    @pytest.mark.parametrize("bad", [None, "a string", 7, [], {"unexpected": object()}])
    def test_it_never_raises_on_a_shape_it_did_not_expect(self, bad):
        assert format_metric_line(bad, bad).startswith(METRIC_PREFIX)


class TestWhatTheDigestNeedsFromIt:
    def test_it_records_the_slug_the_digest_groups_by(self, webhook):
        alert = firings(webhook())[0]

        assert line(alert, classify(alert))["slug"] == "door-knocking-pack-build-failed"

    # A prose-derived key changes when somebody fixes a typo, which would
    # restart that alert's history in the digest.
    def test_a_rule_this_repo_did_not_provision_records_a_null_slug_not_its_name(self, webhook):
        one = webhook()["alerts"][0]
        alert = firings(webhook(alerts=[{**one, "labels": {"alertname": "someone elses rule"}}]))[0]

        recorded = line(alert, classify(alert))

        assert recorded["slug"] is None
        assert recorded["name"] == "someone elses rule"

    # The list of things humans stopped seeing, and the only way anyone can
    # review whether that was right.
    def test_a_suppression_records_which_cause_hid_it(self, webhook):
        alert = firings(webhook())[0]
        decision = classify(alert, {"people-db-statement-timeout": {"state": "confirmed"}})

        recorded = line(alert, decision)

        assert recorded["outcome"] == SUPPRESS
        assert recorded["cause_id"] == "people-db-statement-timeout"

    # Derivable from `outcome` today, recorded anyway: it is the single number
    # that says how loud this system was, and it should not depend on the digest
    # agreeing with classify.py about which outcomes ping.
    def test_it_records_whether_a_human_was_pinged(self, webhook):
        alert = firings(webhook())[0]

        urgent = line(alert, classify(alert, urgency={"urgent": True, "reason": "prod is down"}))
        routine = line(alert, classify(alert))

        assert urgent["outcome"] == URGENT and urgent["mentioned"] is True
        assert routine["mentioned"] is False

    # The registry's per-cause `evidence` runs on every firing of its alert, so
    # this is what turns "narrow your queries" from advice into something
    # observable before the bill arrives.
    def test_it_records_how_many_loki_queries_a_decision_cost(self, webhook):
        alert = firings(webhook())[0]

        assert line(alert, classify(alert), evidence_queries=3)["evidence_queries"] == 3
        assert line(alert, classify(alert))["evidence_queries"] is None

    def test_it_records_grafanas_fingerprint_so_a_slipped_replay_is_identifiable(self, webhook):
        alert = firings(webhook())[0]

        assert line(alert, classify(alert))["fingerprint"] == "6f1a2b3c4d5e"


class TestCostIsNeverReportedAsFree:
    # A 0.0 is a claim that the decision was free, and the digest sums these:
    # one absent cost coerced to zero understates the week with nothing to say
    # so. Same rule as the gpbot metric's `_number`.
    @pytest.mark.parametrize(
        "value",
        [None, "0.001", True, float("nan"), float("inf"), float("-inf"), [], {}],
        ids=["none", "string", "bool", "nan", "inf", "-inf", "list", "dict"],
    )
    def test_an_unreadable_cost_is_null_not_zero(self, value):
        assert line(None, None, cost_usd=value)["cost_usd"] is None

    # A real zero is still a zero. Nothing should produce one, which is exactly
    # why it must not be conflated with the unreadable case.
    def test_a_genuine_zero_survives(self):
        assert line(None, None, cost_usd=0)["cost_usd"] == 0.0

    # Six places, because a single decision costs a fraction of a cent and
    # rounding further would make every one of them read as free.
    def test_a_fraction_of_a_cent_is_not_rounded_away(self):
        assert line(None, None, cost_usd=0.000123456789)["cost_usd"] == pytest.approx(0.000123, abs=1e-9)

    # NaN and infinity are excluded for a duller reason than the rest:
    # json.dumps emits them as bare NaN / Infinity, which is not JSON, and the
    # digest's parser would drop the whole line rather than the one bad field.
    def test_a_non_finite_cost_cannot_make_the_line_unparseable(self):
        rendered = format_metric_line(None, None, cost_usd=float("nan"))

        json.loads(rendered.partition(METRIC_PREFIX + " ")[2])
        assert "NaN" not in rendered


class TestTheDecisionIsReportedVerbatim:
    # The reason is what makes "what did gpbot hide last week, and was it right"
    # answerable at all.
    def test_the_reason_survives_into_the_line(self, webhook):
        alert = firings(webhook())[0]
        decision = classify(alert, degraded=["loki timed out"])

        assert "loki timed out" in line(alert, decision)["reason"]

    def test_metrics_reads_the_same_outcome_strings_classify_writes(self, webhook):
        alert = firings(webhook())[0]

        for kwargs, expected in (
            ({}, "notify"),
            ({"urgency": {"urgent": True, "reason": "r"}}, "urgent"),
            ({"verdicts": {"people-db-statement-timeout": {"state": "confirmed"}}}, "suppress"),
            ({"degraded": ["x"]}, "notify"),
        ):
            assert line(alert, classify(alert, **kwargs))["outcome"] == expected

    def test_unrecognised_decision_fields_are_ignored_rather_than_leaked(self):
        recorded = line(None, {"outcome": "notify", "secret": "should not appear"})

        assert "secret" not in recorded


def test_the_prefix_is_not_logged_by_anything_else_in_the_filter():
    """A second emitter would double-count every decision in the digest.

    Same hazard as GPBOT_METRIC's, checked the same way: the token must appear
    only in the module that owns it and in the consumer that reads it.
    """
    from pathlib import Path

    root = Path(metrics.__file__).parent
    offenders = [
        path.name
        for path in root.rglob("*.py")
        if path.name not in ("metrics.py",) and "tests" not in path.parts and METRIC_PREFIX in path.read_text()
    ]

    assert offenders == []
