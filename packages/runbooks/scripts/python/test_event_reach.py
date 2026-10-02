"""event_reach (DATA-2531). Pure, fixture-driven; no git, no network."""

import governance_guard as gg

import event_reach as er

PM = """const SHARED_AREAS: ProductArea[] = [
  {
    navId: 'nav-dash-profile',
    name: 'Profile',
    path: '/dashboard/profile',
  },
  {
    navId: 'campaign-details-dashboard',
    name: 'My Profile',
    path: '/dashboard/profile',
  },
  {
    navId: 'campaign-tracker-dashboard',
    name: 'Campaign Manager',
    path: '/dashboard',
  },
  {
    navId: 'polls-dashboard',
    name: 'Polls',
    path: '/dashboard/polls',
  },
]
"""


def test_slug_is_lower_kebab():
    assert er.slug("Additional Questions") == "additional-questions"
    assert er.slug("10DLC") == "10dlc"


def test_route_of_drops_groups_and_slots():
    assert er.route_of("packages/gp-webapp/app/(candidate)/dashboard/@modal/profile/page.tsx") == "/dashboard/profile"
    assert er.route_of("packages/gp-webapp/app/page.tsx") == "/"


def test_route_kind():
    assert er.route_kind("packages/gp-webapp/app/x/page.tsx") == "page"
    assert er.route_kind("packages/gp-webapp/app/x/layout.tsx") == "layout"
    assert er.route_kind("packages/gp-webapp/app/x/template.tsx") == "layout"
    assert er.route_kind("packages/gp-webapp/app/x/error.tsx") == "other"
    assert er.route_kind("packages/gp-webapp/app/api/x/route.ts") == "api"
    assert er.route_kind("packages/gp-webapp/app/x/components/Card.tsx") is None


def test_bare_redirect_is_dead_but_a_generic_return_type_is_not_jsx():
    dead = (
        "import { redirect } from 'next/navigation'\n"
        "export default async function Page(): Promise<React.JSX.Element> {\n"
        "  redirect('/onboarding/office-selection')\n}\n"
    )
    assert er.is_bare_redirect(dead)


def test_conditional_redirect_with_jsx_is_live():
    live = (
        "export default async function Page() {\n"
        "  if (!user) redirect('/login')\n"
        "  return <Questions />\n}\n"
    )
    assert not er.is_bare_redirect(live)


def test_page_title_reads_metadata_and_rejects_dynamic_or_generic():
    assert er.page_title("pageMetaData({\n  title: 'Additional Questions | GoodParty.org',\n})") == "Additional Questions"
    assert er.page_title("pageMetaData({ title: `${name} | GoodParty.org` })") is None
    assert er.page_title("pageMetaData({ title: 'GoodParty.org' })") is None
    assert er.page_title("export default function Page() {}") is None


def _idx(pages):
    return er.AreaIndex(PM, pages)


def test_product_map_paths_merge_their_names():
    area = _idx({}).area("/dashboard/profile")
    assert area.key == "/dashboard/profile"
    assert area.label == "Profile"
    assert area.names == frozenset({"profile", "my-profile"})


def test_a_specific_area_claims_its_subroutes():
    assert _idx({}).area("/dashboard/polls/create").key == "/dashboard/polls"


def test_the_dashboard_root_does_not_claim_unmapped_dashboard_pages():
    idx = _idx({"/dashboard/questions": "pageMetaData({ title: 'Additional Questions | GoodParty.org' })"})
    area = idx.area("/dashboard/questions")
    assert area.key == "/dashboard/questions"
    assert area.label == "Additional Questions"
    assert area.names == frozenset({"additional-questions"})
    assert idx.area("/dashboard").label == "Campaign Manager"


def test_an_untitled_subroute_inherits_its_nearest_titled_ancestor():
    idx = _idx({
        "/onboarding": "pageMetaData({ title: 'Candidate Onboarding | GoodParty.org' })",
        "/onboarding/[step]": "export default function Page() {}",
    })
    assert idx.area("/onboarding/[step]").key == "/onboarding"


def test_a_route_with_no_title_anywhere_falls_back_to_its_last_literal_segment():
    assert _idx({"/volunteer/[id]": ""}).area("/volunteer/[id]").names == frozenset({"volunteer"})
    assert _idx({"/account/billing": ""}).area("/account/billing").names == frozenset({"billing"})


def test_area_for_path_matches_dynamic_segments_and_prefers_literals():
    idx = _idx({
        "/dashboard/polls/[id]": "",
        "/dashboard/polls/create": "",
        "/dashboard/questions": "pageMetaData({ title: 'Additional Questions | GoodParty.org' })",
    })
    assert idx.area_for_path("/dashboard/polls/create?x=1").key == "/dashboard/polls"
    assert idx.area_for_path("/dashboard/questions").label == "Additional Questions"
    assert idx.area_for_path("/nowhere") is None


