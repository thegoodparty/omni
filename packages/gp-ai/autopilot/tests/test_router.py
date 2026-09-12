"""Unit tests for the routing table + human-actor gate (router.py).

Pure logic — no boto3 involved. See test_dispatch.py for the claim/launch
side and test_route_event_dispatch.py for the end-to-end wiring through
handler.route_event.
"""

import autopilot_conductor_router as router
import pytest

BOT_USER_ID = "bot-42"
HUMAN_USER_ID = "human-7"
STORY_LIST_ID = "901300000777"
FEATURE_LIST_ID = "901300000001"


@pytest.fixture(autouse=True)
def bot_user_id_env(monkeypatch):
    monkeypatch.setenv("AUTOPILOT_BOT_USER_ID", BOT_USER_ID)


@pytest.fixture(autouse=True)
def story_list_env(monkeypatch):
    monkeypatch.setenv("AUTOPILOT_STORY_LIST_IDS", STORY_LIST_ID)


def transition(actor_user_id, from_status, to_status, transitioned_at="1700000000000"):
    return router.Transition(
        actor_user_id=actor_user_id,
        from_status=from_status,
        to_status=to_status,
        transitioned_at=transitioned_at,
    )


def event(kind="statusUpdated", task_id="task-1", list_id=FEATURE_LIST_ID, current_status=None, transitions=None):
    return router.RoutableEvent(
        kind=kind,
        task_id=task_id,
        list_id=list_id,
        current_status=current_status,
        transitions=transitions or [],
    )


# ---------------------------------------------------------------------------
# AC1 / AC2 — epic-create gate
# ---------------------------------------------------------------------------


def test_human_actor_approved_tdd_to_in_progress_dispatches_epic_create():
    e = event(
        list_id=FEATURE_LIST_ID,
        transitions=[transition(HUMAN_USER_ID, router.STATUS_APPROVED_TDD, router.STATUS_IN_PROGRESS)],
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].stage == router.STAGE_EPIC_CREATE
    assert decisions[0].card_type == router.FEATURE_CARD
    assert decisions[0].to_supervisor is False


def test_bot_actor_approved_tdd_to_in_progress_dispatches_nothing():
    e = event(
        list_id=FEATURE_LIST_ID,
        transitions=[transition(BOT_USER_ID, router.STATUS_APPROVED_TDD, router.STATUS_IN_PROGRESS)],
    )

    assert router.route(e) == []


def test_unconfigured_bot_user_id_refuses_gate_dispatch_and_logs(monkeypatch, capsys):
    monkeypatch.delenv("AUTOPILOT_BOT_USER_ID", raising=False)
    e = event(
        list_id=FEATURE_LIST_ID,
        transitions=[transition(HUMAN_USER_ID, router.STATUS_APPROVED_TDD, router.STATUS_IN_PROGRESS)],
    )

    decisions = router.route(e)

    assert decisions == []
    assert "ERROR: AUTOPILOT_BOT_USER_ID not configured" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# AC4 — qa is a non-gate transition; a bot actor is a legitimate trigger
# ---------------------------------------------------------------------------


def test_story_to_qa_by_bot_dispatches_qa_run():
    e = event(
        list_id=STORY_LIST_ID,
        transitions=[transition(BOT_USER_ID, router.STATUS_IN_PROGRESS, router.STATUS_QA)],
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].stage == router.STAGE_QA
    assert decisions[0].card_type == router.STORY_CARD


def test_story_to_qa_by_human_also_dispatches():
    e = event(
        list_id=STORY_LIST_ID,
        transitions=[transition(HUMAN_USER_ID, router.STATUS_IN_PROGRESS, router.STATUS_QA)],
    )

    assert len(router.route(e)) == 1


# ---------------------------------------------------------------------------
# Story kickoff — a gate transition, but to "executing" rather than
# "in progress" (see GATE_TO_STATUSES's comment for why there are two).
# ---------------------------------------------------------------------------


def test_human_actor_to_do_to_executing_dispatches_story_stage():
    e = event(
        list_id=STORY_LIST_ID,
        transitions=[transition(HUMAN_USER_ID, router.STATUS_TO_DO, router.STATUS_EXECUTING)],
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].stage == router.STAGE_STORY


def test_bot_actor_to_do_to_executing_dispatches_nothing():
    e = event(
        list_id=STORY_LIST_ID,
        transitions=[transition(BOT_USER_ID, router.STATUS_TO_DO, router.STATUS_EXECUTING)],
    )

    assert router.route(e) == []


# ---------------------------------------------------------------------------
# AC5 — resume
# ---------------------------------------------------------------------------


def test_feedback_needed_to_in_progress_dispatches_resume():
    e = event(
        list_id=STORY_LIST_ID,
        transitions=[transition(HUMAN_USER_ID, router.STATUS_FEEDBACK_NEEDED, router.STATUS_IN_PROGRESS)],
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].stage == router.STAGE_RESUME


