"""Pre-merge governance guard (DATA-2432). In-memory trees only; no git, no network."""

import json

import pytest

import governance_guard as gg
import sem_anchors as sa

WEB_REG = """export const EVENTS = {
  Outreach: {
    CampaignScheduled: 'Voter Outreach - Campaign Scheduled',
    CampaignCompleted: 'Voter Outreach - Campaign Completed',
  },
  Settings: {
    Saved: 'Settings - Saved',
  },
}
"""
API_REG = """export const EVENTS = {
  //  ⚠️  DO NOT MODIFY - Used by HubSpot workflows
  CandidateWebsite: {
    Published: 'Candidate Website - Published',
  },
  Account: {
    UserDeleted: 'Account - User Deleted',
  },
}
"""
WATCHLIST_YAML = "events: []\nbehaviors: []\ndismissed: []\nintents: []\n"


def tree(extra: dict[str, str], *, web: str = WEB_REG, api: str = API_REG,
         watchlist: str = WATCHLIST_YAML, provenance: str = "event_type\n") -> gg.DictTree:
    files = {gg.WEB_REGISTRY: web, gg.API_REGISTRY: api, gg.WATCHLIST: watchlist,
             gg.PROVENANCE: provenance}
    files.update(extra)
    return gg.DictTree(files)


def test_snapshot_counts_key_paths_and_literals_per_file():
    snap = gg.build_snapshot(tree({
        "packages/gp-webapp/app/(dashboard)/outreach/Send.tsx": "trackEvent(EVENTS.Outreach.CampaignScheduled)",
        "packages/gp-webapp/app/(dashboard)/door/Walk.tsx": "trackEvent('Voter Outreach - Campaign Scheduled')",
    }))
    assert snap.files_for("Voter Outreach - Campaign Scheduled") == {
        "packages/gp-webapp/app/(dashboard)/outreach/Send.tsx": 1,
        "packages/gp-webapp/app/(dashboard)/door/Walk.tsx": 1,
    }
    assert snap.count("Voter Outreach - Campaign Scheduled") == 2


def test_tests_and_registries_are_not_call_sites():
    snap = gg.build_snapshot(tree({
        "packages/gp-webapp/app/(dashboard)/outreach/Send.test.tsx": "trackEvent(EVENTS.Outreach.CampaignScheduled)",
        "packages/gp-webapp/__tests__/x.tsx": "trackEvent(EVENTS.Outreach.CampaignScheduled)",
    }))
    assert snap.count("Voter Outreach - Campaign Scheduled") == 0


def test_a_web_key_path_does_not_count_in_gp_api():
    snap = gg.build_snapshot(tree({
        "packages/gp-api/src/x.ts": "track(EVENTS.Outreach.CampaignScheduled)",
    }))
    assert snap.count("Voter Outreach - Campaign Scheduled") == 0


def test_hubspot_protected_names_are_read_from_the_backend_registry():
    snap = gg.build_snapshot(tree({}))
    assert snap.hubspot == {"Candidate Website - Published"}


def test_importers_resolve_relative_and_alias_paths():
    snap = gg.build_snapshot(tree({
        "packages/gp-webapp/app/(dashboard)/page.tsx": "import Card from './components/Card'",
        "packages/gp-webapp/app/(dashboard)/components/Card.tsx": "trackEvent(EVENTS.Settings.Saved)",
        "packages/gp-webapp/app/other/page.tsx": "import Card from '@/app/dashboard/components/Card'",
    }))
    assert sorted(snap.importers("packages/gp-webapp/app/(dashboard)/components/Card.tsx")) == [
        "packages/gp-webapp/app/(dashboard)/page.tsx",
        "packages/gp-webapp/app/other/page.tsx",
    ]


def test_page_routes_drop_route_groups():
    snap = gg.build_snapshot(tree({
        "packages/gp-webapp/app/(candidate)/dashboard/page.tsx": "export default function P() {}",
    }))
    assert "/dashboard" in snap.page_routes


SEND = "packages/gp-webapp/app/(dashboard)/outreach/Send.tsx"


