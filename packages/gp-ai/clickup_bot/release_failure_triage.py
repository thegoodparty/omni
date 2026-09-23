"""Decide what a failed release run means, and what to file for it.

WHY THIS EXISTS: nothing reacted to a failed release train. Two workflows listen
for `release` completing — release-failure-alert.yml, which posts to Slack and
dispatches nothing, and gpbot-dev-test-triage.yml, which only files for failing
`@dev-only` Playwright specs. A train that dies before the E2E shards therefore
reached no queue at all: the shards are skipped, no report is uploaded, the
spec triage answers `shards_ran: false`, and the only artifact of the whole
event is one Slack message waiting for a human to read it.

That is the gap the Sep 2026 incident (ENG-11106/11107) ran through: ~20
consecutive failed runs, three days, nobody told. The alert half of that is
fixed. This is the half that gets the failure into the same ClickUp pipeline a
human-filed bug takes, so an analyze run investigates it and a `fix` verdict
escalates to an implement run through the identical path.

WHAT THIS DOES NOT DO: it does not decide whether the failure is worth an agent
run — the analyze agent does, from inside the repo, where it can read the code
that broke. This module answers the narrower questions the agent cannot answer
from inside a container: which phase died, what the error actually was, whether
two runs failed for the SAME reason, and whether the failure is environmental.

That last one is the boundary this module must not get wrong in one direction.
ci_triage.decide refuses to turn an INFRA classification into an agent run:

    # INFRA NEVER BECOMES AN AGENT RUN. An environmental failure that survived
    # every re-run is a broken mirror or a sick database, and the single most
    # damaging thing this feature could do is point a model at application code
    # to satisfy it.

The same rule holds here, and INFRA_LOG_SIGNATURES is IMPORTED rather than
copied so the two cannot drift (see tests/test_scope_is_mirrored.py for what
this repo thinks of duplicated judgement).

But the rule has an edge, and release 35273516196 is standing on it. That run
failed a Terraform convergence check — textbook infrastructure — while the
actual defect was a filename comparison in release.yml: ci-plan-root.sh writes
`dev-shared-infra.code` and the check looked for `shared-infra.code`, so all 13
roots reported missing after all 13 had applied and re-planned clean. An agent
could have fixed that in two lines; a log-signature matcher would have called it
environmental and stopped. So `classification` here is advisory and is reported,
not enforced: only a signature that MATCHES a known-environmental string is held
back, and everything else — including "I have never seen this" — is filed for a
model to judge. Refusing the unknown is how this would come to mean nothing.

Pure functions over the run's jobs and annotations, no network and no clients,
on the same contract as ci_triage.py and dev_test_triage.py:
.github/workflows/gpbot-release-failure-triage.yml gathers the facts and files
the ticket, and every judgement about what they mean is made here where
tests/test_release_failure_triage.py can pin it against captured run shapes.
"""

import hashlib
import json
import re
import sys
from typing import Any

from ci_triage import INFRA_LOG_SIGNATURES

# Phases in pipeline order, matched against the failed job names. ORDER IS THE
# WHOLE POINT and it is release-failure-alert.yml's, kept identical on purpose:
# a failed `Dev <service>` job SKIPS the E2E shards, and the run's red gate job
# is STILL named `E2E`. During the Sep 2026 incident that got a deploy-role IAM
# failure triaged as an e2e problem. First match wins, so the earliest phase
# that failed is the one reported, because it is the one that caused the rest.
#
# "Dev " keeps its trailing space and sits above "Verify dev serving":
# verify-dev needs only gp-api and gp-webapp, so it can fail alongside another
# parallel Dev job, and the deploy failure is then the real story.
PHASES = (
    ("Await checks", "checks gate (pre-deploy checks failed)"),
    ("Dev ", "dev deploy (E2E shards were skipped, not run)"),
    ("Verify dev serving", "dev serving verification (dev did not converge to the deployed SHA)"),
    ("E2E", "E2E against dev"),
    ("Promote", "prod promotion"),
    ("Record prod", "prod promotion"),
    ("Check gp-ai images", "prod promotion"),
)

STARTUP_FAILURE_PHASE = "runner startup failure (no jobs ran)"

