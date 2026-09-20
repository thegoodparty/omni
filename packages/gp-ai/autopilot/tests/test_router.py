"""Unit tests for the routing table + human-actor gate (router.py).

Pure logic — no boto3 involved. See test_dispatch.py for the claim/launch
side and test_route_event_dispatch.py for the end-to-end wiring through
handler.route_event.
"""

import autopilot_conductor_router as router
import pytest

BOT_USER_ID = "bot-42"
HUMAN_USER_ID = "human-7"
BOARD_LIST_ID = "901300000001"
# A story is a subtask of its epic — epic_task_id set IS what makes an event
# a story event (router.derive_card_type).
EPIC_TASK_ID = "epic-1"


@pytest.fixture(autouse=True)
def bot_user_id_env(monkeypatch):
    monkeypatch.setenv("AUTOPILOT_BOT_USER_ID", BOT_USER_ID)


def transition(actor_user_id, from_status, to_status, transitioned_at="1700000000000"):
    return router.Transition(
        actor_user_id=actor_user_id,
        from_status=from_status,
        to_status=to_status,
        transitioned_at=transitioned_at,
    )


def event(
    kind="statusUpdated",
    task_id="task-1",
    list_id=BOARD_LIST_ID,
    current_status=None,
    transitions=None,
    event_ts=None,
    event_actor_id=None,
    epic_task_id=None,
    latest_comment_text=None,
):
    return router.RoutableEvent(
        kind=kind,
        task_id=task_id,
        list_id=list_id,
        current_status=current_status,
        transitions=transitions or [],
        event_ts=event_ts,
        event_actor_id=event_actor_id,
        epic_task_id=epic_task_id,
        latest_comment_text=latest_comment_text,
    )


def story_event(**kwargs):
    kwargs.setdefault("epic_task_id", EPIC_TASK_ID)
    return event(**kwargs)


# ---------------------------------------------------------------------------
# AC1 / AC2 — epic-create gate
# ---------------------------------------------------------------------------


def test_human_actor_approved_tdd_to_in_progress_dispatches_epic_create():
    e = event(
        transitions=[transition(HUMAN_USER_ID, router.STATUS_APPROVED_TDD, router.STATUS_IN_PROGRESS)],
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].stage == router.STAGE_EPIC_CREATE
    assert decisions[0].card_type == router.FEATURE_CARD
    assert decisions[0].to_supervisor is False


def test_bot_actor_approved_tdd_to_in_progress_dispatches_nothing():
    e = event(
        transitions=[transition(BOT_USER_ID, router.STATUS_APPROVED_TDD, router.STATUS_IN_PROGRESS)],
    )

    assert router.route(e) == []


def test_unconfigured_bot_user_id_refuses_gate_dispatch_and_logs(monkeypatch, capsys):
    monkeypatch.delenv("AUTOPILOT_BOT_USER_ID", raising=False)
    e = event(
        transitions=[transition(HUMAN_USER_ID, router.STATUS_APPROVED_TDD, router.STATUS_IN_PROGRESS)],
    )

    decisions = router.route(e)

    assert decisions == []
    assert "ERROR: AUTOPILOT_BOT_USER_ID not configured" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# AC4 — qa is a non-gate transition; a bot actor is a legitimate trigger
# ---------------------------------------------------------------------------


def test_story_to_qa_by_bot_dispatches_qa_run():
    e = story_event(
        transitions=[transition(BOT_USER_ID, router.STATUS_IN_PROGRESS, router.STATUS_QA)],
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].stage == router.STAGE_QA
    assert decisions[0].card_type == router.STORY_CARD


def test_story_to_qa_by_human_also_dispatches():
    e = story_event(
        transitions=[transition(HUMAN_USER_ID, router.STATUS_IN_PROGRESS, router.STATUS_QA)],
    )

    assert len(router.route(e)) == 1


# ---------------------------------------------------------------------------
# Story kickoff — a manual human dispatch out of the queue column. The
# supervisor's own dispatches never route through here (it launches Fargate
# directly), and the stage runner's first "in progress" write is a bot actor
# this gate refuses.
# ---------------------------------------------------------------------------


def test_human_actor_queued_to_in_progress_dispatches_story_stage():
    e = story_event(
        transitions=[transition(HUMAN_USER_ID, router.STATUS_APPROVED_TDD, router.STATUS_IN_PROGRESS)],
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].stage == router.STAGE_STORY