def test_last_call_site_removed_with_key_left_is_a_dead_listing():
    base = gg.build_snapshot(tree({SEND: "trackEvent(EVENTS.Settings.Saved)"}))
    head = gg.build_snapshot(tree({SEND: "noop()"}))
    [f] = gg.dead_listings(base, head)
    assert (f.rule, f.level, f.event) == ("dead_listing", "block", "Settings - Saved")
    assert "Delete its key" in f.fix


def test_removing_the_key_too_clears_the_dead_listing():
    base = gg.build_snapshot(tree({SEND: "trackEvent(EVENTS.Settings.Saved)"}))
    head = gg.build_snapshot(tree({SEND: "noop()"}, web=WEB_REG.replace("    Saved: 'Settings - Saved',\n", "")))
    assert gg.dead_listings(base, head) == []


def test_an_event_that_never_had_a_call_site_is_skipped():
    base = gg.build_snapshot(tree({}))
    head = gg.build_snapshot(tree({}))
    assert gg.dead_listings(base, head) == []


def test_a_hubspot_event_left_dead_says_to_check_hubspot():
    api = "packages/gp-api/src/website/website.service.ts"
    base = gg.build_snapshot(tree({api: "this.analytics.track(id, EVENTS.CandidateWebsite.Published)"}))
    head = gg.build_snapshot(tree({api: "noop()"}))
    [f] = gg.dead_listings(base, head)
    assert "HubSpot" in f.detail


def test_removing_a_hubspot_key_warns():
    base = gg.build_snapshot(tree({}))
    head = gg.build_snapshot(tree({}, api=API_REG.replace("    Published: 'Candidate Website - Published',\n", "")))
    [f] = gg.hubspot_warnings(base, head)
    assert (f.rule, f.level) == ("hubspot_event_removed", "warn")


DOOR = "packages/gp-webapp/app/(dashboard)/door-knocking/Walk.tsx"
MODAL = "packages/gp-webapp/app/(dashboard)/components/RecordModal.tsx"
TASKFLOW = "packages/gp-webapp/app/(dashboard)/components/TaskFlow.tsx"
LEGS = {"win_activated_users": [sa.Leg("Voter Outreach - Campaign Completed"),
                                sa.Leg("Viewed", path="/dashboard"),
                                sa.Leg("Old - Thing", era="historical")]}


def test_only_watched_legs_are_guarded_and_path_legs_are_separate():
    events, paths = gg.watched_legs(LEGS)
    assert events == {"Voter Outreach - Campaign Completed": ("win_activated_users",)}
    assert paths == {("Viewed", "/dashboard"): ("win_activated_users",)}


def test_losing_one_of_several_okr_call_sites_blocks():
    """The TaskFlow delete: the event still fired from the modal, but the scheduling
    call site was gone. Both files sit under app/dashboard/components/, so a route
    comparison saw no change. Per-file counts do."""
    cc = "trackEvent(EVENTS.Outreach.CampaignCompleted)"
    base = gg.build_snapshot(tree({TASKFLOW: cc, MODAL: cc}))
    head = gg.build_snapshot(tree({MODAL: cc}))
    events, paths = gg.watched_legs(LEGS)
    [f] = gg.okr_findings(base, head, events, paths, renames={})
    assert (f.rule, f.level, f.event) == ("okr_call_site_lost", "block", "Voter Outreach - Campaign Completed")
    assert TASKFLOW in f.detail and f.metrics == ("win_activated_users",)
    assert "intents:" in f.fix


def test_a_git_rename_that_keeps_the_count_is_not_a_finding():
    cc = "trackEvent(EVENTS.Outreach.CampaignCompleted)"
    moved = "packages/gp-webapp/app/(dashboard)/components/TaskFlowV2.tsx"
    base = gg.build_snapshot(tree({TASKFLOW: cc}))
    head = gg.build_snapshot(tree({moved: cc}))
    events, paths = gg.watched_legs(LEGS)
    assert gg.okr_findings(base, head, events, paths, renames={TASKFLOW: moved}) == []


