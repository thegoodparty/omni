"""Launch watch: daily outcome checks for recent launches, posting breaks to #bugs.

Each check in ``launch_watch.yaml`` asks whether a launch is doing what it shipped to do,
for a fixed watch period after it ships. Errors reach Sentry and Grafana, and broken
tracking reaches the event health monitor, but a launch can work without erroring and
still do nothing for users. The first check here is that kind: the SMS cutoff notice
went unseen for its whole first fortnight while 60 to 130 candidates a day past their
cutoff visited outreach, and no alert existed that could notice.

A check's SQL returns one row with ``exposed`` (users who should have triggered the
outcome in the window) and ``fired`` (users who did). It fails when at least
``min_exposed`` users were exposed and none fired. Too little exposure is not a finding.
The window is the ``window_days`` full Eastern days ending yesterday, passed to the SQL
as ``{window_start}`` and ``{window_end}`` (inclusive ISO dates).

Posting is stateless: a failing check posts only when the previous day's window did not
fail (or was outside the watch), so a break posts once, not every day it lasts.

Reads Databricks through ``databricks_oauth`` (GitHub OIDC in CI, your CLI profile
locally). Posts with ``SLACK_APP_BOT_TOKEN`` to ``SLACK_BUGS_CHANNEL_ID``; the bot must be
a member of that channel.

Usage:
    cd packages/runbooks/scripts/python
    uv run launch_watch.py --dry-run                     # print, post nothing
    uv run launch_watch.py --dry-run --as-of 2026-10-17 --ignore-watch-period
    uv run launch_watch.py                               # what the schedule runs
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Callable, Mapping
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import requests
import yaml

HERE = Path(__file__).resolve().parent
CHECKS_FILE = HERE / "launch_watch.yaml"
PR_URL = "https://github.com/thegoodparty/omni/pull/{}"
REQUIRED = (
    "id",
    "launch",
    "what",
    "prs",
    "active_from",
    "active_until",
    "window_days",
    "min_exposed",
    "sql",
)

Row = Mapping[str, Any]
Query = Callable[[str], Row]


def load_checks(path: Path = CHECKS_FILE) -> list[dict]:
    return (yaml.safe_load(path.read_text()) or {}).get("checks") or []


def validate(check: Mapping[str, Any]) -> None:
    missing = [k for k in REQUIRED if check.get(k) in (None, "", [])]
    if missing:
        raise ValueError(
            f"check {check.get('id', '?')} is missing {', '.join(missing)}"
        )


def _day(value: Any) -> date:
    return value if isinstance(value, date) else date.fromisoformat(str(value))


def window(check: Mapping[str, Any], as_of: date) -> tuple[date, date]:
    end = as_of - timedelta(days=1)
    return end - timedelta(days=int(check["window_days"]) - 1), end


def is_active(check: Mapping[str, Any], as_of: date) -> bool:
    end = window(check, as_of)[1]
    return _day(check["active_from"]) <= end <= _day(check["active_until"])


def render_sql(check: Mapping[str, Any], as_of: date) -> str:
    start, end = window(check, as_of)
    return (
        check["sql"]
        .replace("{window_start}", start.isoformat())
        .replace("{window_end}", end.isoformat())
    )


def evaluate(check: Mapping[str, Any], row: Row) -> str:
    exposed, fired = int(row.get("exposed") or 0), int(row.get("fired") or 0)
    if exposed < int(check["min_exposed"]):
        return "low_exposure"
    return "fail" if fired == 0 else "pass"


def run_check(
    check: Mapping[str, Any],
    as_of: date,
    query: Query,
    *,
    ignore_watch_period: bool = False,
) -> dict:
    if not ignore_watch_period and not is_active(check, as_of):
        return {"id": check["id"], "status": "inactive", "post": False}
    row = query(render_sql(check, as_of))
    status = evaluate(check, row)
    post = False
    if status == "fail":
        prev = as_of - timedelta(days=1)
        if ignore_watch_period or is_active(check, prev):
            post = evaluate(check, query(render_sql(check, prev))) != "fail"
        else:
            post = True
    return {
        "id": check["id"],
        "status": status,
        "post": post,
        "exposed": int(row.get("exposed") or 0),
        "fired": int(row.get("fired") or 0),
        "window": window(check, as_of),
    }


def message(check: Mapping[str, Any], result: Mapping[str, Any]) -> str:
    start, end = result["window"]
    prs = ", ".join(f"<{PR_URL.format(n)}|#{n}>" for n in check["prs"])
    exposed_label = check.get("exposed_label") or "users were exposed"
    fired_label = check.get("fired_label") or "triggered it"
    lines = [
        f":rotating_light: *Launch watch: {check['launch']}*",
        f"Expected: {check['what']}.",
        (
            f"Seen {start:%b %-d} to {end:%b %-d} (ET): {result['exposed']} {exposed_label} "
            f"and {result['fired']} {fired_label}."
        ),
        f"Shipped in {prs}. Nothing errors, so Sentry and Grafana will not show this.",
    ]
    if check.get("notes"):
        lines.append(str(check["notes"]).strip())
    lines.append(
        f"_Check `{check['id']}` in packages/runbooks/scripts/python/launch_watch.yaml_"
    )
    return "\n".join(lines)


def post_to_slack(text: str, *, token: str, channel: str) -> None:
    resp = requests.post(
        "https://slack.com/api/chat.postMessage",
        headers={"Authorization": f"Bearer {token}"},
        json={"channel": channel, "text": text, "unfurl_links": False},
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    if not body.get("ok"):
        raise RuntimeError(f"Slack refused the post: {body.get('error')}")


def _databricks_query(sql: str) -> Row:
    import databricks_oauth as dbc

    df = dbc.run_query(sql)
    if len(df) != 1:
        raise RuntimeError(f"a launch-watch query must return one row, got {len(df)}")
    return df.iloc[0].to_dict()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    ap.add_argument("--check", help="run one check by id")
    ap.add_argument(
        "--dry-run", action="store_true", help="print findings, post nothing"
    )
    ap.add_argument(
        "--ignore-watch-period",
        action="store_true",
        help="backtest outside active_from/active_until",
    )
    args = ap.parse_args(argv)

    checks = [c for c in load_checks() if not args.check or c["id"] == args.check]
    if args.check and not checks:
        print(f"no check named {args.check}", file=sys.stderr)
        return 2
    for check in checks:
        validate(check)

    token, channel = (
        os.environ.get("SLACK_APP_BOT_TOKEN"),
        os.environ.get("SLACK_BUGS_CHANNEL_ID"),
    )
    if not args.dry_run and not (token and channel):
        print(
            "SLACK_APP_BOT_TOKEN and SLACK_BUGS_CHANNEL_ID are required unless --dry-run",
            file=sys.stderr,
        )
        return 2

    errors = 0
    for check in checks:
        try:
            result = run_check(
                check,
                args.as_of,
                _databricks_query,
                ignore_watch_period=args.ignore_watch_period,
            )
        except Exception as exc:  # noqa: BLE001 - one broken check must not hide the others
            errors += 1
            print(f"{check['id']}: error: {exc}", file=sys.stderr)
            continue
        print(
            f"{check['id']}: {result['status']} exposed={result.get('exposed', '-')} "
            f"fired={result.get('fired', '-')} post={result['post']}"
        )
        if result["post"]:
            text = message(check, result)
            if args.dry_run:
                print(text)
            else:
                post_to_slack(text, token=token, channel=channel)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
