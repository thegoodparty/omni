"""Decide what to do about a failing check on a [GP-Bot] PR.

WHY THIS EXISTS: the bot opens a PR and stops. PR #1306 sat from 2026-08-18
with delegate-reviewer[bot] approval and a red `E2E` check, waiting for a human
to notice. Nothing drove it.

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
ACTION_REPORT = "report"
ACTION_ESCALATE = "escalate"
ACTION_NONE = "none"

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
MAX_FIX_RUNS = 2

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


def parse_state(comment_body: Any) -> dict:
    """Read the attempt counters out of the drive's own PR comment.

    No comment yet means nothing has been spent. An unparseable one is treated as
    exhausted rather than fresh: guessing "fresh" on a state comment we cannot
    read is how a bounded feature becomes an unbounded bill.
    """
    exhausted = {"reruns": MAX_RERUNS, "fixes": MAX_FIX_RUNS, "escalated": True, "fix_started_at": 0}
    if not isinstance(comment_body, str) or not comment_body.strip():
        return {"reruns": 0, "fixes": 0, "escalated": False, "fix_started_at": 0}

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
    }


def render_state(state: dict) -> str:
    return "<!-- gpbot-ci-state: " + json.dumps(state, sort_keys=True) + " -->"


def decide(checks: Any, state: Any, now: float | None = None) -> dict:
    """Turn classified failures plus what has already been spent into one action.

    One action for the whole PR, not one per check: a re-run re-runs every failed
    job at once, and an agent run is pointed at the PR rather than at a single
    check. Ordering is cheap-first — a re-run that clears the board costs no model
    spend and no code change.

    `now` is injected so the in-flight window below is exercised by tests at
    fixed instants rather than by whatever the clock happens to say.
    """
    now = time.time() if now is None else now
    if not isinstance(state, dict):
        state = {}
    reruns = _coerce_count(state.get("reruns"))
    fixes = _coerce_count(state.get("fixes"))
    already_escalated = state.get("escalated") is True
    fix_started_at = _coerce_timestamp(state.get("fix_started_at"))

    classifications = [classify_check(check) for check in (checks if isinstance(checks, list) else [])]

    if not classifications:
        return {
            "action": ACTION_NONE,
            "reason": "no failing checks",
            "classifications": [],
            "next_state": {
                "reruns": reruns,
                "fixes": fixes,
                "escalated": already_escalated,
                "fix_started_at": fix_started_at,
            },
        }

    if already_escalated:
        # Terminal until a human intervenes. The counters are per-PR rather than
        # per-commit precisely so that a fix run's own push cannot reopen this,
        # so nothing the bot does can clear it — which is the point.
        return {
            "action": ACTION_NONE,
            "reason": "already escalated to a human on this PR; not spending anything further",
            "classifications": classifications,
            "next_state": {"reruns": reruns, "fixes": fixes, "escalated": True, "fix_started_at": fix_started_at},
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
            "next_state": {"reruns": reruns, "fixes": fixes, "escalated": False, "fix_started_at": fix_started_at},
        }

    actionable = [c for c in classifications if c["classification"] != PRE_EXISTING]
    if not actionable:
        # Hard requirement: a breakage that is already red on main gets reported,
        # never fixed here. Reporting is terminal too — re-running a check that
        # fails on main just burns CI to reach the same answer.
        return {
            "action": ACTION_REPORT,
            "reason": "every failing check is already failing on main; not this PR's regression",
            "classifications": classifications,
            "next_state": {"reruns": reruns, "fixes": fixes, "escalated": True, "fix_started_at": fix_started_at},
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
            "next_state": {"reruns": reruns + 1, "fixes": fixes, "escalated": False, "fix_started_at": 0},
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
            "next_state": {"reruns": reruns, "fixes": fixes, "escalated": True, "fix_started_at": fix_started_at},
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
            # Stamped here rather than by the workflow so the in-flight window
            # opens in the same write that spends the slot. Two separate writes
            # could crash between them and leave a launched run unguarded.
            "next_state": {"reruns": reruns, "fixes": fixes + 1, "escalated": False, "fix_started_at": int(now)},
        }

    return {
        "action": ACTION_ESCALATE,
        "reason": f"spent {reruns} re-run(s) and {fixes} fix run(s) without getting CI green",
        "classifications": classifications,
        "next_state": {"reruns": reruns, "fixes": fixes, "escalated": True, "fix_started_at": fix_started_at},
    }


def render_summary(decision: dict) -> str:
    """One human-readable paragraph: what was decided about each check, and why.

    This is what a person reads in Slack when the drive gives up, so it leads
    with the observation rather than the verdict — "the runner killed the job"
    is actionable, "classified as infra" is not.
    """
    lines = [f"{c['name']}: {c['evidence']}" for c in decision.get("classifications", [])]
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
        ACTION_REPORT: "Stopping: this is already broken on `main`.",
        ACTION_ESCALATE: "Stopping and handing this to a human.",
        ACTION_NONE: "No action.",
    }.get(action, "No action.")

    spent = f"Spent so far on this PR: {next_state.get('reruns', 0)} re-run(s) of "
    spent += f"{MAX_RERUNS}, {next_state.get('fixes', 0)} fix run(s) of {MAX_FIX_RUNS}."

    footer = ""
    if action in (ACTION_ESCALATE, ACTION_REPORT):
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

    decision = decide(payload.get("checks"), state)
    decision["comment_body"] = render_comment(decision)
    decision["summary"] = render_summary(decision)

    json.dump(decision, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
