import pytest

from alert_filter.classify import ANNOTATE, NOTIFY, SUPPRESS, URGENT, classify
from alert_filter.payload import firings
from alert_filter.render import (
    URGENT_PREFIX,
    body,
    disposition_reply,
    filtered_post,
    raw_post,
    strip_mentions,
    urgent_mirror,
)

MENTION = "<!subteam^S0AE3NTCXM3>"


@pytest.fixture
def alert(webhook):
    return firings(webhook())[0]


def decide(outcome, **overrides):
    base = {
        "outcome": outcome,
        "reason": "a reason",
        "cause_id": None,
        "mention": outcome == URGENT,
        "urgent": outcome == URGENT,
        "degraded": False,
    }
    base.update(overrides)
    return base


class TestStrippingThePing:
    # Matched by shape rather than against a list of the two group ids this repo
    # knows about: such a list would silently stop stripping the moment a third
    # team started owning an alert, and "silently stops stripping" means every
    # routine alert pings a team again — the exact state this filter exists to
    # end.
    @pytest.mark.parametrize(
        "mention",
        ["<!subteam^S0AD54G9D3K>", "<!subteam^S0AE3NTCXM3>", "<!subteam^SNEWTEAM123|@new-team>"],
        ids=["serve", "win", "a-team-nobody-has-created-yet"],
    )
    def test_any_subteam_mention_is_removed_not_just_the_known_ones(self, mention):
        assert mention not in strip_mentions(f"something broke\n\n{mention}")

    # No alert uses these today. Handled for the same reason as above: the rule
    # is "a non-urgent alert does not ping", and an alert that started using
    # `<!here>` would otherwise bypass it entirely.
    @pytest.mark.parametrize("broadcast", ["<!here>", "<!channel>", "<!everyone>", "<!here|@here>"])
    def test_broadcast_mentions_are_removed_too(self, broadcast):
        assert "<!" not in strip_mentions(f"something broke\n\n{broadcast}")

    # Nothing provisions one, and if something starts to, a named individual in
    # an alert body is a deliberate choice by its author rather than the blanket
    # team ping this is about.
    def test_a_named_individual_is_left_alone(self):
        assert "<@U123ABC>" in strip_mentions("ask <@U123ABC> about this")

    # `buildAlertDescription` joins the mention on with a blank line, so a bare
    # deletion leaves the message ending in two newlines.
    def test_the_body_does_not_end_in_the_gap_the_mention_left(self):
        stripped = strip_mentions(f"something broke\n\n{MENTION}")

        assert stripped == "something broke"

    # Collapsed in an order that does not fuse the paragraphs a mention sat
    # between.
    def test_a_mention_between_two_paragraphs_leaves_one_blank_line(self):
        stripped = strip_mentions(f"first\n\n{MENTION}\n\nsecond")

        assert stripped == "first\n\nsecond"

    def test_a_body_with_no_mention_is_unchanged(self):
        assert strip_mentions("nothing to strip here") == "nothing to strip here"


class TestTheBodyIsGrafanasNotOurs:
    # `description` carries the environment tag, the window and the "search for
    # X" instructions that make the alert actionable. Rewriting any of that here
    # would fork prose into a repo its author does not read.
    def test_it_posts_the_description_verbatim(self, alert):
        assert body(alert) == alert["description"]

    # A fallback rather than a supplement: including both would repeat the rule
    # name and the environment tag twice in a two-line message.
    def test_the_title_is_used_only_when_there_is_no_body(self, alert):
        titled = {**alert, "description": None}

        assert body(titled) == alert["summary"]
        assert body(alert) == alert["description"]

    def test_it_falls_back_to_the_rule_name(self, alert):
        assert body({**alert, "description": None, "summary": None}) == alert["name"]

    # Should be unreachable. Here because the alternative when it is reached is
    # posting an empty message, which reads to whoever is on call exactly like
    # nothing having fired.
    def test_an_alert_with_no_text_at_all_still_says_something(self):
        assert body({}).strip()


class TestWhatTheFilteredChannelSees:
    def test_an_urgent_alert_keeps_its_mention_and_is_prefixed(self, alert):
        post = filtered_post(alert, decide(URGENT))

        assert post.startswith(URGENT_PREFIX)
        assert MENTION in post

    # The single most important assertion in this module: `classify` decides
    # whether an alert is worth a ping, and this is where that becomes true.
    @pytest.mark.parametrize("outcome", [NOTIFY, ANNOTATE, SUPPRESS])
    def test_everything_else_loses_its_mention(self, alert, outcome):
        assert MENTION not in filtered_post(alert, decide(outcome))

    def test_only_an_urgent_alert_is_prefixed(self, alert):
        for outcome in (NOTIFY, ANNOTATE):
            assert URGENT_PREFIX not in filtered_post(alert, decide(outcome))

    # Stated end to end over the real classifier rather than over a hand-built
    # decision, so the two halves of the rule cannot drift: the decision is what
    # `classify` produced and the post is what this module did with it.
    def test_the_ping_rule_holds_from_classification_through_to_the_post(self, alert):
        urgent = classify(alert, urgency={"urgent": True, "reason": "prod is down"})
        routine = classify(alert)

        assert MENTION in filtered_post(alert, urgent)
        assert MENTION not in filtered_post(alert, routine)

    def test_the_grafana_link_is_appended_when_there_is_one(self, alert):
        assert "View in Grafana" in filtered_post(alert, decide(NOTIFY))

    def test_a_post_survives_an_alert_with_no_link(self, alert):
        post = filtered_post({**alert, "url": None}, decide(NOTIFY))

        assert post.strip()
        assert "View in Grafana|" not in post