def test_bot_actor_queued_to_in_progress_dispatches_nothing():
    e = story_event(
        transitions=[transition(BOT_USER_ID, router.STATUS_APPROVED_TDD, router.STATUS_IN_PROGRESS)],
    )

    assert router.route(e) == []


# ---------------------------------------------------------------------------
# AC5 — resume
# ---------------------------------------------------------------------------


def test_feedback_needed_to_in_progress_dispatches_resume():
    e = story_event(
        transitions=[transition(HUMAN_USER_ID, router.STATUS_FEEDBACK_NEEDED, router.STATUS_IN_PROGRESS)],
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].stage == router.STAGE_RESUME


def test_bot_actor_feedback_needed_to_in_progress_dispatches_nothing():
    # "in progress" is a gate destination no matter which table row it hits.
    e = story_event(
        transitions=[transition(BOT_USER_ID, router.STATUS_FEEDBACK_NEEDED, router.STATUS_IN_PROGRESS)],
    )

    assert router.route(e) == []


def test_comment_posted_while_feedback_needed_dispatches_resume():
    # A real taskCommentPosted delivery carries NO history_items; the dedup
    # key comes from the bucketed delivery timestamp.
    e = story_event(
        kind="commentPosted",
        current_status=router.STATUS_FEEDBACK_NEEDED,
        event_ts="1700000099000",
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].stage == router.STAGE_RESUME
    assert decisions[0].transitioned_at == router.comment_trigger_key("1700000099000")


def test_burst_comment_deliveries_share_one_dedup_key():
    # 1700000099000 and 1700000200000 are 101s apart — same 10-minute bucket.
    decisions = [
        router.route(
            story_event(
                kind="commentPosted",
                current_status=router.STATUS_FEEDBACK_NEEDED,
                event_ts=ts,
            )
        )[0]
        for ts in ("1700000099000", "1700000200000")
    ]

    assert decisions[0].transitioned_at == decisions[1].transitioned_at


def test_later_feedback_round_gets_a_fresh_dedup_key():
    # 20 minutes apart — a second feedback phase must not be swallowed by the
    # claim a completed run left behind.
    first = router.comment_trigger_key("1700000099000")
    second = router.comment_trigger_key(str(1700000099000 + 20 * 60 * 1000))

    assert first != second


def test_comment_posted_by_the_bot_itself_is_ignored_and_logged(capsys):
    # The park primitive's LAST card write is its own comment, which comes
    # right back as a commentPosted delivery. Dispatching on it would resume
    # the stage that just parked, and a resume that re-parks comments again —
    # a self-sustaining loop at one paid Fargate run per lap (observed on the
    # first live park; only the then-missing dedup timestamp stopped it).
    e = story_event(
        kind="commentPosted",
        current_status=router.STATUS_FEEDBACK_NEEDED,
        event_ts="1700000100000",
        event_actor_id=BOT_USER_ID,
    )

    assert router.route(e) == []
    assert "Ignoring the bot's own comment" in capsys.readouterr().out


def test_comment_posted_by_a_human_dispatches_resume():
    e = story_event(
        kind="commentPosted",
        current_status=router.STATUS_FEEDBACK_NEEDED,
        event_ts="1700000100000",
        event_actor_id=HUMAN_USER_ID,
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].stage == router.STAGE_RESUME


# ---------------------------------------------------------------------------
# ENG-11150 — Slack-answer relay exemption from the self-resume guard
# ---------------------------------------------------------------------------


def test_bot_comment_carrying_the_slack_answer_marker_dispatches_resume():
    # The ONE exemption: a comment this conductor itself relayed from a
    # Slack thread reply carries the marker even though the actor is the bot.
    e = story_event(
        kind="commentPosted",
        current_status=router.STATUS_FEEDBACK_NEEDED,
        event_ts="1700000100000",
        event_actor_id=BOT_USER_ID,
        latest_comment_text="[autopilot:slack-answer from U123] fix the flaky test",
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].stage == router.STAGE_RESUME


