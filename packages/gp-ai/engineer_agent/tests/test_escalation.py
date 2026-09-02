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

    def __init__(self, task: dict | None = None, get_task_error: Exception | None = None):
        self._task = task if task is not None else {"id": TASK_ID, "tags": []}
        self._get_task_error = get_task_error
        self.added_tags: list[tuple[str, str]] = []
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
        self.added_tags.append((task_id, tag_name))
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