def test_removing_the_page_behind_a_path_leg_blocks():
    page = "packages/gp-webapp/app/(dashboard)/page.tsx"
    base = gg.build_snapshot(tree({page: "export default function P() {}"}))
    head = gg.build_snapshot(tree({}))
    events, paths = gg.watched_legs(LEGS)
    [f] = gg.okr_findings(base, head, events, paths, renames={})
    assert (f.rule, f.event) == ("okr_page_removed", "Viewed")


def test_an_okr_call_site_file_nobody_imports_any_more_blocks():
    page = "packages/gp-webapp/app/(dashboard)/door-knocking/page.tsx"
    cc = "trackEvent(EVENTS.Outreach.CampaignCompleted)"
    base = gg.build_snapshot(tree({page: "import Walk from './Walk'", DOOR: cc}))
    head = gg.build_snapshot(tree({page: "export default function P() {}", DOOR: cc}))
    events, paths = gg.watched_legs(LEGS)
    [f] = gg.okr_findings(base, head, events, paths, renames={})
    assert (f.rule, f.event) == ("okr_file_unused", "Voter Outreach - Campaign Completed")


def test_a_surface_path_this_change_deletes_blocks():
    wl = ("behaviors:\n  - id: b\n    surfaces:\n      - path: " + SEND + "\n"
          "        label: x\n        instrumented_by: [\"Settings - Saved\"]\nintents: []\n")
    base = gg.build_snapshot(tree({SEND: "x"}, watchlist=wl))
    head = gg.build_snapshot(tree({}, watchlist=wl))
    [f] = gg.stale_surface_paths(base, head)
    assert (f.rule, f.level) == ("stale_surface_path", "block") and SEND in f.detail


def test_a_surface_path_already_stale_on_main_does_not_block():
    wl = ("behaviors:\n  - id: b\n    surfaces:\n      - path: packages/gp-webapp/gone.tsx\n"
          "        label: x\nintents: []\n")
    base = gg.build_snapshot(tree({}, watchlist=wl))
    head = gg.build_snapshot(tree({}, watchlist=wl))
    assert gg.stale_surface_paths(base, head) == []


def test_a_new_key_with_a_colon_and_no_provenance_row_warns():
    web = WEB_REG.replace("    Saved: 'Settings - Saved',\n",
                          "    Saved: 'Settings - Saved',\n    Click: 'Settings - Page: Click Save',\n")
    base = gg.build_snapshot(tree({}, provenance="event_type\nSettings - Saved\n"))
    head = gg.build_snapshot(tree({}, web=web, provenance="event_type\nSettings - Saved\n"))
    rules = sorted(f.rule for f in gg.new_key_warnings(base, head))
    assert rules == ["naming", "no_provenance_row"]


def test_a_directory_surface_counts_as_present_by_its_files():
    story = "packages/gp-webapp/app/(dashboard)/story"
    page = f"{story}/Page.tsx"
    wl = ("behaviors:\n  - id: b\n    surfaces:\n      - path: " + story + "\n"
          "        label: x\nintents: []\n")
    base = gg.build_snapshot(tree({page: "x"}, watchlist=wl))
    head = gg.build_snapshot(tree({}, watchlist=wl))
    [f] = gg.stale_surface_paths(base, head)
    assert (f.rule, f.level) == ("stale_surface_path", "block") and story in f.detail


def test_a_directory_surface_present_in_both_is_not_stale():
    story = "packages/gp-webapp/app/(dashboard)/story"
    page = f"{story}/Page.tsx"
    wl = ("behaviors:\n  - id: b\n    surfaces:\n      - path: " + story + "\n"
          "        label: x\nintents: []\n")
    base = gg.build_snapshot(tree({page: "x"}, watchlist=wl))
    head = gg.build_snapshot(tree({page: "x"}, watchlist=wl))
    assert gg.stale_surface_paths(base, head) == []


def test_a_renamed_okr_call_site_file_that_loses_its_importer_blocks():
    page = "packages/gp-webapp/app/(dashboard)/door-knocking/page.tsx"
    moved = "packages/gp-webapp/app/(dashboard)/door-knocking/WalkV2.tsx"
    cc = "trackEvent(EVENTS.Outreach.CampaignCompleted)"
    base = gg.build_snapshot(tree({page: "import Walk from './Walk'", DOOR: cc}))
    head = gg.build_snapshot(tree({page: "export default function P() {}", moved: cc}))
    events, paths = gg.watched_legs(LEGS)
    [f] = gg.okr_findings(base, head, events, paths, renames={DOOR: moved})
    assert (f.rule, f.event) == ("okr_file_unused", "Voter Outreach - Campaign Completed")


