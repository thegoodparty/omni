"""Render the Monday message that says whether gpbot did its job last week.

WHY THIS EXISTS: the worst thing this system has done was not a bad fix. It went
silent from 2026-07-31 to 2026-08-14 — 26 tagged tickets, 3 analyzed — while
every dashboard read healthy, because nothing was watching the one number that
would have shown it. There is still no alarm for "the bot stopped looking at
bugs"; the Lambda error alarm needs the Lambda to run, and a webhook ClickUp has
suspended produces no logs to alarm on.

So the headline is COVERAGE — every bug tagged `gpbot-analyze` last week versus
the ones that actually got an analysis, with the misses named — and not merges.
Leading with merges would misprice the product and invite gaming: the bot's main
output is a written root cause, `escalation.py` deliberately opens a PR only on a
`fix` verdict, and a merged-PR scorecard grades a correct week near zero.

THREE THINGS THIS DELIBERATELY DOES NOT DO:

It never computes a percentage. This system has produced three genuinely
autonomous bug-fix PRs. A rate over that base is noise dressed as a measurement,
and once a percentage is in a Slack message it gets quoted in meetings.

It never estimates engineering time saved. The arithmetic needs a per-ticket
human diagnosis time, which nobody records, and the resulting range spans 4x. A
weekly message that restarts an argument about its own inputs is a message
people stop reading.

It never stays quiet. `gpbot-stale-pr-alert.yml` is silent when it finds nothing
and that is right for a nag, but silence here would be indistinguishable from the
job being broken — which is this system's signature failure mode. A quiet week
posts and says it was quiet.

A SOURCE THAT FAILED MUST SAY SO RATHER THAN READ ZERO. If CloudWatch is
unreachable the cost line reads "unavailable"; it never reads "$0". "0 missed" on
a coverage check that never ran is an actively false claim about the thing this
message exists to report, and it is the one output that would be worse than not
posting at all.

Pure functions over JSON, no network and no clients, on the same contract as
ci_triage.py: `.github/workflows/gpbot-weekly-digest.yml` gathers the facts from
ClickUp, GitHub and CloudWatch, and every judgement about what they mean is made
here where clickup_bot/tests/test_weekly_digest.py can pin it against captured
response shapes.
"""

import json
import statistics
import sys
import time
from datetime import UTC, datetime
from typing import Any

# The tag that defines the denominator. A bug carrying it is a bug the system
# promised to look at, which is why coverage is measured against this and not
# against "bugs filed" — tagging is somebody else's job and is currently ~100%.
ANALYZE_TAG = "gpbot-analyze"

# How the bot signs everything it says on a ticket.
BOT_PREFIX = "[GP-Bot]"

# ...and the two things it says that are NOT an analysis. Counting either as
# coverage would be self-certifying: `Processing started` is posted by the
# Lambda the moment a Fargate task launches, so a run that then crashed, hit its
# budget ceiling or was killed at its deadline would report as an analyzed
# ticket, at a latency of a few seconds. That is precisely the failure the
# coverage number exists to catch.
NON_ANALYSIS_COMMENT_PREFIXES = (
    f"{BOT_PREFIX} Processing started",
    f"{BOT_PREFIX} Failed to start processing",
)

# The two signals that identify a bot PR, matched the same way as
# gpbot-ci-drive.yml and gpbot-pr-triage.yml: the title comes from the agent's
# `gh` call and the branch from its git commands, and either alone has been
# wrong before.
BOT_PR_TITLE_PREFIX = "[GP-Bot]"
BOT_PR_BRANCH_MARKER = "/gp-bot_"

# Reviews from these accounts are not human attention. delegate reviews every
# bot PR automatically, so counting it would mean no PR is ever reported as
# waiting on a human — the warning would be permanently absent, which reads
# identical to everything being fine. Compared after lowercasing and stripping a
# trailing "[bot]", because the same account is `cursor` over GraphQL and
# `cursor[bot]` over REST.
BOT_REVIEWERS = frozenset({"delegate-reviewer", "cursor"})

