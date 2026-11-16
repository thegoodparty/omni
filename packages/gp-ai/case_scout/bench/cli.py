"""`uv run python -m case_scout.bench`: see README.md beside this file."""

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from case_scout.bench.cost import estimate_after, estimate_before
from case_scout.bench.judge_loader import JUDGE_CASES_DIR
from case_scout.bench.loader import FIXTURES_DIR, BenchFixture, load_fixtures
from case_scout.bench.report import render_report
from case_scout.bench.runner import FAIL, BenchRun, real_calls, run_bench
from case_scout.bench.stubs import label_echo_calls
from case_scout.bucket import CaseScoutBucket

BENCH_BUCKET = "case-scout-bench"
_REGION = "us-west-2"
LIVE_COMMAND = "uv run python -m case_scout.bench --live"


def build_results(run: BenchRun, mode: str, out_dir: Path, created_at: datetime) -> dict[str, Any]:
    results = run.results
    by_category: dict[str, dict[str, int]] = {}
    check_failures: dict[str, int] = {}
    for r in results:
        bucket = by_category.setdefault(r["category"], {"fixtures": 0, "passed": 0})
        bucket["fixtures"] += 1
        bucket["passed"] += int(r["passed"])
        for name, check in r["checks"].items():
            if check["status"] == FAIL:
                check_failures[name] = check_failures.get(name, 0) + 1
    cost = estimate_after(run.recorder)
    if mode == "stub":
        cost = {**cost, "estimatedUsd": 0.0, "estimatedUsdByStage": {}}
    return {
        "runId": run.run_id,
        "createdAt": created_at.isoformat(),
        "mode": mode,
        "outDir": str(out_dir),
        "cost": cost,
        "summary": {
            "fixtures": len(results),
            "fixturesPassed": sum(1 for r in results if r["passed"]),
            "drafts": sum(1 for r in results if r["case"]),
            "byCategory": by_category,
            "checkFailures": check_failures,
        },
        "scoringErrors": list(run.night.scoring_errors),
        "fixtures": results,
    }


def write_outputs(results: dict[str, Any], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "results.json").write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n")
    (out_dir / "report.html").write_text(render_report(results))


class GradeEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    faithful: Literal[1, 2, 3] | None = None
    gradeable: Literal[1, 2, 3] | None = None
    fictional: Literal[1, 2, 3] | None = None
    note: str = ""


class GradesFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    runId: str
    grades: dict[str, GradeEntry]


def merge_grades(results: dict[str, Any], grades: GradesFile) -> dict[str, Any]:
    if grades.runId != results["runId"]:
        raise ValueError(f"grades are for run {grades.runId}, results are for run {results['runId']}")
    by_id = {f["id"]: f for f in results["fixtures"]}
    unknown = sorted(set(grades.grades) - set(by_id))
    if unknown:
        raise ValueError(f"grades name fixtures this run does not have: {unknown}")
    for fixture_id, entry in grades.grades.items():
        by_id[fixture_id]["grades"] = entry.model_dump()

    drafted = [f for f in results["fixtures"] if f["case"]]
    complete = [
        f for f in drafted if all(f["grades"].get(d) is not None for d in ("faithful", "gradeable", "fictional"))
    ]
    perfect = [f for f in complete if all(f["grades"][d] == 3 for d in ("faithful", "gradeable", "fictional"))]
    results["gradeSummary"] = {
        "drafts": len(drafted),
        "graded": len(complete),
        "allThrees": len(perfect),
        "allThreesShare": round(len(perfect) / len(complete), 3) if complete else None,
    }
    return results


def _grade(run_dir: Path, grades_path: Path) -> int:
    results_path = run_dir / "results.json"
    results = json.loads(results_path.read_text())
    try:
        grades = GradesFile(**json.loads(grades_path.read_text()))
        merge_grades(results, grades)
    except (ValidationError, ValueError) as e:
        print(f"could not merge grades: {e}", file=sys.stderr)
        return 1
    write_outputs(results, run_dir)
    s = results["gradeSummary"]
    print(f"merged grades into {results_path}: {s['graded']} of {s['drafts']} drafts graded, {s['allThrees']} at 3/3/3")
    return 0