def test_bot_actor_feedback_needed_to_in_progress_dispatches_nothing():
    # "in progress" is a gate destination no matter which table row it hits.
    e = event(
        list_id=STORY_LIST_ID,
        transitions=[transition(BOT_USER_ID, router.STATUS_FEEDBACK_NEEDED, router.STATUS_IN_PROGRESS)],
    )

    assert router.route(e) == []


def test_comment_posted_while_feedback_needed_dispatches_resume():
    e = event(
        kind="commentPosted",
        list_id=STORY_LIST_ID,
        current_status=router.STATUS_FEEDBACK_NEEDED,
        transitions=[transition(HUMAN_USER_ID, None, None, transitioned_at="1700000099000")],
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].stage == router.STAGE_RESUME
    assert decisions[0].transitioned_at == "1700000099000"


def test_comment_posted_by_bot_while_feedback_needed_still_dispatches():
    # commentPosted has no to-status of its own, so it never matches
    # GATE_TO_STATUSES — a bot-authored comment is as legitimate a trigger
    # here as a human one.
    e = event(
        kind="commentPosted",
        list_id=STORY_LIST_ID,
        current_status=router.STATUS_FEEDBACK_NEEDED,
        transitions=[transition(BOT_USER_ID, None, None)],
    )

    assert len(router.route(e)) == 1


def test_comment_posted_outside_feedback_needed_dispatches_nothing():
    e = event(kind="commentPosted", list_id=STORY_LIST_ID, current_status=router.STATUS_IN_PROGRESS)

    assert router.route(e) == []


def test_comment_posted_on_feature_card_dispatches_nothing():
    # resume is a story-only stage.
    e = event(kind="commentPosted", list_id=FEATURE_LIST_ID, current_status=router.STATUS_FEEDBACK_NEEDED)

    assert router.route(e) == []


# ---------------------------------------------------------------------------
# Story done -> supervisor stub
# ---------------------------------------------------------------------------


def test_story_done_routes_to_supervisor_stub(capsys):
    e = event(
        list_id=STORY_LIST_ID,
        transitions=[transition(HUMAN_USER_ID, router.STATUS_QA, router.STATUS_DONE)],
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].to_supervisor is True
    assert decisions[0].stage == router.STAGE_SUPERVISOR

    router.dispatch_to_supervisor(decisions[0])
    out = capsys.readouterr().out
    assert "supervisor not yet implemented" in out
    assert "task-1" in out


def test_story_done_by_bot_still_routes_to_supervisor_stub():
    # DONE is not a gate destination — the supervisor decides what happens
    # next regardless of who moved the card there.
    e = event(
        list_id=STORY_LIST_ID,
        transitions=[transition(BOT_USER_ID, router.STATUS_QA, router.STATUS_DONE)],
    )

    decisions = router.route(e)

    assert len(decisions) == 1
    assert decisions[0].to_supervisor is True


def test_feature_card_done_does_not_route_to_supervisor():
    # The supervisor stub is a story-only path in this task.
    e = event(
        list_id=FEATURE_LIST_ID,
        transitions=[transition(HUMAN_USER_ID, router.STATUS_IN_PROGRESS, router.STATUS_DONE)],
    )

    assert router.route(e) == []


# ---------------------------------------------------------------------------
# Misc routing edges
# ---------------------------------------------------------------------------


def test_unrecognized_transition_dispatches_nothing():
    e = event(
        list_id=FEATURE_LIST_ID,
        transitions=[transition(HUMAN_USER_ID, "backlog", "blocked")],
    )

    assert router.route(e) == []


def test_task_created_kind_dispatches_nothing():
    e = event(kind="taskCreated", list_id=FEATURE_LIST_ID)

    assert router.route(e) == []


# ---------------------------------------------------------------------------
# Card type derivation
# ---------------------------------------------------------------------------


def test_derive_card_type_story_list():
    assert router.derive_card_type(STORY_LIST_ID) == router.STORY_CARD


def test_derive_card_type_defaults_to_feature_card():
    assert router.derive_card_type(FEATURE_LIST_ID) == router.FEATURE_CARD
    assert router.derive_card_type(None) == router.FEATURE_CARD


# ---------------------------------------------------------------------------
# Per-stage ceilings
# ---------------------------------------------------------------------------


def test_stage_ceilings_match_ticket_defaults():
    assert router.STAGE_CEILINGS[router.STAGE_EPIC_CREATE] == router.StageCeiling(10.0, 30 * 60)
    assert router.STAGE_CEILINGS[router.STAGE_STORY] == router.StageCeiling(15.0, 45 * 60)
    assert router.STAGE_CEILINGS[router.STAGE_QA] == router.StageCeiling(8.0, 30 * 60)
