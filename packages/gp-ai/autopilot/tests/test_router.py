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
    assert router.STAGE_CEILINGS[router.STAGE_QA] == router.StageCeiling(8.0, 30 * 60)
    # resume inherits story's ceiling by design (the ticket carves out no
    # separate budget for it) — a change to either side must break this.
    assert router.STAGE_CEILINGS[router.STAGE_RESUME] == router.STAGE_CEILINGS[router.STAGE_STORY]
