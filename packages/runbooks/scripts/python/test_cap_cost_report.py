"""Self-containment contract for the Stage 7 HTML report.

Builds a report from a tiny synthetic outputs dir (fake scope/distributions/
profile JSON + three 1x1 valid PNGs) and asserts the HTML is fully
self-contained — no http(s) sources, no leftover src placeholders, images
embedded as base64 data URIs — and that it degrades gracefully when milestone
data and the profile are absent. No S3/DB.
"""
import base64
import json
import os

from cap_cost_report import build_report

# A minimal but valid 1x1 PNG (the 8-byte signature + IHDR/IDAT/IEND).
_PNG_1x1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _write_outputs(tmp_path, *, with_profile=True, with_milestones=False):
    plots = tmp_path / "plots"
    plots.mkdir(parents=True)
    scope = {
        "label": "synthetic last 1 cohorts",
        "experiment_type": "synthetic_job",
        "summary": {
            "runs": 3,
            "window_start_utc": "2026-06-26T19:00:13.909000+00:00",
            "window_end_utc": "2026-06-26T19:34:48.225000+00:00",
            "costUsd_sum": 30.0,
        },
        "runs": [],
    }
    (tmp_path / "scope.json").write_text(json.dumps(scope))

    dist = {
        "overall": {"n": 3, "total": 30.0, "median": 9.0, "p90": 12.0, "p99": 14.0, "max": 14.5},
        "by_status": {"COMPLETED": {"n": 3, "total": 30.0}},
        "pareto_tail": {
            "runs_driving_80pct_spend": 2,
            "of_total_runs": 3,
            "share_of_runs": 0.667,
            "top_runs": [{"run_id": "r1", "run_cost": 14.5}],
        },
        "coverage": {
            "runs_in_scope": 3,
            "logs_parsed": 3,
            "coverage_pct": 100.0,
            "turn_rows": 120,
            "runs_with_milestones": 0,
            "milestone_coverage_pct": 0.0,
        },
        "milestone_note": "No milestone markers in this cohort.",
    }
    if with_milestones:
        dist["milestone_costs"] = {
            "ordered": [
                {"milestone": "setup", "total": 6.0, "share_of_spend": 0.2, "runs": 3,
                 "median_per_run": 2.0, "p90_per_run": 2.5},
                {"milestone": "work", "total": 24.0, "share_of_spend": 0.8, "runs": 3,
                 "median_per_run": 8.0, "p90_per_run": 9.0},
            ],
            "runs_with_milestones": 3,
        }
        dist["milestone_note"] = "Per-milestone cost attribution is LIVE."
    (plots / "distributions.json").write_text(json.dumps(dist))

    for name in ("cumulative_cost.png", "cost_velocity.png", "population_heatmap.png"):
        (plots / name).write_bytes(_PNG_1x1)
    if with_milestones:
        (plots / "milestone_heatmap.png").write_bytes(_PNG_1x1)

    profile_path = None
    if with_profile:
        profile = {
            "experiment_type": "synthetic_job",
            "status_field": "status",
            "success_status": "completed",
            "n_runs": 3,
            "outcome_counts": {
                "completed": 2,
                "agenda_provided_by_user": 1,  # non-standard status, must still render
            },
            "headline": {
                "metric": "dollars_per_completed_run",
                "total_cost_usd": 30.0,
                "value": 15.0,
                "note": "per completed run, including failures",
            },
        }
        profile_path = str(tmp_path / "profile.json")
        (tmp_path / "profile.json").write_text(json.dumps(profile))
    return str(tmp_path / "scope.json"), str(plots), profile_path


def _assert_self_contained(doc: str):
    assert "http://" not in doc
    assert "https://" not in doc
    # No leftover unfilled src placeholders.
    assert 'src="__' not in doc
    assert 'src=""' not in doc
    # Every img is a base64 data URI.
    assert "data:image/png;base64," in doc
    assert doc.count('<img') == doc.count('src="data:image/png;base64,')
    # Inline style, valid html shell.
    assert "<style>" in doc and "<!doctype html>" in doc.lower()


