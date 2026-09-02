"""The scope rule exists twice. This is what stops the copies drifting apart.

handler.out_of_scope_reason is the authority: it is what refuses to launch an
implement run, and it is the thing standing between a data ticket and a code PR.
engineer_agent.agent.escalation.out_of_scope_reason is a mirror of it, applied
earlier so that a ticket the Lambda will refuse is never tagged `gpbot-work` and
never reported as "escalated" (see the SCOPE note in that module for the
2026-09-01 incident that bought it).

They cannot share a module. Terraform zips the Lambda as a single named file, so
handler.py imports nothing from this repository, and the agent runs in a
different image. Duplication is forced; going undetected is not.

Both directions of drift are worth catching, and they are not equally bad:

  - The MIRROR narrower than the authority means a real bug stops being
    escalated. Silent, and it looks exactly like the bot having no opinion.
  - The MIRROR wider than the authority is only the old behaviour back again —
    a wasted tag that the Lambda still refuses.

This file is cheap insurance for the first one. It runs both copies over the same
cases in one pytest session; TEST_PATHS in the Makefile covers both packages.
"""

import handler
import pytest

from engineer_agent.agent import escalation
from shared.clickup_client import ClickUpTask


def task_dump(**overrides) -> dict:
    """A task shaped the way the agent actually sees one.

    Through ClickUpTask and by_alias, not hand-written, because the alias is
    where this went wrong once already: the model maps the API's `list` onto a
    field called `list_id`, and a plain model_dump() drops `list` altogether.
    """
    fields = {
        "id": "86ak9at9u",
        "custom_id": "ENG-11017",
        "name": "Compliance status is incorrect.",
        "tags": [{"name": "production-bug"}],
        "list": {"id": "901326170555", "name": "Bugs"},
    }
    fields.update(overrides)
    return ClickUpTask(**fields).model_dump(by_alias=True)


CASES = [
    pytest.param(task_dump(), id="an ordinary bug"),
    pytest.param(task_dump(custom_id="DATA-2393"), id="a data custom_id"),
    pytest.param(task_dump(custom_id="data-2393"), id="a lowercase data custom_id"),
    pytest.param(task_dump(custom_id=None), id="no custom_id at all"),
    pytest.param(
        task_dump(list={"id": escalation.DATA_BACKLOG_LIST_ID, "name": "Data Backlog"}),
        id="the Data Backlog list",
    ),
    pytest.param(
        task_dump(list={"id": handler.GROWTH_BUGS_LIST_ID, "name": "Growth-Bugs"}),
        id="the Growth-Bugs list, which is now routed rather than refused",
    ),
    pytest.param(
        task_dump(list={"id": escalation.DATA_BACKLOG_LIST_ID}),
        id="an out-of-scope list with no name",
    ),
    pytest.param(
        task_dump(tags=[{"name": "production-bug"}, {"name": "bug: district-assignment"}]),
        id="the district-assignment tag",
    ),
    pytest.param(
        task_dump(tags=[{"name": "BUG: District-Assignment"}]),
        id="that tag in another case",
    ),
    # Malformed shapes. Both copies document a fail-open, and both have to fail
    # open in the same places, or the mirror starts dropping escalations the
    # Lambda would have accepted.
    pytest.param(None, id="not a task"),
    pytest.param("not-a-dict", id="a string"),
    pytest.param({}, id="an empty task"),
    pytest.param({"custom_id": None, "list": None, "tags": None}, id="every field null"),
    pytest.param({"custom_id": 42}, id="a numeric custom_id"),
    pytest.param({"list": "Data Backlog"}, id="a list that is a string"),
    pytest.param({"list": {"id": 901326391561}}, id="a numeric list id"),
    pytest.param({"tags": "bug: district-assignment"}, id="tags that are a string"),
    pytest.param({"tags": [None, {"name": None}]}, id="unreadable tags"),
]


@pytest.mark.parametrize("task", CASES)
def test_both_copies_reach_the_same_answer(task):
    assert escalation.out_of_scope_reason(task) == handler.out_of_scope_reason(task)


def test_the_lists_are_the_same_lists():
    # Compared as values rather than by identity: the point is that adding a
    # list to one file and forgetting the other fails here, loudly, rather than
    # in a month when a Growth-Bugs ticket quietly gets a PR.
    assert escalation.OUT_OF_SCOPE_LIST_IDS == handler.OUT_OF_SCOPE_LIST_IDS
    assert escalation.OUT_OF_SCOPE_CUSTOM_ID_PREFIXES == handler.OUT_OF_SCOPE_CUSTOM_ID_PREFIXES
    assert escalation.OUT_OF_SCOPE_TAG_NAMES == handler.OUT_OF_SCOPE_TAG_NAMES


def test_a_marketing_ticket_is_a_different_repo_not_a_refusal():
    # Growth-Bugs sat in OUT_OF_SCOPE_LIST_IDS until gp-marketing became a repo
    # the agent could be pointed at. Both copies have to have let go of it, or
    # marketing tickets keep being refused by whichever copy still remembers.
    marketing = task_dump(list={"id": handler.GROWTH_BUGS_LIST_ID, "name": "Growth-Bugs"})

    assert handler.out_of_scope_reason(marketing) is None
    assert escalation.out_of_scope_reason(marketing) is None
    assert handler.target_repo(marketing) == handler.MARKETING_REPO


def test_the_mirror_is_never_the_only_thing_holding():
    # A reminder in executable form: the Lambda checks scope itself, on the task
    # it fetches itself, whatever the agent decided earlier. If this assertion
    # is ever the thing that fails, the guard has been moved out of the Lambda
    # and the repository is protected by an optimisation.
    data_ticket = task_dump(custom_id="DATA-2393")
    assert handler.out_of_scope_reason(data_ticket) is not None