# The E2E phase is NOT this module's to ticket. gpbot-dev-test-triage.yml files
# one ticket per failing `@dev-only` spec off the same event, with the spec's
# own fingerprint and repro command, which is strictly better than anything
# derivable from a job name here. Two listeners filing for one failure would
# buy two investigations into one question — the exact waste the dedup in both
# workflows exists to prevent. Reported as a deferral rather than silence, so
# the Slack thread still shows that this triage saw the run and chose not to act.
DEFERRED_PHASES = frozenset({"E2E against dev"})

# Annotation lines that carry no information about WHICH failure this is. Every
# failed bash step emits the first one, so a signature built from it would make
# every unrelated failure in the repo look like the same incident — which for a
# per-streak dedup means the second distinct breakage silently joins the first
# one's ticket and is never investigated.
#
# Dropped only when something more specific survives: a step that produced
# nothing else leaves these as the only evidence there is, and a weak signature
# is still better than no ticket.
GENERIC_ANNOTATIONS = (
    re.compile(r"^process completed with exit code \d+\.?$"),
    re.compile(r"^the (job|operation) was canceled"),
    re.compile(r"^node\.?js? \d+ is deprecated"),
    re.compile(r"^the following actions? (target|uses) node"),
)

# Substitutions applied before hashing, so the same breakage on two runs hashes
# the same. Each one is a value that changes every run and would otherwise make
# every run a new incident: commit shas (release.yml threads them into image
# tags, so they appear inside otherwise-identical error text), run and job ids,
# timestamps, durations, and bare numbers.
#
# The sha pattern runs BEFORE the generic-number one, because a 40-char hex
# string is also a run of digits and letters and collapsing its digits first
# would leave a partially-masked token that still varies.
NORMALISERS = (
    (re.compile(r"\b[0-9a-f]{7,40}\b"), "<sha>"),
    (re.compile(r"\b\d{4}-\d{2}-\d{2}t[\d:.]+z?\b"), "<time>"),
    (re.compile(r"\b\d+(\.\d+)?(ms|s|m|h)\b"), "<dur>"),
    (re.compile(r"\b\d+\b"), "<n>"),
    (re.compile(r"\s+"), " "),
)

# How many normalised lines go into the signature. A job that emits one error
# per Terraform root emits 13, and all 13 are the same incident — but a cap
# keeps one pathological job (a matrix leg that annotates per file) from making
# the signature depend on how many things happened to break, which would split
# one streak across several tickets.
MAX_SIGNATURE_LINES = 12

# Enough to identify a failure, short enough to read in a ClickUp list. Same
# order of magnitude as dev_test_triage.MAX_TICKET_TITLE_CHARS, for the same
# reason: ClickUp truncates long names in list view and a title that identifies
# nothing costs the dedup its only human-readable check.
MAX_TICKET_TITLE_CHARS = 120

# Error text included in the ticket body. The analyze agent re-reads the run
# anyway, so this is orientation rather than evidence; a whole Terraform log
# pasted into a ClickUp description is unreadable and costs the useful part its
# visibility.
MAX_BODY_ERROR_LINES = 25
MAX_BODY_LINE_CHARS = 300


def _text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def failed_jobs(jobs: Any) -> list[dict]:
    """The jobs that did not pass, in the order the API reported them.

    `timed_out` counts with `failure`: a job killed by `timeout-minutes` blocked
    promotion exactly as hard as one that returned non-zero, and release
    35240376865's own history is full of them. `cancelled` does NOT count —
    the train cancels to coalesce a burst of merges, and a job cancelled that
    way observed nothing.
    """
    if not isinstance(jobs, list):
        return []
    return [job for job in jobs if isinstance(job, dict) and _text(job.get("conclusion")) in ("failure", "timed_out")]


def classify_phase(job_names: list[str], conclusion: str) -> str:
    """Which stage of the train died, named the way the Slack alert names it.

    A startup_failure schedules no jobs at all, so the job-name cases have
    nothing to match on and it is answered first.
    """
    if conclusion == "startup_failure":
        return STARTUP_FAILURE_PHASE
    joined = " | ".join(job_names)
    for needle, phase in PHASES:
        if needle in joined:
            return phase
    return "unknown — read the run"


def _normalise(line: str) -> str:
    out = line.strip().lower()
    for pattern, replacement in NORMALISERS:
        out = pattern.sub(replacement, out)
    return out.strip()


def _is_generic(raw: str) -> bool:
    """Judged on the RAW line, not the normalised one.

    Normalisation masks digits into `<n>`, so a pattern written against the text
    a human sees ("exit code 1") silently stops matching once the line has been
    through it. Keeping the two apart means the patterns above can be read
    against real log output, and neither list has to know about the other.
    """
    text = " ".join(raw.split()).lower()
    return any(pattern.match(text) for pattern in GENERIC_ANNOTATIONS)