def test_bot_park_comment_is_not_exempted_by_the_marker_check(capsys):
    # Loop safety: the resume a relayed answer wakes may itself re-park. That
    # park comment is bot-authored too, but carries PARK_MARKER, never
    # SLACK_ANSWER_MARKER — it must NOT be exempted, or the self-resume loop
    # the original guard exists to stop comes right back.
    e = story_event(
        kind="commentPosted",
        current_status=router.STATUS_FEEDBACK_NEEDED,
        event_ts="1700000200000",
        event_actor_id=BOT_USER_ID,
        latest_comment_text="[autopilot:parked stage=qa]\n\n1. Q?",
    )

    assert router.route(e) == []
    assert "Ignoring the bot's own comment" in capsys.readouterr().out


def test_bot_comment_with_no_latest_comment_text_is_not_exempted(capsys):
    # The common case: latest_comment_text is only ever hydrated for a
    # commentPosted delivery whose actor is the bot, but a None value (no
    # comments read yet, or a read that came back empty) must still fall
    # through to the ordinary bot-ignore behavior, not silently exempt.
    e = story_event(
        kind="commentPosted",
        current_status=router.STATUS_FEEDBACK_NEEDED,
        event_ts="1700000300000",
        event_actor_id=BOT_USER_ID,
    )

    assert router.route(e) == []
    assert "Ignoring the bot's own comment" in capsys.readouterr().out


def test_is_slack_relay_comment_matches_only_the_slack_answer_marker():
    assert router.is_slack_relay_comment("[autopilot:slack-answer from U123] yes, use option B") is True
    assert router.is_slack_relay_comment("[autopilot:parked stage=qa]\n\n1. Q?") is False
    assert router.is_slack_relay_comment("just a reply") is False
    assert router.is_slack_relay_comment(None) is False


def test_format_slack_answer_comment_embeds_user_and_text():
    text = router.format_slack_answer_comment("U123", "yes, use option B")

    assert text == "[autopilot:slack-answer from U123] yes, use option B"
    assert router.is_slack_relay_comment(text) is True


def test_latest_comment_text_picks_the_newest_by_date():
    comments = [
        {"comment_text": "older", "date": "1000"},
        {"comment_text": "newest", "date": "3000"},
        {"comment_text": "middle", "date": "2000"},
    ]

    assert router.latest_comment_text(comments) == "newest"


def test_latest_comment_text_empty_thread_is_none():
    assert router.latest_comment_text([]) is None


# ---------------------------------------------------------------------------
# ENG-11150 — Slack thread-reply classification (pure, no Slack API calls)
# ---------------------------------------------------------------------------

SLACK_CHANNEL = "C-AUTOPILOT"


def slack_reply(
    channel=SLACK_CHANNEL,
    ts="1700000100.000100",
    thread_ts="1700000000.000000",
    user_id="U-HUMAN",
    bot_id=None,
    text="use option B",
    event_id="Ev123",
):
    return router.SlackReplyEvent(
        channel=channel,
        ts=ts,
        thread_ts=thread_ts,
        user_id=user_id,
        bot_id=bot_id,
        text=text,
        event_id=event_id,
    )


def test_human_thread_reply_in_the_autopilot_channel_is_relayable():
    assert router.is_relayable_slack_reply(slack_reply(), expected_channel=SLACK_CHANNEL) is True


def test_bot_message_is_never_relayable():
    # Covers the relay's own message landing back as a Slack event, and any
    # other app/bot post in the channel.
    e = slack_reply(bot_id="B123")

    assert router.is_relayable_slack_reply(e, expected_channel=SLACK_CHANNEL) is False


def test_non_thread_message_is_not_relayable():
    # A bare top-level channel message: thread_ts equal to its own ts is how
    # Slack represents "this message doesn't reply to anything".
    e = slack_reply(thread_ts="1700000100.000100", ts="1700000100.000100")

    assert router.is_relayable_slack_reply(e, expected_channel=SLACK_CHANNEL) is False


def test_message_with_no_thread_ts_is_not_relayable():
    e = slack_reply(thread_ts=None)

    assert router.is_relayable_slack_reply(e, expected_channel=SLACK_CHANNEL) is False


def test_message_in_a_different_channel_is_not_relayable():
    e = slack_reply(channel="C-SOME-OTHER-CHANNEL")

    assert router.is_relayable_slack_reply(e, expected_channel=SLACK_CHANNEL) is False


def test_message_with_no_user_is_not_relayable():
    e = slack_reply(user_id=None)

    assert router.is_relayable_slack_reply(e, expected_channel=SLACK_CHANNEL) is False


