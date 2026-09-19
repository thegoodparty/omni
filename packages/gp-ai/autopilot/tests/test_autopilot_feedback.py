"""Tests for the ask-and-park primitive: the only way a headless autopilot
stage gets human input.

Deterministic-helper tests only, per the ticket's own scoping note — whether a
human's reply actually answers a question is the model's judgement at
runtime. These pin what code can guarantee: the marker format, the parse
(latest wins), the dedup that keeps a re-park from repeating itself, the
write order park_for_feedback commits to, and the CLICKUP_TASK_ID/EPIC_TASK_ID
scoping guard.

FakeClickUpClient mirrors engineer_agent/tests/test_escalation.py's own fake:
records writes, used as a context manager via a factory.
"""

import pytest

from autopilot.agent import feedback
from autopilot.agent.feedback import (
    FEEDBACK_NEEDED_STATUS,
    UnknownStageError,
    apply_park_outcome,
    format_park_comment,
    format_park_marker,
    new_questions,
    notify_slack,
    park_for_feedback,
    park_if_stranded,
    parse_parked_stage,
    previously_asked_questions,
    read_park_sentinel,
    write_park_sentinel,
)
from shared.clickup_client import ClickUpComment, ClickUpTask

TASK_ID = "TEST-1"
EPIC_ID = "EPIC-1"

ENV = {"CLICKUP_TASK_ID": TASK_ID, "EPIC_TASK_ID": EPIC_ID, "AUTOPILOT_SLACK_CHANNEL": "#autopilot"}


def make_comment(text: str, date: str = "1000", comment_id: str = "c1") -> ClickUpComment:
    return ClickUpComment(id=comment_id, comment_text=text, date=date)


class FakeClickUpClient:
    """Records writes in call order. Constructed via a factory, used as a
    context manager (matches engineer_agent/tests/test_escalation.py)."""

    def __init__(
        self, comments=None, task_url="https://app.clickup.com/t/TEST-1", raise_on=None, task_status="in progress"
    ):
        self._comments = comments if comments is not None else []
        self._task_url = task_url
        self._raise_on = raise_on or {}
        self._task_status = task_status
        self.writes: list[tuple] = []
        self.closed = False

    def get_task(self, task_id, include_subtasks=False):
        if "get_task" in self._raise_on:
            raise self._raise_on["get_task"]
        return ClickUpTask(id=task_id, name="a card", url=self._task_url, status={"status": self._task_status})

    def get_task_comments(self, task_id):
        if "get_task_comments" in self._raise_on:
            raise self._raise_on["get_task_comments"]
        return self._comments

    def create_task_comment(self, task_id, comment_text):
        if "create_task_comment" in self._raise_on:
            raise self._raise_on["create_task_comment"]
        self.writes.append(("comment", task_id, comment_text))
        return make_comment(comment_text, date="2000", comment_id="posted")

    def update_task(self, task_id, status=None):
        if "update_task" in self._raise_on:
            raise self._raise_on["update_task"]
        self.writes.append(("status", task_id, status))
        return ClickUpTask(id=task_id, name="a card", url=self._task_url)

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.closed = True
        return False


class FakeWebClient:
    def __init__(self, raise_on_post=None):
        self.posted: list[tuple] = []
        self._raise_on_post = raise_on_post

    def chat_postMessage(self, channel, text):
        if self._raise_on_post:
            raise self._raise_on_post
        self.posted.append((channel, text))
        return {}


class FakeSlackClient:
    """Stands in for shared.slack_client.SlackClient. Only `.client` (the
    underlying slack_sdk WebClient) is used by park_for_feedback — see the
    module docstring on why chat_postMessage is called directly rather than
    through a SlackClient method that does not exist."""

    def __init__(self, raise_on_post=None):
        self.client = FakeWebClient(raise_on_post=raise_on_post)


def factory_for(client):
    return lambda: client


# ---------------------------------------------------------------------------
# Marker format + parse
# ---------------------------------------------------------------------------