class TestWhatTheFilterAddsToAPost:
    # "No known cause matched" is the default state of every alert that has ever
    # fired. Stamping it on each one would be noise added by the thing hired to
    # remove noise.
    def test_a_plain_notification_gets_no_commentary(self, alert):
        assert filtered_post(alert, decide(NOTIFY)) == strip_mentions(
            body(alert)
        ) + "\n\n" + "<{}|View in Grafana>".format(alert["url"])

    # The finding goes after the alert's own text, because the body is what a
    # reader needs in order to act and a message that leads with the robot's
    # opinion trains people to scroll past the first line.
    def test_an_annotated_alert_says_what_it_looks_like_after_the_body(self, alert):
        post = filtered_post(alert, decide(ANNOTATE, cause_id="people-db-statement-timeout"))
        summary = alert["known_causes"][0]["summary"]

        assert summary in post
        assert post.index(summary) > post.index("failed to build")

    def test_an_annotation_for_a_cause_that_is_not_in_the_registry_adds_nothing(self, alert):
        post = filtered_post(alert, decide(ANNOTATE, cause_id="not-a-real-cause"))

        assert "known issue" not in post

    # A real fact about how much to trust the routing, so unlike a plain notify
    # this one does get said.
    def test_a_degraded_notification_admits_it(self, alert):
        post = filtered_post(alert, decide(NOTIFY, degraded=True, reason="loki timed out"))

        assert "could not fully check" in post
        assert "loki timed out" in post


class TestTheRawChannelHidesNothingAndPingsNobody:
    def test_the_body_is_verbatim(self, alert):
        assert "failed to build after the response had already started" in raw_post(alert)

    # The one thing that would make the raw channel as unusable as the filtered
    # one was. Urgency lives in the filtered channel and in #bot-urgent; the raw
    # channel is for reading, not for being woken by.
    def test_it_does_not_ping(self, alert):
        assert MENTION not in raw_post(alert)


class TestEveryAlertCarriesItsOwnDisposition:
    # Without this the raw channel is a firehose with no record of a decision,
    # and there is no way to audit the filter except by diffing two channels by
    # eye.
    @pytest.mark.parametrize("outcome", [URGENT, NOTIFY, ANNOTATE, SUPPRESS])
    def test_every_outcome_produces_a_reply(self, alert, outcome):
        reply = disposition_reply(decide(outcome, reason="because"), alert)

        assert reply.strip()
        assert "because" in reply

    # The id is what the metric is keyed on, so a reader who disagrees with a
    # suppression can find every other firing it covered.
    def test_a_suppression_names_the_cause_id(self, alert):
        reply = disposition_reply(decide(SUPPRESS, cause_id="people-db-statement-timeout"), alert)

        assert "people-db-statement-timeout" in reply
        assert "suppressed" in reply

    def test_a_suppression_does_not_claim_to_have_been_posted(self, alert):
        assert "filtered channel" not in disposition_reply(decide(SUPPRESS), alert)

    @pytest.mark.parametrize("outcome", [URGENT, NOTIFY, ANNOTATE])
    def test_everything_else_says_where_it_went(self, alert, outcome):
        assert "filtered channel" in disposition_reply(decide(outcome), alert)

    # A NOTIFY that was a fallback and a NOTIFY that was a judgement need
    # different follow-up from whoever is auditing the filter.
    def test_a_fallback_is_distinguishable_from_a_judgement(self, alert):
        fallback = disposition_reply(decide(NOTIFY, degraded=True), alert)
        judged = disposition_reply(decide(NOTIFY), alert)

        assert "could not decide" in fallback
        assert "could not decide" not in judged


class TestTheUrgentMirror:
    def test_it_pings_and_links_back_to_the_full_alert(self, alert):
        mirror = urgent_mirror(alert, decide(URGENT, reason="prod is down"), "https://slack.example/p123")

        assert MENTION in mirror
        assert mirror.startswith(URGENT_PREFIX)
        assert "prod is down" in mirror
        assert "https://slack.example/p123" in mirror

    def test_it_survives_having_no_permalink_to_link_back_to(self, alert):
        mirror = urgent_mirror(alert, decide(URGENT), None)

        assert mirror.strip()
        assert "Full alert" not in mirror