def test_blank_text_is_not_relayable():
    e = slack_reply(text="   ")

    assert router.is_relayable_slack_reply(e, expected_channel=SLACK_CHANNEL) is False


def test_slack_ping_task_id_extracts_the_card_id_from_a_park_message():
    text = "Autopilot parked <https://app.clickup.com/t/abc123|a card> during *qa* — needs your input:\n1. Q?"

    assert router.slack_ping_task_id(text) == "abc123"


def test_slack_ping_task_id_extracts_the_card_id_from_a_notify_message():
    text = "Autopilot *story* on <https://app.clickup.com/t/xyz789|a card>: opened a PR"

    assert router.slack_ping_task_id(text) == "xyz789"


def test_slack_ping_task_id_none_when_thread_root_is_not_a_ping():
    assert router.slack_ping_task_id("just chatting about something else") is None
    assert router.slack_ping_task_id(None) is None


def test_comment_resume_refused_when_bot_user_id_unconfigured(monkeypatch, capsys):
    # Same fail-closed shape as the gate check: an actor that cannot be told
    # apart from the bot cannot be proven human, and the failure mode of
    # guessing wrong is the self-resume loop above.
    monkeypatch.delenv("AUTOPILOT_BOT_USER_ID", raising=False)
    e = story_event(
        kind="commentPosted",
        current_status=router.STATUS_FEEDBACK_NEEDED,
        event_ts="1700000100000",
        event_actor_id=HUMAN_USER_ID,
    )

    assert router.route(e) == []
    assert "refusing comment-resume dispatch" in capsys.readouterr().out


def test_comment_posted_outside_feedback_needed_dispatches_nothing_but_logs(capsys):
    # The status is hydrated after the fast-ack, so a card moved out of
    # feedback-needed in that window is dropped here — and the sweep cannot
    # reconstruct commentPosted, so this log line is the only trace.
    e = story_event(kind="commentPosted", task_id="story-5", current_status=router.STATUS_IN_PROGRESS)

    assert router.route(e) == []
    out = capsys.readouterr().out
    assert "WARNING: commentPosted on story story-5 dropped" in out


def test_comment_posted_on_feature_card_dispatches_nothing():
    # resume is a story-only stage.
    e = event(kind="commentPosted", current_status=router.STATUS_FEEDBACK_NEEDED)

    assert router.route(e) == []


# ---------------------------------------------------------------------------
# Story done -> supervisor stub
# ---------------------------------------------------------------------------


def test_story_done_routes_to_supervisor_with_its_epic(monkeypatch):
    e = story_event(
        transitions=[transition(HUMAN_USER_ID, router.STATUS_QA, router.STATUS_DONE)],
        epic_task_id="epic-7",
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].to_supervisor is True
    assert decisions[0].stage == router.STAGE_SUPERVISOR
    assert decisions[0].epic_task_id == "epic-7"

    # dispatch_to_supervisor's actual epic-conductor logic is exercised in
    # test_supervisor.py; here it is enough to confirm router hands the
    # decision to whichever module _load_supervisor_module resolves.
    calls = []
    fake_supervisor = type("FakeSupervisor", (), {"handle_routed_event": staticmethod(calls.append)})()
    monkeypatch.setattr(router, "_load_supervisor_module", lambda: fake_supervisor)

    router.dispatch_to_supervisor(decisions[0])

    assert calls == [decisions[0]]


def test_breakdown_approval_to_executing_dispatches_to_supervisor_with_own_id():
    # The feature card IS the epic here — no separate epic_task_id field to
    # read, unlike a story-done decision.
    e = event(
        task_id="epic-42",
        transitions=[transition(HUMAN_USER_ID, router.STATUS_FEEDBACK_NEEDED, router.STATUS_EXECUTING)],
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].to_supervisor is True
    assert decisions[0].stage == router.STAGE_SUPERVISOR
    assert decisions[0].epic_task_id == "epic-42"


def test_breakdown_approval_to_executing_by_bot_dispatches_nothing():
    # STATUS_EXECUTING is in GATE_TO_STATUSES; the human-actor gate applies
    # to the supervisor kickoff exactly like every other gated transition.
    e = event(
        transitions=[transition(BOT_USER_ID, router.STATUS_FEEDBACK_NEEDED, router.STATUS_EXECUTING)],
    )

    assert router.route(e) == []


