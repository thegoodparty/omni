import json
from datetime import date
from pathlib import Path

import pytest

import instrumentation_gaps as ig


def test_is_excluded_matches_package_and_file_globs():
    globs = [
        "packages/gp-admin/**",
        "packages/prototypes/**",
        "**/*.test.tsx",
        "**/*.stories.tsx",
        "packages/gp-webapp/app/api/health/**",
    ]
    assert ig.is_excluded("packages/gp-admin/app/page.tsx", globs) is True
    assert ig.is_excluded("packages/gp-webapp/components/Foo.test.tsx", globs) is True
    assert ig.is_excluded("packages/gp-webapp/app/api/health/route.ts", globs) is True
    assert ig.is_excluded("packages/gp-webapp/app/dashboard/page.tsx", globs) is False


def test_load_gap_config_missing_file_returns_empty(tmp_path):
    cfg = ig.load_gap_config(tmp_path / "nope.yaml")
    assert cfg == {"exclude_globs": []}


def test_route_pattern_from_page_path():
    f = ig.route_pattern_from_page_path
    assert f("packages/gp-webapp/app/dashboard/page.tsx") == "/dashboard"
    assert f("packages/gp-webapp/app/page.tsx") == "/"
    assert (
        f("packages/gp-webapp/app/dashboard/campaign/[slug]/edit/page.tsx")
        == "/dashboard/campaign/[slug]/edit"
    )
    # route groups (parenthesized dirs) are not URL segments
    assert f("packages/gp-webapp/app/(marketing)/about/page.tsx") == "/about"


def test_enumerate_route_surfaces_skips_excluded():
    pages = [
        "packages/gp-webapp/app/dashboard/page.tsx",
        "packages/gp-webapp/app/api/health/route.ts",  # not a page, and excluded
        "packages/gp-webapp/app/logout/page.tsx",       # excluded
    ]
    globs = ["packages/gp-webapp/app/api/**", "packages/gp-webapp/app/logout/**"]
    out = ig.enumerate_route_surfaces(pages, globs)
    assert [s["id"] for s in out] == ["/dashboard"]
    assert out[0]["surface_type"] == "route"
    assert out[0]["location"] == "packages/gp-webapp/app/dashboard/page.tsx"


def test_detect_webapp_wizard_and_form_and_cta():
    text = (
        "const [currentStep, setCurrentStep] = useState(0)\n"
        "export function Wizard() {\n"
        "  return <form onSubmit={handleSubmit}>\n"
        "    <Button onClick={handlePublish}>Publish</Button>\n"
        "  </form>\n"
        "}\n"
    )
    out = ig.detect_surfaces_in_file("packages/gp-webapp/components/Wizard.tsx", text)
    kinds = {s["surface_type"] for s in out}
    assert "wizard_stage" in kinds
    assert "form_submit" in kinds
    assert "cta" in kinds
    assert all(s["id"].startswith("packages/gp-webapp/components/Wizard.tsx#") for s in out)


def test_detect_api_job_webhook_status():
    text = (
        "@Processor('briefing')\n"
        "export class BriefingWorker {\n"
        "  @Post('webhook')\n"
        "  handleWebhook() {}\n"
        "  async complete() { this.status = 'COMPLETED' }\n"
        "}\n"
    )
    out = ig.detect_surfaces_in_file("packages/gp-api/src/briefing/briefing.worker.ts", text)
    kinds = {s["surface_type"] for s in out}
    assert "api_job" in kinds
    assert "api_webhook" in kinds
    assert "api_status" in kinds


def test_detect_returns_nothing_for_plain_file():
    assert ig.detect_surfaces_in_file("packages/gp-webapp/helpers/x.ts", "export const x = 1\n") == []


def test_extract_context_windows_around_match():
    text = "\n".join(f"line{i}" for i in range(100))
    pat = __import__("re").compile(r"line50")
    out = ig.extract_context(text, pat, max_lines=10)
    assert "line50" in out
    assert out.count("\n") <= 10
    assert "line0" not in out  # windowed, not from the top


def test_extract_context_no_pattern_takes_head():
    text = "\n".join(f"line{i}" for i in range(100))
    out = ig.extract_context(text, None, max_lines=5)
    assert out.startswith("line0")
    assert "line50" not in out


def test_extract_context_short_file_returns_all():
    assert ig.extract_context("a\nb\nc", None, max_lines=40) == "a\nb\nc"


def test_has_tracking_call():
    assert ig.has_tracking_call("trackEvent(EVENTS.Foo.Bar, {})") is True
    assert ig.has_tracking_call("this.analytics.track(userId, EVENTS.X.Y)") is True
    assert ig.has_tracking_call("const x = 1") is False


def test_find_gaps_filters_files_with_tracking():
    surfaces = [
        {"id": "/dashboard", "surface_type": "route", "location": "a/page.tsx"},
        {"id": "/settings", "surface_type": "route", "location": "b/page.tsx"},
    ]
    gaps = ig.find_gaps(surfaces, files_with_tracking={"a/page.tsx"})
    assert [g["id"] for g in gaps] == ["/settings"]


def test_rank_gap_orders_wizard_before_route_before_cta():
    assert ig.rank_gap({"surface_type": "wizard_stage"}) < ig.rank_gap({"surface_type": "route"})
    assert ig.rank_gap({"surface_type": "route"}) < ig.rank_gap({"surface_type": "cta"})
    assert ig.rank_gap({"surface_type": "mystery"}) == 5


def test_md_cell_escapes_pipes_and_newlines_and_blanks():
    assert ig._md_cell(None) == "-"
    assert ig._md_cell("   ") == "-"
    assert ig._md_cell("a | b") == r"a \| b"
    assert ig._md_cell("line1\nline2") == "line1 line2"