# When an open bot PR starts counting as waiting on a human. Matches
# gpbot-stale-pr-alert.yml's STALE_HOURS so the two cannot disagree in the same
# channel about whether a PR is stale.
STALE_HOURS = 48

# How many missed tickets are named before the line is summarised. The point of
# naming them is that somebody can go and re-tag one, which nobody does from a
# wall of twenty-three links — and twenty-three is the real number this hit
# during the outage. Past this the count still tells the truth and the ticket
# list is a query away.
MAX_NAMED_MISSES = 8

# Verdicts, in the order the analyze prompt offers them. Kept as a tuple rather
# than derived from the data so a week with no `needs-human` still prints
# `0 needs-human`: a verdict that silently stops appearing is a parser drifting
# away from the prompt, and it would otherwise look like the bot simply never
# reached that conclusion.
VERDICTS = ("fix", "no-code-change", "needs-human")

# The two verdicts that mean a human did not have to diagnose the ticket. This
# is the closest thing to a direct value measurement the system produces, and it
# is reported as a count of tickets rather than as a rate.
DEFLECTING_VERDICTS = ("no-code-change", "needs-human")

# What a run's structured line looks like. Written by
# engineer_agent/agent/metrics.py; see that module for why it exists at all.
METRIC_PREFIX = "GPBOT_METRIC"

# Exit code for "the message is on stdout, but at least one source could not be
# read". The workflow posts the message either way and then goes red, because a
# digest assembled from two sources out of three is still worth having and the
# gap still needs someone to look at it.
EXIT_DEGRADED = 2


def _epoch_from_clickup(value: Any) -> float | None:
    """ClickUp's millisecond epoch, which it sends as a STRING."""
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    try:
        return float(value) / 1000.0
    except (TypeError, ValueError):
        return None


def _epoch_from_iso(value: Any) -> float | None:
    """GitHub's ISO-8601, whose trailing `Z` datetime.fromisoformat rejected
    until 3.11 and which still has to survive a null (an unmerged PR's
    `mergedAt`)."""
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def comment_text(comment: Any) -> str:
    """The text of one ClickUp comment, both ways ClickUp sends it.

    SHAPE CONTRACT, and it has already cost us a production incident: the real
    `GET /task/{id}/comment` response carries the full text in a top-level
    `comment_text` field, while the `comment[]` items carry fragments with no
    `type` key. A matcher that required `type == "text"` matched 0 of 13 real
    comments in the 2026-07-14 incident and dedup never fired once.

    Same rules as the handler's twin (`has_processing_started_comment`):
    `comment_text` is trusted only when it is a non-empty string, and any
    non-string fragment contributes "" rather than raising — ClickUp does ship
    `"text": null`.
    """
    if not isinstance(comment, dict):
        return ""
    text = comment.get("comment_text")
    if isinstance(text, str) and text:
        return text
    return "".join(
        item["text"] if isinstance(item, dict) and isinstance(item.get("text"), str) else ""
        for item in (comment.get("comment") if isinstance(comment.get("comment"), list) else [])
    )


def analysis_posted_at(comments: Any) -> float | None:
    """When the bot posted an actual analysis on this ticket, if it ever did.

    EARLIEST, not latest. A ticket can collect several bot comments — an
    analysis, then a PR link, then a CI-drive note — and latency is measured to
    the first thing a human could have read.
    """
    timestamps = []
    for comment in comments if isinstance(comments, list) else []:
        text = comment_text(comment).lstrip()
        if not text.startswith(BOT_PREFIX):
            continue
        if text.startswith(NON_ANALYSIS_COMMENT_PREFIXES):
            continue
        posted = _epoch_from_clickup(comment.get("date") if isinstance(comment, dict) else None)
        if posted is not None:
            timestamps.append(posted)
    return min(timestamps) if timestamps else None


def _ticket_name(ticket: dict) -> str:
    custom_id = ticket.get("custom_id")
    if isinstance(custom_id, str) and custom_id:
        return custom_id
    task_id = ticket.get("id")
    return task_id if isinstance(task_id, str) and task_id else "(unidentified ticket)"


