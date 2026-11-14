import json
import re
from datetime import UTC, datetime
from pathlib import Path

import pytest

from case_scout.bench import cli
from case_scout.bench.cost import estimate_before
from case_scout.bench.judge_loader import (
    CHAT_CASE_KEYS,
    JUDGE_CASES_DIR,
    case_list_issue,
    chat_case_issue,
    draft_loader_issue,
)
from case_scout.bench.loader import FIXTURES_DIR, fixture_messages, fixture_rows, load_fixtures
from case_scout.bench.report import render_report
from case_scout.bench.runner import CallRecorder, run_bench
from case_scout.bench.stubs import label_echo_calls
from case_scout.bucket import CaseScoutBucket
from case_scout.reader.case_schema import MAX_CONDITION_CHARS, MAX_HANDLED_WHEN_CHARS
from case_scout.reader.scoring import COVERED_SCOPES, KNOWN_PATTERNS, render_session_transcript
from case_scout.reader.sessions import segment_into_sessions

from .conftest import TEST_BUCKET

NOW = datetime(2026, 11, 10, 6, 0, tzinfo=UTC)

_CASES_TS = JUDGE_CASES_DIR.parent / "cases.ts"

FIXTURES = load_fixtures()
BY_ID = {f.id: f for f in FIXTURES}


def _store(s3_bucket) -> CaseScoutBucket:
    return CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)


def _run(s3_bucket, score=None, draft=None, second_read=None, fixtures=None):
    fixtures = fixtures or FIXTURES
    stub_score, stub_draft, stub_second_read = label_echo_calls(fixtures)
    return run_bench(
        fixtures,
        _store(s3_bucket),
        now=NOW,
        run_id="bench-test",
        score_inner=score or stub_score,
        draft_inner=draft or stub_draft,
        second_read_inner=second_read or stub_second_read,
    )


def _result(run, fixture_id):
    return next(r for r in run.results if r["id"] == fixture_id)


def _fixture_id(transcript: str) -> str:
    match = re.search(r"^# session bench-([a-z0-9-]+):", transcript, re.M)
    assert match is not None
    return match.group(1)


class TestFixtures:
    def test_the_set_matches_the_proposal(self):
        categories = [f.category for f in FIXTURES]
        assert categories.count("known_pattern") == 9
        assert categories.count("good") == 5
        assert categories.count("borderline") == 2
        assert categories.count("planted_pii") == 2
        assert categories.count("duplicate") == 1
        assert categories.count("uncovered_agent") == 1

    def test_one_known_pattern_fixture_per_pattern(self):
        patterns = sorted(f.expect.pattern for f in FIXTURES if f.category == "known_pattern")
        assert patterns == sorted(KNOWN_PATTERNS)

    def test_every_fixture_is_one_session(self):
        sessions = segment_into_sessions(fixture_messages(FIXTURES))
        assert sorted(s.conversation_id for s in sessions) == sorted(f.conversation_id for f in FIXTURES)

    def test_rows_carry_the_views_column_set(self):
        columns = {"conversation_id", "scope", "message_id", "role", "content", "created_at"}
        columns |= {"tool_calls", "is_internal", "denylist"}
        for fixture in FIXTURES:
            for row in fixture_rows(fixture):
                assert set(row) == columns
                assert all(isinstance(call["input"], str) for call in row["tool_calls"])

    def test_tool_calls_reach_the_scoring_transcript(self):
        session = next(
            s
            for s in segment_into_sessions(fixture_messages(FIXTURES))
            if s.conversation_id.endswith("f08-inflated-background-saved")
        )
        assert 'tool: campaign_story input: {"action": "save"' in render_session_transcript(session)

    def test_the_uncovered_fixture_uses_a_scope_the_scout_skips(self):
        uncovered = [f for f in FIXTURES if f.category == "uncovered_agent"]
        assert all(f.agent not in COVERED_SCOPES for f in uncovered)
        assert all(f.agent in COVERED_SCOPES for f in FIXTURES if f.category != "uncovered_agent")

    def test_named_cases_exist_on_the_agents_list(self):
        for fixture in FIXTURES:
            named = [fixture.expect.covered_by, *fixture.expect.also_pass_if_covered_by]
            case_ids = {
                c["caseId"] for c in json.loads((JUDGE_CASES_DIR / f"{fixture.agent}.json").read_text())["cases"]
            }
            for case_id in filter(None, named):
                assert case_id in case_ids, f"{fixture.id} names {case_id}, which {fixture.agent}.json does not have"

    def test_planted_pii_is_actually_in_the_transcript(self):
        for fixture in FIXTURES:
            text = "\n".join(m.content for m in fixture.messages)
            for planted in fixture.planted_pii:
                assert planted in text, f"{fixture.id} lists {planted!r} but never plants it"

    def test_no_em_or_en_dashes(self):
        for path in FIXTURES_DIR.glob("*.json"):
            text = path.read_text()
            assert chr(0x2014) not in text and chr(0x2013) not in text, path.name

    def test_a_label_that_contradicts_itself_is_refused(self, tmp_path):
        raw = json.loads((FIXTURES_DIR / "g01-candidate-forum-prep.json").read_text())
        raw["expect"]["drop_ok"] = True
        (tmp_path / "bad.json").write_text(json.dumps(raw))
        with pytest.raises(ValueError, match="drop_ok"):
            load_fixtures(tmp_path)