def _print_estimate(fixtures: list[BenchFixture], cases_dir: Path) -> None:
    estimate = estimate_before(fixtures, cases_dir)
    print(f"{len(fixtures)} fixtures, model {estimate.model}")
    print(
        f"estimated cost of a live run: about ${estimate.expected_usd:.2f} "
        f"({estimate.expected_calls['score']} score, {estimate.expected_calls['draft']} draft, "
        f"{estimate.expected_calls['gate']} gate calls), at most ${estimate.worst_usd:.2f} if every covered "
        "fixture is drafted and every call retries once"
    )


def _run(args: argparse.Namespace) -> int:
    fixtures = load_fixtures(Path(args.fixtures))
    cases_dir = Path(args.cases_dir)
    _print_estimate(fixtures, cases_dir)

    if args.live and args.stub:
        print("pass --live or --stub, not both", file=sys.stderr)
        return 2
    if not args.live and not args.stub:
        print(
            "refusing to run: a bench run makes real, paid Anthropic calls. Get approval for the cost above, "
            f"then run:\n  {LIVE_COMMAND}\nor preview the report for free with --stub.",
            file=sys.stderr,
        )
        return 2
    if args.live and not os.environ.get("ANTHROPIC_API_KEY"):
        print("--live needs ANTHROPIC_API_KEY set in this shell", file=sys.stderr)
        return 2

    if args.live:
        score_inner, draft_inner, second_read_inner = real_calls()
    else:
        score_inner, draft_inner, second_read_inner = label_echo_calls(fixtures)

    created_at = datetime.now(UTC)
    run_id = created_at.strftime("%Y%m%dT%H%M%SZ")
    out_dir = Path(args.out_dir) / run_id

    import boto3
    from moto import mock_aws

    with mock_aws():
        s3 = boto3.client("s3", region_name=_REGION)
        s3.create_bucket(Bucket=BENCH_BUCKET, CreateBucketConfiguration={"LocationConstraint": _REGION})
        run = run_bench(
            fixtures,
            CaseScoutBucket(BENCH_BUCKET, s3_client=s3),
            now=created_at,
            run_id=run_id,
            score_inner=score_inner,
            draft_inner=draft_inner,
            second_read_inner=second_read_inner,
            cases_dir=cases_dir,
        )

    results = build_results(run, "live" if args.live else "stub", out_dir, created_at)
    write_outputs(results, out_dir)
    s = results["summary"]
    print(f"{s['fixturesPassed']} of {s['fixtures']} fixtures passed every automatic check, {s['drafts']} drafts")
    if s["checkFailures"]:
        print(f"failed checks: {s['checkFailures']}")
    print(
        f"estimated spend: ${results['cost']['estimatedUsd']:.2f}"
        if args.live
        else "stub run: nothing spent, and the results say nothing about the scout's quality"
    )
    print(f"wrote {out_dir / 'results.json'} and {out_dir / 'report.html'}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m case_scout.bench", description="The case scout's quality bench.")
    parser.add_argument("--live", action="store_true", help="make the real, paid Anthropic calls")
    parser.add_argument("--stub", action="store_true", help="answer every call from the fixture labels, for free")
    parser.add_argument("--out-dir", default="bench-out", help="where runs are written (default: bench-out)")
    parser.add_argument("--fixtures", default=str(FIXTURES_DIR), help=argparse.SUPPRESS)
    parser.add_argument("--cases-dir", default=str(JUDGE_CASES_DIR), help=argparse.SUPPRESS)
    parser.add_argument(
        "--grade",
        nargs=2,
        metavar=("RUN_DIR", "GRADES_JSON"),
        help="merge grades exported from a run's report.html into its results.json",
    )
    args = parser.parse_args(argv)
    if args.grade:
        return _grade(Path(args.grade[0]), Path(args.grade[1]))
    return _run(args)
