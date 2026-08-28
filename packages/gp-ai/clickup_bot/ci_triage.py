"""Decide what to do about a failing check or an unanswered review finding on a
[GP-Bot] PR.

WHY THIS EXISTS: the bot opens a PR and stops. PR #1306 sat from 2026-08-18
with delegate-reviewer[bot] approval and a red `E2E` check, waiting for a human
to notice. Nothing drove it.

THE SECOND HALF, added after #1306 merged: Cursor Bugbot posted a high-severity
finding on that same PR three minutes after it opened, delegate-reviewer
approved two minutes later without accounting for it, and a human approved and
merged two days after that without answering the thread. The finding was
correct — the regression it described reached main and was fixed separately in
PR #1431. Nothing in the system treats an unresolved finding as work: Bugbot
posts a COMMENTED review, never CHANGES_REQUESTED, so it never blocks, and one
approval satisfies the ruleset. So an unresolved, unanswered Bugbot thread is
driven here too, on the same budget as a failing check.

THE THIRD HALF: a PR can stop being mergeable without any check going red and
without anyone reviewing it, simply because main moved underneath it. Nothing
reports that. GitHub shows a conflicted PR as green if its checks passed, the
approval stays valid, and the only visible difference is a disabled merge
button — so a bot PR that nobody is watching rots quietly. A conflicted branch
is therefore work too, and it is settled BEFORE checks and findings, because
neither a green board nor an answered thread can merge a branch that conflicts.

Being merely BEHIND main is deliberately NOT driven. The repository's ruleset
sets strict_required_status_checks_policy false, so an out-of-date branch still
merges; updating one on every push to main would spend a full CI cycle per bot
PR per merge to change nothing about whether it can land.

delegate-reviewer's own findings are deliberately NOT driven here. It withholds
approval until its blockers are fixed, which already gates the merge, and it
runs a reply-and-re-review protocol (`delegate review`) that a second automated
actor would fight.

WHY IT IS NOT JUST "ASK THE MODEL TO FIX CI": most bot-PR check failures we have
actually observed were infrastructure, not regressions. #1306's failing
`E2E Shard (1)` never ran a single test — it hung in `Install Playwright
browsers` (an `apt-get` against azure.archive.ubuntu.com) for 29 minutes until
the job's 30-minute timeout cancelled it, while shards 2-4 passed. The identical
signature hit PR #1319 twice consecutively and an unrelated branch in the same
window. gp-api's `Test (shard 1)` has failed the same way on people-db
`statement timeout` errors. Pointing an agent at any of those asks it to change
application code to satisfy a failure the diff did not cause, which is strictly
worse than leaving the PR alone.

So the money is spent only on a failure that has earned it, and the ordering of
that judgement is the whole design:

    already failing on main  -> report it, never touch it (not this PR's bug)
    infrastructure signature -> re-run; NEVER escalates to an agent run
    anything else            -> re-run ONCE first, and only spend an agent run
                                on a failure that reproduced

Re-running an unclassifiable failure before paying for it is the cheap half of
the trade: a flake clears for free, and a real regression comes back with
evidence that it is deterministic. A CI re-run costs minutes; an agent run costs
$1.50-$5 and can push code.

The taxonomy and the round caps are lifted from `.claude/skills/ship-pr/SKILL.md`
"Phase 3", which is how a human-driven agent already triages these. This module
automates that judgement; it deliberately does not invent a new one.

Pure functions over JSON, with no network and no GitHub client, so the whole
decision is unit-testable against real captured failures — see
clickup_bot/tests/test_ci_triage.py. `.github/workflows/gpbot-ci-drive.yml`
gathers the facts and executes the verdict; nothing decides anything in YAML.
"""

import json
import re
import sys
import time
from typing import Any

# How a failing check is classified. The classification is about EVIDENCE; the
# action it maps to also depends on what has already been spent (see decide).
PRE_EXISTING = "pre-existing"
INFRA = "infra"
UNKNOWN = "unknown"

# What the workflow should do with the PR.
ACTION_RERUN = "rerun"
ACTION_FIX = "fix"
ACTION_FIX_FINDINGS = "fix-findings"
ACTION_FIX_CONFLICTS = "fix-conflicts"
ACTION_REPORT = "report"
ACTION_ESCALATE = "escalate"
ACTION_HOLD = "hold"
ACTION_NONE = "none"

