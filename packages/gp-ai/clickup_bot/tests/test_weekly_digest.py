"""Tests for the Monday digest.

A wrong measurement does not throw. It posts, confidently, and gets quoted in a
meeting — so the failures worth guarding here are the ones that produce a
plausible number rather than an error. Three shapes of that recur below:

- A source that did not answer reading as a zero. "0 missed" from a coverage
  check that never ran is a false claim about the one thing this message exists
  to report.
- A marker comment counting as an analysis. The bot posts `[GP-Bot] Processing
  started` when the Fargate task launches, so counting it would let a crashed
  run report as a covered ticket at a latency of seconds.
- A percentage. Three autonomous PRs is not a base anyone can compute a rate on.

The golden fixture below is the week of 2026-08-17 as recorded in the gpbot
metrics report, and the assertion is that this module reproduces the message
that report proposed. It is the closest thing to a reconciliation that can live
in a test suite.
"""

import io
import json
from datetime import UTC, datetime

import pytest
import weekly_digest
from weekly_digest import (
    EXIT_DEGRADED,
    STALE_HOURS,
    analysis_posted_at,
    comment_text,
    cost,
    coverage,
    has_human_review,
    is_bot_pr,
    pull_requests,
    render,
    summarize,
    verdicts,
)

# The completed Mon-Sun week the workflow would report on.
WINDOW = {"start": "2026-08-17T00:00:00Z", "end": "2026-08-24T00:00:00Z"}
WINDOW_START = datetime(2026, 8, 17, tzinfo=UTC)

# The instant the metrics report was prepared. The golden fixture is pinned to
# it rather than to the Monday the workflow actually runs, because the report's
# PR ages ("~62h", "~25h") were measured then — and the staleness warning is a
# statement about right now, not about the window.
REPORT_PREPARED = datetime(2026, 8, 20, 15, 0, tzinfo=UTC).timestamp()


def ms(moment: datetime) -> str:
    # ClickUp sends millisecond epochs as strings.
    return str(int(moment.timestamp() * 1000))


def a_ticket(custom_id: str, created: datetime, analyzed_after_min: float | None = None, **overrides) -> dict:
    """A ClickUp task as the workflow hands it over, comments included verbatim."""
    comments = [
        # Always present, and always ignored: the Lambda posts this the moment
        # the Fargate task launches, well before there is anything to read.
        {
            "id": "c-ack",
            "date": ms(created),
            "comment_text": "[GP-Bot] Processing started (analyze). Re-tag after 15 minutes to re-run.",
            "comment": [],
        }
    ]
    if analyzed_after_min is not None:
        posted = created.timestamp() + analyzed_after_min * 60
        comments.append(
            {
                "id": "c-analysis",
                "date": str(int(posted * 1000)),
                "comment_text": f"[GP-Bot] Analysis\n\nRoot cause for {custom_id}...\n\nGPBOT-VERDICT: fix",
                "comment": [],
            }
        )
    ticket = {
        "id": f"86a{custom_id.lower()}",
        "custom_id": custom_id,
        "name": f"{custom_id} reported bug",
        "url": f"https://app.clickup.com/t/86a{custom_id.lower()}",
        "date_created": ms(created),
        "comments": comments,
    }
    ticket.update(overrides)
    return ticket


def a_run(label: str = "analyze", verdict: str | None = "fix", cost_usd: float | None = 3.71, **overrides) -> dict:
    """One CloudWatch event carrying a GPBOT_METRIC line, in the shape
    `aws logs filter-log-events` returns."""
    fields = {
        "task_id": "86acb46d4",
        "label": label,
        "verdict": verdict,
        "status": "success",
        "cost_usd": cost_usd,
        "duration_s": 361.2,
        "escalation": "escalated",
    }
    fields.update(overrides)
    return {
        "timestamp": 1_755_500_000_000,
        "message": f"2026-08-18T14:02:11 INFO GPBOT_METRIC {json.dumps(fields)}\n",
        "logStreamName": "ecs/engineer-agent/abc123",
    }


def a_pr(number: int, created: str, **overrides) -> dict:
    pr = {
        "number": number,
        "title": f"[GP-Bot] ENG-109{number} fix the thing",
        "url": f"https://github.com/thegoodparty/omni/pull/{number}",
        "createdAt": created,
        "closedAt": None,
        "mergedAt": None,
        "state": "OPEN",
        "headRefName": f"ENG-109{number}/gp-bot_fix-the-thing",
        "reviews": [{"author": {"login": "delegate-reviewer"}, "state": "APPROVED"}],
    }
    pr.update(overrides)
    return pr


