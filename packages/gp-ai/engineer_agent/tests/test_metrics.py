"""Tests for the one line per run that the weekly digest counts.

What is being protected here is a measurement, which fails differently from
code: a broken metric does not throw, it reports a smaller number. The digest
sums costs and counts verdicts off these lines, so a field that silently
degrades to `0` or disappears produces a Monday message that is wrong and
confident. Both directions are asserted below — the line must be emitted at all,
and it must not invent a value it does not have.

The other half is that emitting it can never cost a run. It runs after the
analysis has already been posted to the ticket, so anything that raises here
turns a useful run into a task-failure alarm.
"""

import json

import pytest

from engineer_agent.agent import main as agent_main
from engineer_agent.agent.metrics import METRIC_PREFIX, format_metric_line

# A real analyze result, trimmed: the shape `_consume_agent_stream` returns on
# success, with the verdict sitting inside prose the way a model actually emits
# it rather than alone on the last line.
ANALYZE_RESULT = {
    "status": "success",
    "task_id": "86acb46d4",
    "result": (
        "Root cause: `did_win=false` on a closed campaign fails `isActiveCampaign()`, "
        "so Pro checkout answers NO_ACTIVE_CAMPAIGN (campaigns.service.ts:412).\n\n"
        "GPBOT-VERDICT: fix\n"
    ),
    "cost_usd": 3.7100000000000004,
    "num_turns": 24,
    "session_id": "a1b2c3d4",
}


def parsed(line: str) -> dict:
    prefix, _, body = line.partition(" ")
    assert prefix == METRIC_PREFIX
    return json.loads(body)


class RecordingLogger:
    """Records log calls.

    Not caplog: shared.logger sets propagate=False and binds its StreamHandler
    to the sys.stdout that existed at import time, so neither caplog nor capsys
    sees these lines. Recording the module's logger tests the same contract —
    the line reaches CloudWatch, which is where the digest reads it.
    """

    def __init__(self):
        self.infos: list[str] = []

    def info(self, message, *args, **kwargs):
        self.infos.append(str(message))

    def error(self, message, *args, **kwargs):
        pass

    def warning(self, message, *args, **kwargs):
        pass

    def exception(self, message, *args, **kwargs):
        pass


class TestWhatARunReportsAboutItself:
    def test_an_analyze_run_reports_its_verdict_cost_and_duration_in_one_line(self):
        fields = parsed(format_metric_line(ANALYZE_RESULT, "analyze", "escalated", 361.24))

        assert fields["task_id"] == "86acb46d4"
        assert fields["label"] == "analyze"
        assert fields["verdict"] == "fix"
        assert fields["status"] == "success"
        assert fields["cost_usd"] == 3.71
        assert fields["duration_s"] == 361.2
        assert fields["escalation"] == "escalated"

    def test_the_verdict_is_the_one_escalation_acted_on(self):
        # A model routinely restates the menu it was given before answering, and
        # `parse_verdict` takes the LAST match for exactly that reason. A second
        # regex written here would eventually disagree with the one gating
        # escalation, and then the digest would describe a bot nobody is running.
        echoed = dict(
            ANALYZE_RESULT,
            result="You must end with GPBOT-VERDICT: fix | no-code-change | needs-human\n\nGPBOT-VERDICT: no-code-change",
        )

        assert parsed(format_metric_line(echoed, "analyze", "verdict no-code-change"))["verdict"] == "no-code-change"

    def test_a_fix_verdict_that_never_escalated_says_so(self):
        # The gap no other signal shows. The ticket has an analysis, the verdict
        # called for a fix, and no implement run was ever queued — which reads
        # in ClickUp and in GitHub as an ordinary no-code-change week.
        line = parsed(format_metric_line(ANALYZE_RESULT, "analyze", "escalation failed"))

        assert line["verdict"] == "fix"
        assert line["escalation"] == "escalation failed"

    def test_a_run_that_failed_is_still_counted(self):
        # 23 of 23 runs succeeding is a reported number, and it is only
        # meaningful if a failure would have shown up in the same query.
        failed = {
            "status": "error",
            "task_id": "86acb46d4",
            "error": "Deadline exceeded (2700s)",
            "error_subtype": "error_deadline_exceeded",
        }

        fields = parsed(format_metric_line(failed, "analyze", "run did not succeed (status=error)", 2700.0))

        assert fields["status"] == "error"
        # No verdict, rather than one salvaged from a partial analysis: a run
        # that was killed mid-flight may have written a confident-looking
        # conclusion, and escalation already refuses to trust it.
        assert fields["verdict"] is None

    def test_an_implement_run_reports_no_verdict_without_that_reading_as_a_failure(self):
        implement = dict(ANALYZE_RESULT, result="Opened https://github.com/thegoodparty/omni/pull/1318")

        fields = parsed(format_metric_line(implement, "implement", "not an analyze run"))

        assert fields["label"] == "implement"
        assert fields["verdict"] is None
        assert fields["status"] == "success"