def signature_lines(annotations: Any) -> list[str]:
    """The normalised, de-duplicated error lines a signature is built from.

    Sorted, because two runs can emit the same set of errors in different order
    — the Terraform roots in release.yml are applied in parallel and annotate as
    they finish — and an order-sensitive signature would call that two incidents.
    """
    if not isinstance(annotations, list):
        return []

    seen: set[str] = set()
    specific: list[str] = []
    generic: list[str] = []
    for raw in annotations:
        text = _text(raw)
        line = _normalise(text)
        if not line or line in seen:
            continue
        seen.add(line)
        (generic if _is_generic(text) else specific).append(line)

    chosen = specific or generic
    return sorted(chosen)[:MAX_SIGNATURE_LINES]


def signature(phase: str, annotations: Any) -> str:
    """A stable id for "this same failure", for the per-streak dedup.

    Phase is folded in so two unrelated breakages that happen to emit the same
    generic text — a bare `exit code 1` in the checks gate and in the promote
    step — are not treated as one incident.

    Truncated to 12 hex chars. This is a dedup key, not a security boundary,
    and it has to fit in a ClickUp task name beside a readable summary.
    """
    lines = signature_lines(annotations)
    digest = hashlib.sha256(("\n".join([phase, *lines])).encode("utf-8")).hexdigest()
    return digest[:12]


def is_infra(annotations: Any) -> bool:
    """Whether any error names a known-environmental failure.

    Imported signatures, not copied ones — see the module docstring. Substring
    matching against the lowercased raw line rather than the normalised one,
    because several entries contain digits ("502 bad gateway") that
    normalisation would mask into `<n>`.
    """
    if not isinstance(annotations, list):
        return False
    haystack = "\n".join(_text(raw) for raw in annotations).lower()
    return any(needle in haystack for needle in INFRA_LOG_SIGNATURES)


def _summary_line(annotations: Any) -> str:
    """The most specific error line, unnormalised, for the ticket title."""
    if not isinstance(annotations, list):
        return ""
    for raw in annotations:
        line = _text(raw).strip()
        if line and not _is_generic(line):
            return " ".join(line.split())
    for raw in annotations:
        line = _text(raw).strip()
        if line:
            return " ".join(line.split())
    return ""


def ticket_title(phase: str, sig: str, annotations: Any) -> str:
    """Deterministic from the phase and signature, which is what makes it a key.

    The workflow dedups on this name, scoped to tasks carrying the bot's tag —
    the same approach gpbot-dev-test-triage.yml takes, and for the same reason:
    ClickUp's list endpoint does not reliably return descriptions, so matching
    the signature in the body would cost one GET per open ticket per run.

    The signature is in the name rather than only the body so a human scanning
    the list can see that two tickets are two incidents.
    """
    head = f"[release] {phase.split(' (')[0]} — {sig}"
    summary = _summary_line(annotations)
    if not summary:
        return head[:MAX_TICKET_TITLE_CHARS]
    title = f"{head}: {summary}"
    if len(title) <= MAX_TICKET_TITLE_CHARS:
        return title
    return title[: MAX_TICKET_TITLE_CHARS - 1].rstrip() + "…"