# ---------------------------------------------------------------------------
# The week of 2026-08-17, exactly as the metrics report recorded it.
# ---------------------------------------------------------------------------

# Six analyzed tickets with the latencies the report measured, and DATA-2336 —
# the HubSpot-filed ticket whose tag arrived inside the create call, so no
# webhook ever fired and the sweep's 24h lookback had not started yet.
REPORT_TICKETS = [
    a_ticket("ENG-10905", datetime(2026, 8, 19, 16, 0, tzinfo=UTC), 4.8),
    a_ticket("ENG-10906", datetime(2026, 8, 19, 17, 30, tzinfo=UTC), 5.6),
    a_ticket("ENG-10893", datetime(2026, 8, 18, 9, 15, tzinfo=UTC), 6.5),
    a_ticket("ENG-10892", datetime(2026, 8, 18, 8, 40, tzinfo=UTC), 8.2),
    a_ticket("ENG-10903", datetime(2026, 8, 19, 11, 5, tzinfo=UTC), 8.5),
    a_ticket("ENG-10902", datetime(2026, 8, 19, 10, 20, tzinfo=UTC), 11.1),
    a_ticket("DATA-2336", datetime(2026, 8, 17, 19, 9, tzinfo=UTC), None),
]

# The seven verdicts recorded since escalation went live, and the four runs that
# followed them. The seventh analyze run belongs to a ticket created just before
# the window — runs are bucketed by when they ran, tickets by when they were
# filed, so the two counts are not required to match and this fixture keeps that
# honest rather than tidying it away.
REPORT_RUNS = [
    a_run(verdict="fix", cost_usd=0.23),
    a_run(verdict="fix", cost_usd=3.10),
    a_run(verdict="fix", cost_usd=3.71),
    a_run(verdict="no-code-change", cost_usd=3.71),
    a_run(verdict="no-code-change", cost_usd=4.20),
    a_run(verdict="no-code-change", cost_usd=5.10),
    a_run(verdict="needs-human", cost_usd=7.93),
    a_run(label="implement", verdict=None, cost_usd=0.41, escalation="not an analyze run"),
    a_run(label="implement", verdict=None, cost_usd=4.27, escalation="not an analyze run"),
    a_run(label="implement", verdict=None, cost_usd=5.34, escalation="not an analyze run"),
]

# #1306 sat 62h with only a bot approval; #1307 was merged by a human after
# rework; #1318 was 25h old when the report was written.
REPORT_PRS = [
    a_pr(1306, "2026-08-18T01:00:00Z"),
    a_pr(
        1307,
        "2026-08-18T20:00:00Z",
        state="MERGED",
        mergedAt="2026-08-19T18:00:00Z",
        closedAt="2026-08-19T18:00:00Z",
        reviews=[
            {"author": {"login": "delegate-reviewer"}, "state": "APPROVED"},
            {"author": {"login": "tomer-tgp"}, "state": "APPROVED"},
        ],
    ),
    a_pr(1318, "2026-08-19T14:00:00Z"),
]

REPORT_PAYLOAD = {"window": WINDOW, "tickets": REPORT_TICKETS, "runs": REPORT_RUNS, "prs": REPORT_PRS}


def digest(payload: dict | None = None, now: float = REPORT_PREPARED) -> str:
    return render(summarize(payload if payload is not None else REPORT_PAYLOAD, now=now))


class TestTheWeekTheMetricsReportMeasured:
    """Reconciliation against numbers that were checked by hand against live data."""

    def test_it_reproduces_the_message_the_metrics_report_proposed(self):
        assert digest() == (
            "*gpbot — week of Aug 17–23*\n"
            "Coverage: 6 of 7 tagged bugs analyzed — *1 missed*: "
            "<https://app.clickup.com/t/86adata-2336|DATA-2336>\n"
            "Median time to analysis: 7.3 min\n"
            "Verdicts: 3 fix · 3 no-code-change · 1 needs-human → *4 tickets kept off the eng queue*\n"
            "PRs: 3 opened · 1 merged · 0 closed unmerged · "
            f"⚠️ 1 open past {STALE_HOURS}h with no human review: "
            "<https://github.com/thegoodparty/omni/pull/1306|#1306>\n"
            "Cost: $38.00 this week · $3.71 median per analysis"
        )

    def test_the_headline_is_coverage_and_not_merges(self):
        # Ordering is the argument the whole module makes. A merged-PR headline
        # grades a week where the bot correctly declined to write code near
        # zero, and the largest failure this system has had was invisible to it.
        lines = digest().splitlines()

        assert lines[1].startswith("Coverage:")
        assert "PRs:" in lines[4]


