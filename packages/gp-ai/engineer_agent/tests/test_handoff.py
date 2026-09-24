"""Tests for the #bugs announcement made when a run hands its ticket back.

What is protected here is the opposite of test_escalation.py's concern. There,
every guard that keeps escalation CLOSED matters most, because the cost of being
wrong is an unwanted PR. Here the cost of being wrong is silence on a ticket a
person has to act on — ENG-11112 sat for a day that way — so these lean on the
paths that must still produce a message: a degraded ClickUp, an unroutable list,
a refusal reason nobody has written yet.
"""

import json
from pathlib import Path

import pytest

from engineer_agent.agent import handoff
from engineer_agent.agent.config import ANALYZE_LABEL, DEV_TEST_LABEL
from engineer_agent.agent.escalation import (
    OUTCOME_ALREADY_QUEUED,
    OUTCOME_DISABLED,
    OUTCOME_ESCALATED,
)
from engineer_agent.agent.handoff import (
    CHANNEL_ENV,
    DEFAULT_GROUP,
    GROUP_SLACK_IDS,
    LIST_ROUTING,
    NEEDS_HUMAN_REASON,
    TOKEN_ENV,
    group_mention,
    handoff_reason,
    maybe_notify_handoff,
    owning_group,
    post_to_slack,
    render_handoff,
)

TASK_ID = "86akjftnv"
CHANNEL = "C022VR6PRQC"
TOKEN = "xoxb-not-a-real-token"
WIN_BUGS_LIST = "901321761872"
SERVE_BUGS_LIST = "901328720152"

ENV = {CHANNEL_ENV: CHANNEL, TOKEN_ENV: TOKEN}


class RecordingLogger:
    """Records log calls.

    Not caplog: shared.logger sets propagate=False and binds its StreamHandler
    to the sys.stdout that existed at import time, so neither caplog nor capsys
    sees these lines. Recording the module's logger tests the same contract —
    an ERROR-level line reaches CloudWatch — without depending on logging
    plumbing this package deliberately customizes.
    """

    def __init__(self):
        self.errors: list[str] = []
        self.infos: list[str] = []

    def error(self, message, *args, **kwargs):
        self.errors.append(str(message))

    def info(self, message, *args, **kwargs):
        self.infos.append(str(message))

    def warning(self, message, *args, **kwargs):
        pass


@pytest.fixture
def log(monkeypatch):
    recorder = RecordingLogger()
    monkeypatch.setattr(handoff, "logger", recorder)
    return recorder


class FakeTask:
    """Stands in for the pydantic ClickUpTask the real client returns."""

    def __init__(self, payload: dict):
        self._payload = payload

    def model_dump(self, **kwargs) -> dict:
        # Accepts by_alias and ignores it: these payloads are written in the
        # API's own spelling already.
        return self._payload


class FakeClickUpClient:
    def __init__(self, task: dict | None = None, error: Exception | None = None):
        self._task = task
        self._error = error

    def get_task(self, task_id: str):
        if self._error is not None:
            raise self._error
        return FakeTask(self._task if self._task is not None else {"id": task_id})

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class RecordingPoster:
    def __init__(self, accepted: bool = True):
        self.accepted = accepted
        self.posts: list[tuple[str, str, str]] = []

    def __call__(self, channel: str, token: str, text: str) -> bool:
        self.posts.append((channel, token, text))
        return self.accepted


def factory_for(client: FakeClickUpClient):
    return lambda: client


def analysis(verdict: str, status: str = "success", extra: str = "") -> dict:
    return {"status": status, "task_id": TASK_ID, "result": f"Root cause found.{extra}\nGPBOT-VERDICT: {verdict}"}


def ticket(**overrides) -> dict:
    fields = {
        "id": TASK_ID,
        "custom_id": "ENG-11112",
        "name": "Candidate profile reverting to unclaimed external record",
        "url": f"https://app.clickup.com/t/{TASK_ID}",
        "list": {"id": WIN_BUGS_LIST, "name": "Bugs"},
    }
    fields.update(overrides)
    return fields


# --- who gets told -----------------------------------------------------------