class TestUnknownIsNotZero:
    """The failure mode that produces a wrong number instead of a red build."""

    def test_a_missing_cost_is_null_rather_than_free(self):
        # The digest sums this field. A cost coerced to 0.0 understates the
        # week's spend and there is nothing anywhere to say a run was skipped.
        fields = parsed(format_metric_line({"status": "success", "task_id": "x"}, "analyze", "no verdict"))

        assert fields["cost_usd"] is None
        assert fields["duration_s"] is None

    def test_a_cost_of_actually_zero_is_reported_as_zero(self):
        # The other side of the same distinction, which is only worth drawing if
        # a real zero survives it.
        fields = parsed(format_metric_line(dict(ANALYZE_RESULT, cost_usd=0.0), "analyze", "escalated", 0.4))

        assert fields["cost_usd"] == 0.0
        assert fields["duration_s"] == 0.4

    def test_a_nonsense_cost_cannot_produce_a_line_nobody_can_parse(self):
        # json.dumps writes NaN and Infinity as bare tokens, which are not JSON.
        # The digest would drop the whole line — every field of it — over one
        # bad number.
        for bad in (float("nan"), float("inf"), "3.71", None, True):
            fields = parsed(format_metric_line(dict(ANALYZE_RESULT, cost_usd=bad), "analyze", "escalated"))

            assert fields["cost_usd"] is None
            assert fields["verdict"] == "fix"


class TestTheContractWithTheDigest:
    def test_every_field_is_present_even_when_it_does_not_apply(self):
        # Absent and null mean different things to the reader: null is "this run
        # had none", a missing key is "this line came from a build that predates
        # the field". Only one of those is a reason to go and look at the code.
        expected = {"task_id", "label", "verdict", "status", "cost_usd", "duration_s", "escalation"}

        assert set(parsed(format_metric_line(None, None, None)).keys()) == expected

    def test_the_line_is_a_single_greppable_line(self):
        # filter-log-events returns whole messages and the consumer splits on
        # the prefix. A pretty-printed object arrives as a dozen unrelated
        # events, none of which parse.
        line = format_metric_line(ANALYZE_RESULT, "analyze", "escalated", 361.2)

        assert "\n" not in line
        assert line.startswith(METRIC_PREFIX + " {")

    def test_junk_in_never_raises(self):
        # This runs after the ticket already has its analysis. An exception here
        # would turn a successful run into a task-failure alarm and lose the
        # analysis nobody would then trust.
        for result in (None, "", [], 7, {"status": object()}):
            assert format_metric_line(result, object(), object(), object()).startswith(METRIC_PREFIX)


class TestTheLineIsActuallyEmitted:
    """The regression that would look exactly like a quiet week.

    Every assertion above is about the line's contents; none of them notices if
    nothing ever calls it. This system's signature failure is going silent while
    looking healthy, and an unemitted metric reproduces that precisely — the
    digest reports zero runs and no check anywhere goes red.
    """

    @pytest.fixture
    def wired(self, monkeypatch, tmp_path):
        monkeypatch.setenv("TASK_ID", "86acb46d4")
        monkeypatch.setenv("INSTRUCTION", "analyze the bug")
        monkeypatch.setenv("AGENT_LABEL", "analyze")
        monkeypatch.setenv("WORKSPACE_DIR", str(tmp_path / "workspace"))
        monkeypatch.setattr(agent_main, "setup_github_auth", lambda env: "none")

        async def completes(config):
            return ANALYZE_RESULT

        monkeypatch.setattr(agent_main, "run_agent", completes)
        monkeypatch.setattr(agent_main, "maybe_escalate", lambda result, label: "escalated")

        recorder = RecordingLogger()
        monkeypatch.setattr(agent_main, "logger", recorder)
        return recorder

    async def test_a_completed_run_emits_exactly_one_metric_line(self, wired):
        await agent_main.main()

        lines = [line for line in wired.infos if line.startswith(METRIC_PREFIX)]

        assert len(lines) == 1
        assert parsed(lines[0])["verdict"] == "fix"

    async def test_the_line_carries_what_the_escalation_decided(self, wired, monkeypatch):
        # Ordering, not decoration: the escalation outcome is a field on the
        # line, so emitting before `maybe_escalate` ran would report every run
        # as un-escalated and make the most interesting failure invisible.
        monkeypatch.setattr(agent_main, "maybe_escalate", lambda result, label: "disabled")

        await agent_main.main()

        line = next(parsed(m) for m in wired.infos if m.startswith(METRIC_PREFIX))

        assert line["escalation"] == "disabled"

    async def test_the_duration_is_the_run_and_not_the_process(self, wired):
        await agent_main.main()

        duration = next(parsed(m) for m in wired.infos if m.startswith(METRIC_PREFIX))["duration_s"]

        # A stub run returns immediately, so anything but a near-zero number
        # here means the clock is measuring something other than the run.
        assert 0 <= duration < 5