def test_story_done_by_bot_still_routes_to_supervisor_stub():
    # DONE is not a gate destination — the supervisor decides what happens
    # next regardless of who moved the card there.
    e = story_event(
        transitions=[transition(BOT_USER_ID, router.STATUS_QA, router.STATUS_DONE)],
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].to_supervisor is True


def test_feature_card_done_does_not_route_to_supervisor():
    # The supervisor stub is a story-only path in this task.
    e = event(
        transitions=[transition(HUMAN_USER_ID, router.STATUS_IN_PROGRESS, router.STATUS_DONE)],
    )

    assert router.route(e) == []


# ---------------------------------------------------------------------------
# Misc routing edges
# ---------------------------------------------------------------------------


def test_unrecognized_transition_dispatches_nothing():
    e = event(
        transitions=[transition(HUMAN_USER_ID, "backlog", "blocked")],
    )

    assert router.route(e) == []


def test_task_created_kind_dispatches_nothing():
    e = event(kind="taskCreated")

    assert router.route(e) == []


def test_story_kickoff_and_epic_create_share_a_transition_but_not_a_row():
    # The same (approved tdd -> in progress) move means epic-create on a
    # feature card and story kickoff on a story — parenthood is the only
    # discriminator, so a mixed-up epic_task_id would dispatch the wrong
    # (and differently-priced) stage.
    t = [transition(HUMAN_USER_ID, router.STATUS_APPROVED_TDD, router.STATUS_IN_PROGRESS)]

    assert router.route(event(transitions=t))[0].stage == router.STAGE_EPIC_CREATE
    assert router.route(story_event(transitions=t))[0].stage == router.STAGE_STORY


# ---------------------------------------------------------------------------
# Card type derivation — parenthood, not list membership
# ---------------------------------------------------------------------------


def test_derive_card_type_story_when_parent_set():
    assert router.derive_card_type(EPIC_TASK_ID) == router.STORY_CARD


def test_derive_card_type_defaults_to_feature_card():
    assert router.derive_card_type(None) == router.FEATURE_CARD


# ---------------------------------------------------------------------------
# Per-stage ceilings
# ---------------------------------------------------------------------------


def test_stage_ceilings_match_ticket_defaults():
    assert router.STAGE_CEILINGS[router.STAGE_EPIC_CREATE] == router.StageCeiling(10.0, 30 * 60)
    assert router.STAGE_CEILINGS[router.STAGE_STORY] == router.StageCeiling(15.0, 45 * 60)
    assert router.STAGE_CEILINGS[router.STAGE_QA] == router.StageCeiling(8.0, 45 * 60)
    # resume inherits story's ceiling by design (the ticket carves out no
    # separate budget for it) — a change to either side must break this.
    assert router.STAGE_CEILINGS[router.STAGE_RESUME] == router.STAGE_CEILINGS[router.STAGE_STORY]


# ---------------------------------------------------------------------------
# Park-marker parse (the conductor's copy)
# ---------------------------------------------------------------------------


def test_park_marker_pattern_matches_the_agent_side_pattern_exactly():
    # The regex is deliberately duplicated from the agent's feedback module
    # (the Lambda bundle can't import it — see the comment on the constant).
    # This is the drift alarm: the two must stay character-identical.
    from autopilot.agent.feedback import PARK_MARKER_PATTERN as agent_pattern

    assert router.PARK_MARKER_PATTERN.pattern == agent_pattern.pattern
    assert router.PARK_MARKER_PATTERN.flags == agent_pattern.flags


def test_parked_stage_from_comments_latest_marker_wins_by_date():
    comments = [
        {"comment_text": "[autopilot:parked stage=story]", "date": "3000"},
        {"comment_text": "[autopilot:parked stage=qa]", "date": "1000"},
    ]

    assert router.parked_stage_from_comments(comments) == "story"


def test_parked_stage_from_comments_none_without_a_marker():
    assert router.parked_stage_from_comments([{"comment_text": "just a reply", "date": "1"}]) is None
    assert router.parked_stage_from_comments([]) is None


# ---------------------------------------------------------------------------
# Run-summary marker (ENG-11151) — the conductor's copy
# ---------------------------------------------------------------------------


def test_run_summary_marker_pattern_matches_the_agent_side_pattern_exactly():
    # Same drift alarm as PARK_MARKER_PATTERN above: duplicated because the
    # Lambda bundle can't import autopilot.agent.metrics.
    from autopilot.agent.metrics import RUN_SUMMARY_MARKER_PATTERN as agent_pattern

    assert router.RUN_SUMMARY_MARKER_PATTERN.pattern == agent_pattern.pattern
    assert router.RUN_SUMMARY_MARKER_PATTERN.flags == agent_pattern.flags


