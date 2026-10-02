"""event_reach (DATA-2531). Pure, fixture-driven; no git, no network."""

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