class TestRunBenchWithLabelEchoStubs:
    def test_every_fixture_passes_when_the_scout_does_what_the_labels_say(self, s3_bucket):
        run = _run(s3_bucket)

        failing = {r["id"]: r["checks"] for r in run.results if not r["passed"]}
        assert failing == {}
        assert sum(1 for r in run.results if r["case"]) == 11

    def test_the_uncovered_scope_is_never_scored(self, s3_bucket):
        run = _run(s3_bucket)

        assert not [c for c in run.recorder.calls if c.session_id and "u01-" in c.session_id]
        assert _result(run, "u01-priority-flow-invented-budget")["checks"]["ignored"]["status"] == "pass"

    def test_the_bench_cap_lets_every_candidate_draft(self, s3_bucket):
        run = _run(s3_bucket)

        assert run.night.draft_run is not None
        assert "capped" not in [line["outcome"] for line in run.night.draft_run.ledger_lines]


class TestChecksCatchARegression:
    def test_a_scout_that_scores_everything_clean_fails_every_should_draft_fixture(self, s3_bucket):
        clean = json.dumps(
            {"session_id": "x", "requests": [{"request_ordinal": 1, "severity": 0, "known_pattern": "none"}]}
        )
        run = _run(s3_bucket, score=lambda system, transcript: clean)

        for r in run.results:
            if r["expect"]["should_draft"] and not r["expect"]["drop_ok"]:
                assert r["checks"]["drafted"]["status"] == "fail", r["id"]
                assert r["checks"]["pattern"]["status"] == "fail", r["id"]

    def test_a_wrong_pattern_fails_only_the_pattern_check(self, s3_bucket):
        stub_score, _, _ = label_echo_calls(FIXTURES)

        def score(system, transcript):
            raw = json.loads(stub_score(system, transcript))
            if _fixture_id(transcript) == "f01-unsourced-turnout-math":
                raw["requests"][0]["known_pattern"] = "date_arithmetic"
            return json.dumps(raw)

        result = _result(_run(s3_bucket, score=score), "f01-unsourced-turnout-math")

        assert result["checks"]["pattern"]["status"] == "fail"
        assert result["checks"]["drafted"]["status"] == "pass"

    def test_a_planted_name_the_gate_misses_fails_no_planted_pii(self, s3_bucket):
        _, stub_draft, _ = label_echo_calls(FIXTURES)

        def draft(system, transcript):
            raw = json.loads(stub_draft(system, transcript))
            if _fixture_id(transcript) == "p01-pii-neighbor-daycare-accusation":
                raw["case"]["question"] = "Is Della Fairbrook running an unlicensed daycare?"
            return json.dumps(raw)

        result = _result(_run(s3_bucket, draft=draft), "p01-pii-neighbor-daycare-accusation")

        assert result["checks"]["no_planted_pii"]["status"] == "fail"
        assert "Della Fairbrook" in result["checks"]["no_planted_pii"]["detail"]

    def test_a_planted_phone_the_gate_catches_is_a_pass_for_a_drop_ok_fixture(self, s3_bucket):
        _, stub_draft, _ = label_echo_calls(FIXTURES)

        def draft(system, transcript):
            raw = json.loads(stub_draft(system, transcript))
            if _fixture_id(transcript) == "p01-pii-neighbor-daycare-accusation":
                raw["case"]["question"] = "Should I call the resident back at (307) 555-0148?"
            return json.dumps(raw)

        result = _result(_run(s3_bucket, draft=draft), "p01-pii-neighbor-daycare-accusation")

        assert result["outcome"] == "gated"
        assert result["gate"]["rule"] == "contactPattern"
        assert result["checks"]["drafted"]["status"] == "pass"
        assert "gate dropped it" in result["checks"]["no_planted_pii"]["detail"]

    def test_a_gated_draft_fails_a_fixture_that_must_draft(self, s3_bucket):
        run = _run(s3_bucket, second_read=lambda draft_text: '["Somewhere Real"]')

        result = _result(run, "f02-modeled-party-as-registration")
        assert result["gate"] == {"passed": False, "rule": "secondRead", "reason": result["gate"]["reason"]}
        assert result["checks"]["drafted"]["status"] == "fail"

    def test_drafting_the_duplicate_fails_it(self, s3_bucket):
        _, stub_draft, _ = label_echo_calls(FIXTURES)
        new_case = json.dumps(
            {
                "outcome": "newCase",
                "failureSummary": "claims a booking",
                "case": {"caseId": "claims-booking", "question": "q", "condition": "c", "handledWhen": "h"},
            }
        )

        def draft(system, transcript):
            return (
                new_case if _fixture_id(transcript) == "d01-claims-meeting-booked" else stub_draft(system, transcript)
            )

        result = _result(_run(s3_bucket, draft=draft), "d01-claims-meeting-booked")

        assert result["checks"]["drafted"]["status"] == "fail"
        assert result["checks"]["skipped_as_covered"]["status"] == "fail"

    def test_an_accepted_covered_by_alternative_passes(self, s3_bucket):
        _, stub_draft, _ = label_echo_calls(FIXTURES)
        covered = json.dumps(
            {"outcome": "coveredBy", "failureSummary": "outside tool", "caseId": "product-how-to-from-the-map"}
        )

        def draft(system, transcript):
            return (
                covered if _fixture_id(transcript) == "f09-outside-canvassing-app" else stub_draft(system, transcript)
            )

        result = _result(_run(s3_bucket, draft=draft), "f09-outside-canvassing-app")

        assert result["outcome"] == "covered"
        assert result["checks"]["drafted"]["status"] == "pass"

    def test_a_borderline_chat_the_scout_drafts_fails(self, s3_bucket):
        stub_score, _, _ = label_echo_calls(FIXTURES)

        def score(system, transcript):
            raw = json.loads(stub_score(system, transcript))
            if _fixture_id(transcript) == "b01-six-slogans-when-asked-for-three":
                raw["requests"][0]["severity"] = 2
            return json.dumps(raw)

        result = _result(_run(s3_bucket, score=score), "b01-six-slogans-when-asked-for-three")

        assert result["checks"]["drafted"]["status"] == "fail"