def test_format_park_comment_starts_with_the_marker_line_then_numbers_questions():
    text = format_park_comment("epic-create", ["Q1", "Q2"])
    lines = text.splitlines()

    assert lines[0] == "[autopilot:parked stage=epic-create]"
    assert lines[2] == "1. Q1"
    assert lines[3] == "2. Q2"


def test_parse_parked_stage_returns_none_with_no_marker():
    assert parse_parked_stage([make_comment("just a normal reply")]) is None


def test_parse_parked_stage_latest_marker_wins_by_date_not_list_order():
    # Deliberately out of chronological order in the list itself, to prove
    # this reads the comment's own `date` rather than trusting list position.
    comments = [
        make_comment(format_park_marker("story"), date="3000"),
        make_comment(format_park_marker("epic-create"), date="1000"),
        make_comment(format_park_marker("qa"), date="2000"),
    ]

    assert parse_parked_stage(comments) == "story"


def test_parse_parked_stage_is_case_insensitive():
    assert parse_parked_stage([make_comment("[AUTOPILOT:PARKED STAGE=QA]", date="1")]) == "qa"


def test_parse_parked_stage_ignores_a_comment_with_an_unparseable_date():
    # An undatable comment sorts first (oldest), same "fail toward not
    # blocking" direction clickup_bot takes on an unparseable comment date —
    # it must not crash the parse, and must not be mistaken for the latest.
    comments = [
        make_comment(format_park_marker("epic-create"), date="not-a-number"),
        make_comment(format_park_marker("qa"), date="1000"),
    ]

    assert parse_parked_stage(comments) == "qa"


# ---------------------------------------------------------------------------
# Question dedup
# ---------------------------------------------------------------------------


def test_previously_asked_questions_reads_only_marker_comments():
    comments = [
        make_comment(format_park_comment("epic-create", ["What repo?", "What deadline?"]), date="1"),
        make_comment("I don't know, ask someone else", date="2"),
    ]

    assert previously_asked_questions(comments) == ["What repo?", "What deadline?"]


def test_new_questions_drops_anything_already_asked_case_and_whitespace_insensitive():
    comments = [make_comment(format_park_comment("epic-create", ["What repo?"]), date="1")]

    assert new_questions(["  what   REPO?  ", "What deadline?"], comments) == ["What deadline?"]


def test_new_questions_deduplicates_within_the_candidate_list_itself():
    assert new_questions(["Same question", "same question"], []) == ["Same question"]


def test_new_questions_across_multiple_prior_marker_comments():
    comments = [
        make_comment(format_park_comment("epic-create", ["Q1"]), date="1"),
        make_comment(format_park_marker("epic-create") + "\n\n1. Q2", date="2"),
    ]

    assert new_questions(["Q1", "Q2", "Q3"], comments) == ["Q3"]


# ---------------------------------------------------------------------------
# Park sequence
# ---------------------------------------------------------------------------


def test_park_for_feedback_posts_comment_then_moves_status_then_notifies_slack(tmp_path):
    clickup = FakeClickUpClient()
    slack = FakeSlackClient()

    result = park_for_feedback(
        TASK_ID,
        "epic-create",
        ["What repo?"],
        clickup_client_factory=factory_for(clickup),
        slack_client_factory=factory_for(slack),
        workspace_dir=str(tmp_path),
        env=ENV,
    )

    assert clickup.writes == [
        ("comment", TASK_ID, "[autopilot:parked stage=epic-create]\n\n1. What repo?"),
        ("status", TASK_ID, FEEDBACK_NEEDED_STATUS),
    ]
    assert len(slack.client.posted) == 1
    channel, text = slack.client.posted[0]
    assert channel == "#autopilot"
    assert "What repo?" in text
    assert clickup.closed is True
    assert result == {
        "status": "parked",
        "task_id": TASK_ID,
        "stage": "epic-create",
        "questions": ["What repo?"],
        "card_url": "https://app.clickup.com/t/TEST-1",
        "channel": "#autopilot",
    }