def test_the_routing_table_matches_the_roster_the_workflow_reads():
    """The mirror. .github/gpbot-reviewers.json is the authority.

    gpbot-pr-triage.yml reads that file directly; this module cannot, because
    the agent's Docker build context is packages/gp-ai and nothing under
    .github/ is in the image. So the routing exists twice, and the drift that
    matters is silent: a rotation added or a list re-assigned in the roster
    leaves bot PRs going to the right person and bot handoffs going to the
    wrong one, with nothing failing.
    """
    roster = json.loads((Path(__file__).resolve().parents[4] / ".github/gpbot-reviewers.json").read_text())

    assert {name: group["slackGroupId"] for name, group in roster["groups"].items()} == GROUP_SLACK_IDS
    assert roster["listRouting"] == LIST_ROUTING
    assert roster["defaultGroup"] == DEFAULT_GROUP


def test_every_routed_group_has_a_slack_id_to_mention():
    # A list routed to a group with no id produces a message that pings nobody,
    # which is the one failure mode this whole module exists to remove.
    assert set(LIST_ROUTING.values()) <= set(GROUP_SLACK_IDS)
    assert DEFAULT_GROUP in GROUP_SLACK_IDS


@pytest.mark.parametrize(
    "task, expected",
    [
        (ticket(), "win-bugs"),
        (ticket(list={"id": SERVE_BUGS_LIST, "name": "Bugs"}), "serve-bugs"),
        # Marketing Site Bugs is routable for analysis but absent from the
        # roster's listRouting, so it lands on the default like it does for PRs.
        (ticket(list={"id": "901328971692", "name": "Marketing Site Bugs"}), DEFAULT_GROUP),
        (ticket(list=None), DEFAULT_GROUP),
        (ticket(list={"name": "Bugs"}), DEFAULT_GROUP),
        (ticket(list="Bugs"), DEFAULT_GROUP),
        ({}, DEFAULT_GROUP),
        (None, DEFAULT_GROUP),
    ],
    ids=["win", "serve", "unrouted list", "no list", "list without id", "list as a string", "empty", "not a task"],
)
def test_an_unreadable_list_still_pings_a_rotation(task, expected):
    # Deliberately not "fail closed". Guessing the wrong rotation costs one
    # person a glance at a ticket that is not theirs; guessing nobody is the
    # silence being fixed. gpbot-pr-triage.yml makes the same trade with
    # `.listRouting[$l] // .defaultGroup`.
    assert owning_group(task) == expected
    assert group_mention(task).startswith("<!subteam^")


def test_a_group_with_no_slack_id_mentions_nobody_rather_than_breaking_the_message(monkeypatch):
    monkeypatch.setitem(handoff.LIST_ROUTING, WIN_BUGS_LIST, "a-rotation-with-no-id")

    assert group_mention(ticket()) == ""


# --- when a run is a handoff -------------------------------------------------


@pytest.mark.parametrize("label", [ANALYZE_LABEL, DEV_TEST_LABEL])
def test_needs_human_is_announced_from_every_verdict_emitting_run(label):
    assert handoff_reason(analysis("needs-human"), label, "verdict needs-human") == NEEDS_HUMAN_REASON


@pytest.mark.parametrize("label", ["implement", "ci-fix", ""], ids=["implement", "ci-fix", "unlabelled"])
def test_a_run_that_was_never_asked_for_a_verdict_is_never_a_handoff(label):
    # An implement or ci-fix run emits no verdict, and its ticket already
    # carries a PR that gpbot-pr-triage.yml announced and
    # gpbot-stale-pr-alert.yml chases. An unset label means nobody said what
    # kind of run this is, which config.py already reads as "stay closed".
    assert handoff_reason(analysis("needs-human"), label, "not a verdict-emitting run") is None


@pytest.mark.parametrize(
    "outcome",
    [OUTCOME_ESCALATED, OUTCOME_ALREADY_QUEUED, OUTCOME_DISABLED],
)
def test_a_fix_that_is_being_handled_is_not_announced(outcome):
    assert handoff_reason(analysis("fix"), ANALYZE_LABEL, outcome) is None


@pytest.mark.parametrize(
    "outcome",
    [
        "out of scope (custom_id DATA-2393 is not code work)",
        "analyze-only repo (thegoodparty/gp-marketing)",
        "escalation failed",
        "a refusal reason nobody has written yet",
    ],
    ids=["out of scope", "analyze-only repo", "tag write failed", "an unknown future reason"],
)
def test_a_fix_nobody_queued_is_announced(outcome):
    """The default is to tell someone, and the unknown-reason case is the point.

    A refusal added to escalation.py later starts announcing itself instead of
    silently dropping a ticket that has a known fix and no PR. That is the safe
    direction: being wrong costs one message somebody ignores.
    """
    reason = handoff_reason(analysis("fix"), ANALYZE_LABEL, outcome)

    assert reason is not None
    assert outcome in reason