class TestCallRecorder:
    def test_forwards_and_attributes_each_call(self):
        recorder = CallRecorder(
            score_inner=lambda s, t: "score-out",
            draft_inner=lambda s, t: "draft-out",
            second_read_inner=lambda d: "[]",
        )

        recorder.score("sys", "# session conv:m1\nbody")
        recorder.draft("sys", "# session conv:m2\nbody")
        recorder.second_read("the draft")

        assert [(c.stage, c.session_id, c.output) for c in recorder.calls] == [
            ("score", "conv:m1", "score-out"),
            ("draft", "conv:m2", "draft-out"),
            ("gate", "conv:m2", "[]"),
        ]

    def test_records_a_call_that_raised(self):
        def boom(system, transcript):
            raise RuntimeError("down")

        recorder = CallRecorder(score_inner=boom, draft_inner=boom, second_read_inner=lambda d: "[]")
        with pytest.raises(RuntimeError):
            recorder.score("sys", "# session conv:m1\n")

        assert recorder.calls[0].output == ""


def _valid_case(**overrides):
    case = {
        "caseId": "a-new-case",
        "question": "A question?",
        "condition": "A condition.",
        "handledWhen": "the reply does the thing.",
        "source": "production",
        "split": "tune",
    }
    case.update(overrides)
    return case


