"""Choice check (DATA-2754). No network: the model client is a fake."""

from types import SimpleNamespace

import choice_judge as cj
import governance_guard as gg

DIFF = """diff --git a/packages/gp-webapp/app/x/PurposeStep.tsx b/packages/gp-webapp/app/x/PurposeStep.tsx
new file mode 100644
--- /dev/null
+++ b/packages/gp-webapp/app/x/PurposeStep.tsx
@@ -0,0 +1,3 @@
+export const PurposeStep = ({ onSelect }) =>
+  PURPOSES.map((p) => <Card onClick={() => onSelect(p.id)} />)
+// done
diff --git a/packages/gp-api/src/a.ts b/packages/gp-api/src/a.ts
--- a/packages/gp-api/src/a.ts
+++ b/packages/gp-api/src/a.ts
@@ -10,2 +10,3 @@ class A {
   keep()
+  this.analytics.track({ event: 'X', properties: { purpose } })
   keep()
diff --git a/packages/gp-webapp/app/y/Gone.tsx b/packages/gp-webapp/app/y/Gone.tsx
deleted file mode 100644
--- a/packages/gp-webapp/app/y/Gone.tsx
+++ /dev/null
@@ -1 +0,0 @@
-<Select />
"""


def test_added_lines_keeps_head_line_numbers_and_skips_deleted_files():
    added = cj.added_lines(DIFF)
    assert added["packages/gp-webapp/app/x/PurposeStep.tsx"][1][0] == 2
    assert added["packages/gp-api/src/a.ts"] == [
        (11, "  this.analytics.track({ event: 'X', properties: { purpose } })")]
    assert not any(p.endswith("Gone.tsx") for p in added)


def test_hint_matches_custom_pickers_and_not_plain_markup():
    assert cj.CHOICE_HINT.search("onClick={() => onSelect(purpose.id)}")
    assert cj.CHOICE_HINT.search("{ROBOCALL_PURPOSES.map((purpose) => (")
    assert cj.CHOICE_HINT.search("<Select value={tone} onValueChange={setTone}>")
    assert cj.CHOICE_HINT.search("<EmailGoalStep goalId={goalId} />")
    assert not cj.CHOICE_HINT.search('<div className="space-y-3">')
    assert not cj.CHOICE_HINT.search("const selected = useMemo(() => x, [x])")


def test_scope_is_webapp_tsx_outside_tests_and_dev():
    assert cj._in_scope("packages/gp-webapp/app/dashboard/x/Step.tsx")
    assert not cj._in_scope("packages/gp-webapp/app/dashboard/x/Step.test.tsx")
    assert not cj._in_scope("packages/gp-webapp/e2e-tests/src/x.tsx")
    assert not cj._in_scope("packages/gp-webapp/app/dev/email-templates/page.tsx")
    assert not cj._in_scope("packages/gp-admin/app/x/Step.tsx")


def test_system_prompt_carries_the_skill_rule_and_the_gotchas_book():
    rubric = "intro\n   - A step where the user chooses something records the choice\n- UNRELATED_RULE"
    prompt = cj.system_prompt(rubric, "TRAP ROW")
    assert "A step where the user chooses" in prompt and "UNRELATED_RULE" not in prompt
    assert "TRAP ROW" in prompt
    # The committed skill still has the line, so the judge is not quietly sent everything.
    assert cj._choice_rule(cj.RUBRIC_PATH.read_text()).startswith("## Rubric rule")


def _client(results, stop="end_turn"):
    seen = {}

    def create(**kw):
        seen.update(kw)
        block = SimpleNamespace(type="tool_use", input={"results": results})
        return SimpleNamespace(stop_reason=stop, content=[block])

    return (lambda _key: SimpleNamespace(messages=SimpleNamespace(create=create))), seen


def _verdict(id_, *, choice=True, recorded=False):
    return {"id": id_, "is_output_choice": choice, "choice": "purpose" if choice else "",
            "recorded": recorded, "evidence": "", "reason": "No event carries it."}


def test_only_unrecorded_output_choices_warn_and_invented_ids_are_dropped():
    items = [{"id": "a.tsx"}, {"id": "b.tsx"}, {"id": "c.tsx"}]
    factory, seen = _client([_verdict("a.tsx"), _verdict("b.tsx", recorded=True),
                             _verdict("c.tsx", choice=False), _verdict("invented.tsx")])
    verdicts, status = cj.judge(items, api_key="k", client_factory=factory)
    assert status == "ok"
    assert [v["id"] for v in cj.unrecorded(verdicts)] == ["a.tsx"]
    assert seen["tool_choice"] == {"type": "tool", "name": "report_choice_verdicts"}


def test_missing_key_skips_without_calling_the_model():
    def boom(_key):
        raise AssertionError("must not build a client without a key")

    verdicts, status = cj.judge([{"id": "a.tsx"}], api_key=None, client_factory=boom)
    assert verdicts == {} and status.startswith("skipped")


def test_truncated_response_is_a_status_not_an_exception():
    factory, _ = _client([_verdict("a.tsx")], stop="max_tokens")
    verdicts, status = cj.judge([{"id": "a.tsx"}], api_key="k", client_factory=factory)
    assert verdicts == {} and "truncated" in status


def test_guard_turns_verdicts_into_warnings_and_reports_a_skip(monkeypatch):
    monkeypatch.setattr(cj, "run", lambda *a, **k: (
        [_verdict("packages/gp-webapp/app/x/PurposeStep.tsx")], "ok", 1))
    examined: dict = {}
    found = gg.choice_findings(None, "b", "h", None, examined)
    assert [(f.rule, f.level, f.event) for f in found] == [
        ("choice_not_recorded", "warn", "purpose")]
    assert "x/PurposeStep.tsx" in found[0].detail
    assert examined["choice_judge"] == {"status": "ok", "candidates": 1}

    monkeypatch.setattr(cj, "run", lambda *a, **k: ([], "skipped: ANTHROPIC_API_KEY unset", 3))
    report = gg.Report(blocks=[], warns=[], cleared=[], examined={
        "events_compared": 0, "okr_legs": 0, "files_scanned": 0, "sem_copy_date": None,
        "unmatched_path_legs": []})
    report.warns += gg.choice_findings(None, "b", "h", None, report.examined)
    assert "Choice check did not run" in gg.render_markdown(report)


def test_guard_only_judges_when_asked(monkeypatch):
    calls = []
    monkeypatch.setattr(gg, "choice_findings", lambda *a, **k: calls.append(1) or [])
    monkeypatch.setattr(gg, "evaluate", lambda *a, **k: gg.Report([], [], [], {}))
    monkeypatch.setattr(gg, "load_base_anchors", lambda _t: ({}, None))
    monkeypatch.setattr(gg, "build_snapshot", lambda _t: None)
    monkeypatch.setattr(gg, "GitTree", lambda *_a: None)
    monkeypatch.setattr(gg, "git_renames", lambda *_a: {})
    base = dict(repo=".", base="b", head="h", extra_leg=[])
    gg._run(SimpleNamespace(**base, judge_choices=False))
    assert calls == []
    gg._run(SimpleNamespace(**base, judge_choices=True))
    assert calls == [1]


def test_tracking_lines_include_gp_api_wrappers():
    for line in ("await this.analytics.trackForOffice(orgId, EVENTS.X, {})",
                 "this.track(user, 'Team - Invite Accepted')",
                 "trackEvent(EVENTS.Outreach.CampaignCompleted, props)"):
        assert cj._TRACKING.search(line), line
    assert not cj._TRACKING.search("const tracker = useRef(null)")