def test_park_for_feedback_writes_the_sentinel_as_its_last_step(tmp_path):
    park_for_feedback(
        TASK_ID,
        "story",
        ["Q?"],
        clickup_client_factory=factory_for(FakeClickUpClient()),
        slack_client_factory=factory_for(FakeSlackClient()),
        workspace_dir=str(tmp_path),
        env=ENV,
    )

    assert read_park_sentinel(str(tmp_path)) == {"stage": "story", "task_id": TASK_ID}


def test_park_for_feedback_dedupes_against_the_existing_thread(tmp_path):
    existing = [make_comment(format_park_comment("epic-create", ["What repo?"]), date="1")]
    clickup = FakeClickUpClient(comments=existing)

    result = park_for_feedback(
        TASK_ID,
        "epic-create",
        ["What repo?", "What deadline?"],
        clickup_client_factory=factory_for(clickup),
        slack_client_factory=factory_for(FakeSlackClient()),
        workspace_dir=str(tmp_path),
        env=ENV,
    )

    assert result["questions"] == ["What deadline?"]
    assert "What repo?" not in clickup.writes[0][2]


def test_park_for_feedback_skips_the_comment_but_still_completes_when_nothing_is_new(tmp_path):
    # Not an error case: a re-park whose questions are all already on the
    # card must not duplicate the comment, but it must still finish moving
    # the status and notifying Slack (see the retry-safety test below for
    # why this matters).
    existing = [make_comment(format_park_comment("epic-create", ["What repo?"]), date="1")]
    clickup = FakeClickUpClient(comments=existing)
    slack = FakeSlackClient()

    result = park_for_feedback(
        TASK_ID,
        "epic-create",
        ["What repo?"],
        clickup_client_factory=factory_for(clickup),
        slack_client_factory=factory_for(slack),
        workspace_dir=str(tmp_path),
        env=ENV,
    )

    assert clickup.writes == [("status", TASK_ID, FEEDBACK_NEEDED_STATUS)]
    assert len(slack.client.posted) == 1
    assert result["status"] == "parked"
    assert result["questions"] == []
    assert read_park_sentinel(str(tmp_path)) == {"stage": "epic-create", "task_id": TASK_ID}


def test_retrying_after_a_failed_status_move_completes_the_status_move_and_slack_notify(tmp_path):
    # The exact bug this regression-tests: attempt 1 posts the comment, then
    # the status move fails. A naive retry re-derives `to_ask` from the
    # thread (now carrying attempt 1's own comment), finds nothing new, and
    # must NOT treat that as "already asked, refuse" — that would wedge the
    # card behind its own dedup guard with no way to finish parking it.
    failing_clickup = FakeClickUpClient(raise_on={"update_task": RuntimeError("clickup 500")})
    with pytest.raises(RuntimeError, match="clickup 500"):
        park_for_feedback(
            TASK_ID,
            "epic-create",
            ["What repo?"],
            clickup_client_factory=factory_for(failing_clickup),
            slack_client_factory=factory_for(FakeSlackClient()),
            workspace_dir=str(tmp_path),
            env=ENV,
        )
    assert failing_clickup.writes == [("comment", TASK_ID, "[autopilot:parked stage=epic-create]\n\n1. What repo?")]
    assert read_park_sentinel(str(tmp_path)) is None

    posted_comment = make_comment(format_park_comment("epic-create", ["What repo?"]), date="2")
    retry_clickup = FakeClickUpClient(comments=[posted_comment])
    retry_slack = FakeSlackClient()

    result = park_for_feedback(
        TASK_ID,
        "epic-create",
        ["What repo?"],
        clickup_client_factory=factory_for(retry_clickup),
        slack_client_factory=factory_for(retry_slack),
        workspace_dir=str(tmp_path),
        env=ENV,
    )

    # No duplicate comment — only the status move this retry needed to finish.
    assert retry_clickup.writes == [("status", TASK_ID, FEEDBACK_NEEDED_STATUS)]
    assert len(retry_slack.client.posted) == 1
    assert result["status"] == "parked"
    assert read_park_sentinel(str(tmp_path)) == {"stage": "epic-create", "task_id": TASK_ID}