class TestCoverageNamesWhatWasMissed:
    def test_a_missed_ticket_is_named_so_somebody_can_re_tag_it(self):
        # DATA-2336 has still never been analyzed. A count alone would have left
        # it as an anonymous "1 missed" in every weekly message since.
        assert "DATA-2336" in digest()

    def test_a_processing_started_marker_is_not_an_analysis(self):
        # The self-certifying failure: the Lambda posts this comment when the
        # Fargate task launches, so a run that then crashed would report as a
        # covered ticket at a latency of a few seconds.
        ticket = a_ticket("ENG-10999", WINDOW_START, analyzed_after_min=None)

        facts = coverage([ticket])

        assert facts["analyzed"] == 0
        assert facts["missed"][0]["name"] == "ENG-10999"
        assert facts["median_latency_min"] is None

    def test_a_failure_comment_is_not_an_analysis_either(self):
        ticket = a_ticket("ENG-10999", WINDOW_START)
        ticket["comments"].append(
            {
                "id": "c-fail",
                "date": ms(WINDOW_START),
                "comment_text": "[GP-Bot] Failed to start processing: ECS RunTask denied",
                "comment": [],
            }
        )

        assert coverage([ticket])["analyzed"] == 0

    def test_a_comment_from_a_human_is_not_an_analysis(self):
        ticket = a_ticket("ENG-10999", WINDOW_START)
        ticket["comments"].append(
            {"id": "c-human", "date": ms(WINDOW_START), "comment_text": "any update on this?", "comment": []}
        )

        assert coverage([ticket])["analyzed"] == 0

    def test_latency_is_measured_to_the_first_analysis_not_the_last_bot_comment(self):
        # A ticket collects several bot comments over its life — the analysis,
        # then a PR link, then a CI-drive note. Latency is what a human waited
        # for something readable.
        created = WINDOW_START
        ticket = a_ticket("ENG-10999", created, analyzed_after_min=5.0)
        ticket["comments"].append(
            {
                "id": "c-pr",
                "date": ms(datetime(2026, 8, 18, 12, tzinfo=UTC)),
                "comment_text": "[GP-Bot] Opened PR #1318",
                "comment": [],
            }
        )

        assert coverage([ticket])["median_latency_min"] == 5.0

    def test_an_analysis_posted_after_the_window_closed_still_counts_as_covered(self):
        # A Sunday-night bug analyzed on Monday morning was looked at. Calling
        # it a miss would report a working system as broken every week that
        # ended with a late ticket.
        late = a_ticket("ENG-10999", datetime(2026, 8, 23, 23, 50, tzinfo=UTC), analyzed_after_min=20)

        assert coverage([late])["analyzed"] == 1

    def test_a_ticket_with_no_custom_id_is_still_named(self):
        anonymous = a_ticket("ENG-10999", WINDOW_START)
        anonymous["custom_id"] = None

        assert coverage([anonymous])["missed"][0]["name"] == anonymous["id"]

    def test_junk_in_the_ticket_list_cannot_break_the_digest(self):
        assert coverage([None, "nope", 7])["tagged"] == 0


class TestReadingClickUpComments:
    """The shape contract that has already cost a production incident."""

    def test_the_text_is_read_from_the_top_level_field_the_api_actually_sends(self):
        assert comment_text({"comment_text": "[GP-Bot] Analysis", "comment": []}) == "[GP-Bot] Analysis"

    def test_it_falls_back_to_the_fragments_without_requiring_a_type_key(self):
        # The 2026-07-14 incident: the old matcher required `type == "text"` on
        # comment items, which the real response does not carry, so it matched 0
        # of 13 real comments and dedup never fired once.
        fragments = {"comment": [{"text": "[GP-Bot] "}, {"text": "Analysis"}]}

        assert comment_text(fragments) == "[GP-Bot] Analysis"

    def test_a_null_fragment_contributes_nothing_rather_than_raising(self):
        # ClickUp does ship `"text": null`, and a single one used to crash the
        # whole check mid-webhook.
        assert comment_text({"comment": [{"text": None}, {"text": "[GP-Bot] Analysis"}]}) == "[GP-Bot] Analysis"

    def test_an_undatable_analysis_does_not_count_as_one(self):
        # Without a usable date there is no latency to measure and no way to
        # tell the comment apart from one posted a year ago.
        assert analysis_posted_at([{"comment_text": "[GP-Bot] Analysis", "date": None}]) is None


