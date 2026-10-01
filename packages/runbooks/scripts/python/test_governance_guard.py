"""Pre-merge governance guard (DATA-2432). In-memory trees only; no git, no network."""

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
        "packages/gp-webapp/app/dashboard/outreach/Send.tsx": "trackEvent(EVENTS.Outreach.CampaignScheduled)",
        "packages/gp-webapp/app/dashboard/door/Walk.tsx": "trackEvent('Voter Outreach - Campaign Scheduled')",
    }))
    assert snap.files_for("Voter Outreach - Campaign Scheduled") == {
        "packages/gp-webapp/app/dashboard/outreach/Send.tsx": 1,
        "packages/gp-webapp/app/dashboard/door/Walk.tsx": 1,
    }
    assert snap.count("Voter Outreach - Campaign Scheduled") == 2


def test_tests_and_registries_are_not_call_sites():
    snap = gg.build_snapshot(tree({
        "packages/gp-webapp/app/dashboard/outreach/Send.test.tsx": "trackEvent(EVENTS.Outreach.CampaignScheduled)",
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
        "packages/gp-webapp/app/dashboard/page.tsx": "import Card from './components/Card'",
        "packages/gp-webapp/app/dashboard/components/Card.tsx": "trackEvent(EVENTS.Settings.Saved)",
        "packages/gp-webapp/app/other/page.tsx": "import Card from '@/app/dashboard/components/Card'",
    }))
    assert sorted(snap.importers("packages/gp-webapp/app/dashboard/components/Card.tsx")) == [
        "packages/gp-webapp/app/dashboard/page.tsx",
        "packages/gp-webapp/app/other/page.tsx",
    ]


def test_page_routes_drop_route_groups():
    snap = gg.build_snapshot(tree({
        "packages/gp-webapp/app/(candidate)/dashboard/page.tsx": "export default function P() {}",
    }))
    assert "/dashboard" in snap.page_routes


SEND = "packages/gp-webapp/app/dashboard/outreach/Send.tsx"


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


DOOR = "packages/gp-webapp/app/dashboard/door-knocking/Walk.tsx"
MODAL = "packages/gp-webapp/app/dashboard/components/RecordModal.tsx"
TASKFLOW = "packages/gp-webapp/app/dashboard/components/TaskFlow.tsx"
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
    moved = "packages/gp-webapp/app/dashboard/components/TaskFlowV2.tsx"
    base = gg.build_snapshot(tree({TASKFLOW: cc}))
    head = gg.build_snapshot(tree({moved: cc}))
    events, paths = gg.watched_legs(LEGS)
    assert gg.okr_findings(base, head, events, paths, renames={TASKFLOW: moved}) == []


def test_removing_the_page_behind_a_path_leg_blocks():
    page = "packages/gp-webapp/app/dashboard/page.tsx"
    base = gg.build_snapshot(tree({page: "export default function P() {}"}))
    head = gg.build_snapshot(tree({}))
    events, paths = gg.watched_legs(LEGS)
    [f] = gg.okr_findings(base, head, events, paths, renames={})
    assert (f.rule, f.event) == ("okr_page_removed", "Viewed")


def test_an_okr_call_site_file_nobody_imports_any_more_blocks():
    page = "packages/gp-webapp/app/dashboard/door-knocking/page.tsx"
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
    story = "packages/gp-webapp/app/dashboard/story"
    page = f"{story}/Page.tsx"
    wl = ("behaviors:\n  - id: b\n    surfaces:\n      - path: " + story + "\n"
          "        label: x\nintents: []\n")
    base = gg.build_snapshot(tree({page: "x"}, watchlist=wl))
    head = gg.build_snapshot(tree({}, watchlist=wl))
    [f] = gg.stale_surface_paths(base, head)
    assert (f.rule, f.level) == ("stale_surface_path", "block") and story in f.detail


def test_a_directory_surface_present_in_both_is_not_stale():
    story = "packages/gp-webapp/app/dashboard/story"
    page = f"{story}/Page.tsx"
    wl = ("behaviors:\n  - id: b\n    surfaces:\n      - path: " + story + "\n"
          "        label: x\nintents: []\n")
    base = gg.build_snapshot(tree({page: "x"}, watchlist=wl))
    head = gg.build_snapshot(tree({page: "x"}, watchlist=wl))
    assert gg.stale_surface_paths(base, head) == []


def test_a_renamed_okr_call_site_file_that_loses_its_importer_blocks():
    page = "packages/gp-webapp/app/dashboard/door-knocking/page.tsx"
    moved = "packages/gp-webapp/app/dashboard/door-knocking/WalkV2.tsx"
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
    assert [x.rule for x in remaining] == ["dead_listing"]