def test_park_for_feedback_rejects_a_task_id_outside_the_envelope(tmp_path):
    clickup = FakeClickUpClient()
    slack = FakeSlackClient()

    with pytest.raises(ValueError, match="CLICKUP_TASK_ID"):
        park_for_feedback(
            "SOME-OTHER-CARD",
            "epic-create",
            ["Q?"],
            clickup_client_factory=factory_for(clickup),
            slack_client_factory=factory_for(slack),
            workspace_dir=str(tmp_path),
            env=ENV,
        )

    assert clickup.writes == []
    assert slack.client.posted == []


def test_park_for_feedback_rejects_an_unknown_stage(tmp_path):
    with pytest.raises(UnknownStageError):
        park_for_feedback(
            TASK_ID,
            "not-a-real-stage",
            ["Q?"],
            clickup_client_factory=factory_for(FakeClickUpClient()),
            slack_client_factory=factory_for(FakeSlackClient()),
            workspace_dir=str(tmp_path),
            env=ENV,
        )


def test_park_for_feedback_requires_a_slack_channel(tmp_path):
    env_without_channel = {"CLICKUP_TASK_ID": TASK_ID, "EPIC_TASK_ID": EPIC_ID}
    clickup = FakeClickUpClient()

    with pytest.raises(ValueError, match="channel"):
        park_for_feedback(
            TASK_ID,
            "epic-create",
            ["Q?"],
            clickup_client_factory=factory_for(clickup),
            slack_client_factory=factory_for(FakeSlackClient()),
            workspace_dir=str(tmp_path),
            env=env_without_channel,
        )

    assert clickup.writes == []


def test_a_failed_slack_post_raises_and_leaves_no_sentinel(tmp_path):
    clickup = FakeClickUpClient()
    slack = FakeSlackClient(raise_on_post=RuntimeError("slack is down"))

    with pytest.raises(RuntimeError, match="slack is down"):
        park_for_feedback(
            TASK_ID,
            "epic-create",
            ["Q?"],
            clickup_client_factory=factory_for(clickup),
            slack_client_factory=factory_for(slack),
            workspace_dir=str(tmp_path),
            env=ENV,
        )

    # The comment and status move already happened — that partial state is
    # real and visible on the card — but no sentinel means main.py cannot
    # report this run as a clean park.
    assert len(clickup.writes) == 2
    assert read_park_sentinel(str(tmp_path)) is None


def test_a_failed_status_move_raises_before_slack_is_ever_touched(tmp_path):
    clickup = FakeClickUpClient(raise_on={"update_task": RuntimeError("clickup 500")})
    slack = FakeSlackClient()

    with pytest.raises(RuntimeError, match="clickup 500"):
        park_for_feedback(
            TASK_ID,
            "epic-create",
            ["Q?"],
            clickup_client_factory=factory_for(clickup),
            slack_client_factory=factory_for(slack),
            workspace_dir=str(tmp_path),
            env=ENV,
        )

    assert slack.client.posted == []
    assert read_park_sentinel(str(tmp_path)) is None


# ---------------------------------------------------------------------------
# Sentinel round trip
# ---------------------------------------------------------------------------


def test_read_park_sentinel_is_none_when_nothing_was_written(tmp_path):
    assert read_park_sentinel(str(tmp_path)) is None


def test_write_then_read_park_sentinel_round_trips(tmp_path):
    write_park_sentinel(str(tmp_path), "qa", TASK_ID)

    assert read_park_sentinel(str(tmp_path)) == {"stage": "qa", "task_id": TASK_ID}


def test_read_park_sentinel_tolerates_a_corrupt_file(tmp_path):
    (tmp_path / feedback.PARK_SENTINEL_FILENAME).write_text("not json")

    assert read_park_sentinel(str(tmp_path)) is None