# Review authors whose unresolved threads count as work. Compared after
# lowercasing and stripping a trailing "[bot]", because the same account is
# `cursor` over GraphQL and `cursor[bot]` over REST.
FINDING_AUTHORS = ("cursor",)

# CAPS. Both are per-PR and cumulative for the life of the PR, deliberately NOT
# per-HEAD-SHA: a fix run pushes a commit, and resetting the counters on a new
# commit would let a fix run that fails re-trigger itself forever. That is the
# money-burning loop this whole module exists to bound.

# Re-runs cost CI minutes and no model spend, so the cap is set by how many
# consecutive infrastructure failures we have actually seen rather than by cost:
# PR #1319 hit the identical apt-get hang TWICE IN A ROW, so a cap of 1 or 2
# would have escalated a pure flake to a human. Three absorbs the observed worst
# case with one spare.
MAX_RERUNS = 3

# Agent runs cost $1.50-$5 each and can push code. Two matches the "stop after 2
# check-fix rounds" cap in ship-pr's Phase 3, and holds this feature's worst case
# to ~$10 per PR on top of the ~$30 the ticket may already have spent on
# analyze-then-implement.
#
# ONE BUDGET, SHARED between failing checks and review findings, because what it
# bounds is money rather than either activity on its own. A single run answers
# every open finding at once, so the cost does not grow with how much Bugbot
# found — which is what makes it affordable to treat a low-severity finding as
# work instead of filtering on a severity string parsed out of a comment body.
MAX_FIX_RUNS = 2

# How many finding ids the marker comment carries. Each is ~40 characters and
# the comment is capped at 65536, so this is far below the real limit; it exists
# so a PR that collects findings indefinitely cannot grow the comment without
# bound. Overflow drops the OLDEST ids, so the most recent findings stay
# tracked and an old one can at worst buy one more fix run.
MAX_TRACKED_FINDINGS = 50

# A finding's title as shown to a human in Slack. Bugbot's own heading is one
# short line, so this only ever truncates a malformed body.
MAX_FINDING_TITLE_CHARS = 120

# How long a launched fix run is assumed to still be working.
#
# WHY THIS IS NEEDED AT ALL: launching a fix run changes nothing observable. It
# queues a Fargate task; no check goes pending until that task actually pushes a
# commit, which is many minutes later. The 30-minute schedule would otherwise
# come back to the same red board, see the same evidence, and launch a second
# agent against the same branch — two runs pushing the same branch, and both fix
# slots gone before either had finished. The Lambda's dedup claim does not cover
# this: its TTL is 15 minutes, shorter than the run it would be guarding.
#
# The value is the agent's own ceiling plus room to start:
# DEFAULT_DEADLINE_SECONDS is 45 minutes (engineer_agent/agent/config.py) and a
# Fargate task takes a few minutes to pull and boot. Erring long costs one
# schedule tick of latency; erring short buys a duplicate agent run.
FIX_RUN_GRACE_SECONDS = 60 * 60

# Log fragments that prove a failure was environmental. Matched case-insensitively
# against the tail of the failed job's log.
#
# ASYMMETRY, and it is the reason this list is generous rather than precise: a
# false positive here costs a re-run and ends at a human (INFRA never becomes an
# agent run — see decide). A false negative costs a re-run AND an agent run
# pointed at code that was never broken. Over-matching is the cheap mistake.
#
# Every entry is a signature observed on a real omni run, not a guess at what
# might break.
INFRA_LOG_SIGNATURES = (
    # #1306 / #1319: `playwright install --with-deps` hangs in apt-get against
    # the Azure-hosted Ubuntu mirror until the job timeout kills it.
    "azure.archive.ubuntu.com",
    "archive.ubuntu.com",
    "e: failed to fetch",
    "e: unable to fetch some archives",
    # Transient TLS/DNS against the GitHub API, which has cascaded into E2E
    # failures that look nothing like their cause.
    "x509: certificate is not valid",
    "tls handshake timeout",
    "could not resolve host",
    "getaddrinfo eai_again",
    # gp-api `Test (shard 1)` against people-db.
    "statement timeout",
    "canceling statement due to",
    "hook timed out",
    "connection terminated unexpectedly",
    "econnreset",
    "etimedout",
    "socket hang up",
    # Runner and upstream-service failures.
    "no space left on device",
    "the runner has received a shutdown signal",
    "502 bad gateway",
    "503 service unavailable",
    "504 gateway time-out",
    "429 too many requests",
)