def test_is_run_summary_comment_matches_only_the_run_summary_marker():
    assert router.is_run_summary_comment("[autopilot:run-summary stage=story outcome=success cost_usd=3.71]") is True
    assert router.is_run_summary_comment("[autopilot:parked stage=story]\n\n1. Q?") is False
    assert router.is_run_summary_comment("[autopilot:slack-answer from U123] yes") is False
    assert router.is_run_summary_comment("just a reply") is False
    assert router.is_run_summary_comment(None) is False


def test_latest_run_summary_parses_stage_outcome_and_cost():
    comments = [{"comment_text": "[autopilot:run-summary stage=story outcome=success cost_usd=3.71]", "date": "1000"}]

    summary = router.latest_run_summary(comments)

    assert summary == {"stage": "story", "outcome": "success", "cost_usd": 3.71}


def test_latest_run_summary_without_cost_reports_none_not_zero():
    comments = [{"comment_text": "[autopilot:run-summary stage=qa outcome=error]", "date": "1000"}]

    assert router.latest_run_summary(comments) == {"stage": "qa", "outcome": "error", "cost_usd": None}


def test_latest_run_summary_latest_marker_wins_by_date():
    comments = [
        {"comment_text": "[autopilot:run-summary stage=story outcome=feedback_parked cost_usd=1.0]", "date": "1000"},
        {"comment_text": "[autopilot:run-summary stage=story outcome=success cost_usd=4.5]", "date": "5000"},
    ]

    assert router.latest_run_summary(comments) == {"stage": "story", "outcome": "success", "cost_usd": 4.5}


def test_latest_run_summary_none_without_a_marker():
    assert router.latest_run_summary([{"comment_text": "just a reply", "date": "1"}]) is None


def test_bot_run_summary_comment_is_not_exempted_by_the_marker_check(capsys):
    # A run-summary comment is bot-authored (posted via the same ClickUp API
    # key) and carries neither PARK_MARKER nor SLACK_ANSWER_MARKER — it must
    # be ignored exactly like a re-park comment (test_bot_park_comment_is_
    # not_exempted_by_the_marker_check above), never treated as a human answer.
    e = story_event(
        kind="commentPosted",
        current_status=router.STATUS_FEEDBACK_NEEDED,
        event_ts="1700000400000",
        event_actor_id=BOT_USER_ID,
        latest_comment_text="[autopilot:run-summary stage=story outcome=success cost_usd=3.71]",
    )

    assert router.route(e) == []
    assert "Ignoring the bot's own comment" in capsys.readouterr().out


def test_parked_stage_from_comments_survives_bad_dates_and_missing_text():
    comments = [
        {"comment_text": "[autopilot:parked stage=story]", "date": "not-a-number"},
        {"date": "2000"},
        {"comment_text": "[AUTOPILOT:PARKED STAGE=QA]", "date": "1000"},
    ]

    assert router.parked_stage_from_comments(comments) == "qa"


# ---------------------------------------------------------------------------
# Merge-pending park classifier (ENG-11147)
# ---------------------------------------------------------------------------


def test_merge_pending_pr_number_extracts_the_pr_number():
    question = "Merge pending: PR #123 is approved with auto-merge armed but hasn't merged yet."

    assert router.merge_pending_pr_number(question) == 123


def test_merge_pending_pr_number_is_case_insensitive_and_tolerates_spacing():
    assert router.merge_pending_pr_number("merge pending:  pr  #7 armed but not merged.") == 7


def test_merge_pending_pr_number_none_for_a_real_question():
    assert router.merge_pending_pr_number("Should this endpoint require an admin role?") is None


def test_merge_pending_pr_number_none_for_deploy_pending():
    # Scoped to merge-pending only — qa.md's status note keeps the existing
    # auto-resume/human path (see sweep.py's resolve_merge_pending_parks).
    assert router.merge_pending_pr_number("Deploy pending: commit abc123 isn't live on dev yet.") is None


def test_merge_pending_pr_number_none_when_pr_number_missing():
    assert router.merge_pending_pr_number("Merge pending: not sure which PR, check the thread.") is None
