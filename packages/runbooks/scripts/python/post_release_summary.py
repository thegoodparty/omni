"""Post a daily "shipped to prod" summary to #product-releases.

Source of truth is the `production` GitHub Environment's deployment history:
promote.yml records one successful Deployment per promotion. "What shipped in the
window" is the commit range between the prod SHA at the start of the window and
the prod SHA now — so a merged-but-not-yet-promoted commit, or a held/failed
promotion, is correctly excluded. The message has three parts: an AI-written
summary (ANTHROPIC_API_KEY), the ClickUp tickets, and the PRs — tickets and PRs
as bolded links. Degrades gracefully: a missing ANTHROPIC/ClickUp credential
drops that enrichment rather than failing the run.

Needs full git history (checkout fetch-depth: 0). Env: GH_TOKEN, GITHUB_REPOSITORY,
SLACK_BOT_TOKEN, ANTHROPIC_API_KEY (optional), CLICKUP_API_TOKEN (optional; the
ClickUp team id is hardcoded), RELEASE_PRODUCT_CHANNEL (default #product-releases),
RELEASE_WINDOW_HOURS (24).
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
PR_NUM_RE = re.compile(r"\(#(\d+)\)\s*$")
MERGE_RE = re.compile(r"^Merge pull request #(\d+)")
REPO = os.environ.get("GITHUB_REPOSITORY", "thegoodparty/omni")
CHANNEL = os.environ.get("RELEASE_PRODUCT_CHANNEL") or "#product-releases"
WINDOW_HOURS = int(os.environ.get("RELEASE_WINDOW_HOURS") or "24")
CLICKUP_TEAM_ID = "90132012119"  # GoodParty workspace; custom task ids resolve here


def gh_api(path: str):
    return json.loads(subprocess.check_output(["gh", "api", path], text=True))


def _parse_ts(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def successful_prod_deployments() -> list[tuple[str, datetime]]:
    """(sha, created_at) for successful `production` deployments, newest first."""
    deps = gh_api(f"repos/{REPO}/deployments?environment=production&per_page=100")
    out: list[tuple[str, datetime]] = []
    for d in deps:
        statuses = gh_api(f"repos/{REPO}/deployments/{d['id']}/statuses?per_page=1")
        if statuses and statuses[0].get("state") == "success":
            out.append((d["sha"], _parse_ts(d["created_at"])))
    return out


def shipped_pr_numbers(prev_sha: str | None, cur_sha: str) -> list[int]:
    """PR numbers merged in prev_sha..cur_sha (or the last window if no prev)."""
    if prev_sha:
        args = ["git", "log", f"{prev_sha}..{cur_sha}", "--pretty=%s"]
    else:
        args = ["git", "log", cur_sha, "--since", f"{WINDOW_HOURS} hours ago", "--pretty=%s"]
    subjects = subprocess.check_output(args, text=True)
    seen: set[int] = set()
    nums: list[int] = []
    for line in subjects.splitlines():
        m = PR_NUM_RE.search(line) or MERGE_RE.match(line)
        if m:
            n = int(m.group(1))
            if n not in seen:
                seen.add(n)
                nums.append(n)
    return nums


def pr_details(n: int) -> dict:
    pr = gh_api(f"repos/{REPO}/pulls/{n}")
    return {
        "number": pr["number"],
        "title": pr["title"],
        "url": pr["html_url"],
        "body": pr.get("body") or "",
        "headRefName": (pr.get("head") or {}).get("ref", ""),
    }


def tickets_for(pr: dict) -> set[str]:
    blob = " ".join([pr["title"], pr["body"], pr["headRefName"]])
    return {m.group(0).upper() for m in TICKET_RE.finditer(blob)}


def clickup_lookup(tag: str) -> tuple[str | None, str | None]:
    """(name, url) for a ClickUp custom task id, or (None, None) on any failure."""
    api_key = os.environ.get("CLICKUP_API_TOKEN")
    if not api_key:
        return None, None
    try:
        task = clickup_api.request(
            "GET", f"task/{tag}", api_key,
            params={"custom_task_ids": "true", "team_id": CLICKUP_TEAM_ID},
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


def slack_escape(s: str) -> str:
    # Slack mrkdwn link labels <url|label> close at a literal '>'; escape the
    # HTML-special chars so titles like "a -> b" or "A & B" don't break the link.
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main() -> None:
    deployments = successful_prod_deployments()
    if not deployments:
        print("No successful production deployments yet; nothing to post.")
        return

    current = deployments[0][0]
    cutoff = datetime.now(timezone.utc) - timedelta(hours=WINDOW_HOURS)
    previous = next((sha for sha, ts in deployments if ts < cutoff), None)
    if previous == current:
        print("No new production deployment in the window; nothing to post.")
        return
    if previous is None:
        # Every deployment is inside the window (e.g. first day). Diff against the
        # oldest recorded deployment, not a time-based git log which would include
        # merged-but-not-yet-promoted commits.
        if len(deployments) == 1:
            print("Only one deployment on record; nothing to diff against.")
            return
        previous = deployments[-1][0]

    nums = shipped_pr_numbers(previous, current)
    if not nums:
        print("No PRs in the shipped range; nothing to post.")
        return
    prs = [pr_details(n) for n in nums]

    tags: set[str] = set()
    for pr in prs:
        tags |= tickets_for(pr)
    tickets = {tag: clickup_lookup(tag) for tag in sorted(tags)}
    summary = ai_summary(prs, {tag: name for tag, (name, _) in tickets.items()})

    date_str = datetime.now(timezone.utc).astimezone().strftime("%b %-d, %Y")
    lines = [f"*Shipped to prod — {date_str}*", ""]
    if summary:
        lines += [slack_escape(summary), ""]

    if tickets:
        lines.append("*Tickets*")
        for tag, (name, url) in tickets.items():
            text = f"{tag}: {slack_escape(name)}" if name else tag
            lines.append(f"- <{url}|*{text}*>" if url else f"- *{text}*")
        lines.append("")

    lines.append("*Pull Requests*")
    for pr in prs:
        lines.append(f"- <{pr['url']}|*#{pr['number']}: {slack_escape(pr['title'])}*>")

    post_slack("\n".join(lines).strip())
    print(f"Posted release summary: {len(prs)} PR(s), {len(tickets)} ticket(s).")


if __name__ == "__main__":
    main()