# Conclusions that are not a verdict on the diff. #1306's `E2E Shard (1)` is
# `cancelled`: it hit `timeout-minutes: 30` with `Run Playwright tests` still
# pending, so it never observed the diff at all. A conclusion in this set is by
# itself proof that no test result was produced, which is why it short-circuits
# the log scan — and why it must be exhaustive. Anything missing here falls
# through to UNKNOWN and can eventually buy an agent run to "fix" code that was
# never executed. The value is what a human reads on escalation, so it says what
# happened to the job rather than naming the branch that was taken.
NO_VERDICT_CONCLUSIONS = {
    "cancelled": "the runner killed it, so it never reported a test result",
    "timed_out": "it hit its job timeout, so it never reported a test result",
    "stale": "GitHub marked the run stale and abandoned it without a verdict",
    "startup_failure": "the runner never started, so no test ran at all",
    "action_required": "it is parked on a manual approval gate, not on anything in the diff",
}

# The marker that makes the attempt counters durable across invocations. Same
# device as delegate's `<!-- delegate-finding-id: ... -->`: state lives in an
# upserted PR comment, so it survives runner restarts, re-runs and pushes, and a
# human reading the PR can see exactly what the bot has spent.
STATE_MARKER = "<!-- gpbot-ci-drive -->"
_STATE_PATTERN = re.compile(r"<!--\s*gpbot-ci-state:\s*(\{.*?\})\s*-->", re.DOTALL)

# Cap on how much log tail is examined. The signature list only ever matches near
# the end of a failed job, and an unbounded excerpt would be a large, entirely
# attacker-shaped string to carry around.
MAX_LOG_EXCERPT_CHARS = 20000


def classify_check(check: Any) -> dict:
    """Classify one failing check from its job structure and log tail.

    Returns `{"name": ..., "classification": ..., "evidence": ...}`. The evidence
    string is what gets reported to humans on exhaustion, so it must say what was
    observed, not just which branch was taken.
    """
    if not isinstance(check, dict):
        # Shape drift must not crash the drive. An unreadable check is exactly
        # the "cannot tell" case UNKNOWN exists for, and UNKNOWN still costs a
        # re-run before it can cost anything else.
        return {"name": "<unreadable>", "classification": UNKNOWN, "evidence": "check payload was not an object"}

    name = check.get("name")
    name = name if isinstance(name, str) and name else "<unnamed>"

    # FIRST, unconditionally: a check that is also red on main is not this PR's
    # problem, and no other signal may override that. Fighting a pre-existing
    # breakage is how a bot ends up rewriting code it never touched.
    if check.get("failing_on_main") is True:
        return {
            "name": name,
            "classification": PRE_EXISTING,
            "evidence": "this check is failing on main too, so the PR did not cause it",
        }

    conclusion = check.get("conclusion")
    conclusion = conclusion.lower() if isinstance(conclusion, str) else ""
    if conclusion in NO_VERDICT_CONCLUSIONS:
        return {
            "name": name,
            "classification": INFRA,
            "evidence": f"the job ended '{conclusion}' — {NO_VERDICT_CONCLUSIONS[conclusion]}",
        }

    log_excerpt = check.get("log_excerpt")
    if isinstance(log_excerpt, str) and log_excerpt:
        haystack = log_excerpt[-MAX_LOG_EXCERPT_CHARS:].lower()
        for signature in INFRA_LOG_SIGNATURES:
            if signature in haystack:
                return {
                    "name": name,
                    "classification": INFRA,
                    "evidence": f"log carries the known infrastructure signature {signature!r}",
                }

    # Deliberately NOT "regression". Nothing here proves the diff caused this,
    # and the only honest thing to say is that it could not be attributed — which
    # buys a free re-run rather than an agent run. See decide.
    return {
        "name": name,
        "classification": UNKNOWN,
        "evidence": "no infrastructure signature and not failing on main; cause not established",
    }


def _finding_title(excerpt: Any) -> str:
    """The first meaningful line of a finding, for the summary a human reads.

    Bugbot opens with a markdown heading (`### Failed collection hides retry
    UI`) followed by a severity line and a block of HTML comment markers. The
    heading is the only part worth repeating in Slack.

    This text never reaches an agent's prompt. It comes from a comment body,
    which is exactly the untrusted-input shape the CI path keeps out of the
    Lambda payload, and the same rule applies here.
    """
    if not isinstance(excerpt, str):
        return "(no description)"
    for line in excerpt.splitlines():
        line = line.strip().lstrip("#").strip()
        if not line or line.startswith("<"):
            continue
        return line[:MAX_FINDING_TITLE_CHARS]
    return "(no description)"


