"""Tests for the analyze -> implement escalation gate.

The thing being protected here is the repository. An escalation opens a PR with
no human between the model's judgement and the branch, so every guard that keeps
escalation CLOSED matters more than the one path that opens it.
"""

import pytest

from engineer_agent.agent import escalation
from engineer_agent.agent.escalation import (
    ESCALATION_ENABLED_ENV,
    IMPLEMENT_TAG,
    already_queued,
    escalation_enabled,
    maybe_escalate,
    parse_repo,
    parse_verdict,
)
from shared.clickup_client import ClickUpTask

TASK_ID = "86acb46d4"


class RecordingLogger:
    """Records log calls.

    Not caplog: shared.logger sets propagate=False and binds its StreamHandler to
    the sys.stdout that existed at import time, so neither caplog nor capsys sees
    these lines. Recording the module's logger tests the same contract — an
    ERROR-level line reaches CloudWatch, which is what fires the alarm — without
    depending on logging plumbing this package deliberately customizes.
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
    monkeypatch.setattr(escalation, "logger", recorder)
    return recorder


class FakeClickUpClient:
    """Records tag writes. Constructed via a factory, used as a context manager."""

    def __init__(
        self,
        task: dict | None = None,
        get_task_error: Exception | None = None,
        add_tag_error: Exception | None = None,
    ):
        self._task = task if task is not None else {"id": TASK_ID, "tags": []}
        self._get_task_error = get_task_error
        self._add_tag_error = add_tag_error
        self.added_tags: list[tuple[str, str]] = []
        self.comments: list[tuple[str, str]] = []
        self.writes: list[tuple[str, str]] = []
        self.closed = False

    def get_task(self, task_id: str):
        if self._get_task_error is not None:
            raise self._get_task_error
        # A real ClickUpTask is passed through untouched, so a test can opt into
        # the actual model when the model itself is what is under test.
        if hasattr(self._task, "model_dump"):
            return self._task
        return FakeTask(self._task)

    def add_tag_to_task(self, task_id: str, tag_name: str):
        if self._add_tag_error is not None:
            raise self._add_tag_error
        # Appends to the SAME list the comment writer uses, so a test can assert
        # the order of the two. That order is load-bearing: the tag launches the
        # implement run and the comment tells it where to go.
        self.added_tags.append((task_id, tag_name))
        self.writes.append(("tag", tag_name))
        return {}

    def create_task_comment(self, task_id: str, comment_text: str):
        self.comments.append((task_id, comment_text))
        self.writes.append(("comment", comment_text))
        return {}

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.closed = True
        return False


class FakeTask:
    """Stands in for the pydantic ClickUpTask the real client returns."""

    def __init__(self, payload: dict):
        self._payload = payload

    def model_dump(self, **kwargs) -> dict:
        # Accepts by_alias and ignores it: these payloads are written in the
        # API's own spelling already. The alias itself is pinned by the tests
        # that build a real ClickUpTask.
        return self._payload


def factory_for(client: FakeClickUpClient):
    return lambda: client


@pytest.fixture(autouse=True)
def escalation_on(monkeypatch):
    # Most tests here exercise the decision, not the switch, so the switch is on
    # by default and the OFF behavior is pinned by its own test below.
    monkeypatch.setenv(ESCALATION_ENABLED_ENV, "true")


def analysis(result_text: str, status: str = "success") -> dict:
    return {"status": status, "task_id": TASK_ID, "result": result_text}


# ---------------------------------------------------------------------------
# Verdict parsing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,expected",
    [
        ("GPBOT-VERDICT: fix", "fix"),
        ("GPBOT-VERDICT: no-code-change", "no-code-change"),
        ("GPBOT-VERDICT: needs-human", "needs-human"),
        ("gpbot-verdict: FIX", "fix"),
        ("GPBOT-VERDICT:fix", "fix"),
        ("GPBOT-VERDICT:   fix", "fix"),
        ("Long analysis...\n\nGPBOT-VERDICT: fix\n", "fix"),
    ],
)
def test_parse_verdict_reads_the_documented_forms(text, expected):
    assert parse_verdict(text) == expected


def test_parse_verdict_takes_the_last_verdict_not_an_echoed_menu():
    # Models routinely restate the instructions they were given before answering.
    # Reading the first match would let the prompt's own example decide whether a
    # PR gets opened.
    text = (
        "I was asked to end with one of GPBOT-VERDICT: fix, GPBOT-VERDICT: no-code-change, "
        "or GPBOT-VERDICT: needs-human.\n\n"
        "This is an upstream data gap.\n\nGPBOT-VERDICT: no-code-change"
    )
    assert parse_verdict(text) == "no-code-change"


@pytest.mark.parametrize(
    "text",
    [
        None,
        "",
        123,
        {"verdict": "fix"},
        "No verdict line at all, just prose about the bug.",
        "GPBOT-VERDICT: maybe",
        "GPBOT-VERDICT: ship-it",
        "GPBOT VERDICT: fix",
    ],
)
def test_parse_verdict_returns_none_for_anything_unrecognized(text):
    assert parse_verdict(text) is None


# ---------------------------------------------------------------------------
# The escalation decision
# ---------------------------------------------------------------------------


def test_a_fix_verdict_queues_an_implementation_run():
    client = FakeClickUpClient()

    outcome = maybe_escalate(analysis("root cause found\n\nGPBOT-VERDICT: fix"), "analyze", factory_for(client))

    assert outcome == "escalated"
    assert client.added_tags == [(TASK_ID, IMPLEMENT_TAG)]
    assert client.closed


@pytest.mark.parametrize("verdict", ["no-code-change", "needs-human"])
def test_a_non_fix_verdict_leaves_the_ticket_alone(verdict):
    # The two verdicts that carry the actual value of this feature: 2 of the 5
    # bugs reported 2026-08-14..17 were a feature request and a vendor data gap,
    # and a PR for either would have been pure waste.
    client = FakeClickUpClient()

    outcome = maybe_escalate(analysis(f"GPBOT-VERDICT: {verdict}"), "analyze", factory_for(client))

    assert outcome == f"verdict {verdict}"
    assert client.added_tags == []


def test_a_missing_verdict_never_escalates_and_is_loud(log):
    # Silence here is indistinguishable from the feature being switched off, so
    # a drifted prompt has to announce itself.
    client = FakeClickUpClient()

    outcome = maybe_escalate(analysis("I looked at it and here are some thoughts."), "analyze", factory_for(client))

    assert outcome == "no verdict"
    assert client.added_tags == []
    assert log.errors


def test_an_implement_run_can_never_escalate():
    # Guards against a loop: an implement run that somehow emitted the token must
    # not be able to queue another implement run.
    client = FakeClickUpClient()

    outcome = maybe_escalate(analysis("GPBOT-VERDICT: fix"), "implement", factory_for(client))

    assert outcome == "not an analyze run"
    assert client.added_tags == []


def test_a_run_with_no_label_cannot_escalate():
    # An unset AGENT_LABEL means something other than the ClickUp bot started
    # this run (local invocation, older task definition). Unknown provenance
    # must not be treated as an analysis licensed to open PRs.
    client = FakeClickUpClient()

    outcome = maybe_escalate(analysis("GPBOT-VERDICT: fix"), "", factory_for(client))

    assert outcome == "not an analyze run"
    assert client.added_tags == []


@pytest.mark.parametrize("status", ["error", "timeout"])
def test_an_unsuccessful_run_never_escalates(status):
    # A budget-capped or deadline-killed run can leave a confident-sounding
    # partial analysis behind. We know it did not finish, so its verdict is not
    # evidence of anything.
    client = FakeClickUpClient()

    outcome = maybe_escalate(analysis("GPBOT-VERDICT: fix", status=status), "analyze", factory_for(client))

    assert outcome.startswith("run did not succeed")
    assert client.added_tags == []


def test_a_ticket_already_carrying_the_tag_is_not_re_tagged():
    client = FakeClickUpClient(task={"id": TASK_ID, "tags": [{"name": "gpbot-work"}, {"name": "hs ticket"}]})

    outcome = maybe_escalate(analysis("GPBOT-VERDICT: fix"), "analyze", factory_for(client))

    assert outcome == "already queued"
    assert client.added_tags == []


def test_a_clickup_failure_reports_but_does_not_raise(log):
    # This runs after the analysis has already been posted. Raising would convert
    # a successful, useful run into a task-failure alarm.
    client = FakeClickUpClient(get_task_error=RuntimeError("clickup down"))

    outcome = maybe_escalate(analysis("GPBOT-VERDICT: fix"), "analyze", factory_for(client))

    assert outcome == "escalation failed"
    assert log.errors


def test_a_fix_verdict_without_a_task_id_cannot_escalate():
    client = FakeClickUpClient()

    outcome = maybe_escalate({"status": "success", "result": "GPBOT-VERDICT: fix"}, "analyze", factory_for(client))

    assert outcome == "no task_id"
    assert client.added_tags == []


# ---------------------------------------------------------------------------
# Work the implement agent is not allowed to do
#
# The Lambda refuses these runs whatever this module decides. What is tested
# here is that the ticket is left clean and the outcome is reported honestly:
# before this, an out-of-scope ticket came back "escalated" with a gpbot-work
# tag on it and no PR would ever follow.
# ---------------------------------------------------------------------------


def in_scope_task(**overrides) -> ClickUpTask:
    fields = {
        "id": TASK_ID,
        "custom_id": "ENG-11017",
        "name": "Compliance status is incorrect.",
        "tags": [{"name": "production-bug"}],
        "list": {"id": "901326170555", "name": "Bugs"},
    }
    fields.update(overrides)
    return ClickUpTask(**fields)


def test_the_data_ticket_that_prompted_this_is_not_queued(log):
    # DATA-2393, 2026-09-01: filed twice from HubSpot, analyzed twice, both
    # analyses concluded `fix`, both escalations reported "escalated", and no
    # implement run ever ran because the Lambda refused it. The pipeline looked
    # broken for a day because of what this line now says.
    task = in_scope_task(
        custom_id="DATA-2393",
        name="Pro Upgrade Date Doubling as Downgrade Date",
        list={"id": escalation.DATA_BACKLOG_LIST_ID, "name": "Data Backlog"},
    )
    client = FakeClickUpClient(task=task)

    outcome = maybe_escalate(analysis("root cause found\n\nGPBOT-VERDICT: fix"), "analyze", factory_for(client))

    assert outcome.startswith("out of scope")
    assert "DATA-2393" in outcome
    assert client.added_tags == []
    # The verdict was still real and still worth reading. It has to stay
    # visible, or this looks identical to an analysis that found nothing.
    assert any("fix" in line and TASK_ID in line for line in log.infos)


def test_a_ticket_caught_only_by_its_list_survives_the_real_task_model():
    # Deliberately built from ClickUpTask rather than a hand-written dict.
    # ClickUpTask aliases the API's `list` onto a field named `list_id`, so a
    # plain model_dump() drops the `list` key entirely. This ticket carries an
    # ENG custom_id and no data tag, so the LIST is the only thing identifying
    # it — a hand-made dict would pass while production silently widened.
    #
    # Growth-Bugs used to be this test's subject. It is a routed repo now rather
    # than a refusal, so the case moved to a data ticket filed without the
    # DATA- prefix, which is the remaining list-only signal.
    task = in_scope_task(
        custom_id="ENG-11020",
        name="voter file shows the wrong district",
        list={"id": escalation.DATA_BACKLOG_LIST_ID, "name": "Data Backlog"},
    )
    client = FakeClickUpClient(task=task)

    outcome = maybe_escalate(analysis("GPBOT-VERDICT: fix"), "analyze", factory_for(client))

    assert outcome.startswith("out of scope")
    assert "Data Backlog" in outcome
    assert client.added_tags == []


def test_a_district_assignment_ticket_filed_into_an_eng_list_is_still_data_work():
    # The case neither the custom_id nor the list can catch: data work triaged
    # into a bug list, marked only by the data team's own tag.
    task = in_scope_task(tags=[{"name": "production-bug"}, {"name": "bug: district-assignment"}])
    client = FakeClickUpClient(task=task)

    outcome = maybe_escalate(analysis("GPBOT-VERDICT: fix"), "analyze", factory_for(client))

    assert outcome.startswith("out of scope")
    assert client.added_tags == []


def test_an_ordinary_bug_still_gets_queued():
    # The guard rail is only worth having if the main path survives it.
    client = FakeClickUpClient(task=in_scope_task())

    outcome = maybe_escalate(analysis("GPBOT-VERDICT: fix"), "analyze", factory_for(client))

    assert outcome == "escalated"
    assert client.added_tags == [(TASK_ID, IMPLEMENT_TAG)]


def test_out_of_scope_is_reported_ahead_of_already_queued():
    # Both are true of DATA-2393 today, since the escalation that ran before
    # this change left the tag behind. "Already queued" would claim a run is
    # coming; nothing is coming, and the reason a human needs is the scope one.
    task = in_scope_task(
        custom_id="DATA-2393",
        tags=[{"name": IMPLEMENT_TAG}],
        list={"id": escalation.DATA_BACKLOG_LIST_ID, "name": "Data Backlog"},
    )
    client = FakeClickUpClient(task=task)

    outcome = maybe_escalate(analysis("GPBOT-VERDICT: fix"), "analyze", factory_for(client))

    assert outcome.startswith("out of scope")
    assert client.added_tags == []


@pytest.mark.parametrize(
    "task",
    [
        None,
        "not-a-dict",
        {},
        {"custom_id": None, "list": None, "tags": None},
        {"custom_id": 42},
        {"list": "Data Backlog"},
        {"list": {"id": 901326391561}},
        {"tags": [None, "bug: district-assignment"]},
    ],
)
def test_an_unreadable_ticket_is_left_to_the_lambda(task):
    # Fails open, matching the Lambda exactly. This copy is a courtesy; the
    # guard that actually protects the repository runs later and sees the task
    # again. Guessing "out of scope" from a malformed field here would drop
    # real fixes silently, which is the worse of the two failures.
    assert escalation.out_of_scope_reason(task) is None


def test_a_lowercase_data_prefix_is_still_data_work():
    assert escalation.out_of_scope_reason({"custom_id": "data-2393"}) is not None


# ---------------------------------------------------------------------------
# The per-repo ramp
#
# A repo the bot has just learned to READ has not earned the right to open PRs
# in it. omni logged verdicts for weeks before its switch was flipped; a new
# repo gets the same treatment rather than inheriting that trust.
# ---------------------------------------------------------------------------


def test_a_new_repo_is_analyze_only_until_someone_says_otherwise():
    # The default, and the direction it is safe to be wrong in: the cost of
    # this default is a missing PR, and the cost of the other one is an
    # unrequested PR in a repo nobody agreed to.
    client = FakeClickUpClient(task=in_scope_task())

    outcome = maybe_escalate(
        analysis("GPBOT-VERDICT: fix"), "analyze", factory_for(client), target_repo="thegoodparty/gp-marketing"
    )

    assert outcome.startswith("analyze-only repo")
    assert "gp-marketing" in outcome
    assert client.added_tags == []


def test_the_verdict_is_still_logged_for_an_analyze_only_repo(log):
    # The whole value of a ramp is being able to read what it WOULD have opened
    # before widening it. A silent skip makes the ramp unreviewable.
    client = FakeClickUpClient(task=in_scope_task())

    maybe_escalate(
        analysis("GPBOT-VERDICT: fix"), "analyze", factory_for(client), target_repo="thegoodparty/gp-marketing"
    )

    assert any("fix" in line and TASK_ID in line for line in log.infos)


def test_naming_the_repo_is_what_turns_it_on(monkeypatch):
    monkeypatch.setenv(escalation.ESCALATION_REPOS_ENV, "thegoodparty/omni,thegoodparty/gp-marketing")
    client = FakeClickUpClient(task=in_scope_task())

    outcome = maybe_escalate(
        analysis("GPBOT-VERDICT: fix"), "analyze", factory_for(client), target_repo="thegoodparty/gp-marketing"
    )

    assert outcome == "escalated"
    assert client.added_tags == [(TASK_ID, IMPLEMENT_TAG)]


def test_an_unrouted_run_is_treated_as_omni():
    # Backward compatibility with every run launched before TARGET_REPO existed.
    client = FakeClickUpClient(task=in_scope_task())

    outcome = maybe_escalate(analysis("GPBOT-VERDICT: fix"), "analyze", factory_for(client), target_repo="")

    assert outcome == "escalated"


def test_a_blank_repo_list_does_not_silently_disable_escalation(monkeypatch):
    # An empty variable means "not configured", never "no repo may escalate".
    # The latter turns a Terraform typo into a total outage of the feature that
    # looks exactly like the model having no opinions.
    monkeypatch.setenv(escalation.ESCALATION_REPOS_ENV, "  ,  ")
    client = FakeClickUpClient(task=in_scope_task())

    outcome = maybe_escalate(
        analysis("GPBOT-VERDICT: fix"), "analyze", factory_for(client), target_repo="thegoodparty/omni"
    )

    assert outcome == "escalated"


def test_the_master_switch_still_beats_the_repo_list(monkeypatch):
    # The kill switch has to remain a kill switch: a repo on the allowlist must
    # not escalate once the master switch is off.
    monkeypatch.setenv(escalation.ESCALATION_REPOS_ENV, "thegoodparty/omni")
    monkeypatch.delenv(ESCALATION_ENABLED_ENV, raising=False)
    client = FakeClickUpClient(task=in_scope_task())

    outcome = maybe_escalate(
        analysis("GPBOT-VERDICT: fix"), "analyze", factory_for(client), target_repo="thegoodparty/omni"
    )

    assert outcome == "disabled"
    assert client.added_tags == []


def test_scope_is_checked_before_the_repo_ramp():
    # A data ticket routed to an analyze-only repo is refused for being data
    # work, not for the ramp. The scope reason is the one a human needs, and it
    # stays true after the ramp is widened.
    client = FakeClickUpClient(task=in_scope_task(custom_id="DATA-2400"))

    outcome = maybe_escalate(
        analysis("GPBOT-VERDICT: fix"), "analyze", factory_for(client), target_repo="thegoodparty/gp-marketing"
    )

    assert outcome.startswith("out of scope")


# ---------------------------------------------------------------------------
# The ramp switch
# ---------------------------------------------------------------------------


def test_the_switch_is_off_unless_explicitly_turned_on(monkeypatch):
    monkeypatch.delenv(ESCALATION_ENABLED_ENV, raising=False)
    assert escalation_enabled() is False


@pytest.mark.parametrize("value", ["true", "TRUE", "1", "yes", "on", " true "])
def test_the_switch_accepts_the_obvious_truthy_spellings(value):
    assert escalation_enabled({ESCALATION_ENABLED_ENV: value}) is True


@pytest.mark.parametrize("value", ["", "false", "0", "no", "off", "maybe", "True-ish"])
def test_anything_else_leaves_the_switch_off(value):
    # Fail closed on a typo. A misspelled "ture" must not hand a model commit
    # access to the default branch.
    assert escalation_enabled({ESCALATION_ENABLED_ENV: value}) is False


def test_with_the_switch_off_a_fix_verdict_is_logged_but_not_acted_on(monkeypatch, log):
    # The dry-run state that makes the ramp usable: verdicts are observable in
    # the logs, so their quality can be judged before the switch is flipped.
    monkeypatch.delenv(ESCALATION_ENABLED_ENV, raising=False)
    client = FakeClickUpClient()

    outcome = maybe_escalate(analysis("GPBOT-VERDICT: fix"), "analyze", factory_for(client))

    assert outcome == "disabled"
    assert client.added_tags == []
    # The verdict AND the ticket must both appear, or the log line cannot answer
    # "which tickets would this have opened PRs for?".
    assert any("fix" in line and TASK_ID in line for line in log.infos)


# ---------------------------------------------------------------------------
# already_queued shape tolerance
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "task",
    [
        None,
        "not-a-dict",
        {},
        {"tags": None},
        {"tags": "gpbot-work"},
        {"tags": [None]},
        {"tags": [{"name": None}]},
        {"tags": [{"name": "gpbot-analyze"}]},
    ],
)
def test_already_queued_says_no_when_it_cannot_tell(task):
    # Fails toward attempting the write: adding a tag ClickUp already has is a
    # harmless no-op, while wrongly believing it is present would drop the
    # escalation entirely.
    assert already_queued(task) is False


def test_already_queued_matches_case_insensitively():
    assert already_queued({"tags": [{"name": "GPBot-Work"}]}) is True


# ---------------------------------------------------------------------------
# Following the cause into another repo.
#
# A ticket is routed by the ClickUp list it was filed in, which records where a
# human put it and not where the code is. The first marketing ticket the bot
# ever saw was routed to gp-marketing and turned out to be a gp-api email.
#
# The analysis is now allowed to read across repos and to say where the fix
# belongs. These pin the half that has to survive this process exiting: the
# implement run is launched by a tag, a tag cannot carry a repo, so the answer
# is written onto the ticket for the Lambda to read back.
# ---------------------------------------------------------------------------

MARKETING = "thegoodparty/gp-marketing"
OMNI = "thegoodparty/omni"


@pytest.mark.parametrize(
    "text,expected",
    [
        (f"GPBOT-REPO: {MARKETING}", MARKETING),
        (f"GPBOT-REPO:{MARKETING}", MARKETING),
        (f"GPBOT-REPO:   {MARKETING}", MARKETING),
        (f"cause is an email\n\nGPBOT-REPO: {OMNI}\nGPBOT-VERDICT: fix", OMNI),
    ],
)
def test_parse_repo_reads_the_documented_forms(text, expected):
    assert parse_repo(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        None,
        123,
        "",
        "no repo line here",
        "GPBOT-REPO: thegoodparty/gp-data-platform",
        "GPBOT-REPO: some-fork/omni",
        "GPBOT REPO: thegoodparty/omni",
        "GPBOT-REPO: omni",
    ],
)
def test_parse_repo_returns_none_for_anything_it_cannot_vouch_for(text):
    # Unknown names are dropped rather than honoured. Honouring one would point
    # a run at a repo the agent has no briefing for and could not work in, and
    # `some-fork/omni` shows why matching on the bare name is not enough.
    assert parse_repo(text) is None


def test_parse_repo_takes_the_last_one_not_the_instructions_own_example():
    # The instruction spells the line out with gp-marketing in it. Reading the
    # first match would let the example redirect every run that quoted it.
    text = f"I was told to write GPBOT-REPO: {MARKETING}\n\nThe cause is in the API.\n\nGPBOT-REPO: {OMNI}"

    assert parse_repo(text) == OMNI


def test_a_named_repo_is_recorded_on_the_ticket_for_the_implement_run(monkeypatch):
    monkeypatch.setenv(escalation.ESCALATION_REPOS_ENV, f"{OMNI},{MARKETING}")
    client = FakeClickUpClient()

    outcome = maybe_escalate(
        analysis(f"the cause is a page template\n\nGPBOT-REPO: {MARKETING}\nGPBOT-VERDICT: fix"),
        "analyze",
        factory_for(client),
        target_repo=OMNI,
    )

    assert outcome == "escalated"
    assert len(client.comments) == 1
    assert MARKETING in client.comments[0][1]


def test_the_marker_is_written_before_the_tag_that_launches_the_run(monkeypatch):
    """Order is the whole correctness of the redirect.

    The tag is what makes ClickUp fire the webhook that launches the implement
    run, and the Lambda decides that run's repo by reading the marker. Written
    afterwards, the webhook can arrive first and the run starts against the
    list's guess — the exact redirect this exists to perform.
    """
    monkeypatch.setenv(escalation.ESCALATION_REPOS_ENV, f"{OMNI},{MARKETING}")
    client = FakeClickUpClient()

    maybe_escalate(
        analysis(f"GPBOT-REPO: {MARKETING}\nGPBOT-VERDICT: fix"),
        "analyze",
        factory_for(client),
        target_repo=OMNI,
    )

    assert [kind for kind, _ in client.writes] == ["comment", "tag"]


def test_no_marker_when_the_analysis_agrees_with_the_list():
    # The line exists to correct the routing, not to confirm it. A marker on
    # every ticket would be noise on the ticket and a write nobody needed.
    client = FakeClickUpClient()

    maybe_escalate(
        analysis(f"GPBOT-REPO: {OMNI}\nGPBOT-VERDICT: fix"),
        "analyze",
        factory_for(client),
        target_repo=OMNI,
    )

    assert client.comments == []
    assert client.added_tags == [(TASK_ID, "gpbot-work")]


def test_the_ramp_is_applied_to_the_repo_the_fix_is_in(monkeypatch):
    """Not the repo that was read. This is the point of the whole change.

    A marketing bug filed into an omni list is routed to omni, and omni is past
    its ramp. Checking the routed repo would wave it through and open a PR in
    gp-marketing while gp-marketing is still analyze-only — the ramp would be
    measuring a repo the PR was never going to land in.
    """
    monkeypatch.setenv(escalation.ESCALATION_REPOS_ENV, OMNI)
    client = FakeClickUpClient()

    outcome = maybe_escalate(
        analysis(f"GPBOT-REPO: {MARKETING}\nGPBOT-VERDICT: fix"),
        "analyze",
        factory_for(client),
        target_repo=OMNI,
    )

    assert outcome == f"analyze-only repo ({MARKETING})"
    assert client.added_tags == []
    assert client.comments == [], "a ticket that was not queued must not claim an implementation is coming"


def test_a_redirect_into_a_repo_that_is_ramped_on_does_escalate(monkeypatch):
    # The other direction, so the test above is pinning the ramp rather than
    # just "a redirect never escalates".
    monkeypatch.setenv(escalation.ESCALATION_REPOS_ENV, f"{OMNI},{MARKETING}")
    client = FakeClickUpClient()

    outcome = maybe_escalate(
        analysis(f"GPBOT-REPO: {MARKETING}\nGPBOT-VERDICT: fix"),
        "analyze",
        factory_for(client),
        target_repo=OMNI,
    )

    assert outcome == "escalated"
    assert client.added_tags == [(TASK_ID, "gpbot-work")]


def test_an_unknown_repo_leaves_the_routing_alone(monkeypatch):
    # Falls back to the routed repo rather than refusing the escalation: the
    # analysis is still good, only its redirect is unusable.
    monkeypatch.setenv(escalation.ESCALATION_REPOS_ENV, OMNI)
    client = FakeClickUpClient()

    outcome = maybe_escalate(
        analysis("GPBOT-REPO: thegoodparty/gp-data-platform\nGPBOT-VERDICT: fix"),
        "analyze",
        factory_for(client),
        target_repo=OMNI,
    )

    assert outcome == "escalated"
    assert client.comments == []


def test_a_failed_tag_write_retracts_the_redirect_it_already_announced(monkeypatch):
    """The comment cannot be unwritten, so it has to be corrected.

    The redirect note goes on the ticket BEFORE the tag, because the tag is what
    launches the run and the run reads the note (see the ordering test above).
    That ordering has a cost: if the tag write then fails, the ticket carries a
    note announcing an implementation run that nobody queued, and ClickUpClient
    has no delete to take it back with.

    Left alone that note is worse than noise, because it is machine-read. A human
    retrying the escalation by hand gets routed by a note written for a run that
    never happened, to a repo chosen by an analysis they may not have read.

    So the ticket gets a correction where the claim is, not just a line in
    CloudWatch that nobody is watching.
    """
    monkeypatch.setenv(escalation.ESCALATION_REPOS_ENV, f"{OMNI},{MARKETING}")
    client = FakeClickUpClient(add_tag_error=RuntimeError("clickup 429"))

    outcome = maybe_escalate(
        analysis(f"GPBOT-REPO: {MARKETING}\nGPBOT-VERDICT: fix"),
        "analyze",
        factory_for(client),
        target_repo=OMNI,
    )

    assert outcome == "escalation failed"
    assert client.added_tags == []
    kinds = [kind for kind, _ in client.writes]
    assert kinds == ["comment", "comment"], "the redirect was announced, so a correction is owed"
    correction = client.comments[-1][1]
    assert "never queued" in correction
    assert "not in effect" in correction


def test_the_correction_note_cannot_itself_be_read_as_a_redirect(monkeypatch):
    """It names a repo, and a note that names a repo must not route anything.

    The correction has to say which repo the retracted note pointed at, or it
    does not tell the reader what to check. But the Lambda finds redirects by
    scanning comment text for the marker phrase, so a correction that happened to
    carry that phrase would re-assert the very routing it exists to withdraw.
    """
    monkeypatch.setenv(escalation.ESCALATION_REPOS_ENV, f"{OMNI},{MARKETING}")
    client = FakeClickUpClient(add_tag_error=RuntimeError("clickup 500"))

    maybe_escalate(
        analysis(f"GPBOT-REPO: {MARKETING}\nGPBOT-VERDICT: fix"),
        "analyze",
        factory_for(client),
        target_repo=OMNI,
    )

    correction = client.comments[-1][1]
    assert escalation.REPO_MARKER_PREFIX not in correction