def coverage(tickets: Any) -> dict:
    """Did every bug reported last week actually get looked at, and how fast.

    The denominator is tickets CREATED in the window, which the workflow has
    already filtered on. Bucketing by creation date rather than by analysis date
    is what makes consecutive weeks comparable, and it is the only bucketing
    under which a ticket nobody analyzed appears anywhere at all.

    THE ANALYSIS IS NOT REQUIRED TO FALL INSIDE THE WINDOW. A Sunday-night bug
    analyzed on Monday morning is covered, not missed: the question this number
    answers is whether the bug was looked at, and a calendar boundary is not a
    failure. It costs a small amount of accuracy at the edge of the week and
    buys a number that never reports a working system as broken.

    Anything other than a list means the ClickUp call did not happen, which is
    reported as unavailable rather than as a clean sheet.
    """
    if not isinstance(tickets, list):
        return {"available": False}

    analyzed, missed, latencies = 0, [], []
    for ticket in tickets:
        if not isinstance(ticket, dict):
            continue
        posted = analysis_posted_at(ticket.get("comments"))
        if posted is None:
            missed.append({"name": _ticket_name(ticket), "url": ticket.get("url")})
            continue
        analyzed += 1
        created = _epoch_from_clickup(ticket.get("date_created"))
        # A negative latency is a clock disagreement between ClickUp's two
        # timestamps, not a comment that predates its ticket. Dropping it keeps
        # one impossible number out of the median rather than out of coverage.
        if created is not None and posted >= created:
            latencies.append((posted - created) / 60.0)

    return {
        "available": True,
        "tagged": sum(1 for t in tickets if isinstance(t, dict)),
        "analyzed": analyzed,
        "missed": missed,
        # None rather than 0 when nothing was analyzed: "median 0.0 min" is a
        # claim of instant service on a week where the bot did nothing.
        "median_latency_min": round(statistics.median(latencies), 1) if latencies else None,
    }


def _metric_records(runs: Any) -> list[dict]:
    """The parsed GPBOT_METRIC lines, from whatever shape the query returned.

    Accepts CloudWatch's own event objects and bare message strings, because
    `filter-log-events` returns the first and `--query 'events[].message'`
    returns the second, and which one the workflow hands over should not be able
    to silently zero the cost line.

    A line that does not parse is dropped rather than raised on: one malformed
    message must not cost the whole week's runs. The count of what survived is
    reported beside the numbers, so a systematic parse failure shows up as a run
    count that disagrees with the analyses ClickUp can see.
    """
    records = []
    for event in runs if isinstance(runs, list) else []:
        message = event if isinstance(event, str) else event.get("message") if isinstance(event, dict) else None
        if not isinstance(message, str):
            continue
        _, marker, body = message.partition(METRIC_PREFIX)
        if not marker:
            continue
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            records.append(parsed)
    return records


def verdicts(runs: Any) -> dict:
    """What the analyses concluded, and how many tickets that kept off the queue.

    `no_verdict` is counted and reported because it is alarm-worthy rather than
    merely uninteresting: the analyze prompt requires the line, so a run that
    produced none means the prompt and `escalation.py`'s parser have drifted
    apart — and that failure silently stops every escalation while looking like
    a week of quiet tickets.
    """
    if not isinstance(runs, list):
        return {"available": False}

    records = _metric_records(runs)
    counts = dict.fromkeys(VERDICTS, 0)
    no_verdict = 0
    for record in records:
        verdict = record.get("verdict")
        if verdict in counts:
            counts[verdict] += 1
        elif record.get("label") == "analyze" and record.get("status") == "success":
            # Only a run that finished counts as a missing verdict. An errored or
            # deadline-killed run has an obvious reason for having none, and
            # lumping the two together would bury the case that needs looking at.
            no_verdict += 1

    return {
        "available": True,
        "counts": counts,
        "deflected": sum(counts[verdict] for verdict in DEFLECTING_VERDICTS),
        "no_verdict": no_verdict,
    }