def open_findings(findings: Any) -> list[dict]:
    """The review threads that still need an answer, newest shape-checked.

    Four things disqualify a thread, and the direction of each default is
    chosen so that a garbled input errs toward "this still needs an answer" —
    silently dropping a real finding is the bug this whole path exists to fix:

    - Not from a watched review author. delegate is excluded on purpose (see
      the module docstring).
    - Already resolved. Only an explicit `true` counts, so a missing field
      leaves the thread in scope.
    - Outdated, meaning the lines it points at have since changed. This is the
      natural stop for a thread the bot has already acted on: a fix push moves
      the code and GitHub marks the thread outdated by itself. A push that
      moves the lines WITHOUT addressing the finding also clears it, which is
      the accepted cost of not re-litigating every thread on every commit.
    - A human has replied. Then a person owns the thread and the bot must not
      talk over them. On #1306 nobody replied, which is why it qualified.

    A thread with no id is dropped, and that is the one drop that is not the
    safe direction. It has to be: `findings_attempted` is keyed on the id, so
    an untrackable thread would buy a fix run on every single pass forever.
    """
    result = []
    for finding in findings if isinstance(findings, list) else []:
        if not isinstance(finding, dict):
            continue
        thread_id = finding.get("id")
        if not isinstance(thread_id, str) or not thread_id:
            continue
        author = finding.get("author")
        author = author.strip().lower().removesuffix("[bot]") if isinstance(author, str) else ""
        if author not in FINDING_AUTHORS:
            continue
        if finding.get("resolved") is True or finding.get("outdated") is True:
            continue
        if finding.get("human_replied") is True:
            continue
        result.append({"id": thread_id, "title": _finding_title(finding.get("excerpt"))})
    return result


def is_conflicted(mergeability: Any) -> bool:
    """Whether the branch conflicts with its base, from `gh pr view`'s two fields.

    ONLY AN EXPLICIT "CONFLICTING" COUNTS, and the default direction here is the
    opposite of open_findings' because the cost is the opposite. GitHub computes
    mergeability lazily: a PR that has just been pushed to, or one GitHub has not
    got round to, reports UNKNOWN for a few seconds. Treating UNKNOWN — or a
    missing field, or a shape we do not recognise — as conflicted would point an
    agent at a branch that merges perfectly well, which is both a wasted fix run
    and a pointless commit on a PR a human is about to merge.

    Erring the other way is nearly free: the drive comes back every 30 minutes,
    and a real conflict does not go away on its own.

    `merge_state` is read only for the sentence a human sees. `mergeable` is the
    authoritative field, and deriving the verdict from one signal rather than
    OR-ing two avoids acting on the window where they disagree.
    """
    if not isinstance(mergeability, dict):
        return False
    value = mergeability.get("mergeable")
    return isinstance(value, str) and value.strip().upper() == "CONFLICTING"


def _coerce_count(value: Any) -> int:
    # A hand-edited or drifted marker comment must not crash the drive, and must
    # not read as "nothing spent yet" either — that would silently uncap the
    # feature. Anything unreadable counts as the cap already being reached.
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return MAX_RERUNS + MAX_FIX_RUNS
    return value


def _coerce_timestamp(value: Any) -> int:
    # Unreadable means "assume a run is NOT in flight", the opposite direction to
    # _coerce_count. Failing the other way would let a garbled marker park a PR
    # for an hour at a time; the counters still cap the spend either way.
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        return 0
    return int(value)


def _coerce_ids(value: Any) -> list[str]:
    # Unreadable means "nothing attempted", which at worst lets a finding buy
    # one more fix run. The fix counter still caps the spend either way, and
    # the alternative — treating a garbled list as "everything was attempted" —
    # would silently stop answering findings, which is the failure this path
    # exists to prevent.
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item][-MAX_TRACKED_FINDINGS:]