def _okr_finding():
    return gg.Finding("okr_call_site_lost", "block", "Voter Outreach - Campaign Completed",
                      "x", "fix", ("win_activated_users",))


def _wl(rows: str) -> str:
    return "behaviors: []\nintents:\n" + rows if rows else "behaviors: []\nintents: []\n"


ROW = ('  - {metric: win_activated_users, event: "Voter Outreach - Campaign Completed", '
       'intent: retire_activity, reason: "Scheduling flow retired", date: "2026-10-01"}\n')


def test_an_intent_added_in_this_change_clears_the_okr_finding():
    base = gg.build_snapshot(tree({}, watchlist=_wl("")))
    head = gg.build_snapshot(tree({}, watchlist=_wl(ROW)))
    remaining, cleared = gg.apply_intents([_okr_finding()], base, head)
    assert remaining == [] and len(cleared) == 1


def test_an_intent_already_on_main_does_not_clear_a_new_finding():
    base = gg.build_snapshot(tree({}, watchlist=_wl(ROW)))
    head = gg.build_snapshot(tree({}, watchlist=_wl(ROW)))
    remaining, cleared = gg.apply_intents([_okr_finding()], base, head)
    assert [f.rule for f in remaining] == ["okr_call_site_lost"] and cleared == []


def test_every_metric_of_a_shared_leg_needs_its_own_row():
    f = gg.Finding("okr_call_site_lost", "block", "Voter Outreach - Campaign Completed", "x", "fix",
                   ("win_activated_users", "win_product_output_users"))
    base = gg.build_snapshot(tree({}, watchlist=_wl("")))
    head = gg.build_snapshot(tree({}, watchlist=_wl(ROW)))
    remaining, _ = gg.apply_intents([f], base, head)
    assert [x.rule for x in remaining] == ["okr_call_site_lost"]


def test_a_successor_with_no_call_site_is_refused():
    row = ('  - {metric: win_activated_users, event: "Voter Outreach - Campaign Completed", '
           'intent: successor, successor: "Outreach - Campaign Completed", reason: "renamed", date: "2026-10-01"}\n')
    base = gg.build_snapshot(tree({}, watchlist=_wl("")))
    head = gg.build_snapshot(tree({}, watchlist=_wl(row)))
    remaining, _ = gg.apply_intents([_okr_finding()], base, head)
    assert sorted(f.rule for f in remaining) == ["invalid_intent", "okr_call_site_lost"]


def test_a_row_missing_its_reason_is_an_invalid_intent():
    row = ('  - {metric: win_activated_users, event: "Voter Outreach - Campaign Completed", '
           'intent: retire_activity, reason: "", date: "2026-10-01"}\n')
    base = gg.build_snapshot(tree({}, watchlist=_wl("")))
    head = gg.build_snapshot(tree({}, watchlist=_wl(row)))
    remaining, _ = gg.apply_intents([], base, head)
    assert [f.rule for f in remaining] == ["invalid_intent"]


def test_intents_do_not_clear_a_dead_listing():
    f = gg.Finding("dead_listing", "block", "Voter Outreach - Campaign Completed", "x", "fix")
    base = gg.build_snapshot(tree({}, watchlist=_wl("")))
    head = gg.build_snapshot(tree({}, watchlist=_wl(ROW)))
    remaining, _ = gg.apply_intents([f], base, head)
    assert [x.rule for x in remaining if x.level == "block"] == ["dead_listing"]


def test_evaluate_reports_what_it_examined():
    base = gg.build_snapshot(tree({SEND: "trackEvent(EVENTS.Settings.Saved)"}))
    head = gg.build_snapshot(tree({SEND: "noop()"}))
    report = gg.evaluate(base, head, LEGS, "2026-10-01", renames={})
    assert [f.rule for f in report.blocks] == ["dead_listing"]
    assert report.examined["okr_legs"] == 2
    assert report.examined["sem_copy_date"] == "2026-10-01"
    assert report.examined["events_compared"] >= 3