class TestASourceThatFailedSaysSo:
    """The distinction the whole module is built around: 0 is not "unknown"."""

    def test_unreachable_cloudwatch_reads_unavailable_rather_than_no_spend(self):
        message = digest({**REPORT_PAYLOAD, "runs": None})

        assert "Cost: *unavailable*" in message
        assert "$0" not in message

    def test_unreachable_clickup_never_claims_nothing_was_missed(self):
        # The actively false answer. "0 missed" from a check that never ran is
        # worse than posting nothing at all.
        message = digest({**REPORT_PAYLOAD, "tickets": None})

        assert "Coverage: *unavailable*" in message
        assert "missed" not in message.split("\n")[1].replace("*unavailable*", "")

    def test_unreachable_github_does_not_report_a_week_with_no_prs(self):
        assert "PRs: *unavailable*" in digest({**REPORT_PAYLOAD, "prs": None})

    def test_a_query_that_worked_and_found_nothing_says_something_different(self):
        # Three states, not two — but only where the zero is believable. A week
        # with no tickets and no runs is a free week and says so; the same zero
        # on a week that analyzed something is handled below.
        message = digest({"window": WINDOW, "tickets": [], "runs": [], "prs": []})

        assert "Cost: no runs recorded this week." in message
        assert "unavailable" not in message.split("Cost:")[1]

    def test_a_source_that_is_the_wrong_shape_counts_as_missing(self):
        # Only a list means "we checked". A string, an object or an absent key
        # are all things a half-failed shell pipeline produces, and none of them
        # is evidence of a quiet week.
        for junk in ("", {}, "null", 0):
            assert coverage(junk)["available"] is False
            assert verdicts(junk) == {"available": False, "reason": weekly_digest.RUNS_UNREACHABLE}
            assert cost(junk) == {"available": False, "reason": weekly_digest.RUNS_UNREACHABLE}


class TestTheWeekProductionActuallyAnswered:
    """The digest as CI rendered it for 2026-08-17, before this fix.

    Everything here is from that run: 8 tagged tickets, 7 analyzed, DATA-2336
    missed (its real ClickUp id), a 6.5 minute median, 3 PRs opened and 2 merged
    with real timestamps, and zero GPBOT_METRIC lines. The seven analyzed
    tickets are stand-ins carrying latencies that produce the observed median —
    the run reported the median, not the individual tickets.

    The message this asserts is the one the team would see on the first Monday
    after this merges, so it is the assertion most worth breaking loudly.
    """

    TICKETS = [
        a_ticket("ENG-10892", datetime(2026, 8, 18, 8, 40, tzinfo=UTC), 4.8),
        a_ticket("ENG-10893", datetime(2026, 8, 18, 9, 15, tzinfo=UTC), 5.6),
        a_ticket("ENG-10902", datetime(2026, 8, 19, 10, 20, tzinfo=UTC), 6.2),
        a_ticket("ENG-10903", datetime(2026, 8, 19, 11, 5, tzinfo=UTC), 6.5),
        a_ticket("ENG-10905", datetime(2026, 8, 19, 16, 0, tzinfo=UTC), 8.2),
        a_ticket("ENG-10906", datetime(2026, 8, 19, 17, 30, tzinfo=UTC), 8.5),
        a_ticket("ENG-10907", datetime(2026, 8, 21, 9, 0, tzinfo=UTC), 11.1),
        a_ticket(
            "DATA-2336",
            datetime(2026, 8, 17, 19, 9, tzinfo=UTC),
            None,
            id="86ak1w3tn",
            url="https://app.clickup.com/t/86ak1w3tn",
        ),
    ]

    PRS = [
        a_pr(
            1306,
            "2026-08-18T01:00:40Z",
            state="MERGED",
            mergedAt="2026-08-20T16:03:00Z",
            closedAt="2026-08-20T16:03:00Z",
        ),
        a_pr(
            1307,
            "2026-08-18T15:43:17Z",
            state="MERGED",
            mergedAt="2026-08-19T10:25:39Z",
            closedAt="2026-08-19T10:25:39Z",
        ),
        a_pr(
            1318,
            "2026-08-19T14:11:11Z",
            state="MERGED",
            mergedAt="2026-08-24T16:05:54Z",
            closedAt="2026-08-24T16:05:54Z",
        ),
    ]

    def test_the_two_false_lines_are_now_reported_as_missing(self):
        payload = {"window": WINDOW, "tickets": self.TICKETS, "runs": [], "prs": self.PRS}

        assert digest(payload, now=datetime(2026, 8, 28, 15, 0, tzinfo=UTC).timestamp()) == (
            "*gpbot — week of Aug 17–23*\n"
            "Coverage: 7 of 8 tagged bugs analyzed — *1 missed*: "
            "<https://app.clickup.com/t/86ak1w3tn|DATA-2336>\n"
            "Median time to analysis: 6.5 min\n"
            "Verdicts: *unavailable* — no run metrics recorded for this week.\n"
            "PRs: 3 opened · 2 merged · 0 closed unmerged\n"
            "Cost: *unavailable* — no run metrics recorded for this week.\n"
            "⚠️ 7 tickets analyzed but no run metrics exist for this week, so verdicts and cost are missing "
            "rather than zero. The agent has only recorded them since GPBOT_METRIC shipped — an earlier week "
            "has none, and a later one means the metric has stopped flowing."
        )