def parse_state(comment_body: Any) -> dict:
    """Read the attempt counters out of the drive's own PR comment.

    No comment yet means nothing has been spent. An unparseable one is treated as
    exhausted rather than fresh: guessing "fresh" on a state comment we cannot
    read is how a bounded feature becomes an unbounded bill.
    """
    exhausted = {
        "reruns": MAX_RERUNS,
        "fixes": MAX_FIX_RUNS,
        "escalated": True,
        "fix_started_at": 0,
        "findings_attempted": [],
    }
    if not isinstance(comment_body, str) or not comment_body.strip():
        return {"reruns": 0, "fixes": 0, "escalated": False, "fix_started_at": 0, "findings_attempted": []}

    match = _STATE_PATTERN.search(comment_body)
    if not match:
        return exhausted
    try:
        parsed = json.loads(match.group(1))
    except json.JSONDecodeError:
        return exhausted
    if not isinstance(parsed, dict):
        return exhausted

    return {
        "reruns": _coerce_count(parsed.get("reruns")),
        "fixes": _coerce_count(parsed.get("fixes")),
        "escalated": parsed.get("escalated") is True,
        "fix_started_at": _coerce_timestamp(parsed.get("fix_started_at")),
        "findings_attempted": _coerce_ids(parsed.get("findings_attempted")),
    }


def render_state(state: dict) -> str:
    return "<!-- gpbot-ci-state: " + json.dumps(state, sort_keys=True) + " -->"


def decide(checks: Any, state: Any, findings: Any = None, mergeability: Any = None, now: float | None = None) -> dict:
    """Turn classified failures plus what has already been spent into one action.

    One action for the whole PR, not one per check: a re-run re-runs every failed
    job at once, and an agent run is pointed at the PR rather than at a single
    check. Ordering is cheap-first — a re-run that clears the board costs no model
    spend and no code change.

    CONFLICTS ARE SETTLED FIRST, then checks, then findings. A conflicted branch
    cannot merge however green it is, so re-running its checks or answering its
    review threads spends CI minutes and model tokens to arrive at a PR that
    still cannot land. Resolving the conflict pushes a commit, which re-runs the
    checks anyway — so the cheaper-looking order is also the wasteful one.

    CHECKS ARE SETTLED BEFORE FINDINGS. A run that answers a finding pushes code
    that has to pass CI anyway, so paying for one while the board is red spends
    money to arrive at a PR that is still red.

    `now` is injected so the in-flight window below is exercised by tests at
    fixed instants rather than by whatever the clock happens to say.
    """
    conflicted = is_conflicted(mergeability)
    decision = _decide(checks, state, findings, conflicted, now)
    # Stamped once on the way out rather than by each branch, for the same
    # reason next_state exists: eleven branches each restating the whole shape
    # is eleven chances to omit a field, and an omitted `conflicted` would drop
    # the conflict from the summary a human reads on escalation.
    decision["conflicted"] = conflicted
    return decision