def test_zero_okr_legs_is_a_guard_error_not_a_pass():
    snap = gg.build_snapshot(tree({}))
    with pytest.raises(gg.GuardError):
        gg.evaluate(snap, snap, {}, None, renames={})


def test_markdown_carries_the_marker_the_fix_and_the_examined_counts():
    base = gg.build_snapshot(tree({SEND: "trackEvent(EVENTS.Settings.Saved)"}))
    head = gg.build_snapshot(tree({SEND: "noop()"}))
    md = gg.render_markdown(gg.evaluate(base, head, LEGS, "2026-10-01", renames={}))
    assert md.startswith("<!-- analytics-guard -->")
    assert "Settings - Saved" in md and "Delete its key" in md and "Examined" in md


def test_cli_exits_1_on_a_bad_ref_and_never_2(tmp_path, capsys):
    code = gg.main(["check", "--base", "not-a-ref-xyz", "--head", "HEAD",
                    "--json", str(tmp_path / "out.json")])
    assert code == 1
    assert json.loads((tmp_path / "out.json").read_text())["status"] == "error"


def test_unmatched_path_legs_are_examined_and_reported_separately():
    base_no_page = gg.build_snapshot(tree({}))
    report = gg.evaluate(base_no_page, base_no_page, LEGS, "2026-10-01", renames={})
    assert report.examined["unmatched_path_legs"] == ["Viewed@/dashboard"]
    md = gg.render_markdown(report)
    assert "_Path legs with no matching page (not guarded): Viewed@/dashboard._" in md

    page = "packages/gp-webapp/app/(dashboard)/page.tsx"
    base_with_page = gg.build_snapshot(tree({page: "export default function P() {}"}))
    report2 = gg.evaluate(base_with_page, base_with_page, LEGS, "2026-10-01", renames={})
    assert report2.examined["unmatched_path_legs"] == []
    assert "no matching page" not in gg.render_markdown(report2)


# Final review fix wave.

def test_a_registry_that_parses_to_zero_events_is_a_guard_error():
    """A registry whose type annotation the parser cannot read would otherwise report every
    event as unregistered: an input failure, not a finding."""
    with pytest.raises(gg.GuardError):
        gg.build_snapshot(tree({}, web="export const EVENTS: Record<string, unknown> = {\n  A: 'B',\n}\n"))


def test_a_registry_absent_on_a_side_is_not_an_error():
    files = {gg.WATCHLIST: WATCHLIST_YAML, gg.PROVENANCE: "event_type\n", gg.API_REGISTRY: API_REG}
    snap = gg.build_snapshot(gg.DictTree(files))
    assert snap.registries["web"] == {}


SEM_WIN = f"{gg.SEM_DIR}/sem_analytics__users_win.yml"
SEM_TEXT = ("# Refreshed from x on 2026-09-30 by sem_anchors.py refresh-vendored.\n"
            "metrics:\n  - name: win_activated_users\n    config:\n      meta:\n"
            "        anchored_on:\n          - event: \"Voter Outreach - Campaign Completed\"\n")


def test_okr_legs_come_from_the_base_tree():
    anchors, date = gg.load_base_anchors(gg.DictTree({SEM_WIN: SEM_TEXT}))
    assert [leg.event for leg in anchors["win_activated_users"]] == ["Voter Outreach - Campaign Completed"]
    assert date == "2026-09-30"


def test_a_base_with_one_of_the_two_files_keeps_the_other_files_legs():
    anchors, _ = gg.load_base_anchors(gg.DictTree({SEM_WIN: SEM_TEXT}))
    serve_only = set(sa.parse_anchors((sa.VENDORED_DIR / "sem_analytics__users_serve.yml").read_text()))
    assert serve_only and serve_only <= set(anchors)


def test_okr_legs_fall_back_to_disk_when_the_base_has_no_copy():
    anchors, _ = gg.load_base_anchors(gg.DictTree({}))
    assert anchors == sa.load_vendored_anchors()[0]


