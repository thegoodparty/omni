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

    def model_dump(self) -> dict:
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