def ticket_body(payload: dict, phase: str, sig: str, jobs: list[dict], infra: bool) -> str:
    """What the analyze agent reads first.

    Deliberately states what is NOT known. The failure shapes this triage
    catches are the ones where the obvious reading is wrong — a convergence
    check that fails after a clean apply, a gate job named E2E that never ran a
    test — so the body's job is to hand over the evidence and the phase without
    asserting a cause the module cannot know.
    """
    run = payload.get("run") if isinstance(payload.get("run"), dict) else {}
    annotations = payload.get("annotations")
    lines = []
    if isinstance(annotations, list):
        for raw in annotations[:MAX_BODY_ERROR_LINES]:
            line = " ".join(_text(raw).split())
            if line:
                lines.append(line[:MAX_BODY_LINE_CHARS])

    job_lines = (
        "\n".join(
            f"- `{_text(job.get('name'))}` ({_text(job.get('conclusion'))}) — {_text(job.get('html_url'))}"
            for job in jobs
        )
        or "- none reported"
    )
    error_block = "\n".join(f"    {line}" for line in lines) or "    (no annotations were returned)"

    infra_note = (
        "\n**This matched a known-environmental signature** "
        "(`ci_triage.INFRA_LOG_SIGNATURES`), so it may be a sick dependency "
        "rather than a defect. Confirm before changing code: the rule in "
        "`ci_triage.decide` is that infrastructure never becomes a fix run.\n"
        if infra
        else ""
    )

    return f"""## The release train failed and prod is not shipping

`release.yml` is the only path to prod, so this run's failure means the commit
did not promote. Failed at: **{phase}**.

Run: {_text(run.get("url"))}
Commit: `{_text(run.get("head_sha"))[:9]}` — {_text(run.get("display_title"))}
Signature: `{sig}` (identifies this failure across runs; one ticket per red streak)

### Failed jobs

{job_lines}

### What the run reported

```
{error_block}
```
{infra_note}
### What is wanted

Find why this phase failed and whether it is a defect in this repo. Two
readings are usually available and the obvious one is not reliably right —
release 35273516196 failed a Terraform convergence check, which reads as
broken infrastructure, and was a filename mismatch in `release.yml` itself.
So establish which before proposing a change.

If the train has already gone green on a later commit, say so and close this:
a transient failure that fixed itself is worth knowing about and is not worth
a code change. If it is still red, this is blocking every deploy.
"""


def triage(payload: Any) -> dict:
    """What failed, whether it is actionable, and what to file for it.

    `actionable` is the workflow's gate for writing to ClickUp, and it is false
    for three different reasons that a human reading Slack needs told apart:
    the run did not really fail (cancelled, or succeeded), the failure belongs
    to another listener (the E2E specs), or nothing failed that this can name.
    `reason` carries which.
    """
    if not isinstance(payload, dict):
        raise ValueError("triage input must be a JSON object")

    run = payload.get("run")
    if not isinstance(run, dict):
        raise ValueError("triage input needs a `run` object")

    conclusion = _text(run.get("conclusion"))
    if conclusion not in ("failure", "timed_out", "startup_failure"):
        return {
            "actionable": False,
            "reason": f"the run concluded `{conclusion or 'unknown'}`, which is not a failure this triages",
            "phase": None,
            "failed_jobs": [],
            "signature": None,
            "infra": False,
        }

    jobs = failed_jobs(payload.get("jobs"))
    job_names = [_text(job.get("name")) for job in jobs]
    phase = classify_phase(job_names, conclusion)

    if not jobs and conclusion != "startup_failure":
        # The run is red and no job admits to it. Real, and seen: a job evicted
        # mid-step can leave the run failed with every job reporting success.
        # Filed anyway rather than dropped — a red train with no failed job is
        # more alarming than a normal failure, not less — but said plainly.
        return {
            "actionable": False,
            "reason": (
                "the run failed but reported no failed job, so there is nothing to "
                "name or dedup on; read the run by hand"
            ),
            "phase": phase,
            "failed_jobs": [],
            "signature": None,
            "infra": False,
        }

    if phase in DEFERRED_PHASES:
        return {
            "actionable": False,
            "reason": (
                "the E2E shards are gpbot-dev-test-triage.yml's to ticket, per failing "
                "spec, so this files nothing for them"
            ),
            "phase": phase,
            "failed_jobs": job_names,
            "signature": None,
            "infra": False,
        }

    annotations = payload.get("annotations")
    sig = signature(phase, annotations)
    infra = is_infra(annotations)

    return {
        "actionable": True,
        "reason": None,
        "phase": phase,
        "failed_jobs": job_names,
        "signature": sig,
        "infra": infra,
        "ticket_title": ticket_title(phase, sig, annotations),
        "ticket_body": ticket_body(payload, phase, sig, jobs, infra),
    }


def main() -> int:
    """Read the run, jobs and annotations on stdin, write the triage on stdout.

    A CLI rather than an importable-only module, for the same reason
    ci_triage.py and dev_test_triage.py are: the workflow stays a fact gatherer
    that shells out here, and every judgement — including the ticket prose — is
    exercised by pytest instead of by a Monday morning release train.

    Exit 0 whenever a decision was reached, including every `actionable: false`
    case. Exit 1 only when the input could not be read, because a non-zero exit
    is the workflow's signal that it cannot trust the output, and a red triage
    job on every red release run would train everyone to ignore both.
    """
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"ERROR: unreadable triage input: {e}", file=sys.stderr)
        return 1

    try:
        result = triage(payload)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