def _git(repo, *args):
    import subprocess
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


def _commit(repo, files, message):
    for path, text in files.items():
        p = repo / path
        if text is None:
            p.unlink()
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    _git(repo, "add", "-A")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message)
    import subprocess
    return subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], check=True,
                          capture_output=True, text=True).stdout.strip()


def test_a_pr_that_deletes_the_leg_it_breaks_is_still_blocked(tmp_path):
    """The legs are read from the merge base. A PR that edits its own vendored copy to drop
    the leg must not dodge the block it causes."""
    _git(tmp_path, "init", "-q")
    base = _commit(tmp_path, {
        gg.WEB_REGISTRY: WEB_REG, gg.API_REGISTRY: API_REG, gg.WATCHLIST: WATCHLIST_YAML,
        gg.PROVENANCE: "event_type\n", SEM_WIN: SEM_TEXT,
        TASKFLOW: "trackEvent(EVENTS.Outreach.CampaignCompleted)",
        MODAL: "trackEvent(EVENTS.Outreach.CampaignCompleted)",
    }, "base")
    head = _commit(tmp_path, {
        TASKFLOW: None,
        SEM_WIN: SEM_TEXT.replace("Voter Outreach - Campaign Completed", "Something Else"),
    }, "head")
    out = tmp_path / "g.json"
    code = gg.main(["check", "--base", base, "--head", head, "--repo", str(tmp_path), "--json", str(out)])
    report = json.loads(out.read_text())
    assert code == 2
    assert [f["rule"] for f in report["blocks"]] == ["okr_call_site_lost"]
    assert report["examined"]["sem_copy_date"] == "2026-09-30"


def test_cli_exits_1_when_a_registry_does_not_parse(tmp_path):
    _git(tmp_path, "init", "-q")
    files = {gg.WEB_REGISTRY: WEB_REG, gg.API_REGISTRY: API_REG, gg.WATCHLIST: WATCHLIST_YAML,
             gg.PROVENANCE: "event_type\n", SEM_WIN: SEM_TEXT}
    base = _commit(tmp_path, files, "base")
    head = _commit(tmp_path, {gg.WEB_REGISTRY: "export const EVENTS: Record<string, unknown> = {\n"}, "head")
    out = tmp_path / "g.json"
    assert gg.main(["check", "--base", base, "--head", head, "--repo", str(tmp_path), "--json", str(out)]) == 1
    assert json.loads(out.read_text())["status"] == "error"


@pytest.mark.parametrize("field,value", [
    ("reason", "<why>"), ("date", "YYYY-MM-DD"), ("date", "next week"), ("date", "2026-13-01"),
    ("intent", "<relocated|not_a_change|successor|retire_activity>"),
])
def test_placeholder_and_malformed_intent_values_are_rejected(field, value):
    row = {"metric": "win_activated_users", "event": "E", "intent": "retire_activity",
           "reason": "real reason", "date": "2026-10-01"}
    assert gg.intent_problems(row) == []
    row[field] = value
    assert gg.intent_problems(row)


def test_an_unquoted_yaml_date_is_accepted():
    import yaml
    [row] = yaml.safe_load('- {metric: m, event: E, intent: retire_activity, reason: r, date: 2026-10-01}')
    assert gg.intent_problems(row) == []


def test_intent_fix_suggests_retire_only_when_no_call_site_is_left():
    gone = gg.intent_fix("E", ("m",), head_count=0)
    assert "intent: retire_activity" in gone
    still = gg.intent_fix("E", ("m",), head_count=3)
    assert "intent: <relocated|not_a_change|successor|retire_activity>" in still
    assert "intent: retire_activity," not in still


def test_the_okr_fix_offers_a_choice_when_the_event_still_fires_elsewhere():
    cc = "trackEvent(EVENTS.Outreach.CampaignCompleted)"
    base = gg.build_snapshot(tree({TASKFLOW: cc, MODAL: cc}))
    head = gg.build_snapshot(tree({MODAL: cc}))
    events, paths = gg.watched_legs(LEGS)
    [f] = gg.okr_findings(base, head, events, paths, renames={})
    assert "<relocated|not_a_change|successor|retire_activity>" in f.fix