class TestJudgeLoaderMirror:
    def test_the_key_set_matches_chat_case_schema(self):
        text = _CASES_TS.read_text()
        match = re.search(r"export const ChatCaseSchema = z\s*\.object\(\{\n(.*?)\n  \}\)", text, re.S)
        assert match is not None, "ChatCaseSchema moved; update this pin"
        assert set(re.findall(r"^    (\w+):", match.group(1), re.M)) == CHAT_CASE_KEYS

    def test_the_bounds_match_cases_ts(self):
        text = _CASES_TS.read_text()
        assert f"MAX_CONDITION_CHARS = {MAX_CONDITION_CHARS:_}" in text
        assert f"MAX_HANDLED_WHEN_CHARS = {MAX_HANDLED_WHEN_CHARS}" in text
        assert "source: z.enum(['authored', 'production']).optional()" in text
        assert "split: z.enum(['tune', 'holdout']).optional()" in text

    def test_the_real_lists_parse(self):
        for agent in ("campaign_assistant", "chief_of_staff"):
            assert case_list_issue(agent, json.loads((JUDGE_CASES_DIR / f"{agent}.json").read_text())) is None

    def test_a_valid_draft_appends_cleanly(self):
        assert draft_loader_issue("chief_of_staff", _valid_case()) is None

    @pytest.mark.parametrize(
        ("case", "fragment"),
        [
            (_valid_case(split=None), "null"),
            (_valid_case(extra="x"), "unknown keys"),
            (_valid_case(condition="   "), "condition"),
            (_valid_case(turns=["a"]), "exactly one"),
            (_valid_case(source="scout"), "source"),
            (_valid_case(caseId="has space"), "caseId"),
        ],
    )
    def test_the_loader_rules_the_gate_mirror_does_not_check(self, case, fragment):
        issue = chat_case_issue(case)
        assert issue is not None and fragment in issue

    def test_a_case_id_already_on_the_list_is_refused(self):
        issue = draft_loader_issue("chief_of_staff", _valid_case(caseId="control"))
        assert issue is not None and "repeats caseId" in issue


class TestCost:
    def test_the_estimate_covers_only_scored_scopes_and_bounds_itself(self):
        estimate = estimate_before(FIXTURES)

        assert estimate.expected_calls["score"] == 19
        assert estimate.expected_calls["draft"] == 12
        assert estimate.expected_calls["gate"] == 11
        assert 0 < estimate.expected_usd < estimate.worst_usd


class TestCli:
    def test_refuses_without_live_and_makes_no_call(self, monkeypatch, capsys, tmp_path):
        def no_calls():
            raise AssertionError("a model call was set up")

        monkeypatch.setattr(cli, "real_calls", no_calls)

        assert cli.main(["--out-dir", str(tmp_path)]) == 2
        captured = capsys.readouterr()
        assert "estimated cost of a live run" in captured.out
        assert cli.LIVE_COMMAND in captured.err
        assert not list(tmp_path.iterdir())

    def test_live_needs_an_api_key(self, monkeypatch, tmp_path):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

        assert cli.main(["--live", "--out-dir", str(tmp_path)]) == 2

    def test_a_stub_run_writes_results_and_report_and_grades_merge(self, monkeypatch, tmp_path):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

        assert cli.main(["--stub", "--out-dir", str(tmp_path)]) == 0
        (run_dir,) = list(tmp_path.iterdir())
        results = json.loads((run_dir / "results.json").read_text())
        assert results["mode"] == "stub"
        assert results["summary"]["fixturesPassed"] == 20
        assert 'data-grade-for="f01-unsourced-turnout-math"' in (run_dir / "report.html").read_text()

        grades = tmp_path / "grades.json"
        grades.write_text(
            json.dumps(
                {
                    "runId": results["runId"],
                    "grades": {"f01-unsourced-turnout-math": {"faithful": 3, "gradeable": 3, "fictional": 3}},
                }
            )
        )
        assert cli.main(["--grade", str(run_dir), str(grades)]) == 0
        merged = json.loads((run_dir / "results.json").read_text())
        f01 = next(f for f in merged["fixtures"] if f["id"] == "f01-unsourced-turnout-math")
        assert f01["grades"] == {"faithful": 3, "gradeable": 3, "fictional": 3, "note": ""}
        assert merged["gradeSummary"]["allThrees"] == 1

    @pytest.mark.parametrize(
        "payload",
        [
            {"runId": "another-run", "grades": {}},
            {"runId": "RUN", "grades": {"f01-unsourced-turnout-math": {"faithful": 4}}},
            {"runId": "RUN", "grades": {"no-such-fixture": {"faithful": 1}}},
        ],
    )
    def test_bad_grades_are_refused(self, payload, tmp_path):
        results = {"runId": "RUN", "fixtures": [{"id": "f01-unsourced-turnout-math", "case": None, "grades": {}}]}
        (tmp_path / "results.json").write_text(json.dumps(results))
        grades = tmp_path / "grades.json"
        grades.write_text(json.dumps(payload))

        assert cli.main(["--grade", str(tmp_path), str(grades)]) == 1


class TestReport:
    def test_escapes_content_and_offers_grades_only_for_drafts(self, s3_bucket):
        run = _run(s3_bucket)
        results = cli.build_results(run, "stub", Path("bench-out/x"), NOW)
        results["fixtures"][0]["summary"] = "<script>alert(1)</script>"

        html = render_report(results)

        assert "<script>alert(1)</script>" not in html
        assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
        assert html.count("data-grade-for=") == results["summary"]["drafts"]
        assert "Stub run" in html
