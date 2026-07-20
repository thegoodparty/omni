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