def test_copying_the_suggested_okr_row_verbatim_does_not_clear_it():
    cc = "trackEvent(EVENTS.Outreach.CampaignCompleted)"
    base = gg.build_snapshot(tree({TASKFLOW: cc, MODAL: cc}, watchlist=_wl("")))
    events, paths = gg.watched_legs(LEGS)
    head0 = gg.build_snapshot(tree({MODAL: cc}, watchlist=_wl("")))
    [f] = gg.okr_findings(base, head0, events, paths, renames={})
    row = next(line for line in f.fix.splitlines() if line.startswith("  - {"))
    head = gg.build_snapshot(tree({MODAL: cc}, watchlist=_wl(row + "\n")))
    remaining, cleared = gg.apply_intents([f], base, head)
    assert cleared == [] and "invalid_intent" in {x.rule for x in remaining}


def test_the_committed_watchlist_accepts_an_appended_intent_row():
    from pathlib import Path
    import yaml
    text = (Path(gg.REPO_ROOT) / gg.WATCHLIST).read_text()
    doc = yaml.safe_load(text + ROW)
    assert len(doc["intents"]) == 1


def test_a_watchlist_this_change_breaks_is_a_block_not_a_crash():
    base = gg.build_snapshot(tree({}))
    head = gg.build_snapshot(tree({}, watchlist="intents: []\n  - {event: x}\n"))
    assert head.watchlist_error
    report = gg.evaluate(base, head, LEGS, "2026-10-01", renames={})
    [f] = [f for f in report.blocks if f.rule == "watchlist_unparseable"]
    assert "monitored_events.yaml no longer parses" in f.detail


def test_a_watchlist_already_broken_on_main_only_warns():
    bad = "intents: []\n  - {event: x}\n"
    base = gg.build_snapshot(tree({}, watchlist=bad))
    head = gg.build_snapshot(tree({}, watchlist=bad))
    report = gg.evaluate(base, head, LEGS, "2026-10-01", renames={})
    assert "watchlist_unparseable" not in {f.rule for f in report.blocks}
    assert "watchlist_unparseable" in {f.rule for f in report.warns}


def test_a_stale_surface_names_its_behavior_and_label():
    wl = ("behaviors:\n  - id: outreach_sent\n    surfaces:\n      - path: " + SEND + "\n"
          "        label: Text send\nintents: []\n")
    base = gg.build_snapshot(tree({SEND: "x"}, watchlist=wl))
    head = gg.build_snapshot(tree({}, watchlist=wl))
    [f] = gg.stale_surface_paths(base, head)
    assert f.event == "outreach_sent"
    assert "Text send" in f.detail and "outreach_sent" in f.detail
    assert f.fix == ("Move the surface's path: to where the code lives now, or delete the "
                     "surface entry if the feature is gone.")


NAC = ('  - {event: "Settings - Saved", intent: not_a_change, '
       'reason: "fired through a dynamic lookup the guard cannot read", date: "2026-10-01"}\n')


def test_a_not_a_change_row_with_no_metric_clears_a_dead_listing():
    f = gg.Finding("dead_listing", "block", "Settings - Saved", "x", gg._RETIRE_FIX)
    base = gg.build_snapshot(tree({}, watchlist=_wl("")))
    head = gg.build_snapshot(tree({}, watchlist=_wl(NAC)))
    remaining, cleared = gg.apply_intents([f], base, head)
    assert remaining == [] and cleared == [f]


def test_a_not_a_change_row_with_no_reason_does_not_clear_a_dead_listing():
    f = gg.Finding("dead_listing", "block", "Settings - Saved", "x", gg._RETIRE_FIX)
    base = gg.build_snapshot(tree({}, watchlist=_wl("")))
    head = gg.build_snapshot(tree({}, watchlist=_wl(NAC.replace(
        "fired through a dynamic lookup the guard cannot read", ""))))
    remaining, _ = gg.apply_intents([f], base, head)
    assert sorted(x.rule for x in remaining) == ["dead_listing", "invalid_intent"]