# ---------------------------------------------------------------------------
# Outcome tagging
# ---------------------------------------------------------------------------


def test_apply_park_outcome_tags_a_successful_run_that_parked(tmp_path):
    write_park_sentinel(str(tmp_path), "epic-create", TASK_ID)
    result = {"status": "success", "task_id": TASK_ID}

    apply_park_outcome(result, str(tmp_path))

    assert result["parked_stage"] == "epic-create"


def test_apply_park_outcome_leaves_a_plain_success_alone(tmp_path):
    result = {"status": "success", "task_id": TASK_ID}

    apply_park_outcome(result, str(tmp_path))

    assert "parked_stage" not in result


def test_apply_park_outcome_ignores_a_sentinel_on_a_failed_run(tmp_path):
    # A run cannot both error out and cleanly park; a sentinel left behind by
    # an earlier attempt must not relabel a failed run as a successful park.
    write_park_sentinel(str(tmp_path), "epic-create", TASK_ID)
    result = {"status": "error", "task_id": TASK_ID, "error": "boom"}

    apply_park_outcome(result, str(tmp_path))

    assert "parked_stage" not in result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def test_cli_park_exits_zero_and_reports_the_card(monkeypatch, capsys, tmp_path):
    for key, value in ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("WORKSPACE_DIR", str(tmp_path))
    monkeypatch.setattr(feedback, "ClickUpClient", factory_for(FakeClickUpClient()))
    monkeypatch.setattr(feedback, "SlackClient", factory_for(FakeSlackClient()))

    exit_code = feedback.main(["park", "--task-id", TASK_ID, "--stage", "epic-create", "--question", "What repo?"])

    assert exit_code == 0
    assert "Parked" in capsys.readouterr().out
    assert read_park_sentinel(str(tmp_path)) == {"stage": "epic-create", "task_id": TASK_ID}


def test_cli_park_exits_nonzero_and_says_why_on_failure(monkeypatch, capsys):
    for key, value in ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(feedback, "ClickUpClient", factory_for(FakeClickUpClient()))
    monkeypatch.setattr(feedback, "SlackClient", factory_for(FakeSlackClient(raise_on_post=RuntimeError("down"))))

    exit_code = feedback.main(["park", "--task-id", TASK_ID, "--stage", "epic-create", "--question", "What repo?"])

    assert exit_code == 1
    assert "Failed to park" in capsys.readouterr().err


def test_cli_rejects_a_stage_with_no_ceiling_default():
    with pytest.raises(SystemExit):
        feedback.main(["park", "--task-id", TASK_ID, "--stage", "resume", "--question", "Q?"])


def test_cli_parked_stage_prints_the_stage(monkeypatch, capsys):
    comments = [make_comment(format_park_marker("qa"), date="1")]
    monkeypatch.setattr(feedback, "ClickUpClient", factory_for(FakeClickUpClient(comments=comments)))

    exit_code = feedback.main(["parked-stage", "--task-id", TASK_ID])

    assert exit_code == 0
    assert capsys.readouterr().out.strip() == "qa"


def test_cli_parked_stage_exits_nonzero_with_no_marker_on_the_card(monkeypatch, capsys):
    monkeypatch.setattr(feedback, "ClickUpClient", factory_for(FakeClickUpClient(comments=[])))

    exit_code = feedback.main(["parked-stage", "--task-id", TASK_ID])

    assert exit_code == 1
    assert "No park marker" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# Notify (the park's Slack ping without the park)
# ---------------------------------------------------------------------------


def test_notify_slack_posts_one_message_and_touches_nothing_on_the_card():
    slack = FakeSlackClient()

    result = notify_slack(
        TASK_ID,
        "epic-create",
        "Breakdown ready for review",
        slack_client_factory=factory_for(slack),
        env=ENV,
    )

    assert len(slack.client.posted) == 1
    channel, text = slack.client.posted[0]
    assert channel == "#autopilot"
    assert "epic-create" in text
    assert "Breakdown ready for review" in text
    assert f"https://app.clickup.com/t/{TASK_ID}" in text
    assert result == {
        "status": "notified",
        "task_id": TASK_ID,
        "stage": "epic-create",
        "card_url": f"https://app.clickup.com/t/{TASK_ID}",
        "channel": "#autopilot",
    }