def test_merge_judged_state_adds_confirmed_and_preserves_dispositions():
    prior = {
        "/kept": {"id": "/kept", "surface_type": "route", "location": "k.tsx",
                  "disposition": "dismissed", "reason": "human said chrome", "rank": 3,
                  "rubric_rule": "old", "dashboard_question": "oldq", "judge_reason": "old",
                  "first_seen": "2026-07-01", "last_seen": "2026-07-14"},
    }
    verdicts = {
        "/new": {"id": "/new", "is_gap": True, "rubric_rule": "flow",
                 "dashboard_question": "drop-off?", "rank": 0, "reason": "stage"},
        "/kept": {"id": "/kept", "is_gap": True, "rubric_rule": "route-x",
                  "dashboard_question": "q2", "rank": 2, "reason": "judge thinks gap"},
        "/notgap": {"id": "/notgap", "is_gap": False, "rubric_rule": "chrome",
                    "dashboard_question": "", "rank": 5, "reason": "toggle"},
    }
    cands = {
        "/new": {"id": "/new", "surface_type": "wizard_stage", "location": "n.tsx"},
        "/kept": {"id": "/kept", "surface_type": "route", "location": "k.tsx"},
        "/notgap": {"id": "/notgap", "surface_type": "cta", "location": "c.tsx"},
    }
    out = ig.merge_judged_state(prior, verdicts, cands, date(2026, 7, 20))

    # new confirmed gap enters as new with judged fields
    assert out["/new"]["disposition"] == "new"
    assert out["/new"]["rubric_rule"] == "flow"
    assert out["/new"]["dashboard_question"] == "drop-off?"
    assert out["/new"]["judge_reason"] == "stage"
    assert out["/new"]["reason"] == ""          # human field stays empty
    assert out["/new"]["first_seen"] == "2026-07-20"

    # existing dismissed: disposition + human reason + first_seen preserved; judged fields refreshed
    assert out["/kept"]["disposition"] == "dismissed"
    assert out["/kept"]["reason"] == "human said chrome"
    assert out["/kept"]["first_seen"] == "2026-07-01"
    assert out["/kept"]["last_seen"] == "2026-07-20"
    assert out["/kept"]["rubric_rule"] == "route-x"
    assert out["/kept"]["judge_reason"] == "judge thinks gap"

    # is_gap=False never enters state
    assert "/notgap" not in out


def test_merge_judged_state_leaves_unseen_prior_untouched():
    prior = {"/old": {"id": "/old", "disposition": "open", "reason": "", "rank": 3,
                      "last_seen": "2026-07-14"}}
    out = ig.merge_judged_state(prior, {}, {}, date(2026, 7, 20))
    assert out["/old"]["last_seen"] == "2026-07-14"
    assert out["/old"]["disposition"] == "open"


def test_is_visible_only_new():
    assert ig.is_visible({"disposition": "new"}) is True
    assert ig.is_visible({"disposition": "open"}) is False
    assert ig.is_visible({"disposition": "dismissed"}) is False


def test_coverage_stats_counts_by_disposition():
    state = {
        "a": {"disposition": "new"}, "b": {"disposition": "new"},
        "c": {"disposition": "open"}, "d": {"disposition": "dismissed"},
    }
    assert ig.coverage_stats(state) == {
        "tracked_gaps": 4, "new": 2, "open": 1, "accepted": 0, "dismissed": 1,
    }


def test_render_gap_section_shows_judged_columns():
    state = {
        "/wiz": {"id": "/wiz", "surface_type": "wizard_stage", "location": "a.tsx",
                 "disposition": "new", "rank": 0, "rubric_rule": "flow stage",
                 "dashboard_question": "where do users drop off?"},
        "/plain": {"id": "/plain", "surface_type": "route", "location": "b.tsx",
                   "disposition": "new", "rank": 3},  # no judged fields -> dashes
    }
    out = ig.render_gap_section(state, "2026-07-20")
    assert "rubric rule" in out and "dashboard question" in out
    assert "flow stage" in out and "where do users drop off?" in out
    assert out.index("/wiz") < out.index("/plain")
    # the un-judged row renders dashes for the judged cells
    plain_row = [ln for ln in out.splitlines() if "/plain" in ln][0]
    assert "| - |" in plain_row


def test_render_gap_section_reports_judgment_unavailable():
    state = {}
    out = ig.render_gap_section(
        state, "2026-07-20", judgment_status="skipped: ANTHROPIC_API_KEY unset",
        pending_count=42,
    )
    assert "Judgment unavailable" in out
    assert "42 candidate" in out
    assert "ANTHROPIC_API_KEY unset" in out


def test_render_gap_section_ok_status_has_no_unavailable_line():
    state = {"/x": {"id": "/x", "surface_type": "route", "location": "x.tsx",
                    "disposition": "new", "rank": 3}}
    out = ig.render_gap_section(state, "2026-07-20", judgment_status="ok")
    assert "Judgment unavailable" not in out


def test_load_state_missing_file_returns_empty(tmp_path):
    assert ig.load_state(tmp_path / "nope.json") == {}
    assert ig.load_state(None) == {}