def cost(runs: Any) -> dict:
    """What the week cost, and what one analysis costs.

    The median is per ANALYSIS rather than per run. Implement runs are several
    times more expensive and there are far fewer of them, so a blended median
    describes nothing that happens and moves with the escalation rate rather
    than with the price of anything.

    `unpriced` is reported because `cost_usd` is null when a run did not record
    one, and a total silently summed around those understates the week with
    nothing to say so.
    """
    if not isinstance(runs, list):
        return {"available": False}

    records = _metric_records(runs)
    total, unpriced, analysis_costs = 0.0, 0, []
    for record in records:
        value = record.get("cost_usd")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            unpriced += 1
            continue
        total += float(value)
        if record.get("label") == "analyze":
            analysis_costs.append(float(value))

    return {
        "available": True,
        "runs": len(records),
        "total_usd": round(total, 2),
        "median_analysis_usd": round(statistics.median(analysis_costs), 2) if analysis_costs else None,
        "unpriced": unpriced,
    }


def is_bot_pr(pr: Any) -> bool:
    if not isinstance(pr, dict):
        return False
    title = pr.get("title")
    branch = pr.get("headRefName")
    return (isinstance(title, str) and title.startswith(BOT_PR_TITLE_PREFIX)) or (
        isinstance(branch, str) and BOT_PR_BRANCH_MARKER in branch
    )


def has_human_review(pr: Any) -> bool:
    """Whether a person has reviewed this PR.

    A review whose author login is missing does NOT count as human attention.
    GitHub reports a deleted account's login as null, and reading that as a
    human would quietly drop the PR from the warning — the exact miss this line
    exists to catch. gpbot-stale-pr-alert.yml's jq carries the same guard for
    the same reason.
    """
    reviews = pr.get("reviews") if isinstance(pr, dict) else None
    for review in reviews if isinstance(reviews, list) else []:
        author = review.get("author") if isinstance(review, dict) else None
        login = author.get("login") if isinstance(author, dict) else None
        if not isinstance(login, str) or not login:
            continue
        if login.strip().lower().removesuffix("[bot]") not in BOT_REVIEWERS:
            return True
    return False


def pull_requests(prs: Any, start: float, end: float, now: float) -> dict:
    """What happened to the bot's PRs, as raw counts.

    RAW COUNTS, NEVER A RATE. Three autonomous PRs is not a base anyone can
    compute a merge rate on, and the archived gp-webapp repo — 22 bot PRs, 10 of
    them still open and now dead — is the evidence that the constraint is human
    review capacity rather than bot output. A percentage would describe the bot;
    the counts describe the queue.

    The stale warning is deliberately NOT windowed. A PR opened three weeks ago
    that nobody has reviewed is the thing worth saying today, and confining it to
    last week's PRs would drop it from the message on exactly the weeks it
    matters most.
    """
    if not isinstance(prs, list):
        return {"available": False}

    bot_prs = [pr for pr in prs if is_bot_pr(pr)]
    stale_cutoff = now - STALE_HOURS * 3600

    def within(value: Any) -> bool:
        moment = _epoch_from_iso(value)
        return moment is not None and start <= moment < end

    def old_enough_to_be_stale(pr: dict) -> bool:
        # An unreadable createdAt counts as old, which is the same direction
        # gpbot-stale-pr-alert.yml's jq takes (a null sorts below the cutoff
        # string and stays in the alert). Naming a PR that turns out to be fresh
        # costs a glance; dropping one because a date did not parse is the miss
        # the warning exists to prevent.
        created = _epoch_from_iso(pr.get("createdAt"))
        return created is None or created <= stale_cutoff

    # An unmerged close is counted as its own thing rather than folded into
    # "closed": closing a weak bot PR is a perfectly good outcome and a decision
    # somebody made, while a merge is a different claim entirely.
    closed_unmerged = [
        pr for pr in bot_prs if within(pr.get("closedAt")) and _epoch_from_iso(pr.get("mergedAt")) is None
    ]
    stale = [
        pr
        for pr in bot_prs
        if str(pr.get("state", "")).upper() == "OPEN" and old_enough_to_be_stale(pr) and not has_human_review(pr)
    ]

    return {
        "available": True,
        "opened": sum(1 for pr in bot_prs if within(pr.get("createdAt"))),
        "merged": sum(1 for pr in bot_prs if within(pr.get("mergedAt"))),
        "closed_unmerged": len(closed_unmerged),
        "stale": [{"number": pr.get("number"), "url": pr.get("url")} for pr in stale],
    }