def test_a_metric_less_row_must_be_not_a_change():
    row = ('  - {event: "Settings - Saved", intent: retire_activity, reason: "r", date: "2026-10-01"}\n')
    base = gg.build_snapshot(tree({}, watchlist=_wl("")))
    head = gg.build_snapshot(tree({}, watchlist=_wl(row)))
    remaining, _ = gg.apply_intents([], base, head)
    assert [x.rule for x in remaining] == ["invalid_intent"]


def test_the_dead_listing_fix_names_the_not_a_change_escape():
    assert "intent: not_a_change" in gg._RETIRE_FIX and "guard bug" in gg._RETIRE_FIX


def test_editing_an_old_rows_reason_on_main_is_not_a_new_row():
    base = gg.build_snapshot(tree({}, watchlist=_wl(ROW)))
    head = gg.build_snapshot(tree({}, watchlist=_wl(ROW.replace(
        "Scheduling flow retired", "Scheduling flow retired in Q3").replace("2026-10-01", "2026-10-02"))))
    remaining, cleared = gg.apply_intents([_okr_finding()], base, head)
    assert cleared == [] and [f.rule for f in remaining] == ["okr_call_site_lost"]


def test_an_added_row_that_matches_no_finding_warns():
    base = gg.build_snapshot(tree({}, watchlist=_wl("")))
    head = gg.build_snapshot(tree({}, watchlist=_wl(ROW)))
    remaining, cleared = gg.apply_intents([], base, head)
    [f] = remaining
    assert (f.rule, f.level, f.event) == ("intent_unused", "warn", "Voter Outreach - Campaign Completed")


def test_a_used_row_does_not_warn():
    base = gg.build_snapshot(tree({}, watchlist=_wl("")))
    head = gg.build_snapshot(tree({}, watchlist=_wl(ROW)))
    remaining, _ = gg.apply_intents([_okr_finding()], base, head)
    assert remaining == []


def test_an_unused_file_finding_names_the_head_path_and_the_rename():
    page = "packages/gp-webapp/app/(dashboard)/door-knocking/page.tsx"
    moved = "packages/gp-webapp/app/(dashboard)/door-knocking/WalkV2.tsx"
    cc = "trackEvent(EVENTS.Outreach.CampaignCompleted)"
    base = gg.build_snapshot(tree({page: "import Walk from './Walk'", DOOR: cc}))
    head = gg.build_snapshot(tree({page: "export default function P() {}", moved: cc}))
    events, paths = gg.watched_legs(LEGS)
    [f] = gg.okr_findings(base, head, events, paths, renames={DOOR: moved})
    assert f.detail.startswith(moved) and f"(renamed from {DOOR})" in f.detail


def test_markdown_groups_findings_by_rule_and_prints_a_shared_fix_once():
    f1 = gg.Finding("dead_listing", "block", "A - One", "gone", gg._RETIRE_FIX)
    f2 = gg.Finding("dead_listing", "block", "B - Two", "gone", gg._RETIRE_FIX)
    report = gg.Report(blocks=[f1, f2], warns=[], cleared=[], examined={
        "events_compared": 1, "okr_legs": 1, "files_scanned": 1, "sem_copy_date": "d",
        "unmatched_path_legs": []})
    md = gg.render_markdown(report)
    assert md.count("Delete its key") == 1
    assert md.count(gg._TITLES["dead_listing"]) == 1
    assert "`A - One`" in md and "`B - Two`" in md
    assert "**Blocks merge**" in md.splitlines()


def test_markdown_is_capped_with_a_pointer_to_the_job_summary():
    many = [gg.Finding("okr_call_site_lost", "block", f"E{i}", "x" * 200, f"fix {i} " + "y" * 300, ("m",))
            for i in range(400)]
    report = gg.Report(blocks=many, warns=[], cleared=[], examined={
        "events_compared": 1, "okr_legs": 1, "files_scanned": 1, "sem_copy_date": "d",
        "unmatched_path_legs": []})
    full = gg.render_markdown(report)
    capped = gg.render_markdown(report, limit=gg.COMMENT_LIMIT)
    assert len(full) > gg.COMMENT_LIMIT >= len(capped)
    assert "job summary" in capped and capped.startswith("<!-- analytics-guard -->")
