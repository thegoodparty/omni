from pathlib import Path

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
