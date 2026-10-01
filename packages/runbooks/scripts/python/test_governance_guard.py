"""Pre-merge governance guard (DATA-2432). In-memory trees only; no git, no network."""

import governance_guard as gg

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