def test_a_fix_with_no_pr_is_distinguishable_from_needing_a_person():
    # Two different asks — "finish this known fix" versus "work out what to do"
    # — and the on-call reader has to be able to tell them apart at a glance.
    assert handoff_reason(analysis("fix"), ANALYZE_LABEL, "escalation failed") != NEEDS_HUMAN_REASON


@pytest.mark.parametrize(
    "result",
    [
        analysis("no-code-change"),
        analysis("needs-human", status="error"),
        {"status": "success", "task_id": TASK_ID, "result": "I ran out of budget before saying anything"},
        {"status": "success", "task_id": TASK_ID, "result": None},
        {},
        None,
        "not a dict",
    ],
    ids=[
        "no-code-change needs nobody",
        "an unfinished run's verdict is not trusted",
        "no verdict line at all",
        "a result that is not text",
        "an empty result",
        "no result",
        "a result that is a string",
    ],
)
def test_the_channel_is_not_told_about_runs_with_nothing_to_hand_over(result):
    assert handoff_reason(result, ANALYZE_LABEL, "verdict no-code-change") is None


# --- the message -------------------------------------------------------------


def test_the_message_carries_the_ping_the_ticket_and_where_to_read_why():
    text = render_handoff(ticket(), NEEDS_HUMAN_REASON)

    assert f"<!subteam^{GROUP_SLACK_IDS['win-bugs']}>" in text
    assert f"<https://app.clickup.com/t/{TASK_ID}|ENG-11112>" in text
    assert "Candidate profile reverting to unclaimed external record" in text
    assert NEEDS_HUMAN_REASON in text
    assert "comment on the ticket" in text


def test_the_message_names_the_repo_when_the_analysis_placed_the_fix():
    text = render_handoff(ticket(), NEEDS_HUMAN_REASON, "thegoodparty/gp-marketing")

    assert "`thegoodparty/gp-marketing`" in text


def test_the_message_says_nothing_about_a_repo_when_none_was_named():
    assert "The analysis places the fix" not in render_handoff(ticket(), NEEDS_HUMAN_REASON)


@pytest.mark.parametrize(
    "task, expected_link",
    [
        (ticket(url=None), f"https://app.clickup.com/t/{TASK_ID}"),
        (ticket(custom_id=None), TASK_ID),
        ({"id": TASK_ID}, f"https://app.clickup.com/t/{TASK_ID}"),
    ],
    ids=["no url", "no custom_id", "the id alone"],
)
def test_a_thin_ticket_still_produces_a_clickable_message(task, expected_link):
    # The degraded path from a ClickUp failure lands here. A message someone has
    # to go and search ClickUp for is a message that costs more than it saves.
    assert expected_link in render_handoff(task, NEEDS_HUMAN_REASON)


# --- posting -----------------------------------------------------------------


def test_a_handoff_is_posted_to_the_configured_channel():
    poster = RecordingPoster()

    outcome = maybe_notify_handoff(
        analysis("needs-human"),
        ANALYZE_LABEL,
        "verdict needs-human",
        client_factory=factory_for(FakeClickUpClient(ticket())),
        poster=poster,
        env=ENV,
    )

    assert outcome == "announced"
    channel, token, text = poster.posts[0]
    assert (channel, token) == (CHANNEL, TOKEN)
    assert "ENG-11112" in text


def test_nothing_is_posted_for_a_run_that_is_not_a_handoff():
    poster = RecordingPoster()

    outcome = maybe_notify_handoff(analysis("fix"), ANALYZE_LABEL, OUTCOME_ESCALATED, poster=poster, env=ENV)

    assert outcome == "not a handoff"
    assert poster.posts == []


@pytest.mark.parametrize(
    "env, missing",
    [({TOKEN_ENV: TOKEN}, CHANNEL_ENV), ({CHANNEL_ENV: CHANNEL}, TOKEN_ENV), ({}, CHANNEL_ENV)],
    ids=["no channel", "no token", "neither"],
)
def test_an_unconfigured_channel_is_an_error_and_not_a_shrug(env, missing, log):
    """The switch is allowed to be off; it is not allowed to be quiet.

    Every other unset variable in this system degrades to the behaviour that
    existed before the feature. This one degrades to the exact silence the
    feature exists to end, on a ticket already decided to need a person — so it
    logs at ERROR, where CloudWatch can see it.
    """
    poster = RecordingPoster()

    outcome = maybe_notify_handoff(
        analysis("needs-human"), ANALYZE_LABEL, "verdict needs-human", poster=poster, env=env
    )

    assert outcome == "not configured"
    assert poster.posts == []
    assert any(missing in line and TASK_ID in line for line in log.errors)