def test_notify_slack_explicit_channel_wins_over_the_env():
    slack = FakeSlackClient()

    notify_slack(
        TASK_ID,
        "qa",
        "hello",
        channel="#other",
        slack_client_factory=factory_for(slack),
        env=ENV,
    )

    assert slack.client.posted[0][0] == "#other"


def test_notify_slack_rejects_a_task_id_outside_the_envelope():
    slack = FakeSlackClient()

    with pytest.raises(ValueError, match="Refusing to notify"):
        notify_slack(
            "SOMEONE-ELSES-CARD",
            "epic-create",
            "hello",
            slack_client_factory=factory_for(slack),
            env=ENV,
        )
    assert slack.client.posted == []


def test_notify_slack_rejects_an_unknown_stage():
    with pytest.raises(UnknownStageError):
        notify_slack(
            TASK_ID,
            "not-a-stage",
            "hello",
            slack_client_factory=factory_for(FakeSlackClient()),
            env=ENV,
        )


def test_notify_slack_requires_a_channel():
    with pytest.raises(ValueError, match="No Slack channel"):
        notify_slack(
            TASK_ID,
            "epic-create",
            "hello",
            slack_client_factory=factory_for(FakeSlackClient()),
            env={"CLICKUP_TASK_ID": TASK_ID},
        )


def test_notify_slack_requires_a_nonempty_message():
    with pytest.raises(ValueError, match="non-empty message"):
        notify_slack(
            TASK_ID,
            "epic-create",
            "   ",
            slack_client_factory=factory_for(FakeSlackClient()),
            env=ENV,
        )


def test_cli_notify_posts_and_exits_zero(monkeypatch, capsys):
    slack = FakeSlackClient()
    monkeypatch.setattr(feedback, "SlackClient", factory_for(slack))
    monkeypatch.setenv("CLICKUP_TASK_ID", TASK_ID)
    monkeypatch.setenv("AUTOPILOT_SLACK_CHANNEL", "#autopilot")

    exit_code = feedback.main(
        ["notify", "--task-id", TASK_ID, "--stage", "epic-create", "--message", "Breakdown ready"]
    )

    assert exit_code == 0
    assert len(slack.client.posted) == 1
    assert "Notified" in capsys.readouterr().out


def test_cli_notify_exits_nonzero_when_slack_fails(monkeypatch, capsys):
    monkeypatch.setattr(feedback, "SlackClient", factory_for(FakeSlackClient(raise_on_post=RuntimeError("down"))))
    monkeypatch.setenv("CLICKUP_TASK_ID", TASK_ID)
    monkeypatch.setenv("AUTOPILOT_SLACK_CHANNEL", "#autopilot")

    exit_code = feedback.main(["notify", "--task-id", TASK_ID, "--stage", "epic-create", "--message", "hi"])

    assert exit_code == 1
    assert "Failed to notify" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# Stranded-run guard (the harness's deterministic park)
# ---------------------------------------------------------------------------


def test_park_if_stranded_parks_a_success_left_in_progress(tmp_path):
    clickup = FakeClickUpClient(task_status="in progress")
    slack = FakeSlackClient()
    result = {"status": "success"}

    park_if_stranded(
        result,
        "story",
        TASK_ID,
        clickup_client_factory=factory_for(clickup),
        slack_client_factory=factory_for(slack),
        env=ENV,
        workspace_dir=str(tmp_path),
    )

    # The park ran: comment, status move to feedback needed, Slack ping, and
    # the result now reports the park so the metric line says feedback_parked.
    assert ("status", TASK_ID, FEEDBACK_NEEDED_STATUS) in clickup.writes
    assert len(slack.client.posted) == 1
    assert result["parked_stage"] == "story"