def _window(payload: dict) -> tuple[float, float]:
    """The half-open [start, end) instants the digest reports on.

    RAISED ON RATHER THAN DEFAULTED. Every other bad input here degrades to
    "unavailable", but a digest with a guessed window would silently report the
    wrong seven days — and it would look completely normal, which is the one
    thing worse than not posting.
    """
    window = payload.get("window") if isinstance(payload.get("window"), dict) else {}
    start = _epoch_from_iso(window.get("start"))
    end = _epoch_from_iso(window.get("end"))
    if start is None or end is None or end <= start:
        raise ValueError("window.start and window.end must be ISO-8601 instants with end after start")
    return start, end


def summarize(payload: Any, now: float | None = None) -> dict:
    """Every fact the message states, with each source's availability attached.

    `now` is injected so the staleness threshold is exercised at a fixed instant
    by tests rather than by whatever the clock says when the suite runs.
    """
    if not isinstance(payload, dict):
        raise ValueError("digest input must be a JSON object")
    start, end = _window(payload)
    now = time.time() if now is None else now

    return {
        "start": start,
        "end": end,
        "coverage": coverage(payload.get("tickets")),
        "verdicts": verdicts(payload.get("runs")),
        "cost": cost(payload.get("runs")),
        "prs": pull_requests(payload.get("prs"), start, end, now),
    }


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def _link(url: Any, label: str) -> str:
    return f"<{url}|{label}>" if isinstance(url, str) and url else label


def _coverage_line(facts: dict) -> str:
    if not facts.get("available"):
        # Named explicitly rather than left as a gap. This is the headline
        # number, so a reader must be told it is absent instead of inferring it
        # from a short message.
        return "Coverage: *unavailable* — could not read tagged tickets from ClickUp."

    tagged, analyzed = facts["tagged"], facts["analyzed"]
    if tagged == 0:
        # A quiet week still posts, and says which quiet it was. "0 of 0
        # analyzed" reads like a broken query; "nothing was tagged" is a fact
        # about the inbox, and if it is wrong the person reading knows it
        # immediately.
        return f"Coverage: no bugs were tagged `{ANALYZE_TAG}` this week."

    line = f"Coverage: {analyzed} of {_plural(tagged, 'tagged bug')} analyzed"
    missed = facts["missed"]
    if not missed:
        return line
    named = ", ".join(_link(m["url"], m["name"]) for m in missed[:MAX_NAMED_MISSES])
    overflow = "" if len(missed) <= MAX_NAMED_MISSES else f", +{len(missed) - MAX_NAMED_MISSES} more"
    return f"{line} — *{len(missed)} missed*: {named}{overflow}"


def _latency_line(facts: dict) -> str | None:
    if not facts.get("available") or facts.get("median_latency_min") is None:
        return None
    # Median, not mean. Two tickets that hit the tag-in-create-call race sat for
    # ~2.7 days and would drag a mean into meaninglessness; the median describes
    # what a bug reported this morning can expect.
    return f"Median time to analysis: {facts['median_latency_min']} min"


def _verdict_line(facts: dict) -> str:
    if not facts.get("available"):
        return "Verdicts: *unavailable* — could not read run metrics from CloudWatch."
    counts = facts["counts"]
    if not any(counts.values()) and not facts["no_verdict"]:
        return "Verdicts: no analyses recorded."
    listed = " · ".join(f"{counts[verdict]} {verdict}" for verdict in VERDICTS)
    line = f"Verdicts: {listed} → *{_plural(facts['deflected'], 'ticket')} kept off the eng queue*"
    if facts["no_verdict"]:
        # Surfaced in the message rather than left to the logs: this is the
        # shape of "escalation has silently stopped working".
        count = facts["no_verdict"]
        line += f" · ⚠️ {count} {'analysis' if count == 1 else 'analyses'} produced no verdict"
    return line