def test_full_report_is_self_contained(tmp_path):
    scope, plots, profile = _write_outputs(tmp_path, with_profile=True)
    doc = build_report(scope, plots, profile, None)
    _assert_self_contained(doc)
    # Headline + outcome rows present, including the non-standard status.
    assert "$15.00" in doc
    assert "agenda_provided_by_user" in doc
    assert "Pareto check" in doc
    # Three embedded charts.
    assert doc.count('src="data:image/png;base64,') == 3


def test_report_renders_without_milestone_data(tmp_path):
    scope, plots, profile = _write_outputs(tmp_path, with_profile=True, with_milestones=False)
    doc = build_report(scope, plots, profile, None)
    _assert_self_contained(doc)
    # No milestone section when the data is absent.
    assert "by milestone" not in doc
    # The footer caveat names the missing milestone attribution.
    assert "milestone" in doc.lower()


def test_report_with_milestones_renders_table(tmp_path):
    scope, plots, profile = _write_outputs(tmp_path, with_profile=True, with_milestones=True)
    doc = build_report(scope, plots, profile, None)
    _assert_self_contained(doc)
    assert "by milestone" in doc
    assert "setup" in doc and "work" in doc
    # The milestone heatmap is embedded too -> 4 charts.
    assert doc.count('src="data:image/png;base64,') == 4


def test_report_degrades_without_profile(tmp_path):
    scope, plots, _ = _write_outputs(tmp_path, with_profile=False)
    doc = build_report(scope, plots, None, None)
    _assert_self_contained(doc)
    # No outcome table without a profile, but the total card still renders.
    assert "What the cohort produced" not in doc
    assert "total cohort cost" in doc
    # The total must appear exactly once — not duplicated as both the lead card
    # and the fixed third card when profile is absent.
    assert doc.count("total cohort cost") == 1
    # Footer flags the missing profile.
    assert "no profile.json" in doc


def test_report_with_parquet_renders_drivers_block(tmp_path):
    import pandas as pd

    scope, plots, profile = _write_outputs(tmp_path, with_profile=True)
    # Two runs, three turns each; cache_read dominates tokens so cache_read_share
    # is well-defined and cost varies with turn count.
    turns = pd.DataFrame(
        {
            "run_id": ["r1", "r1", "r1", "r2", "r2"],
            "turn_idx": [0, 1, 2, 0, 1],
            "tokens": [1000, 1000, 1000, 1000, 1000],
            "cache_read": [900, 900, 900, 900, 900],
            "run_cost_usd": [14.5, 14.5, 14.5, 9.0, 9.0],
        }
    )
    parquet_path = str(tmp_path / "turns.parquet")
    turns.to_parquet(parquet_path)

    doc = build_report(scope, plots, profile, parquet_path)
    _assert_self_contained(doc)
    # The drivers-present prose renders the cache-read share sentence.
    assert "Cached-context reads are" in doc
    assert "90.0%" in doc
    assert "cache_read x turns" in doc
    # The footer must NOT flag the parquet as missing, since it was read.
    assert "parquet absent or unreadable" not in doc


def test_null_headline_shows_na(tmp_path):
    scope, plots, _ = _write_outputs(tmp_path, with_profile=True)
    # Rewrite the profile with a null headline value and zero delivered.
    profile = {
        "experiment_type": "synthetic_job",
        "status_field": "status",
        "success_status": "completed",
        "n_runs": 3,
        "outcome_counts": {"failed": 3},
        "headline": {"metric": "x", "value": None, "note": "per completed run"},
    }
    profile_path = os.path.join(os.path.dirname(scope), "profile.json")
    with open(profile_path, "w") as f:
        json.dump(profile, f)
    doc = build_report(scope, plots, profile_path, None)
    _assert_self_contained(doc)
    assert "n/a (0 delivered)" in doc