class TestAZeroIsOnlyBelievedWhenSomethingCorroboratesIt:
    """The bug the first production run found.

    That run reported "Verdicts: no analyses recorded" and "Cost: no runs
    recorded this week" for a week in which ClickUp could see seven analyses,
    three lines above, in the same message. CloudWatch had not failed — it
    answered honestly, and the answer was zero because GPBOT_METRIC ships in
    this same change and did not exist during the window.

    Every week before the deploy has that shape, including the first one the
    team will be shown. The availability rule only covered a source that
    errored; this covers a source that is healthy and empty.
    """

    def test_analyses_with_no_metric_lines_read_as_missing_rather_than_as_zero(self):
        message = digest({**REPORT_PAYLOAD, "runs": []})

        assert "Verdicts: *unavailable*" in message
        assert "Cost: *unavailable*" in message
        assert "no analyses recorded" not in message
        assert "no runs recorded" not in message

    def test_the_message_says_how_to_tell_a_rollout_from_a_fault(self):
        # The symptom alone is not actionable: the same empty result is expected
        # before the deploy and a real failure after it, and only a human knows
        # which side of that date the week falls on.
        message = digest({**REPORT_PAYLOAD, "runs": []})

        assert "6 tickets analyzed but no run metrics exist for this week" in message
        assert "since GPBOT_METRIC shipped" in message
        assert "stopped flowing" in message

    def test_the_reason_is_given_once_rather_than_in_both_lines(self):
        message = digest({**REPORT_PAYLOAD, "runs": []})

        assert message.count("GPBOT_METRIC shipped") == 1

    def test_a_genuinely_quiet_week_still_reads_as_quiet(self):
        # The other half, and the one that must not be lost: a warning that
        # fires on a normal week is a warning people learn to skip.
        message = digest({"window": WINDOW, "tickets": [], "runs": [], "prs": []})

        assert "Verdicts: no analyses recorded." in message
        assert "Cost: no runs recorded this week." in message
        assert "unavailable" not in message
        assert "no run metrics" not in message

    def test_a_zero_nothing_can_corroborate_is_not_reported_as_quiet(self):
        # ClickUp failed, so there is no independent count of analyses to check
        # the zero against. Reporting a quiet week here would be a guess, and it
        # is the same guess that produced the bug above.
        message = digest({**REPORT_PAYLOAD, "tickets": None, "runs": []})

        assert "Verdicts: *unavailable*" in message
        assert "could not be read to corroborate" in message

    def test_lines_that_all_fail_to_parse_count_as_a_gap_not_a_quiet_week(self):
        # A shape drift between the emitter and this parser produces zero usable
        # records from a query that returned plenty, which is a gap by any
        # reading.
        message = digest({**REPORT_PAYLOAD, "runs": [{"message": "GPBOT_METRIC {broken"}]})

        assert "Verdicts: *unavailable*" in message

    def test_one_good_line_is_enough_to_believe_the_rest(self):
        # The check is about whether the metric is flowing at all, not about
        # whether every run is accounted for. Demanding a line per analysis
        # would fire on any run that crashed before it could log one.
        message = digest({**REPORT_PAYLOAD, "runs": [a_run(verdict="fix", cost_usd=3.71)]})

        assert "1 fix · 0 no-code-change · 0 needs-human" in message
        assert "no run metrics" not in message


