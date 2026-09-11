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
from engineer_agent.agent.repos import resolve_repo
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
        task_dump(list={"id": handler.MARKETING_SITE_BUGS_LIST_ID, "name": "Marketing Site Bugs"}),
        id="the Marketing Site Bugs list, which is routed rather than refused",
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


def test_every_routed_repo_has_a_briefing():
    """The other half of the two-table split, pinned at CI time.

    handler.py says a routing entry with no matching profile "fails the run
    loudly", and it does — on the first real ticket, in production. That is the
    loud-but-late failure the mirror test above exists to prevent for the scope
    rules, and routing deserves the same treatment: adding a list->repo mapping
    and forgetting the briefing otherwise passes every test.
    """
    for list_id, repo_name in handler.REPO_BY_LIST_ID.items():
        # Raises UnknownRepoError, which is the assertion.
        assert resolve_repo(repo_name).full_name == repo_name, f"list {list_id} routes to an unbriefed repo"

    # The default is reachable without a list entry, so it needs checking too.
    assert resolve_repo(handler.DEFAULT_REPO).full_name == handler.DEFAULT_REPO


def test_the_base_branches_agree_across_the_package_boundary():
    """The Lambda's second copy of every repo's base branch.

    It cannot import repos.py — it is packaged and deployed alone — but it has
    to know the branch, because the CI-fix instructions tell the agent what to
    diff against and what to merge from. gp-marketing's is `develop`, so a drift
    to `main` here would have a fix run comparing its PR against a branch the PR
    does not merge into, and then "fixing" the difference.
    """
    for repo, branch in handler.BASE_BRANCH_BY_REPO.items():
        assert resolve_repo(repo).base_branch == branch, f"{repo} disagrees about its base branch"


def test_every_routable_repo_knows_its_base_branch():
    # The two tables are reached by different paths — one from a ClickUp list,
    # the other from a CI-drive payload — so a repo can be routable for analysis
    # while a fix run on its PR is refused for being an unknown repo.
    routable = set(handler.REPO_BY_LIST_ID.values()) | {handler.DEFAULT_REPO}

    assert routable <= set(handler.BASE_BRANCH_BY_REPO)


def test_a_repo_may_only_be_written_to_if_it_can_be_routed_to():
    # An implement allowlist naming a repo nothing routes to is dead config that
    # reads like an enabled feature. Every writable repo is either the default
    # or has a list pointing at it.
    routable = set(handler.REPO_BY_LIST_ID.values()) | {handler.DEFAULT_REPO}

    assert handler.DEFAULT_IMPLEMENT_REPOS <= routable


def test_the_two_ramp_switches_start_from_the_same_place():
    """The third mirrored pair, and the one with the sharpest edge.

    `GPBOT_IMPLEMENT_REPOS` (Lambda) and `GPBOT_ESCALATE_REPOS` (agent) live in
    different Terraform modules and are only compared at runtime, by two
    processes that never talk. A unit test cannot see what Terraform sets — but
    it can see the DEFAULTS, and those are what every environment gets until
    someone deliberately overrides them.

    The harmful direction is escalation wider than implement: the analysis tags
    a ticket the Lambda then refuses, which is a `gpbot-work` tag with no run
    and no PR behind it. That combination read as a broken pipeline on
    2026-09-01 and cost an investigation to explain.
    """
    assert handler.DEFAULT_IMPLEMENT_REPOS == frozenset(escalation.DEFAULT_ESCALATION_REPOS)


def test_a_marketing_ticket_is_a_different_repo_not_a_refusal():
    # Growth-Bugs sat in OUT_OF_SCOPE_LIST_IDS until gp-marketing became a repo
    # the agent could be pointed at. Both copies have to have let go of it, or
    # marketing tickets keep being refused by whichever copy still remembers.
    marketing = task_dump(list={"id": handler.MARKETING_SITE_BUGS_LIST_ID, "name": "Marketing Site Bugs"})

    assert handler.out_of_scope_reason(marketing) is None
    assert escalation.out_of_scope_reason(marketing) is None
    assert handler.target_repo(marketing) == handler.MARKETING_REPO


def test_the_instruction_cannot_redirect_a_ticket_by_being_quoted():
    """The example repo in the instruction must not parse as a real answer.

    parse_repo takes the LAST GPBOT-REPO match, so that a model quoting its
    instructions before answering is overruled by the answer. Reverse the case
    and that rule turns on itself: a model that quotes the example and then says
    nothing — correct behaviour, because the line is only for a redirect — leaves
    the echo as the last match and the ticket goes wherever the example pointed.

    It pointed at gp-marketing, a name that resolves. So every analysis that
    mentioned its own instructions could have silently re-routed a ticket it had
    diagnosed as belonging exactly where it already was.

    This is the assertion and not a note in the prompt because the two halves sit
    in different packages and neither can import the other: the instruction is in
    the Lambda, the parser is in the agent. Run them against each other here or
    the pairing is only an intention.
    """
    assert escalation.parse_repo(handler.ANALYZE_INSTRUCTION) is None


def test_quoting_the_verdict_menu_cannot_order_a_pr():
    """The same echo hazard on the verdict line, where it is already survivable.

    The instruction lists all three verdicts in one block, so a model that quotes
    the block and never answers leaves the last one — `needs-human` — as the last
    match. That costs a human a read, which is the right price for an analysis
    that did not finish.

    Nothing about that is load-bearing except the ORDER. Move `fix` to the bottom
    of that list, for tidiness or because it reads better, and an analysis that
    only ever quoted its instructions starts ordering pull requests. This pins
    the property rather than the order, so any reshuffle that keeps it safe
    passes and the one that does not fails.
    """
    assert escalation.parse_verdict(handler.ANALYZE_INSTRUCTION) != escalation.VERDICT_FIX


def test_the_repo_marker_writer_and_reader_agree():
    """The redirect crosses a process boundary as prose, and prose can drift.

    escalation writes the marker comment; the Lambda finds it again with a
    regex. They are two independent string literals in two packages that cannot
    import each other, and there is a THIRD copy in test_handler.py's fixture.
    All three agree today. Reword the writer for clarity and the reader stops
    matching it — at which point every redirect silently reverts to the list's
    guess, which is the failure this whole mechanism exists to prevent and the
    one that leaves no trace when it happens.

    So the writer's real comment is built here from its own constant and run
    through the reader's own function, in the one test session that imports
    both.
    """
    repo = handler.MARKETING_REPO
    routed = handler.OMNI_REPO
    # Copied from escalation.maybe_escalate deliberately: pinning the whole
    # sentence, not just the prefix, catches a reader that only ever matched
    # because of where the prefix happened to sit in it.
    comment_text = (
        f"{escalation.REPO_MARKER_PREFIX} `{repo}`, not `{routed}`. "
        f"The ticket's list pointed here at `{routed}`; the analysis above found the cause in "
        f"`{repo}`. Delete this comment to send the implementation run back to `{routed}`."
    )

    assert handler.repo_named_by_bot([{"id": "1", "comment_text": comment_text}]) == repo


def test_the_mirror_is_never_the_only_thing_holding():
    # A reminder in executable form: the Lambda checks scope itself, on the task
    # it fetches itself, whatever the agent decided earlier. If this assertion
    # is ever the thing that fails, the guard has been moved out of the Lambda
    # and the repository is protected by an optimisation.
    data_ticket = task_dump(custom_id="DATA-2393")
    assert handler.out_of_scope_reason(data_ticket) is not None