def test_load_state_corrupt_json_raises(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{ not json")
    with pytest.raises(ig.CorruptStateError):
        ig.load_state(bad)


def test_load_state_non_dict_json_raises(tmp_path):
    bad = tmp_path / "list.json"
    bad.write_text("[1, 2, 3]")
    with pytest.raises(ig.CorruptStateError):
        ig.load_state(bad)


def test_scan_repo_finds_route_gap_and_ignores_tracked(tmp_path):
    # minimal fake repo tree
    app = tmp_path / "packages/gp-webapp/app"
    (app / "dashboard").mkdir(parents=True)
    (app / "settings").mkdir(parents=True)
    (app / "dashboard" / "page.tsx").write_text("export default function P(){return null}")
    (app / "settings" / "page.tsx").write_text(
        "import {trackEvent} from 'helpers/analyticsHelper'\nexport default function S(){ trackEvent('x'); return null }"
    )
    surfaces, tracked = ig.scan_repo(tmp_path, exclude_globs=[])
    ids = {s["id"] for s in surfaces}
    assert "/dashboard" in ids and "/settings" in ids
    assert "packages/gp-webapp/app/settings/page.tsx" in tracked

    gaps = ig.find_gaps(surfaces, tracked)
    gap_ids = {g["id"] for g in gaps}
    assert "/dashboard" in gap_ids
    assert "/settings" not in gap_ids


def test_run_sweep_idempotent_same_day(tmp_path):
    app = tmp_path / "packages/gp-webapp/app/dashboard"
    app.mkdir(parents=True)
    (app / "page.tsx").write_text("export default function P(){return null}")
    state = tmp_path / "state.json"

    def fake_factory(_key):
        return _FakeClient(payload={
            "results": [{"id": "/dashboard", "is_gap": True, "rubric_rule": "route",
                         "dashboard_question": "q", "rank": 3, "reason": "r"}]
        })

    kwargs = dict(api_key="sk-ant-x", model="m", client_factory=fake_factory)
    s1, *_ = ig.run_sweep(tmp_path, tmp_path / "n.yaml", state, date(2026, 7, 20), **kwargs)
    ig._atomic_write(state, json.dumps(s1, indent=2, sort_keys=True) + "\n")
    s2, *_ = ig.run_sweep(tmp_path, tmp_path / "n.yaml", state, date(2026, 7, 20), **kwargs)
    assert len(s2) == 1
    assert s2["/dashboard"]["first_seen"] == "2026-07-20"


def test_main_skips_and_leaves_state_untouched_when_corrupt(tmp_path, capsys):
    app = tmp_path / "packages/gp-webapp/app/dashboard"
    app.mkdir(parents=True)
    (app / "page.tsx").write_text("export default function P(){return null}")
    state = tmp_path / "state.json"
    log = tmp_path / "log.md"

    # first run: a known-good state file with a human `dismissed` disposition
    good_state = {
        "/settings": {
            "id": "/settings", "surface_type": "route", "location": "b/page.tsx",
            "disposition": "dismissed", "reason": "chrome", "rank": 3,
            "first_seen": "2026-06-01", "last_seen": "2026-06-01",
        }
    }
    state.write_text(json.dumps(good_state, indent=2, sort_keys=True) + "\n")
    before = state.read_text()

    # second run: the state file is corrupt on disk (e.g. a stray hand-edit)
    state.write_text("{ this is not valid json")
    corrupt = state.read_text()

    rc = ig.main([
        "--repo", str(tmp_path), "--config", str(tmp_path / "none.yaml"),
        "--state", str(state), "--log", str(log), "--today", "2026-07-17",
    ])

    assert rc == 0
    # the file must be left byte-for-byte as the corrupt content was — never overwritten
    assert state.read_text() == corrupt
    assert state.read_text() != before
    assert not log.exists()
    err = capsys.readouterr().err
    assert "unreadable" in err or "corrupt" in err.lower()


def test_main_warns_when_neither_scan_root_exists(tmp_path, capsys):
    state = tmp_path / "state.json"
    log = tmp_path / "log.md"
    rc = ig.main([
        "--repo", str(tmp_path), "--config", str(tmp_path / "none.yaml"),
        "--state", str(state), "--log", str(log), "--today", "2026-07-17",
    ])
    assert rc == 0
    err = capsys.readouterr().err
    assert "neither scan root found" in err


def test_judge_verdict_schema_roundtrips():
    v = ig.JudgeVerdict(
        id="/dashboard/wizard#wizard_stage",
        is_gap=True,
        rubric_rule="multi-step flow stage",
        dashboard_question="Where do users drop off in the wizard?",
        rank=0,
        reason="URL-stable stage RouteTracker cannot see.",
    )
    assert v.is_gap is True
    assert v.rank == 0
    schema = ig.JudgeBatch.model_json_schema()
    assert "results" in schema["properties"]


def test_load_rubric_reads_file(tmp_path):
    p = tmp_path / "SKILL.md"
    p.write_text("# Instrument an analytics event\n\n## Procedure\n...")
    assert "Instrument an analytics event" in ig.load_rubric(p)


def test_load_rubric_missing_raises(tmp_path):
    import pytest
    with pytest.raises(FileNotFoundError):
        ig.load_rubric(tmp_path / "nope.md")


def test_select_candidates_drops_triaged_and_caps():
    gaps = [
        {"id": "/a", "surface_type": "wizard_stage", "location": "a.tsx"},   # rank 0
        {"id": "/b", "surface_type": "cta", "location": "b.tsx"},            # rank 4
        {"id": "/c", "surface_type": "route", "location": "c.tsx"},          # rank 3, dismissed
        {"id": "/d", "surface_type": "form_submit", "location": "d.tsx"},    # rank 2
    ]
    prior = {
        "/c": {"disposition": "dismissed"},
        "/b": {"disposition": "new"},  # still untriaged -> eligible
    }
    out = ig.select_candidates(gaps, prior, limit=2)
    # /c dropped (dismissed); remaining sorted by rank: /a(0), /d(2), /b(4); cap 2
    assert [g["id"] for g in out] == ["/a", "/d"]


def test_select_candidates_keeps_new_disposition():
    gaps = [{"id": "/x", "surface_type": "route", "location": "x.tsx"}]
    out = ig.select_candidates(gaps, {"/x": {"disposition": "new"}}, limit=10)
    assert [g["id"] for g in out] == ["/x"]


class _FakeBlock:
    def __init__(self, input_):
        self.type = "tool_use"
        self.input = input_


class _FakeResp:
    def __init__(self, content):
        self.content = content


def test_build_judge_messages_carries_candidates():
    cands = [{"id": "/a", "surface_type": "route", "location": "a.tsx", "snippet": "x"}]
    msgs = ig.build_judge_messages(cands)
    assert msgs[0]["role"] == "user"
    assert "/a" in msgs[0]["content"]


def test_judge_system_prompt_includes_rubric():
    sp = ig.judge_system_prompt("RUBRIC-BODY-MARKER")
    assert "RUBRIC-BODY-MARKER" in sp


def test_parse_judge_response_validates_and_filters_unknown_ids():
    payload = {
        "results": [
            {"id": "/a", "is_gap": True, "rubric_rule": "flow", "dashboard_question": "q",
             "rank": 0, "reason": "r"},
            {"id": "/hallucinated", "is_gap": True, "rubric_rule": "x",
             "dashboard_question": "q", "rank": 1, "reason": "r"},
        ]
    }
    resp = _FakeResp([_FakeBlock(payload)])
    out = ig.parse_judge_response(resp, candidate_ids=["/a"])
    assert set(out) == {"/a"}
    assert out["/a"]["is_gap"] is True


def test_parse_judge_response_no_tool_use_raises():
    import pytest
    with pytest.raises(RuntimeError):
        ig.parse_judge_response(_FakeResp([]), candidate_ids=["/a"])


class _FakeMessages:
    def __init__(self, payload=None, raise_exc=None):
        self._payload = payload
        self._raise = raise_exc
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._raise is not None:
            raise self._raise
        return _FakeResp([_FakeBlock(self._payload)])


class _FakeClient:
    def __init__(self, payload=None, raise_exc=None):
        self.messages = _FakeMessages(payload, raise_exc)


_VERDICT_PAYLOAD = {
    "results": [
        {"id": "/a", "is_gap": True, "rubric_rule": "flow", "dashboard_question": "q",
         "rank": 0, "reason": "r"},
    ]
}


def test_judge_candidates_uses_forced_tool_and_parses():
    client = _FakeClient(payload=_VERDICT_PAYLOAD)
    cands = [{"id": "/a", "surface_type": "wizard_stage", "location": "a.tsx", "snippet": "x"}]
    out = ig.judge_candidates(cands, "RUBRIC", client=client, model="claude-sonnet-5")
    assert out["/a"]["is_gap"] is True
    sent = client.messages.calls[0]
    assert sent["model"] == "claude-sonnet-5"
    assert sent["tool_choice"] == {"type": "tool", "name": "report_gap_verdicts"}
    assert sent["system"].startswith("RUBRIC")


class _PerChunkClient:
    """Returns is_gap verdicts for exactly the ids present in the request, so a chunked
    call sees only its own chunk's verdicts (mirrors parse_judge_response's id filter)."""
    def __init__(self):
        self.messages = self
        self.calls = 0

    def create(self, **kwargs):
        self.calls += 1
        content = kwargs["messages"][0]["content"]
        ids = [c["id"] for c in json.loads(content.split("\n\n", 1)[1])]
        return _FakeResp([_FakeBlock({"results": [
            {"id": i, "is_gap": True, "rubric_rule": "r", "dashboard_question": "q",
             "rank": 1, "reason": "x"} for i in ids]})])


def test_judge_all_chunks_and_merges():
    cands = [{"id": f"/x{i}", "surface_type": "route", "location": f"{i}.tsx", "snippet": ""}
             for i in range(5)]
    client = _PerChunkClient()
    out = ig.judge_all(cands, "RUBRIC", client=client, model="m", chunk_size=2)
    assert set(out) == {f"/x{i}" for i in range(5)}
    assert client.calls == 3  # 2 + 2 + 1


def test_select_candidates_limit_none_returns_all():
    gaps = [{"id": f"/x{i}", "surface_type": "route", "location": f"{i}.tsx"} for i in range(40)]
    assert len(ig.select_candidates(gaps, {}, limit=None)) == 40


def test_run_judgment_skips_without_key(tmp_path):
    cands = [{"id": "/a", "surface_type": "route", "location": "a.tsx", "snippet": ""}]
    out, status = ig.run_judgment(cands, api_key=None, model="m", rubric_path=tmp_path / "r.md")
    assert out == {}
    assert "ANTHROPIC_API_KEY" in status


def test_run_judgment_no_candidates_is_noop():
    out, status = ig.run_judgment([], api_key="sk-ant-x", model="m")
    assert out == {} and status == "no-candidates"


def test_run_judgment_skips_when_rubric_unreadable(tmp_path):
    # rubric_path points at a directory -> IsADirectoryError (an OSError, not FileNotFoundError);
    # run_judgment must still degrade to a skip and never raise.
    cands = [{"id": "/a", "surface_type": "route", "location": "a.tsx", "snippet": ""}]
    out, status = ig.run_judgment(cands, api_key="sk-ant-x", model="m", rubric_path=tmp_path)
    assert out == {}
    assert status == "skipped: rubric unavailable"


def test_run_judgment_swallows_sdk_error(tmp_path):
    rubric = tmp_path / "r.md"
    rubric.write_text("RUBRIC")
    cands = [{"id": "/a", "surface_type": "route", "location": "a.tsx", "snippet": ""}]
    boom = _FakeClient(raise_exc=RuntimeError("429 overloaded"))
    out, status = ig.run_judgment(
        cands, api_key="sk-ant-x", model="m", rubric_path=rubric,
        client_factory=lambda _k: boom,
    )
    assert out == {}
    assert status.startswith("failed:")


def test_run_judgment_ok_path(tmp_path):
    rubric = tmp_path / "r.md"
    rubric.write_text("RUBRIC")
    cands = [{"id": "/a", "surface_type": "wizard_stage", "location": "a.tsx", "snippet": "x"}]
    client = _FakeClient(payload=_VERDICT_PAYLOAD)
    out, status = ig.run_judgment(
        cands, api_key="sk-ant-x", model="claude-sonnet-5", rubric_path=rubric,
        client_factory=lambda _k: client,
    )
    assert status == "ok"
    assert out["/a"]["rubric_rule"] == "flow"


def test_scan_repo_enriches_snippet(tmp_path):
    app = tmp_path / "packages/gp-webapp/app/dashboard"
    app.mkdir(parents=True)
    (app / "page.tsx").write_text("export default function P(){return <div>hi</div>}")
    surfaces, _ = ig.scan_repo(tmp_path, exclude_globs=[])
    route = next(s for s in surfaces if s["id"] == "/dashboard")
    assert "snippet" in route and route["snippet"]


def test_run_sweep_no_judge_adds_nothing_and_reports_pending(tmp_path):
    app = tmp_path / "packages/gp-webapp/app/dashboard"
    app.mkdir(parents=True)
    (app / "page.tsx").write_text("export default function P(){return null}")
    new_state, gaps, status, pending = ig.run_sweep(
        tmp_path, tmp_path / "none.yaml", tmp_path / "state.json", date(2026, 7, 20),
        enable_judge=False,
    )
    assert gaps  # deterministic gap found
    assert new_state == {}  # nothing enters state without judgment
    assert status.startswith("skipped")
    assert pending >= 1


def test_run_sweep_with_fake_judge_adds_confirmed(tmp_path):
    app = tmp_path / "packages/gp-webapp/app/dashboard"
    app.mkdir(parents=True)
    (app / "page.tsx").write_text("export default function P(){return null}")

    def fake_factory(_key):
        return _FakeClient(payload={
            "results": [
                {"id": "/dashboard", "is_gap": True, "rubric_rule": "route",
                 "dashboard_question": "q", "rank": 3, "reason": "r"},
            ]
        })

    new_state, gaps, status, pending = ig.run_sweep(
        tmp_path, tmp_path / "none.yaml", tmp_path / "state.json", date(2026, 7, 20),
        api_key="sk-ant-x", model="claude-sonnet-5", client_factory=fake_factory,
    )
    assert status == "ok"
    assert new_state["/dashboard"]["disposition"] == "new"
    assert new_state["/dashboard"]["rubric_rule"] == "route"


def test_main_no_judge_writes_empty_state_with_pending_note(tmp_path):
    app = tmp_path / "packages/gp-webapp/app/dashboard"
    app.mkdir(parents=True)
    (app / "page.tsx").write_text("export default function P(){return null}")
    state = tmp_path / "state.json"
    log = tmp_path / "log.md"
    rc = ig.main([
        "--repo", str(tmp_path), "--config", str(tmp_path / "none.yaml"),
        "--state", str(state), "--log", str(log), "--today", "2026-07-20", "--no-judge",
    ])
    assert rc == 0
    assert json.loads(state.read_text()) == {}
    assert "Judgment unavailable" in log.read_text()


def test_gaps_urls_env_overrides_and_derivation(monkeypatch):
    monkeypatch.delenv("GP_GAPS_BROWSE_URL", raising=False)
    monkeypatch.delenv("GP_GAPS_TAB_GID", raising=False)
    monkeypatch.setenv("GP_EVENT_STATE_SHEET_ID", "SID")
    assert ig.gaps_browse_url() == "https://docs.google.com/spreadsheets/d/SID/edit"
    monkeypatch.setenv("GP_GAPS_TAB_GID", "42")
    assert ig.gaps_browse_url().endswith("#gid=42")
    monkeypatch.setenv("GP_GAPS_BROWSE_URL", "https://x")
    assert ig.gaps_browse_url() == "https://x"
    monkeypatch.setenv("GP_GAPS_FEEDBACK_URL", "https://fb")
    assert ig.gaps_feedback_url() == "https://fb"


def test_build_slack_payload_caps_and_shapes_new_gaps():
    run_date = "2026-07-21"
    state = {
        f"/r{i}": {"id": f"/r{i}", "surface_type": "route", "disposition": "new",
                   "rubric_rule": "rr", "dashboard_question": "q", "location": f"r{i}.tsx",
                   "rank": i % 3, "first_seen": run_date}
        for i in range(15)
    }
    state["/done"] = {"id": "/done", "surface_type": "route", "disposition": "accepted", "rank": 0}
    # carried-over untriaged gap: disposition "new" but first_seen from an earlier run —
    # must be excluded from new_count/new_gaps (delta, not existence, based).
    state["/carried"] = {"id": "/carried", "surface_type": "route", "disposition": "new",
                         "rubric_rule": "rr", "dashboard_question": "q", "location": "old.tsx",
                         "rank": 0, "first_seen": "2026-07-01"}
    payload = ig.build_slack_payload(state, run_date, "ok", 0,
                                     browse_url="b", feedback_url="f", top_n=10)
    assert payload["new_count"] == 15          # accepted excluded, carried-over excluded
    assert len(payload["new_gaps"]) == 10      # capped
    assert payload["new_gaps"][0]["rank"] <= payload["new_gaps"][-1]["rank"]
    assert all(g["id"] != "/carried" for g in payload["new_gaps"])
    assert payload["status"] == "ok" and payload["browse_url"] == "b"


def test_build_slack_payload_excludes_carried_over_new_gaps():
    run_date = "2026-07-21"
    state = {
        "/fresh": {"id": "/fresh", "surface_type": "route", "disposition": "new",
                   "rubric_rule": "rr", "dashboard_question": "q", "location": "fresh.tsx",
                   "rank": 0, "first_seen": run_date},
        "/carried": {"id": "/carried", "surface_type": "route", "disposition": "new",
                     "rubric_rule": "rr", "dashboard_question": "q", "location": "old.tsx",
                     "rank": 0, "first_seen": "2026-07-01"},
    }
    payload = ig.build_slack_payload(state, run_date, "ok", 0,
                                     browse_url="b", feedback_url="f", top_n=10)
    assert payload["new_count"] == 1
    assert [g["id"] for g in payload["new_gaps"]] == ["/fresh"]


def test_main_writes_slack_out_file(tmp_path, monkeypatch):
    # a fake repo with one untracked route gap + a fake judge confirming it
    (tmp_path / "packages/gp-webapp/app/foo").mkdir(parents=True)
    (tmp_path / "packages/gp-webapp/app/foo/page.tsx").write_text("export default () => <div/>")
    (tmp_path / "packages/gp-api/src").mkdir(parents=True)
    cfg = tmp_path / "cfg.yaml"; cfg.write_text("exclude_globs: []\n")
    rubric = tmp_path / "rub.md"; rubric.write_text("RUBRIC")
    state = tmp_path / "state.json"
    out = tmp_path / "gap_slack.json"
    payload = {"results": [{"id": "/foo", "is_gap": True, "rubric_rule": "route",
                            "dashboard_question": "q", "rank": 3, "reason": "r"}]}
    monkeypatch.setattr(ig, "make_anthropic_client", lambda k: _FakeClient(payload=payload))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-x")
    rc = ig.main(["--repo", str(tmp_path), "--config", str(cfg), "--state", str(state),
                  "--rubric", str(rubric), "--no-log", "--today", "2026-07-21",
                  "--slack-out", str(out)])
    assert rc == 0
    data = json.loads(out.read_text())
    assert data["status"] == "ok"
    assert any(g["id"] == "/foo" for g in data["new_gaps"])


def test_render_seed_artifact_has_parseable_blocks():
    state = {"/a": {"id": "/a", "surface_type": "route", "rank": 0, "location": "a.tsx",
                    "rubric_rule": "flow", "dashboard_question": "q", "judge_reason": "jr",
                    "disposition": "new", "reason": ""}}
    md = ig.render_seed_artifact(state)
    assert "## /a" in md
    assert "- disposition:" in md and "- reason:" in md
    assert "- location: a.tsx" in md


def test_run_seed_scans_whole_repo_and_confirms(tmp_path):
    (tmp_path / "packages/gp-webapp/app/foo").mkdir(parents=True)
    (tmp_path / "packages/gp-webapp/app/foo/page.tsx").write_text("export default () => <div/>")
    (tmp_path / "packages/gp-api/src").mkdir(parents=True)
    cfg = tmp_path / "c.yaml"; cfg.write_text("exclude_globs: []\n")
    rub = tmp_path / "r.md"; rub.write_text("RUBRIC")
    payload = {"results": [{"id": "/foo", "is_gap": True, "rubric_rule": "route",
                            "dashboard_question": "q", "rank": 3, "reason": "r"}]}
    new_state, status, judged = ig.run_seed(
        tmp_path, cfg, tmp_path / "s.json", date(2026, 7, 21),
        api_key="sk-ant-x", model="m", rubric_path=rub,
        client_factory=lambda _k: _FakeClient(payload=payload))
    assert status == "ok"
    assert new_state["/foo"]["disposition"] == "new"
    assert judged == 1


def test_run_seed_no_candidates(tmp_path):
    cfg = tmp_path / "c.yaml"; cfg.write_text("exclude_globs: []\n")
    new_state, status, judged = ig.run_seed(
        tmp_path, cfg, tmp_path / "s.json", date(2026, 7, 21),
        api_key="sk-ant-x", model="m", rubric_path=tmp_path / "r.md",
        client_factory=lambda _k: _FakeClient(payload=_VERDICT_PAYLOAD))
    assert status == "no-candidates"
    assert judged == 0
    assert new_state == {}


def test_run_seed_skips_without_key(tmp_path):
    (tmp_path / "packages/gp-webapp/app/foo").mkdir(parents=True)
    (tmp_path / "packages/gp-webapp/app/foo/page.tsx").write_text("export default () => <div/>")
    cfg = tmp_path / "c.yaml"; cfg.write_text("exclude_globs: []\n")
    prior = {"/keep": {"id": "/keep", "disposition": "accepted"}}
    state_path = tmp_path / "s.json"
    state_path.write_text(json.dumps(prior))
    new_state, status, judged = ig.run_seed(
        tmp_path, cfg, state_path, date(2026, 7, 21),
        api_key=None, model="m", rubric_path=tmp_path / "r.md",
    )
    assert status == "skipped: ANTHROPIC_API_KEY unset"
    assert judged == 0
    assert new_state == prior
    assert new_state is not prior  # must not alias the prior mapping


def test_run_seed_skips_when_rubric_unreadable(tmp_path):
    (tmp_path / "packages/gp-webapp/app/foo").mkdir(parents=True)
    (tmp_path / "packages/gp-webapp/app/foo/page.tsx").write_text("export default () => <div/>")
    cfg = tmp_path / "c.yaml"; cfg.write_text("exclude_globs: []\n")
    new_state, status, judged = ig.run_seed(
        tmp_path, cfg, tmp_path / "s.json", date(2026, 7, 21),
        api_key="sk-ant-x", model="m", rubric_path=tmp_path,  # a directory -> OSError
    )
    assert status == "skipped: rubric unavailable"
    assert judged == 0
    assert new_state == {}


def test_run_seed_swallows_judge_exception(tmp_path):
    (tmp_path / "packages/gp-webapp/app/foo").mkdir(parents=True)
    (tmp_path / "packages/gp-webapp/app/foo/page.tsx").write_text("export default () => <div/>")
    cfg = tmp_path / "c.yaml"; cfg.write_text("exclude_globs: []\n")
    rub = tmp_path / "r.md"; rub.write_text("RUBRIC")
    boom = _FakeClient(raise_exc=RuntimeError("429 overloaded"))
    new_state, status, judged = ig.run_seed(
        tmp_path, cfg, tmp_path / "s.json", date(2026, 7, 21),
        api_key="sk-ant-x", model="m", rubric_path=rub,
        client_factory=lambda _k: boom,
    )
    assert status.startswith("failed:")
    assert judged == 0
    assert new_state == {}


def test_main_seed_writes_state_and_artifact(tmp_path, monkeypatch):
    (tmp_path / "packages/gp-webapp/app/foo").mkdir(parents=True)
    (tmp_path / "packages/gp-webapp/app/foo/page.tsx").write_text("export default () => <div/>")
    (tmp_path / "packages/gp-api/src").mkdir(parents=True)
    cfg = tmp_path / "cfg.yaml"; cfg.write_text("exclude_globs: []\n")
    rubric = tmp_path / "rub.md"; rubric.write_text("RUBRIC")
    state = tmp_path / "state.json"
    log = tmp_path / "log.md"
    artifact = tmp_path / "seed.md"
    payload = {"results": [{"id": "/foo", "is_gap": True, "rubric_rule": "route",
                            "dashboard_question": "q", "rank": 3, "reason": "r"}]}
    monkeypatch.setattr(ig, "make_anthropic_client", lambda k: _FakeClient(payload=payload))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-x")
    rc = ig.main(["--repo", str(tmp_path), "--config", str(cfg), "--state", str(state),
                  "--rubric", str(rubric), "--log", str(log), "--today", "2026-07-21",
                  "--seed", "--seed-artifact", str(artifact)])
    assert rc == 0
    data = json.loads(state.read_text())
    assert data["/foo"]["disposition"] == "new"
    assert not log.exists()  # --seed skips the log write
    md = artifact.read_text()
    assert "## /foo" in md
    assert "- disposition:" in md


def test_parse_seed_artifact_reads_filled_only():
    md = (
        "# header\n\n"
        "## /a\n- surface_type: route\n- disposition: dismissed\n- reason: chrome\n\n"
        "## /b\n- surface_type: route\n- disposition:\n- reason:\n\n"
    )
    parsed = ig.parse_seed_artifact(md)
    assert set(parsed) == {"/a"}
    assert parsed["/a"] == {"disposition": "dismissed", "reason": "chrome"}


def test_apply_seed_dispositions_updates_known_ids_only():
    state = {"/a": {"id": "/a", "disposition": "new", "reason": "", "first_seen": "2026-07-01"}}
    parsed = {"/a": {"disposition": "dismissed", "reason": "chrome"},
              "/gone": {"disposition": "accepted", "reason": ""}}
    new_state, applied = ig.apply_seed_dispositions(state, parsed, date(2026, 7, 21))
    assert applied == 1
    assert new_state["/a"]["disposition"] == "dismissed"
    assert new_state["/a"]["reason"] == "chrome"
    assert new_state["/a"]["first_seen"] == "2026-07-01"  # preserved
    assert "/gone" not in new_state


def test_apply_seed_dispositions_skips_invalid_value(capsys):
    state = {
        "/a": {"id": "/a", "disposition": "new", "reason": "", "first_seen": "2026-07-01"},
        "/b": {"id": "/b", "disposition": "new", "reason": "", "first_seen": "2026-07-01"},
    }
    parsed = {
        "/a": {"disposition": "dismissed", "reason": "chrome"},
        "/b": {"disposition": "dismiss", "reason": "typo'd disposition"},  # invalid
    }
    new_state, applied = ig.apply_seed_dispositions(state, parsed, date(2026, 7, 21))
    assert applied == 1
    assert new_state["/a"]["disposition"] == "dismissed"
    assert new_state["/b"]["disposition"] == "new"  # invalid value never applied
    err = capsys.readouterr().err
    assert "/b" in err and "dismiss" in err


def test_seed_artifact_round_trip_after_hand_edit():
    """Render an artifact, hand-edit one disposition/reason in the raw text, parse it back —
    the round trip must recover exactly the edited fields without needing the original dict."""
    state = {
        "/a": {"id": "/a", "surface_type": "route", "rank": 0, "location": "a.tsx",
               "rubric_rule": "flow", "dashboard_question": "q", "judge_reason": "jr",
               "disposition": "new", "reason": "", "first_seen": "2026-07-01"},
        "/b": {"id": "/b", "surface_type": "route", "rank": 3, "location": "b.tsx",
               "rubric_rule": "flow", "dashboard_question": "q", "judge_reason": "jr",
               "disposition": "new", "reason": "", "first_seen": "2026-07-01"},
    }
    md = ig.render_seed_artifact(state)
    edited = md.replace("## /a\n- surface_type: route\n- rank: 0\n- location: a.tsx\n"
                         "- rubric_rule: flow\n- dashboard_question: q\n- judge_reason: jr\n"
                         "- disposition:\n- reason:",
                         "## /a\n- surface_type: route\n- rank: 0\n- location: a.tsx\n"
                         "- rubric_rule: flow\n- dashboard_question: q\n- judge_reason: jr\n"
                         "- disposition: accepted\n- reason: real gap")
    parsed = ig.parse_seed_artifact(edited)
    assert set(parsed) == {"/a"}  # /b left blank -> skipped
    new_state, applied = ig.apply_seed_dispositions(state, parsed, date(2026, 7, 21))
    assert applied == 1
    assert new_state["/a"]["disposition"] == "accepted"
    assert new_state["/a"]["reason"] == "real gap"
    assert new_state["/a"]["last_seen"] == "2026-07-21"
    assert new_state["/b"]["disposition"] == "new"  # untouched


def test_main_load_seed_applies_dispositions_and_prints_counts(tmp_path, capsys):
    state = tmp_path / "state.json"
    prior = {
        "/a": {"id": "/a", "disposition": "new", "reason": "", "first_seen": "2026-07-01",
               "last_seen": "2026-07-01"},
    }
    state.write_text(json.dumps(prior, indent=2, sort_keys=True) + "\n")
    artifact = tmp_path / "seed.md"
    artifact.write_text(
        "## /a\n- disposition: dismissed\n- reason: chrome\n\n"
        "## /gone\n- disposition: accepted\n- reason:\n\n"
    )

    rc = ig.main(["--state", str(state), "--load-seed", str(artifact), "--today", "2026-07-21"])

    assert rc == 0
    new_state = json.loads(state.read_text())
    assert new_state["/a"]["disposition"] == "dismissed"
    assert new_state["/a"]["reason"] == "chrome"
    assert new_state["/a"]["last_seen"] == "2026-07-21"
    assert "/gone" not in new_state
    out = capsys.readouterr().out
    assert "applied 1" in out and "skipped 1" in out


def test_main_load_seed_skips_on_corrupt_state(tmp_path, capsys):
    state = tmp_path / "state.json"
    state.write_text("{ not valid json")
    before = state.read_text()
    artifact = tmp_path / "seed.md"
    artifact.write_text("## /a\n- disposition: dismissed\n- reason: chrome\n\n")

    rc = ig.main(["--state", str(state), "--load-seed", str(artifact), "--today", "2026-07-21"])

    assert rc == 0
    assert state.read_text() == before
    err = capsys.readouterr().err
    assert "unreadable" in err or "corrupt" in err.lower()


def test_main_load_seed_missing_file_is_graceful(tmp_path, capsys):
    state = tmp_path / "state.json"
    prior = {"/a": {"id": "/a", "disposition": "new", "reason": "", "first_seen": "2026-07-01"}}
    state.write_text(json.dumps(prior, indent=2, sort_keys=True) + "\n")
    missing = tmp_path / "does-not-exist.md"

    rc = ig.main(["--state", str(state), "--load-seed", str(missing), "--today", "2026-07-21"])

    assert rc == 0
    assert json.loads(state.read_text()) == prior  # untouched
    err = capsys.readouterr().err
    assert str(missing) in err


def test_new_this_run_filters_by_disposition_and_first_seen():
    state = {
        "a": {"id": "a", "disposition": "new", "first_seen": "2026-08-03", "rank": 2},
        "b": {"id": "b", "disposition": "new", "first_seen": "2026-07-27", "rank": 1},
        "c": {"id": "c", "disposition": "dismissed", "first_seen": "2026-08-03", "rank": 0},
        "d": {"id": "d", "disposition": "new", "first_seen": "2026-08-03", "rank": 1},
    }
    out = ig.new_this_run(state, "2026-08-03")
    assert [e["id"] for e in out] == ["d", "a"]  # rank asc, then id; b (old) and c (dismissed) excluded


def test_weekly_review_artifact_round_trips(tmp_path):
    state = {
        "a": {"id": "a", "disposition": "new", "first_seen": "2026-08-03", "rank": 1,
              "surface_type": "route", "location": "app/x/page.tsx", "rubric_rule": "flow",
              "dashboard_question": "q", "judge_reason": "jr"},
        "old": {"id": "old", "disposition": "new", "first_seen": "2026-07-01", "rank": 1},
    }
    art = ig.render_review_artifact(state, "2026-08-03")
    assert "## a" in art and "## old" not in art  # only this run's batch
    filled = art.replace("- disposition:", "- disposition: dismissed", 1) \
                .replace("- reason:", "- reason: not a funnel step", 1)
    parsed = ig.parse_seed_artifact(filled)
    new_state, applied = ig.apply_seed_dispositions(state, parsed, date(2026, 8, 3))
    assert applied == 1
    assert new_state["a"]["disposition"] == "dismissed"
    assert new_state["a"]["reason"] == "not a funnel step"


def test_cli_list_new_outputs_this_run(tmp_path, capsys):
    state_path = tmp_path / "gaps.json"
    state_path.write_text(json.dumps({
        "a": {"id": "a", "disposition": "new", "first_seen": "2026-08-03", "rank": 1},
        "old": {"id": "old", "disposition": "new", "first_seen": "2026-07-01", "rank": 1},
    }))
    rc = ig.main(["--state", str(state_path), "--today", "2026-08-03", "--list-new"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert [e["id"] for e in payload] == ["a"]


def test_cli_list_new_skips_on_corrupt_state(tmp_path, capsys):
    state_path = tmp_path / "gaps.json"
    state_path.write_text("{ not valid json")
    before = state_path.read_text()

    rc = ig.main(["--state", str(state_path), "--today", "2026-08-03", "--list-new"])

    assert rc == 0
    assert state_path.read_text() == before
    err = capsys.readouterr().err
    assert "unreadable" in err or "corrupt" in err.lower()


def test_stamp_gap_and_is_actioned():
    state = {"a": {"id": "a", "disposition": "accepted"}}
    ig.stamp_gap(state, "a", ticket_url="https://clickup.com/t/DATA-9999", actioned_at="2026-08-03")
    assert state["a"]["ticket_url"].endswith("DATA-9999")
    assert state["a"]["actioned_at"] == "2026-08-03"
    assert ig.is_actioned(state["a"]) is True
    assert ig.is_actioned({"id": "b", "disposition": "accepted"}) is False


def test_merge_preserves_ticket_stamp():
    prior = {"a": {"id": "a", "surface_type": "route", "location": "app/x/page.tsx",
                   "disposition": "accepted", "reason": "", "first_seen": "2026-08-03",
                   "last_seen": "2026-08-03", "ticket_url": "https://clickup.com/t/DATA-1",
                   "actioned_at": "2026-08-03", "rank": 1}}
    verdicts = {"a": {"is_gap": True, "rubric_rule": "flow", "dashboard_question": "q",
                      "reason": "still a gap", "rank": 1}}
    cand = {"a": {"id": "a", "surface_type": "route", "location": "app/x/page.tsx"}}
    out = ig.merge_judged_state(prior, verdicts, cand, date(2026, 8, 10))
    assert out["a"]["ticket_url"].endswith("DATA-1")
    assert out["a"]["actioned_at"] == "2026-08-03"
    assert out["a"]["disposition"] == "accepted"