class TestWhatGoesRed:
    def test_a_rollout_gap_is_reported_in_the_message_without_failing_the_job(self, monkeypatch, capsys):
        # A red cross every Monday for a fortnight, over a state the message
        # already explains, is how a job's redness stops meaning anything.
        monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({**REPORT_PAYLOAD, "runs": []})))

        code = weekly_digest.main()

        assert code == 0
        assert "no run metrics exist for this week" in capsys.readouterr().out

    def test_an_unreachable_source_still_fails_the_job(self, monkeypatch, capsys):
        # A query that errored is the workflow failing to do its job, and it has
        # no expected-for-a-fortnight period to be patient about.
        monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({**REPORT_PAYLOAD, "runs": None})))

        assert weekly_digest.main() == EXIT_DEGRADED
        assert "could not read run metrics from CloudWatch" in capsys.readouterr().out


class TestCountsNeverPercentages:
    def test_the_message_states_raw_counts_and_no_rate(self):
        # Every number in this message has a base small enough that a percentage
        # would be noise — and a percentage in Slack is a percentage in a board
        # deck by Thursday.
        message = digest()

        assert "%" not in message
        assert "6 of 7 tagged bugs analyzed" in message

    def test_one_merge_out_of_three_prs_is_never_expressed_as_a_rate(self):
        # The tier the sample size makes least defensible: 3 autonomous PRs, 1
        # merged. The archived gp-webapp repo's 22 bot PRs — 10 of them still
        # open and now dead — say the constraint is review capacity, which a
        # merge rate would attribute to the bot instead.
        pr_line = next(line for line in digest().splitlines() if line.startswith("PRs:"))

        assert pr_line.startswith("PRs: 3 opened · 1 merged · 0 closed unmerged")
        assert "%" not in pr_line and "rate" not in pr_line


class TestAQuietWeekStillPosts:
    """Unlike the stale-PR nag, silence here is indistinguishable from breakage."""

    def test_a_week_with_no_tagged_bugs_still_produces_a_full_message(self):
        message = digest({"window": WINDOW, "tickets": [], "runs": [], "prs": []})

        assert message.startswith("*gpbot — week of Aug 17–23*")
        assert "no bugs were tagged `gpbot-analyze` this week" in message
        assert "Verdicts: no analyses recorded." in message

    def test_it_says_which_quiet_it_was_rather_than_zero_of_zero(self):
        # "0 of 0 analyzed" reads like a broken query. A statement about the
        # inbox is something the reader can immediately recognise as wrong.
        assert "0 of 0" not in digest({"window": WINDOW, "tickets": [], "runs": [], "prs": []})


class TestVerdictsAndDeflections:
    def test_deflections_are_the_two_verdicts_that_kept_a_human_off_the_ticket(self):
        facts = verdicts(REPORT_RUNS)

        assert facts["counts"] == {"fix": 3, "no-code-change": 3, "needs-human": 1}
        assert facts["deflected"] == 4

    def test_a_verdict_that_never_appeared_is_still_printed_as_zero(self):
        # A verdict silently vanishing from the message is what a parser
        # drifting away from the prompt looks like.
        message = digest({**REPORT_PAYLOAD, "runs": [a_run(verdict="fix")]})

        assert "1 fix · 0 no-code-change · 0 needs-human" in message

    def test_a_successful_analysis_with_no_verdict_is_flagged_in_the_message(self):
        # Alarm-worthy: the analyze prompt requires the line, so a run that
        # finished without one means escalation has silently stopped happening.
        message = digest({**REPORT_PAYLOAD, "runs": [a_run(verdict=None)]})

        assert "1 analysis produced no verdict" in message

    def test_a_crashed_run_is_not_counted_as_a_missing_verdict(self):
        # It has an obvious reason for having none, and lumping the two together
        # buries the case that needs looking at.
        facts = verdicts([a_run(verdict=None, status="error")])

        assert facts["no_verdict"] == 0

    def test_one_malformed_line_does_not_lose_the_rest_of_the_week(self):
        broken = {"message": "GPBOT_METRIC {this is not json"}

        facts = verdicts([broken, *REPORT_RUNS])

        assert facts["counts"]["fix"] == 3

    def test_lines_that_are_not_metrics_are_ignored(self):
        noise = {"message": "2026-08-18T14:02:11 INFO Agent completed: 24 turns. Cost: $3.71"}

        assert verdicts([noise])["counts"] == {"fix": 0, "no-code-change": 0, "needs-human": 0}

    def test_bare_message_strings_are_accepted_as_well_as_event_objects(self):
        # `filter-log-events` returns objects; `--query 'events[].message'`
        # returns strings. Which one the workflow hands over must not be able to
        # silently zero the week.
        assert verdicts([a_run()["message"]])["counts"]["fix"] == 1


