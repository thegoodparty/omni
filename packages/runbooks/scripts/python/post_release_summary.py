"""Post a daily "shipped to prod" summary to #product-releases.

Under automated promotion, main auto-ships to prod on green, so "what shipped"
is approximated by the PRs merged to main in the last window (default 24h). The
message has three parts: an AI-written summary (ANTHROPIC_API_KEY), the ClickUp
tickets included (bolded links), and the PRs included (bolded links). Degrades
gracefully: a missing ANTHROPIC/ClickUp credential drops that enrichment rather
than failing the run.

Env: GH_TOKEN (or gh auth), GITHUB_REPOSITORY, SLACK_BOT_TOKEN,
ANTHROPIC_API_KEY (optional), CLICKUP_API_TOKEN + CLICKUP_TEAM_ID (optional),
RELEASE_PRODUCT_CHANNEL (default #product-releases), RELEASE_WINDOW_HOURS (24).
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import requests

import clickup_api

TICKET_RE = re.compile(r"(?:ENG|DATA|WEB|CAP|DT)-\d+", re.IGNORECASE)
REPO = os.environ.get("GITHUB_REPOSITORY", "thegoodparty/omni")
# `or` (not a get default): CI passes these as possibly-empty env vars, and an
# empty string must fall back, not be used verbatim.
CHANNEL = os.environ.get("RELEASE_PRODUCT_CHANNEL") or "#product-releases"
WINDOW_HOURS = int(os.environ.get("RELEASE_WINDOW_HOURS") or "24")


def merged_prs() -> list[dict]:
    """PRs merged into main within the window, newest first."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=WINDOW_HOURS)
    # gh search granularity is a date, so search from the cutoff's day and then
    # filter to the exact cutoff below.
    since_day = cutoff.date().isoformat()
    out = subprocess.check_output(
        [
            "gh", "pr", "list", "--repo", REPO, "--state", "merged",
            "--base", "main", "--limit", "200",
            "--search", f"merged:>={since_day}",
            "--json", "number,title,url,mergedAt,headRefName,body",
        ],
        text=True,
    )
    prs = json.loads(out)
    fresh = [p for p in prs if datetime.fromisoformat(p["mergedAt"]) >= cutoff]
    fresh.sort(key=lambda p: p["mergedAt"], reverse=True)
    return fresh


def tickets_for(pr: dict) -> set[str]:
    blob = " ".join([pr.get("title", ""), pr.get("body") or "", pr.get("headRefName", "")])
    return {m.group(0).upper() for m in TICKET_RE.finditer(blob)}


def clickup_lookup(tag: str) -> tuple[str | None, str | None]:
    """(name, url) for a ClickUp custom task id, or (None, None) on any failure."""
    api_key = os.environ.get("CLICKUP_API_TOKEN")
    team_id = os.environ.get("CLICKUP_TEAM_ID")
    if not api_key or not team_id:
        return None, None
    try:
        task = clickup_api.request(
            "GET", f"task/{tag}", api_key,
            params={"custom_task_ids": "true", "team_id": team_id},
        )
        return task.get("name"), task.get("url")
    except Exception as exc:  # noqa: BLE001 - enrichment only, never fatal
        print(f"clickup: lookup for {tag} failed ({exc})", file=sys.stderr)
        return None, None


def ai_summary(prs: list[dict], ticket_titles: dict[str, str | None]) -> str | None:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    from anthropic import Anthropic

    pr_lines = "\n".join(f"- {p['title']} ({p['url']})" for p in prs)
    tix_lines = "\n".join(f"- {tag}: {name}" for tag, name in ticket_titles.items() if name)
    prompt = (
        "Write a 2-3 sentence, plain-language summary of what shipped to "
        "production, grouped by theme, for a #product-releases Slack post. "
        "Respond with only the paragraph — no preamble, no bullet points, no "
        "headers.\n\nPull requests:\n" + pr_lines
    )
    if tix_lines:
        prompt += "\n\nTickets:\n" + tix_lines
    try:
        resp = Anthropic().messages.create(
            model="claude-opus-5",
            max_tokens=1024,
            # Disable thinking: this is a plain summarization, and on opus-5
            # adaptive thinking is on by default and counts toward max_tokens,
            # which would starve the actual summary text.
            thinking={"type": "disabled"},
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(b.text for b in resp.content if b.type == "text").strip() or None
    except Exception as exc:  # noqa: BLE001 - enrichment only, never fatal
        print(f"anthropic: summary failed ({exc})", file=sys.stderr)
        return None


def post_slack(text: str) -> None:
    resp = requests.post(
        "https://slack.com/api/chat.postMessage",
        headers={
            "Authorization": f"Bearer {os.environ['SLACK_BOT_TOKEN']}",
            "Content-Type": "application/json; charset=utf-8",
        },
        json={"channel": CHANNEL, "text": text, "unfurl_links": False, "unfurl_media": False},
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    if not body.get("ok"):
        raise RuntimeError(f"Slack chat.postMessage failed: {body.get('error', 'unknown')}")


def main() -> None:
    prs = merged_prs()
    if not prs:
        print("No PRs merged in the window; nothing to post.")
        return

    tags: set[str] = set()
    for pr in prs:
        tags |= tickets_for(pr)
    tickets = {tag: clickup_lookup(tag) for tag in sorted(tags)}
    summary = ai_summary(prs, {tag: name for tag, (name, _) in tickets.items()})

    date_str = datetime.now(timezone.utc).astimezone().strftime("%b %-d, %Y")
    lines = [f"*Shipped to prod — {date_str}*", ""]
    if summary:
        lines += [summary, ""]

    if tickets:
        lines.append("*Tickets*")
        for tag, (name, url) in tickets.items():
            label = f"<{url}|*{tag}*>" if url else f"*{tag}*"
            lines.append(f"• {label}" + (f": {name}" if name else ""))
        lines.append("")

    lines.append("*PRs*")
    for pr in prs:
        lines.append(f"• <{pr['url']}|*#{pr['number']}*>: {pr['title']}")

    post_slack("\n".join(lines).strip())
    print(f"Posted release summary: {len(prs)} PR(s), {len(tickets)} ticket(s).")


if __name__ == "__main__":
    main()