def test_park_if_stranded_leaves_a_card_that_ended_elsewhere_alone(tmp_path):
    clickup = FakeClickUpClient(task_status="qa")
    slack = FakeSlackClient()
    result = {"status": "success"}

    park_if_stranded(
        result,
        "story",
        TASK_ID,
        clickup_client_factory=factory_for(clickup),
        slack_client_factory=factory_for(slack),
        env=ENV,
        workspace_dir=str(tmp_path),
    )

    assert clickup.writes == []
    assert slack.client.posted == []
    assert "parked_stage" not in result


def test_park_if_stranded_skips_an_already_parked_result(tmp_path):
    clickup = FakeClickUpClient(task_status="in progress")
    result = {"status": "success", "parked_stage": "story"}

    park_if_stranded(
        result,
        "story",
        TASK_ID,
        clickup_client_factory=factory_for(clickup),
        slack_client_factory=factory_for(FakeSlackClient()),
        env=ENV,
        workspace_dir=str(tmp_path),
    )

    assert clickup.writes == []


def test_park_if_stranded_parks_an_errored_run_left_in_progress(tmp_path):
    # An errored run (deadline kill, ceiling, crash after startup) leaves the
    # card wherever the crash did — the first live qa deadline kill proved
    # neither the sweep nor the stall alert routes it back, so the guard
    # parks errors exactly like successes.
    clickup = FakeClickUpClient(task_status="in progress")
    slack = FakeSlackClient()
    result = {"status": "error", "error": "Deadline exceeded (1800s)"}

    park_if_stranded(
        result,
        "story",
        TASK_ID,
        clickup_client_factory=factory_for(clickup),
        slack_client_factory=factory_for(slack),
        env=ENV,
        workspace_dir=str(tmp_path),
    )

    assert ("status", TASK_ID, FEEDBACK_NEEDED_STATUS) in clickup.writes
    assert result["parked_stage"] == "story"
    parked_comment = next(text for (kind, _, text) in clickup.writes if kind == "comment")
    assert "Deadline exceeded" in parked_comment


def test_park_if_stranded_parks_a_qa_run_dead_in_qa_status(tmp_path):
    # A qa run's card STARTS in "qa", a status nothing routes out of — a run
    # that dies mid-walk strands it exactly where it began (ENG-11132 live).
    clickup = FakeClickUpClient(task_status="qa")
    slack = FakeSlackClient()
    result = {"status": "error", "error": "Deadline exceeded (1800s)"}

    park_if_stranded(
        result,
        "qa",
        TASK_ID,
        clickup_client_factory=factory_for(clickup),
        slack_client_factory=factory_for(slack),
        env=ENV,
        workspace_dir=str(tmp_path),
    )

    assert ("status", TASK_ID, FEEDBACK_NEEDED_STATUS) in clickup.writes
    assert result["parked_stage"] == "qa"


def test_park_if_stranded_leaves_a_passed_qa_card_in_done_alone(tmp_path):
    clickup = FakeClickUpClient(task_status="done")
    result = {"status": "success"}

    park_if_stranded(
        result,
        "qa",
        TASK_ID,
        clickup_client_factory=factory_for(clickup),
        slack_client_factory=factory_for(FakeSlackClient()),
        env=ENV,
        workspace_dir=str(tmp_path),
    )

    assert clickup.writes == []
    assert "parked_stage" not in result


def test_park_if_stranded_guard_failure_never_masks_the_run_result(tmp_path):
    clickup = FakeClickUpClient(task_status="in progress", raise_on={"get_task": RuntimeError("down")})
    result = {"status": "success"}

    returned = park_if_stranded(
        result,
        "story",
        TASK_ID,
        clickup_client_factory=factory_for(clickup),
        slack_client_factory=factory_for(FakeSlackClient()),
        env=ENV,
        workspace_dir=str(tmp_path),
    )

    assert returned == {"status": "success"}