class TestCost:
    def test_the_week_total_and_the_median_analysis_are_both_reported(self):
        facts = cost(REPORT_RUNS)

        assert facts["total_usd"] == 38.00
        assert facts["median_analysis_usd"] == 3.71

    def test_the_median_is_per_analysis_and_not_blended_with_implement_runs(self):
        # Implement runs cost several times more and there are far fewer of
        # them, so a blended median moves with the escalation rate rather than
        # with the price of anything.
        analyses_only = [
            r for r in REPORT_RUNS if json.loads(r["message"].split("GPBOT_METRIC ")[1])["label"] == "analyze"
        ]

        assert cost(REPORT_RUNS)["median_analysis_usd"] == cost(analyses_only)["median_analysis_usd"]

    def test_a_run_that_recorded_no_cost_is_called_out_rather_than_summed_as_zero(self):
        message = digest({**REPORT_PAYLOAD, "runs": [a_run(cost_usd=3.71), a_run(cost_usd=None)]})

        assert "$3.71 this week" in message
        assert "1 run recorded no cost" in message

    def test_a_week_where_nothing_reported_a_cost_does_not_read_as_free(self):
        # The same false claim by a different route from an unreachable
        # CloudWatch: runs happened, none carried a price, and "$0.00" would
        # still be the first thing a reader's eye lands on.
        message = digest({**REPORT_PAYLOAD, "runs": [a_run(cost_usd=None), a_run(cost_usd=None)]})

        assert "Cost: unknown — 2 runs recorded no cost." in message
        assert "$0" not in message


class TestPullRequests:
    def test_a_bot_pr_is_recognised_by_either_signal(self):
        # The title comes from the agent's `gh` call and the branch from its git
        # commands. Either alone has been wrong before.
        assert is_bot_pr({"title": "[GP-Bot] ENG-1 fix", "headRefName": "someone/manual-branch"})
        assert is_bot_pr({"title": "Fix the thing", "headRefName": "ENG-1/gp-bot_fix"})
        assert not is_bot_pr({"title": "Fix the thing", "headRefName": "ENG-1/human-fix"})

    def test_a_bot_approval_is_not_human_attention(self):
        # delegate approves every bot PR, so counting it would make the warning
        # permanently absent — which reads exactly like nothing being stale.
        assert not has_human_review(a_pr(1306, "2026-08-18T01:00:00Z"))

    def test_the_same_account_is_matched_over_either_api(self):
        pr = a_pr(1306, "2026-08-18T01:00:00Z", reviews=[{"author": {"login": "cursor[bot]"}}])

        assert not has_human_review(pr)

    def test_a_deleted_reviewer_account_does_not_count_as_a_human(self):
        # GitHub reports a deleted account's login as null. Reading that as a
        # human would quietly drop the PR from the warning.
        pr = a_pr(1306, "2026-08-18T01:00:00Z", reviews=[{"author": None}])

        assert not has_human_review(pr)
        assert len(pull_requests([pr], 0, 1e12, REPORT_PREPARED)["stale"]) == 1

    def test_a_human_review_clears_the_warning(self):
        pr = a_pr(1306, "2026-08-18T01:00:00Z", reviews=[{"author": {"login": "tomer-tgp"}}])

        assert has_human_review(pr)
        assert pull_requests([pr], 0, 1e12, REPORT_PREPARED)["stale"] == []

    def test_a_stale_pr_opened_before_the_window_is_still_reported(self):
        # Deliberately not windowed: a PR nobody has reviewed for three weeks is
        # the thing most worth saying, and windowing would drop it from the
        # message on exactly the weeks it matters most.
        old = a_pr(1306, "2026-07-01T00:00:00Z")

        facts = pull_requests([old], summarize({"window": WINDOW})["start"], 1e12, REPORT_PREPARED)

        assert facts["opened"] == 0
        assert len(facts["stale"]) == 1

    def test_a_merged_pr_is_not_also_counted_as_closed_unmerged(self):
        facts = pull_requests(REPORT_PRS, *_bounds(), now=REPORT_PREPARED)

        assert facts["merged"] == 1
        assert facts["closed_unmerged"] == 0

    def test_a_pr_closed_without_merging_is_counted_as_its_own_outcome(self):
        # Closing a weak bot PR is a good outcome and a decision somebody made.
        closed = a_pr(1400, "2026-08-18T00:00:00Z", state="CLOSED", closedAt="2026-08-20T00:00:00Z")

        assert pull_requests([closed], *_bounds(), now=REPORT_PREPARED)["closed_unmerged"] == 1

    def test_a_pr_that_is_not_the_bots_is_ignored_entirely(self):
        human = a_pr(1500, "2026-08-18T00:00:00Z", title="Add caching", headRefName="me/add-caching")

        assert pull_requests([human], *_bounds(), now=REPORT_PREPARED)["opened"] == 0