def _decide(checks: Any, state: Any, findings: Any, conflicted: bool, now: float | None) -> dict:
    now = time.time() if now is None else now
    if not isinstance(state, dict):
        state = {}
    reruns = _coerce_count(state.get("reruns"))
    fixes = _coerce_count(state.get("fixes"))
    already_escalated = state.get("escalated") is True
    fix_started_at = _coerce_timestamp(state.get("fix_started_at"))
    attempted = _coerce_ids(state.get("findings_attempted"))

    # Every branch below returns the whole state, and a branch that forgot one
    # field would silently reset it — dropping `findings_attempted` would let
    # the same finding buy a fix run on every pass. Defaults are bound to the
    # values read above, so a caller states only what it changes.
    def next_state(
        *,
        reruns: int = reruns,
        fixes: int = fixes,
        escalated: bool = False,
        fix_started_at: int = fix_started_at,
        findings_attempted: list[str] = attempted,
    ) -> dict:
        return {
            "reruns": reruns,
            "fixes": fixes,
            "escalated": escalated,
            "fix_started_at": fix_started_at,
            "findings_attempted": findings_attempted,
        }

    classifications = [classify_check(check) for check in (checks if isinstance(checks, list) else [])]
    unanswered = open_findings(findings)

    if not classifications and not unanswered and not conflicted:
        # next_state is INERT on every ACTION_NONE branch. gpbot-ci-drive.yml
        # `continue`s on `none` before it reaches the comment write, so nothing
        # here is ever persisted and this cannot clear or set a flag. It is
        # returned only so the decision shape is uniform for the caller.
        #
        # An escalation therefore survives a clear board, which is deliberate.
        # Once the bot has handed a PR to a human, the only actor who can put
        # new work on it is that human, and they were told the bot had stopped.
        # A human deletes the marker comment to hand it back.
        return {
            "action": ACTION_NONE,
            "reason": "the branch merges cleanly, no failing checks and no unanswered review findings",
            "classifications": [],
            "findings": [],
            "next_state": next_state(escalated=already_escalated),
        }

    if already_escalated:
        # Terminal until a human intervenes. The counters are per-PR rather than
        # per-commit precisely so that a fix run's own push cannot reopen this,
        # so nothing the bot does can clear it — which is the point.
        return {
            "action": ACTION_NONE,
            "reason": "already escalated to a human on this PR; not spending anything further",
            "classifications": classifications,
            "findings": unanswered,
            "next_state": next_state(escalated=True),
        }

    # A fix run in flight leaves the board red and untouched until it pushes, so
    # every trigger in that window sees identical evidence. Without this, the
    # 30-minute schedule reads "still red, nothing changed" and launches a second
    # agent onto the same branch. Waiting is always right here: the run either
    # pushes (checks go pending, the guard in the workflow takes over) or it
    # gives up, and either way the next pass has new information.
    if fix_started_at and now - fix_started_at < FIX_RUN_GRACE_SECONDS:
        minutes_left = int((FIX_RUN_GRACE_SECONDS - (now - fix_started_at)) // 60)
        return {
            "action": ACTION_NONE,
            "reason": f"a fix run is still in flight; waiting up to {minutes_left} more minute(s) for it to push",
            "classifications": classifications,
            "findings": unanswered,
            "next_state": next_state(),
        }

    if conflicted:
        return _decide_conflicts(classifications, unanswered, fixes, now, next_state)

    if classifications:
        return _decide_checks(classifications, unanswered, reruns, fixes, now, next_state)

    return _decide_findings(unanswered, attempted, fixes, now, classifications, next_state)


def _decide_conflicts(classifications: list, unanswered: list, fixes: int, now: float, next_state: Any) -> dict:
    """What to do about a branch that no longer merges into main.

    NO CHEAP MOVE COMES FIRST HERE, unlike a failing check. A re-run is worth
    trying on a red board because a flake clears for free; there is no
    equivalent for a conflict, because "conflicting" is precisely the answer git
    already gave when it tried to merge the two. So the first move is the
    expensive one.

    NO SEPARATE ATTEMPT LEDGER either, unlike findings. A finding can stay open
    forever after a run that declined to act on it, so it needs its ids banked
    to stop it buying a run on every pass. A conflict cannot: a run that
    resolves it makes it disappear, and one that does not leaves the same
    conflict for the shared fix budget to bound. That budget is the whole cap —
    at most MAX_FIX_RUNS attempts, then a human.

    A conflict that reappears because main moved again is a genuinely new
    conflict, and it draws on the same budget rather than a fresh one. That is
    deliberately strict: a bot PR that keeps colliding with main is one a human
    should look at, not one to keep paying to rebase.
    """
    if fixes < MAX_FIX_RUNS:
        return {
            "action": ACTION_FIX_CONFLICTS,
            "reason": (
                f"the branch conflicts with main and cannot merge as it stands (fix run {fixes + 1} of {MAX_FIX_RUNS})"
            ),
            "classifications": classifications,
            "findings": unanswered,
            "next_state": next_state(fixes=fixes + 1, fix_started_at=int(now)),
        }

    return {
        "action": ACTION_ESCALATE,
        "reason": f"the branch still conflicts with main after {fixes} fix run(s); it needs a human",
        "classifications": classifications,
        "findings": unanswered,
        "next_state": next_state(escalated=True),
    }


def _decide_checks(
    classifications: list, unanswered: list, reruns: int, fixes: int, now: float, next_state: Any
) -> dict:
    """The failing-check ladder: pre-existing, then infrastructure, then the rest."""
    actionable = [c for c in classifications if c["classification"] != PRE_EXISTING]
    if not actionable:
        # Hard requirement: a breakage that is already red on main gets reported,
        # never fixed here. Reporting is terminal too — re-running a check that
        # fails on main just burns CI to reach the same answer.
        return {
            "action": ACTION_REPORT,
            "reason": "every failing check is already failing on main; not this PR's regression",
            "classifications": classifications,
            "findings": unanswered,
            "next_state": next_state(escalated=True),
        }

    infra = [c for c in actionable if c["classification"] == INFRA]
    unknown = [c for c in actionable if c["classification"] == UNKNOWN]

    # A first re-run is the cheapest possible next move for BOTH classes: it
    # clears a flake for free, and it converts an unattributable failure into a
    # reproduced one that has earned an agent.
    if reruns < MAX_RERUNS and (infra or reruns == 0):
        names = ", ".join(c["name"] for c in (infra or unknown))
        return {
            "action": ACTION_RERUN,
            "reason": f"re-running {names} (attempt {reruns + 1} of {MAX_RERUNS})",
            "classifications": classifications,
            "findings": unanswered,
            "next_state": next_state(reruns=reruns + 1, fix_started_at=0),
        }

    # INFRA NEVER BECOMES AN AGENT RUN. An environmental failure that survived
    # every re-run is a broken mirror or a sick database, and the single most
    # damaging thing this feature could do is point a model at application code
    # to satisfy it. Out of re-runs means out of moves.
    #
    # A persisting infra failure blocks a fix run even when an unrecognized
    # failure is red beside it, which is the stricter reading and the correct
    # one: the broken environment is the most likely CAUSE of the unknown
    # failure (an apt mirror that hangs one job starves another into a timeout
    # that matches no signature). Judging the unknown check while the
    # environment is still broken means judging it on bad evidence, so it has to
    # wait until the infrastructure is healthy — which is a human's job here.
    if infra:
        return {
            "action": ACTION_ESCALATE,
            "reason": (
                f"{MAX_RERUNS} re-runs did not clear an infrastructure failure. It is not a code defect, so no "
                "fix run is attempted"
                + (
                    "; the other failing check cannot be judged while the environment is still broken"
                    if unknown
                    else ""
                )
            ),
            "classifications": classifications,
            "findings": unanswered,
            "next_state": next_state(escalated=True),
        }

    if fixes < MAX_FIX_RUNS:
        names = ", ".join(c["name"] for c in unknown)
        # Deliberately does NOT claim the failure reproduced. It usually has, but
        # the counters are per-PR rather than per-check, so when the re-run budget
        # was spent on an infrastructure failure that has since cleared, a
        # newly-appearing check can reach here having been seen exactly once.
        # Distinguishing the two would need per-check state; overstating the
        # evidence in a line a human reads to decide whether to trust the fix run
        # is the worse of the two costs.
        return {
            "action": ACTION_FIX,
            "reason": (
                f"{names} still failing after {reruns} re-run(s) and carries no infrastructure signature "
                f"(fix run {fixes + 1} of {MAX_FIX_RUNS})"
            ),
            "classifications": classifications,
            "findings": unanswered,
            # Stamped here rather than by the workflow so the in-flight window
            # opens in the same write that spends the slot. Two separate writes
            # could crash between them and leave a launched run unguarded.
            "next_state": next_state(fixes=fixes + 1, fix_started_at=int(now)),
        }

    return {
        "action": ACTION_ESCALATE,
        "reason": f"spent {reruns} re-run(s) and {fixes} fix run(s) without getting CI green",
        "classifications": classifications,
        "findings": unanswered,
        "next_state": next_state(escalated=True),
    }


def _decide_findings(
    unanswered: list, attempted: list[str], fixes: int, now: float, classifications: list, next_state: Any
) -> dict:
    """What to do about review findings, reached only once the board is green.

    A finding gets ONE fix run and no more. `findings_attempted` records the ids
    a run was pointed at, so a finding still open after that run goes to a human
    instead of buying a second attempt. Without it the loop is unbounded in the
    expensive direction: the agent disagrees with a false positive, leaves the
    thread open, and every later pass reads it as fresh work.
    """
    fresh = [f for f in unanswered if f["id"] not in attempted]

    if not fresh:
        return {
            "action": ACTION_HOLD,
            "reason": (
                f"a fix run already answered {'this finding' if len(unanswered) == 1 else 'these findings'} "
                "and the thread is still open; a human has to settle it"
            ),
            "classifications": classifications,
            "findings": unanswered,
            "next_state": next_state(escalated=True),
        }

    if fixes >= MAX_FIX_RUNS:
        return {
            "action": ACTION_HOLD,
            "reason": f"no fix runs left ({fixes} of {MAX_FIX_RUNS} spent), so the review findings need a human",
            "classifications": classifications,
            "findings": unanswered,
            "next_state": next_state(escalated=True),
        }

    return {
        "action": ACTION_FIX_FINDINGS,
        "reason": (
            f"CI is green but {len(fresh)} review finding(s) have no answer (fix run {fixes + 1} of {MAX_FIX_RUNS})"
        ),
        "classifications": classifications,
        "findings": unanswered,
        # Every fresh id is banked now, in the same write that spends the slot.
        # One run answers all of them, so a run that answers none must not be
        # able to buy a second attempt at any of them.
        "next_state": next_state(
            fixes=fixes + 1,
            fix_started_at=int(now),
            findings_attempted=(attempted + [f["id"] for f in fresh])[-MAX_TRACKED_FINDINGS:],
        ),
    }


def render_summary(decision: dict) -> str:
    """One human-readable paragraph: what was decided about each check, and why.

    This is what a person reads in Slack when the drive gives up, so it leads
    with the observation rather than the verdict — "the runner killed the job"
    is actionable, "classified as infra" is not.
    """
    # Listed first because it is the one item that makes every other line moot:
    # a conflicted branch does not merge however the checks read.
    lines = ["the branch conflicts with main and cannot merge"] if decision.get("conflicted") else []
    lines += [f"{c['name']}: {c['evidence']}" for c in decision.get("classifications", [])]
    # Findings are listed even when the decision was about a check, because a
    # human reading a Slack escalation needs to see everything still outstanding
    # on the PR, not only the half that produced the verdict.
    lines += [f"unanswered review finding — {f['title']}" for f in decision.get("findings", [])]
    return decision.get("reason", "") + ("\n" + "\n".join(f"• {line}" for line in lines) if lines else "")


def render_comment(decision: dict) -> str:
    """The full body of the PR marker comment, counters included.

    Built here rather than in the workflow so the durable state and the prose a
    human reads can never disagree: the same function writes both, and
    test_ci_triage.py round-trips it through parse_state.
    """
    next_state = decision.get("next_state", {})
    action = decision.get("action", ACTION_NONE)
    headline = {
        ACTION_RERUN: "Re-running the failed checks.",
        ACTION_FIX: "Starting a run to fix this.",
        ACTION_FIX_FINDINGS: "Starting a run to answer the review findings.",
        ACTION_FIX_CONFLICTS: "Starting a run to resolve the conflicts with `main`.",
        ACTION_REPORT: "Stopping: this is already broken on `main`.",
        ACTION_ESCALATE: "Stopping and handing this to a human.",
        ACTION_HOLD: "Stopping: the review findings need a human.",
        ACTION_NONE: "No action.",
    }.get(action, "No action.")

    spent = f"Spent so far on this PR: {next_state.get('reruns', 0)} re-run(s) of "
    spent += f"{MAX_RERUNS}, {next_state.get('fixes', 0)} fix run(s) of {MAX_FIX_RUNS}."

    footer = ""
    if action in (ACTION_ESCALATE, ACTION_REPORT, ACTION_HOLD):
        # The counters are per-PR and nothing the bot does resets them, so a human
        # has to be told how to hand it back rather than left wondering why the
        # bot went quiet.
        footer = (
            "\n\nThis PR will not be driven further. Delete this comment to let the "
            "bot start over, or take it from here."
        )

    return (
        f"{STATE_MARKER}\n"
        f"**gpbot CI drive** — {headline}\n\n"
        f"{render_summary(decision)}\n\n"
        f"_{spent}_"
        f"{footer}\n"
        f"{render_state(next_state)}\n"
    )


def main() -> int:
    """Read the gathered facts on stdin, write the decision and its rendered text on stdout.

    A CLI rather than an importable-only module so the workflow stays a fact
    gatherer: it shells out here and executes `action`, and every branch of the
    judgement is exercised by pytest instead of by a bot PR in production.

    `state_comment` is the raw body of the drive's own PR comment (or null on the
    first pass). Parsing it here rather than in the workflow keeps every reading
    and writing of the durable counters inside the tested module.

    `findings` is every review thread on the PR, unfiltered. Which ones count is
    a judgement (see open_findings), so the workflow hands over what it gathered
    and decides nothing.

    `mergeability` is `gh pr view`'s mergeable and mergeStateStatus verbatim, on
    the same principle: whether UNKNOWN means "fine" is a judgement, and it is
    made in is_conflicted where a test can pin it.
    """
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"ERROR: unreadable triage input: {e}", file=sys.stderr)
        return 1
    if not isinstance(payload, dict):
        print("ERROR: triage input must be a JSON object", file=sys.stderr)
        return 1

    state = payload.get("state")
    if state is None:
        state = parse_state(payload.get("state_comment"))

    decision = decide(payload.get("checks"), state, payload.get("findings"), payload.get("mergeability"))
    decision["comment_body"] = render_comment(decision)
    decision["summary"] = render_summary(decision)

    json.dump(decision, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
