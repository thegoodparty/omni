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


def test_merge_state_new_and_persisted_dispositions():
    prior = {
        "/settings": {"id": "/settings", "surface_type": "route", "location": "b/page.tsx",
                      "disposition": "dismissed", "reason": "chrome", "rank": 3,
                      "first_seen": "2026-07-01", "last_seen": "2026-07-14"},
        "/old": {"id": "/old", "surface_type": "route", "location": "old/page.tsx",
                 "disposition": "open", "reason": "", "rank": 3,
                 "first_seen": "2026-06-01", "last_seen": "2026-07-14"},
    }
    gaps = [
        {"id": "/dashboard", "surface_type": "wizard_stage", "location": "a/page.tsx"},
        {"id": "/settings", "surface_type": "route", "location": "b/page.tsx"},
    ]
    out = ig.merge_state(prior, gaps, date(2026, 7, 17))

    assert out["/dashboard"]["disposition"] == "new"
    assert out["/dashboard"]["first_seen"] == "2026-07-17"
    assert out["/dashboard"]["rank"] == 0
    # dismissed stays dismissed, last_seen refreshed, reason preserved
    assert out["/settings"]["disposition"] == "dismissed"
    assert out["/settings"]["reason"] == "chrome"
    assert out["/settings"]["last_seen"] == "2026-07-17"
    # an id gone from this run's gaps is retained untouched (no resurrection risk)
    assert out["/old"]["disposition"] == "open"
    assert out["/old"]["last_seen"] == "2026-07-14"


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


def test_render_gap_section_shows_new_ranked_and_coverage():
    state = {
        "/dashboard/wizard": {"id": "/dashboard/wizard", "surface_type": "wizard_stage",
                              "location": "a.tsx", "disposition": "new", "rank": 0},
        "/settings": {"id": "/settings", "surface_type": "route",
                      "location": "b.tsx", "disposition": "new", "rank": 3},
        "/old": {"id": "/old", "surface_type": "route", "location": "c.tsx",
                 "disposition": "dismissed", "rank": 3},
    }
    out = ig.render_gap_section(state, "2026-07-17")
    assert "## 2026-07-17" in out
    assert "Potential instrumentation gaps" in out
    # coverage line reports totals
    assert "3 tracked" in out and "2 new" in out and "1 dismissed" in out
    # wizard (rank 0) appears above the route (rank 3) in the table
    assert out.index("/dashboard/wizard") < out.index("/settings")
    # dismissed gap is not listed
    assert "/old" not in out


def test_render_gap_section_no_new():
    state = {"/x": {"id": "/x", "surface_type": "route", "location": "x.tsx",
                    "disposition": "dismissed", "rank": 3}}
    out = ig.render_gap_section(state, "2026-07-17")
    assert "No new gaps" in out


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


def test_main_writes_state_and_log_and_is_idempotent(tmp_path):
    app = tmp_path / "packages/gp-webapp/app/dashboard"
    app.mkdir(parents=True)
    (app / "page.tsx").write_text("export default function P(){return null}")
    state = tmp_path / "state.json"
    log = tmp_path / "log.md"
    rc = ig.main([
        "--repo", str(tmp_path), "--config", str(tmp_path / "none.yaml"),
        "--state", str(state), "--log", str(log), "--today", "2026-07-17",
    ])
    assert rc == 0
    data = json.loads(state.read_text())
    assert data["/dashboard"]["disposition"] == "new"
    assert "## 2026-07-17" in log.read_text()

    # second run same day: /dashboard stays a single entry, still tracked, not duplicated
    rc2 = ig.main([
        "--repo", str(tmp_path), "--config", str(tmp_path / "none.yaml"),
        "--state", str(state), "--log", str(log), "--today", "2026-07-17",
    ])
    assert rc2 == 0
    assert len(json.loads(state.read_text())) == 1


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