def _bounds() -> tuple[float, float]:
    facts = summarize({"window": WINDOW})
    return facts["start"], facts["end"]


class TestTheContractWithTheAgent:
    """The seam most likely to break without anything going red.

    The digest counts lines that engineer_agent writes and the two modules are
    deployed independently — one to Fargate through the release train, one into
    a GitHub Actions runner at checkout. Every other test here feeds the parser
    a line this file wrote, which would keep passing perfectly while the agent
    emitted something else entirely.
    """

    def test_the_digest_reads_a_line_the_agent_actually_produced(self):
        from engineer_agent.agent.metrics import format_metric_line

        emitted = format_metric_line(
            {"status": "success", "task_id": "86acb46d4", "result": "GPBOT-VERDICT: fix", "cost_usd": 3.71},
            "analyze",
            "escalated",
            361.24,
        )

        assert verdicts([emitted])["counts"]["fix"] == 1
        assert cost([emitted])["total_usd"] == 3.71

    def test_a_null_cost_from_the_agent_is_not_read_as_a_free_run(self):
        # metrics.py writes null when it could not trust the number, and the two
        # halves of that decision have to agree: the emitter refusing to guess
        # is worth nothing if the reader guesses instead.
        from engineer_agent.agent.metrics import format_metric_line

        emitted = format_metric_line({"status": "success", "task_id": "x"}, "analyze", "no verdict")

        assert cost([emitted])["unpriced"] == 1
        assert "Cost: unknown" in digest({**REPORT_PAYLOAD, "runs": [emitted]})


class TestTheCliContract:
    def run_main(self, payload, monkeypatch, capsys):
        monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
        code = weekly_digest.main()
        return code, capsys.readouterr()

    def test_the_rendered_message_goes_to_stdout(self, monkeypatch, capsys):
        code, output = self.run_main(REPORT_PAYLOAD, monkeypatch, capsys)

        assert code == 0
        assert output.out.startswith("*gpbot — week of Aug 17–23*")

    def test_a_missing_source_still_prints_a_message_and_then_goes_red(self, monkeypatch, capsys):
        # Both halves matter. The week's message is worth posting without one
        # source; the missing source is worth someone's attention.
        code, output = self.run_main({**REPORT_PAYLOAD, "runs": None}, monkeypatch, capsys)

        assert code == EXIT_DEGRADED
        assert "Coverage: 6 of 7" in output.out
        assert "verdicts" in output.err and "cost" in output.err

    def test_a_missing_window_is_refused_rather_than_guessed(self, monkeypatch, capsys):
        # Everything else degrades to "unavailable", but a guessed window would
        # report the wrong seven days and look completely normal doing it.
        code, output = self.run_main({"tickets": []}, monkeypatch, capsys)

        assert code == 1
        assert output.out == ""

    def test_unreadable_input_produces_no_message(self, monkeypatch, capsys):
        monkeypatch.setattr("sys.stdin", io.StringIO("{not json"))

        assert weekly_digest.main() == 1

    def test_a_backwards_window_is_refused(self):
        with pytest.raises(ValueError):
            summarize({"window": {"start": WINDOW["end"], "end": WINDOW["start"]}})