def test_an_unreachable_clickup_still_gets_the_message_out(log):
    poster = RecordingPoster()

    outcome = maybe_notify_handoff(
        analysis("needs-human"),
        ANALYZE_LABEL,
        "verdict needs-human",
        client_factory=factory_for(FakeClickUpClient(error=RuntimeError("clickup 503"))),
        poster=poster,
        env=ENV,
    )

    assert outcome == "announced"
    # Degraded, but usable: a working link and a rotation that was pinged.
    text = poster.posts[0][2]
    assert f"https://app.clickup.com/t/{TASK_ID}" in text
    assert "<!subteam^" in text
    assert log.errors


def test_a_refused_post_is_reported_rather_than_reported_as_sent():
    outcome = maybe_notify_handoff(
        analysis("needs-human"),
        ANALYZE_LABEL,
        "verdict needs-human",
        client_factory=factory_for(FakeClickUpClient(ticket())),
        poster=RecordingPoster(accepted=False),
        env=ENV,
    )

    assert outcome == "slack refused"


def test_a_run_with_no_task_id_is_loud_rather_than_silent(log):
    outcome = maybe_notify_handoff(
        {"status": "success", "result": "GPBOT-VERDICT: needs-human"},
        ANALYZE_LABEL,
        "verdict needs-human",
        poster=RecordingPoster(),
        env=ENV,
    )

    assert outcome == "no task_id"
    assert log.errors


def test_an_unexpected_failure_cannot_fail_the_container(log):
    """The blanket except, asserted.

    This is the last thing a finished run does. The analysis is already posted
    and already useful, so no shape of failure here is worth turning it into a
    task-failed alarm.
    """

    def explode(*_args, **_kwargs):
        raise RuntimeError("something nobody predicted")

    outcome = maybe_notify_handoff(
        analysis("needs-human"),
        ANALYZE_LABEL,
        "verdict needs-human",
        client_factory=factory_for(FakeClickUpClient(ticket())),
        poster=explode,
        env=ENV,
    )

    assert outcome == "handoff notification failed"
    assert log.errors


# --- the Slack call itself ---------------------------------------------------


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


def test_slack_saying_no_with_a_200_is_treated_as_a_failure(monkeypatch, log):
    """chat.postMessage answers HTTP 200 when it refuses the message.

    A revoked token or a channel the app was never invited to arrives as
    {"ok": false, "error": "not_in_channel"} with a 200 status, so anything
    checking the status code goes green while nobody is told anything. That is
    how release-failure-alert.yml sent 19 alerts into the void.
    """
    monkeypatch.setattr(handoff.httpx, "post", lambda *a, **k: FakeResponse({"ok": False, "error": "not_in_channel"}))

    assert post_to_slack(CHANNEL, TOKEN, "text") is False
    assert any("not_in_channel" in line for line in log.errors)


def test_a_network_failure_is_reported_rather_than_raised(monkeypatch, log):
    def explode(*_args, **_kwargs):
        raise TimeoutError("slack took too long")

    monkeypatch.setattr(handoff.httpx, "post", explode)

    assert post_to_slack(CHANNEL, TOKEN, "text") is False
    assert log.errors


def test_an_accepted_post_sends_the_text_to_the_channel_without_unfurling(monkeypatch):
    sent = {}

    def capture(url, json=None, headers=None, timeout=None):
        sent.update({"url": url, "body": json, "headers": headers})
        return FakeResponse({"ok": True, "ts": "1789653200.1"})

    monkeypatch.setattr(handoff.httpx, "post", capture)

    assert post_to_slack(CHANNEL, TOKEN, "a handoff") is True
    assert sent["body"] == {
        "channel": CHANNEL,
        "text": "a handoff",
        # A ClickUp unfurl is a large card that pushes the next message off
        # screen, and the link is already labelled.
        "unfurl_links": False,
        "unfurl_media": False,
    }
    assert sent["headers"]["Authorization"] == f"Bearer {TOKEN}"
