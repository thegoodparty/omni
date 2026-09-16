import json

import pytest

from alert_filter.payload import KNOWN_CAUSES_ANNOTATION, firings, is_resolved, known_causes


class TestOneDeliveryCanCarrySeveralAlerts:
    # The controller alerts fire once per route, so a grouped delivery routinely
    # holds several. Collapsing one to its first entry would suppress a real
    # regression whenever it happened to be grouped behind a known one — the
    # most likely way this filter hurts someone, and completely invisible.
    def test_every_firing_alert_in_a_group_is_returned(self, webhook):
        one = webhook()["alerts"][0]
        payload = webhook(alerts=[one, {**one, "fingerprint": "second", "labels": {**one["labels"], "route": "b"}}])

        assert [a["fingerprint"] for a in firings(payload)] == ["6f1a2b3c4d5e", "second"]

    # Grafana puts resolved entries in the array when a group changes shape
    # mid-evaluation. Each one is an alert that has stopped being true, so
    # classifying it would spend a model call and a Loki query deciding whether
    # to notify somebody about something that is over.
    def test_resolved_entries_are_dropped_from_a_firing_delivery(self, webhook):
        one = webhook()["alerts"][0]
        payload = webhook(alerts=[{**one, "status": "resolved"}, {**one, "fingerprint": "still-firing"}])

        assert [a["fingerprint"] for a in firings(payload)] == ["still-firing"]

    def test_a_wholly_resolved_delivery_yields_nothing(self, webhook):
        assert firings(webhook(status="resolved")) == []
        assert is_resolved(webhook(status="resolved"))

    # Case-insensitively, because the value is lowercase in the documented
    # schema and has shipped capitalised in a Grafana test webhook.
    @pytest.mark.parametrize("status", ["Resolved", "RESOLVED", "resolved "])
    def test_resolved_is_recognised_however_it_is_cased(self, webhook, status):
        assert is_resolved(webhook(status=status))

    # These two need different responses from the handler: a resolved delivery
    # is nothing to do, while an unreadable one is a schema change or a bug in
    # the parser, and it has to be possible to be loud about the second without
    # being loud every time an alert recovers.
    def test_an_unreadable_delivery_is_not_a_resolved_one(self):
        assert firings("not a dict") == []
        assert is_resolved("not a dict") is False
        assert is_resolved({"alerts": []}) is False


class TestWhichLabelsIdentifyAnAlert:
    # A grouped delivery's `groupLabels` hold only what the group is keyed by,
    # so a per-route alert's distinguishing label lives on the alert alone.
    # Reading the group first would make four routes indistinguishable.
    def test_the_alerts_own_labels_win_over_the_groups(self, webhook):
        one = webhook()["alerts"][0]
        payload = webhook(
            groupLabels={"environment": "dev", "alertname": "grouped"},
            alerts=[{**one, "labels": {**one["labels"], "environment": "prod"}}],
        )

        assert firings(payload)[0]["environment"] == "prod"

    def test_group_labels_fill_in_what_the_alert_omits(self, webhook):
        one = webhook()["alerts"][0]
        payload = webhook(
            groupLabels={"shared": "from-group"},
            alerts=[{**one, "labels": {"alert_slug": "s"}}],
        )

        assert firings(payload)[0]["labels"]["shared"] == "from-group"

    # `environment` picks the Loki stream an evidence query reads, so a
    # non-string here must not become the string "None" and send the query to a
    # stream of that name.
    def test_a_non_string_label_is_dropped_rather_than_coerced(self, webhook):
        one = webhook()["alerts"][0]
        payload = webhook(alerts=[{**one, "labels": {**one["labels"], "environment": None}}])

        assert firings(payload)[0]["environment"] is None

    # The digest keys on the slug. A rule name is prose and gets reworded, so
    # filling the slug from it would restart an alert's history the first time
    # somebody fixed a typo.
    def test_a_rule_this_repo_did_not_provision_has_a_name_but_no_slug(self, webhook):
        one = webhook()["alerts"][0]
        payload = webhook(alerts=[{**one, "labels": {"alertname": "someone elses rule"}}])

        parsed = firings(payload)[0]
        assert parsed["slug"] is None
        assert parsed["name"] == "someone elses rule"