def test_all_areas_covers_pages_and_the_product_map():
    keys = {a.key for a in _idx({"/dashboard/questions": "pageMetaData({ title: 'Additional Questions' })"}).all_areas()}
    assert {"/dashboard/profile", "/dashboard", "/dashboard/polls", "/dashboard/questions"} <= keys


WEB_REG = """export const EVENTS = {
  Office: {
    Searched: 'Onboarding - Candidate Office Searched',
  },
  Running: {
    Saved: 'Profile - Running Against: Click Save',
  },
  Nav: {
    Clicked: 'Navigation - Click',
  },
}
"""
A = "packages/gp-webapp/app/"


def _snap(files):
    base = {gg.WEB_REGISTRY: WEB_REG, gg.API_REGISTRY: "export const EVENTS = {\n  X: {\n    Y: 'Account - Y',\n  },\n}\n",
            gg.WATCHLIST: "events: []\n", gg.PROVENANCE: "event_type\n", gg.PRODUCT_MAP: PM}
    base.update(files)
    return gg.build_snapshot(gg.DictTree(base))


def _reach(files, event):
    return er.ReachIndex(_snap(files), gg._resolve).reach(event)


ONBOARDING_REDIRECT = {
    A + "onboarding/[slug]/[step]/page.tsx": "import { redirect } from 'next/navigation'\nexport default async function Page(): Promise<never> {\n  redirect('/onboarding/office-selection')\n}\n",
    A + "onboarding/[slug]/[step]/components/OfficeStep.tsx": "export default function OfficeStep() { trackEvent(EVENTS.Office.Searched) }",
    A + "dashboard/shared/CampaignOfficeSelectionModal.tsx": "import OfficeStep from 'app/onboarding/[slug]/[step]/components/OfficeStep'\nexport default function M() { return <OfficeStep/> }",
    A + "dashboard/profile/page.tsx": "import M from '../shared/CampaignOfficeSelectionModal'\nexport default function P() { return <M/> }",
}


def test_the_onboarding_case_resolves_to_profile_only():
    r = _reach(ONBOARDING_REDIRECT, "Onboarding - Candidate Office Searched")
    assert r.area_keys == frozenset({"/dashboard/profile"})
    assert r.live_routes == frozenset({"/dashboard/profile"})
    assert not r.gap_files
    assert not r.dashboard_wide


def test_a_call_site_in_the_page_itself_counts_its_route():
    r = _reach({A + "dashboard/polls/page.tsx": "export default function P() { trackEvent(EVENTS.Office.Searched); return <div/> }"},
               "Onboarding - Candidate Office Searched")
    assert r.live_routes == frozenset({"/dashboard/polls"})


def test_a_redirecting_page_that_still_imports_the_component_is_dead():
    files = dict(ONBOARDING_REDIRECT)
    files[A + "onboarding/[slug]/[step]/page.tsx"] = (
        "import OfficeStep from './components/OfficeStep'\nimport { redirect } from 'next/navigation'\n"
        "export default async function Page() {\n  redirect('/x')\n}\n")
    r = _reach(files, "Onboarding - Candidate Office Searched")
    assert r.dead_routes == frozenset({"/onboarding/[slug]/[step]"})
    assert r.area_keys == frozenset({"/dashboard/profile"})


def test_a_file_nothing_imports_is_a_gap():
    r = _reach({A + "dashboard/x/Orphan.tsx": "trackEvent(EVENTS.Office.Searched)"}, "Onboarding - Candidate Office Searched")
    assert r.gap_files == frozenset({A + "dashboard/x/Orphan.tsx"})
    assert r.areas == ()


def test_dev_pages_are_ignored():
    r = _reach({A + "dev/gallery/page.tsx": "export default function P() { trackEvent(EVENTS.Office.Searched); return <div/> }"},
               "Onboarding - Candidate Office Searched")
    assert r.live_routes == frozenset()
    assert not r.gap_files


def test_a_component_in_the_dashboard_layout_is_dashboard_wide():
    r = _reach({
        A + "dashboard/layout.tsx": "import Nav from './Nav'\nexport default function L({children}) { return <Nav/> }",
        A + "dashboard/Nav.tsx": "export default function Nav() { trackEvent(EVENTS.Nav.Clicked) }",
    }, "Navigation - Click")
    assert r.dashboard_wide


def test_no_webapp_call_site_returns_none():
    assert _reach({}, "Onboarding - Candidate Office Searched") is None


def test_reach_all_covers_every_web_event_with_a_call_site():
    idx = er.ReachIndex(_snap(ONBOARDING_REDIRECT), gg._resolve)
    assert set(idx.reach_all()) == {"Onboarding - Candidate Office Searched"}