def _pr_line(facts: dict) -> str:
    if not facts.get("available"):
        return "PRs: *unavailable* — could not read pull requests from GitHub."
    line = f"PRs: {facts['opened']} opened · {facts['merged']} merged · {facts['closed_unmerged']} closed unmerged"
    stale = facts["stale"]
    if stale:
        named = ", ".join(_link(pr["url"], f"#{pr['number']}") for pr in stale[:MAX_NAMED_MISSES])
        line += f" · ⚠️ {len(stale)} open past {STALE_HOURS}h with no human review: {named}"
    return line


def _cost_line(facts: dict) -> str:
    if not facts.get("available"):
        # NEVER "$0". A zero here is a claim that the bot ran for free, which is
        # the specific lie this whole availability distinction exists to prevent.
        return "Cost: *unavailable* — could not read run metrics from CloudWatch."
    if facts["runs"] == 0:
        # Distinct from both "$0.00" and "unavailable": the query worked and
        # found nothing, which on a week with analyses means the metric line has
        # stopped flowing rather than that the runs were free.
        return "Cost: no runs recorded this week."
    if facts["runs"] == facts["unpriced"]:
        # The same lie by a different route. Runs happened and not one of them
        # reported a price, so summing to $0.00 and appending a qualifier would
        # still put a wrong number where a reader's eye goes first.
        return f"Cost: unknown — {_plural(facts['runs'], 'run')} recorded no cost."
    line = f"Cost: ${facts['total_usd']:.2f} this week"
    if facts["median_analysis_usd"] is not None:
        line += f" · ${facts['median_analysis_usd']:.2f} median per analysis"
    if facts["unpriced"]:
        line += f" · {_plural(facts['unpriced'], 'run')} recorded no cost"
    return line


def render(facts: dict) -> str:
    """The Slack message, headline first.

    Coverage leads and cost trails, which is the order of how much each one has
    cost us. Every line is a raw count; there is not a percentage anywhere in
    here and there must not be one.
    """
    start = datetime.fromtimestamp(facts["start"], tz=UTC)
    # The window is inclusive of its last day, so the header names the Sunday
    # rather than the Monday the window ends at. A reader has to be able to tell
    # at a glance which week this is about, because that is how they tell a
    # fresh digest from a repost.
    last_day = datetime.fromtimestamp(facts["end"] - 1, tz=UTC)
    span = (
        f"{start:%b} {start.day}–{last_day.day}"
        if start.month == last_day.month
        else (f"{start:%b} {start.day}–{last_day:%b} {last_day.day}")
    )
    header = f"*gpbot — week of {span}*"

    lines = [header, _coverage_line(facts["coverage"])]
    latency = _latency_line(facts["coverage"])
    if latency:
        lines.append(latency)
    lines += [_verdict_line(facts["verdicts"]), _pr_line(facts["prs"]), _cost_line(facts["cost"])]
    return "\n".join(lines)


def unavailable_sources(facts: dict) -> list[str]:
    return [name for name in ("coverage", "verdicts", "prs", "cost") if not facts[name].get("available")]


def main() -> int:
    """Read the gathered facts on stdin, write the Slack message on stdout.

    A CLI rather than an importable-only module, for the same reason
    ci_triage.py is one: the workflow stays a fact gatherer that shells out
    here, and every judgement about what those facts mean is exercised by pytest
    instead of by a Monday morning in production.

    Exit codes are three-valued on purpose. 0 is a complete digest; EXIT_DEGRADED
    means the message on stdout is real and postable but a source is missing, so
    the workflow posts it AND goes red; 1 means there is no message at all.
    Collapsing the middle case into either of the others loses something: into 0
    and nobody investigates the missing source, into 1 and the week's message is
    dropped over a partial failure.
    """
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"ERROR: unreadable digest input: {e}", file=sys.stderr)
        return 1

    try:
        facts = summarize(payload)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    sys.stdout.write(render(facts) + "\n")

    missing = unavailable_sources(facts)
    if missing:
        print(f"ERROR: digest rendered without {', '.join(missing)}", file=sys.stderr)
        return EXIT_DEGRADED
    return 0


if __name__ == "__main__":
    sys.exit(main())