class TestReadingTheKnownCausesRegistry:
    def test_it_reads_the_registry_gp_api_serialised(self, webhook):
        causes = firings(webhook())[0]["known_causes"]

        assert [c["id"] for c in causes] == ["people-db-statement-timeout"]
        assert causes[0]["action"] == "suppress"
        assert causes[0]["confirmed_by"] == "Every matched line carries `Code: 57014`."

    # The name is a contract with gp-api's alert-notification.ts. Renaming it on
    # either side makes every alert look like it has no known causes — which
    # fails safe, since everything then notifies, but silently undoes the whole
    # feature.
    def test_the_annotation_name_matches_the_one_gp_api_writes(self):
        assert KNOWN_CAUSES_ANNOTATION == "known_causes"

    # An alert with no registry and an alert whose registry did not parse have
    # to be the same thing, because the filter reads both as "notify". Two
    # spellings of one meaning is how the sides of a contract drift.
    @pytest.mark.parametrize(
        "raw",
        ["", "not json", "{}", '"a string"', "null", "[]", "[1, 2, 3]"],
        ids=["empty", "unparseable", "object", "string", "null", "empty-list", "scalars"],
    )
    def test_anything_unreadable_means_no_known_causes(self, raw):
        assert known_causes({KNOWN_CAUSES_ANNOTATION: raw}) == []

    def test_an_alert_with_no_registry_has_no_known_causes(self):
        assert known_causes({}) == []

    # A cause missing any of these can never match anything, so carrying it
    # forward would only make the registry look larger than it is — and
    # `action` in particular decides whether a human sees the alert, so an
    # unrecognised value must not be honoured as either of the two real ones.
    @pytest.mark.parametrize(
        "missing",
        ["id", "summary", "confirmedBy", "action"],
    )
    def test_a_cause_missing_a_load_bearing_field_is_dropped(self, missing):
        cause = {
            "id": "x",
            "summary": "y",
            "confirmedBy": "z",
            "action": "suppress",
        }
        del cause[missing]

        assert known_causes({KNOWN_CAUSES_ANNOTATION: json.dumps([cause])}) == []

    @pytest.mark.parametrize("action", ["escalate", "SUPPRESS", "notify", "", None])
    def test_an_unrecognised_action_is_dropped(self, action):
        cause = {"id": "x", "summary": "y", "confirmedBy": "z", "action": action}

        assert known_causes({KNOWN_CAUSES_ANNOTATION: json.dumps([cause])}) == []

    # Order is the tie-break when two causes are both confirmed, so it has to
    # survive parsing — see classify.matched_cause.
    def test_declaration_order_survives(self):
        causes = [
            {"id": "first", "summary": "s", "confirmedBy": "c", "action": "annotate"},
            {"id": "second", "summary": "s", "confirmedBy": "c", "action": "suppress"},
        ]

        parsed = known_causes({KNOWN_CAUSES_ANNOTATION: json.dumps(causes)})

        assert [c["id"] for c in parsed] == ["first", "second"]

    # A per-route alert whose label already names the cause needs no query, and
    # that is cheaper and correct — there is nothing extra to learn from the
    # logs. So a cause without evidence is valid, not malformed.
    def test_a_cause_may_judge_on_the_payload_alone(self):
        cause = {"id": "x", "summary": "y", "confirmedBy": "z", "action": "annotate"}

        parsed = known_causes({KNOWN_CAUSES_ANNOTATION: json.dumps([cause])})

        assert parsed[0]["evidence"] is None


class TestTheFieldsADecisionReads:
    def test_it_carries_the_body_the_slack_post_is_built_from(self, webhook):
        parsed = firings(webhook())[0]

        assert "<!subteam^S0AE3NTCXM3>" in parsed["description"]
        assert parsed["summary"].startswith("[PROD]")

    # The link is what makes the post actionable, and it is absent on some
    # delivery shapes, so every renderer has to cope without it.
    def test_the_grafana_link_is_optional(self, webhook):
        one = webhook()["alerts"][0]
        del one["generatorURL"]

        assert firings(webhook(alerts=[one]))[0]["url"] is None

    # Grafana retries a webhook that times out, so the handler dedups on this.
    # Without it a retry posts twice and bills twice.
    def test_it_carries_grafanas_fingerprint_for_dedup(self, webhook):
        assert firings(webhook())[0]["fingerprint"] == "6f1a2b3c4d5e"
