"""The Publisher (TDD "The PR and the note" / "Discover" step 3; Implementation
Notes section 2.3 "Slack note", section 2.4 "The PR template", section 3 "The
Publisher"; ticket Implementation Details, Acceptance Criteria, Test Plan).

Runs as the Lambda's `publish` action (case_scout/lambda/handler.py) — the
GitHub-key-holding half of the TDD's three-process split. It never reads a
transcript: everything here comes from `runs/<runId>/bundle.json` (already
gated, already-fictional case fields), `sources.json` (caseId ->
conversationId, used only in the PRIVATE Slack note, never the PR), and
`record.json` (counts, spend, and the marker candidate the Reader computed —
see reader/main.py's module docstring for why that last piece lives there).

Pure stdlib + boto3/botocore only (via bucket.py/ai_secrets.py/github_auth.py)
— same constraint as every other top-level case_scout module: the Lambda zip
(infrastructure/modules/case-scout/main.tf's archive_file) ships this file's
source directly, with no pip-install step, so anything beyond the stdlib and
what the Lambda runtime already provides (boto3) would import-error at
runtime with no test ever catching it locally unless that test also skips a
virtualenv-installed dependency.

Publisher steps (ticket Implementation Details, numbered to match):
  1. Read the bundle.
  2. Skip any caseId already on `main` (read live via the GitHub API).
  3. For each agent with passing drafts, fetch `cases/<agent>.json`, append,
     commit through the Git Data API — no local clone.
  4. Open one PR a night (not one per agent).
  5. Post the Slack note.
  6. Advance the marker, only after 4 and 5 both succeed, via If-Match.

Plus the unreviewed-PR cleanup (Implementation Notes 2.8/7): closing a
case-scout PR open more than 7 days, as a step of this same nightly run.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Protocol
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from case_scout import ai_secrets, alerts, github_auth, selfcheck
from case_scout.bucket import CaseScoutBucket, Marker

GITHUB_API_BASE_URL = "https://api.github.com"
REPO = "thegoodparty/omni"
DEFAULT_BRANCH = "main"
# Matches reader/case_lists.py's _CASES_PATH exactly — same files, read here
# through the authenticated Contents API instead of that module's keyless
# raw-content read (see that module's docstring for why the Reader can't
# use this path: the Publisher is the only process allowed to hold write
# credentials, per the TDD's three-process isolation).
CASES_PATH = "packages/gp-api/src/chats/evals/judge/cases"
LABEL = "case-scout"
LABEL_COLOR = "5319e7"

OPEN_PRS_ENV = "CASE_SCOUT_OPEN_PRS"
SLACK_BOT_TOKEN_ENV = "SLACK_BOT_TOKEN"
SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage"

# Ticket: "The Slack channel is a per-environment config value, never
# hardcoded: #bot-dev (CL23R5BJ4) in dev, #product-chats-digest in prod."
# Both are channel IDs, what chat.postMessage actually needs. Prod is
# #product-chats-digest (C0C626B0ZJN), a private channel, where a name
# lookup is the riskier path. Kept as fallback DEFAULTS (S9 ticket:
# "keeping those literals as fallback defaults") now that the channel itself
# is overridable via CASE_SCOUT_SLACK_CHANNEL below.
SLACK_CHANNEL_DEV = "CL23R5BJ4"
SLACK_CHANNEL_PROD = "C0C626B0ZJN"
SLACK_CHANNEL_ENV = "CASE_SCOUT_SLACK_CHANNEL"

STALE_PR_MAX_AGE_DAYS = 7

# Ticket: "Record the two closure kinds distinctly in the ledger so the
# drafting story's 30-day logic reads the right signal." `rejected` is
# reserved for an explicit reviewer rejection (ledger.py's own docstring:
# no story in this epic's breakdown writes that outcome yet) — a 7-day
# stale auto-close is never that, so it gets its own outcome name that
# ledger.find_rejection will never match.
OUTCOME_PR_CLOSED_STALE = "prClosedStale"


class PublishError(Exception):
    """A Publisher step failed hard enough to abort tonight's publish —
    caught inside run_publish itself (never raised past it), same
    never-crash-the-Lambda contract every case_scout entry point keeps."""


class GitHubClient(Protocol):
    """The seam run_publish depends on — never the concrete
    RealGitHubClient — so every Publisher test runs against FakeGitHubClient
    with no real network call, the same pattern as
    reader/messages.py's CaseScoutMessageReader and
    reader/case_lists.py's ChatCaseListReader."""

    def read_file(self, path: str, ref: str) -> tuple[dict[str, Any] | None, str | None]:
        """The file's parsed JSON and blob sha, or (None, None) if it
        doesn't exist on `ref` yet (a brand-new agent's first case)."""
        ...

    def open_pr(
        self,
        branch: str,
        base: str,
        files: dict[str, dict[str, Any]],
        commit_message: str,
        pr_title: str,
        pr_body: str,
        label: str,
    ) -> dict[str, Any]:
        """Creates `branch` off `base`, commits every path in `files` (whole
        new file content, via the Git Data API, no local clone) in ONE
        commit, opens one PR, and labels it. Returns {"number", "url"}.
        Idempotent on a branch that already exists (a retried publish for
        the same runId): returns the existing PR instead of erroring or
        double-committing."""
        ...

    def list_open_labeled_prs(self, label: str) -> list[dict[str, Any]]:
        """Open PRs carrying `label`, each as {"number", "headRef",
        "createdAt", "url"}."""
        ...

    def close_pr(self, number: int, reason: str) -> None: ...

    def get_pr_body(self, number: int) -> str:
        """The PR's current body text — selfcheck.py's one read of
        already-published content, independent of whatever this process
        itself just rendered (render_pr_body never includes a conversation
        id by construction; this check exists to catch it anyway if that
        invariant is ever broken)."""
        ...


def _ensure_pem_safe_json_bytes(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, indent=2, sort_keys=False) + "\n").encode()


class RealGitHubClient:
    """GitHub REST + Git Data API over `urllib` (stdlib only — see module
    docstring), authenticated with the Delegate App's installation token
    (github_auth.installation_token(), the same credential autopilot uses
    to open PRs elsewhere in this account)."""

    def __init__(self, repo: str = REPO):
        self._repo = repo

    def _headers(self) -> dict[str, str]:
        token = github_auth.installation_token()
        if not token:
            raise PublishError("no GitHub App installation token available")
        return {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        }

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        req = Request(f"{GITHUB_API_BASE_URL}{path}", data=data, headers=self._headers(), method=method)
        with urlopen(req, timeout=15) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    def read_file(self, path: str, ref: str) -> tuple[dict[str, Any] | None, str | None]:
        try:
            result = self._request("GET", f"/repos/{self._repo}/contents/{path}?ref={ref}")
        except HTTPError as e:
            if e.code == 404:
                return None, None
            raise
        content = base64.b64decode(result["content"]).decode()
        return json.loads(content), result["sha"]

    def _get_ref_sha(self, ref: str) -> str:
        result = self._request("GET", f"/repos/{self._repo}/git/ref/heads/{ref}")
        sha = result["object"]["sha"]
        return str(sha)

    def _ensure_label_exists(self, label: str) -> None:
        try:
            self._request("POST", f"/repos/{self._repo}/labels", {"name": label, "color": LABEL_COLOR})
        except HTTPError as e:
            if e.code != 422:  # 422 Validation Failed: "already_exists"
                raise

    def _find_pr_for_branch(self, branch: str) -> dict[str, Any] | None:
        owner = self._repo.split("/")[0]
        result = self._request("GET", f"/repos/{self._repo}/pulls?head={owner}:{branch}&state=all")
        if result:
            pr = result[0]
            return {"number": pr["number"], "url": pr["html_url"]}
        return None

    def open_pr(
        self,
        branch: str,
        base: str,
        files: dict[str, dict[str, Any]],
        commit_message: str,
        pr_title: str,
        pr_body: str,
        label: str,
    ) -> dict[str, Any]:
        # Checked FIRST, not just inside the except below: a retried publish
        # for the same runId (branch names are deterministic:
        # case-scout/<runId>) after a fully-successful earlier attempt must
        # short-circuit before touching the Git Data API at all, the same as
        # a mid-attempt retry does below (AC: "idempotent re-publish after a
        # partial failure doesn't duplicate cases").
        existing = self._find_pr_for_branch(branch)
        if existing is not None:
            return existing

        try:
            self._commit_and_create_ref(branch, base, files, commit_message)
        except HTTPError as e:
            if e.code != 422:
                raise
            # The ref already exists but `_find_pr_for_branch` above found no
            # PR for it — an earlier attempt committed and created the
            # branch, then died before reaching POST /pulls (a 5xx, a
            # timeout, an oversized body). That branch already carries
            # whatever content that attempt computed; there is nothing left
            # to recommit, only a PR left to open against it. Re-raising
            # here (the original bug) made every later retry fail the exact
            # same way forever — the branch existed, no PR existed, and
            # nothing ever got past this check to create one.

        pr = self._request(
            "POST", f"/repos/{self._repo}/pulls", {"title": pr_title, "head": branch, "base": base, "body": pr_body}
        )
        self._ensure_label_exists(label)
        try:
            self._request("POST", f"/repos/{self._repo}/issues/{pr['number']}/labels", {"labels": [label]})
        except HTTPError:
            pass  # cosmetic only; a missing label never invalidates a real, already-open PR
        return {"number": pr["number"], "url": pr["html_url"]}

    def _commit_and_create_ref(
        self, branch: str, base: str, files: dict[str, dict[str, Any]], commit_message: str
    ) -> None:
        base_sha = self._get_ref_sha(base)
        base_commit = self._request("GET", f"/repos/{self._repo}/git/commits/{base_sha}")
        base_tree_sha = base_commit["tree"]["sha"]

        tree_entries = []
        for path, content in files.items():
            blob = self._request(
                "POST",
                f"/repos/{self._repo}/git/blobs",
                {"content": base64.b64encode(_ensure_pem_safe_json_bytes(content)).decode(), "encoding": "base64"},
            )
            tree_entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})

        tree = self._request(
            "POST", f"/repos/{self._repo}/git/trees", {"base_tree": base_tree_sha, "tree": tree_entries}
        )
        commit = self._request(
            "POST",
            f"/repos/{self._repo}/git/commits",
            {"message": commit_message, "tree": tree["sha"], "parents": [base_sha]},
        )
        self._request("POST", f"/repos/{self._repo}/git/refs", {"ref": f"refs/heads/{branch}", "sha": commit["sha"]})

    def list_open_labeled_prs(self, label: str) -> list[dict[str, Any]]:
        result = self._request("GET", f"/repos/{self._repo}/pulls?state=open&base={DEFAULT_BRANCH}&per_page=100")
        matches = []
        for pr in result or []:
            names = {entry["name"] for entry in pr.get("labels", [])}
            if label in names:
                matches.append(
                    {
                        "number": pr["number"],
                        "headRef": pr["head"]["ref"],
                        "createdAt": pr["created_at"],
                        "url": pr["html_url"],
                    }
                )
        return matches

    def close_pr(self, number: int, reason: str) -> None:
        try:
            self._request("POST", f"/repos/{self._repo}/issues/{number}/comments", {"body": reason})
        except HTTPError:
            pass  # best-effort explanation; closing below is what matters
        self._request("PATCH", f"/repos/{self._repo}/pulls/{number}", {"state": "closed"})

    def get_pr_body(self, number: int) -> str:
        result = self._request("GET", f"/repos/{self._repo}/pulls/{number}")
        body = result.get("body") if result else None
        return body or ""


class FakeGitHubClient:
    """In-memory double for tests — holds `main`'s case-list files and open
    PRs, and reproduces RealGitHubClient's two load-bearing quirks so
    Publisher tests can exercise idempotent re-publish without any real HTTP
    call: (1) a branch that already has an open PR returns that PR instead
    of erroring, and (2) a branch committed by an earlier attempt that died
    before opening its PR (`seed_orphan_branch`) recovers by opening the PR
    against what's already there, rather than getting stuck forever."""

    def __init__(self, files: dict[str, dict[str, Any]] | None = None, now: str = "2026-11-05T00:00:00+00:00"):
        self.files: dict[str, dict[str, Any]] = {k: json.loads(json.dumps(v)) for k, v in (files or {}).items()}
        self.open_prs: dict[str, dict[str, Any]] = {}
        self.orphan_branches: set[str] = set()
        self.closed_prs: list[int] = []
        self.commits: list[dict[str, Any]] = []
        self._now = now
        self._next_pr_number = 1000

    def read_file(self, path: str, ref: str) -> tuple[dict[str, Any] | None, str | None]:
        if path not in self.files:
            return None, None
        return json.loads(json.dumps(self.files[path])), "fake-sha"

    def open_pr(
        self,
        branch: str,
        base: str,
        files: dict[str, dict[str, Any]],
        commit_message: str,
        pr_title: str,
        pr_body: str,
        label: str,
    ) -> dict[str, Any]:
        if branch in self.open_prs:
            existing = self.open_prs[branch]
            return {"number": existing["number"], "url": existing["url"]}

        if branch in self.orphan_branches:
            # Mirrors RealGitHubClient.open_pr: the branch/commit already
            # exists from an earlier, PR-less attempt — nothing left to
            # commit, only the PR to open.
            self.orphan_branches.discard(branch)
        else:
            for path, content in files.items():
                self.files[path] = json.loads(json.dumps(content))
            self.commits.append({"branch": branch, "base": base, "files": files, "message": commit_message})

        number = self._next_pr_number
        self._next_pr_number += 1
        url = f"https://github.com/{REPO}/pull/{number}"
        self.open_prs[branch] = {
            "number": number,
            "url": url,
            "headRef": branch,
            "createdAt": self._now,
            "title": pr_title,
            "body": pr_body,
            "label": label,
        }
        return {"number": number, "url": url}

    def seed_orphan_branch(self, branch: str) -> None:
        """Test helper: simulates an earlier publish attempt that committed
        and created `branch` but died before reaching POST /pulls — the
        partial-failure window open_pr's retry path has to recover from."""
        self.orphan_branches.add(branch)

    def list_open_labeled_prs(self, label: str) -> list[dict[str, Any]]:
        return [
            {"number": pr["number"], "headRef": pr["headRef"], "createdAt": pr["createdAt"], "url": pr["url"]}
            for pr in self.open_prs.values()
            if pr.get("label") == label
        ]

    def close_pr(self, number: int, reason: str) -> None:
        for branch, pr in list(self.open_prs.items()):
            if pr["number"] == number:
                del self.open_prs[branch]
        self.closed_prs.append(number)

    def get_pr_body(self, number: int) -> str:
        for pr in self.open_prs.values():
            if pr["number"] == number:
                return str(pr.get("body") or "")
        return ""

    def seed_open_pr(self, branch: str, number: int, created_at: str) -> None:
        """Test helper: seeds a pre-existing open PR (e.g. from an earlier
        night) without going through open_pr — the stale-close tests need a
        PR whose age predates `now` by more than 7 days, which open_pr's own
        single `now` stamp can't produce."""
        self.open_prs[branch] = {
            "number": number,
            "url": f"https://github.com/{REPO}/pull/{number}",
            "headRef": branch,
            "createdAt": created_at,
            "title": "",
            "body": "",
            "label": LABEL,
        }


def case_scout_open_prs_enabled(environment: str) -> bool:
    """AC #1: "In dev, no PR is ever opened, whatever CASE_SCOUT_OPEN_PRS
    says." Only `environment == "prod"` even consults the env var — every
    other value (dev, "unknown", anything misconfigured) is forced dry,
    never the other way around."""
    if environment != "prod":
        return False
    return os.environ.get(OPEN_PRS_ENV, "false").strip().lower() == "true"


def slack_channel_for_environment(environment: str) -> str:
    """Ticket: "a per-environment config value, never hardcoded." Anything
    other than exactly "prod" gets the dev channel default — same
    fail-toward-dev default as pipeline.is_internal_filter_for_environment.

    S9 ticket: "read through ai_secrets.secret(...) (or os.environ.get(...)),
    the same way the Slack token is read, keeping those literals as fallback
    defaults." ai_secrets.secret() already checks the env var first (what
    lets CASE_SCOUT_SLACK_CHANNEL override in tests/local runs) before
    falling back to the AI_SECRETS_<ENV> bundle — this never puts the
    channel IN that bundle (it isn't a secret), but reuses the same helper
    for its env-var-wins-first behavior rather than hand-rolling it twice."""
    default = SLACK_CHANNEL_PROD if environment == "prod" else SLACK_CHANNEL_DEV
    return ai_secrets.secret(SLACK_CHANNEL_ENV) or default


def databricks_table_for_environment(environment: str) -> str:
    """Implementation Notes 2.3: "reading mart_case_scout.case_scout_messages
    (the _dev view in dev)"."""
    table = "case_scout_messages" if environment == "prod" else "case_scout_messages_dev"
    return f"mart_case_scout.{table}"


PR_FOOTER = (
    "---\n"
    "**How to review:** check each case's `condition` and `handledWhen` against the agent's current "
    "behavior; approve the ones that look right and edit any that need adjusting, the same as reviewing "
    'a handwritten case. "Needs setup" findings have no case yet — the fixture doesn\'t support them. '
    '"List full" cases are gated back because their agent is already at its case-list cap; swap one in '
    "manually if one belongs. Source conversations are never in this PR — they're linked in tonight's "
    "private Slack note."
)


def _format_case_bullet(case: dict[str, Any], severity: Any) -> list[str]:
    return [
        f"- `{case['caseId']}` (severity {severity})",
        f"  - condition: {case['condition']}",
        f"  - handledWhen: {case['handledWhen']}",
    ]


def render_pr_body(
    appended_by_agent: dict[str, list[dict[str, Any]]],
    needs_setup: list[dict[str, Any]],
    list_full: list[dict[str, Any]],
    removals: list[dict[str, Any]],
) -> str:
    """Implementation Notes 2.4: one section per agent (caseId, severity,
    condition, handledWhen — all gated fields), then needs-setup, list-full,
    proposed removals, then a fixed footer. No free text outside those
    fields, and no conversation ids anywhere in this output."""
    proposed_lines = ["## Proposed cases"]
    if appended_by_agent:
        for agent_id in sorted(appended_by_agent):
            proposed_lines.append(f"### {agent_id}")
            for d in appended_by_agent[agent_id]:
                proposed_lines.extend(_format_case_bullet(d["case"], d["severity"]))
    else:
        proposed_lines.append("(no new cases tonight)")

    needs_setup_lines = ["## Needs setup"]
    if needs_setup:
        for n in needs_setup:
            needs_setup_lines.append(f"- {n['agentId']} (severity {n['severity']}): {n['what']}")
    else:
        needs_setup_lines.append("(none)")

    list_full_lines = ["## List full"]
    if list_full:
        for lf in list_full:
            case = lf["case"]
            list_full_lines.append(
                f"- {lf['agentId']} (severity {lf['severity']}): `{case['caseId']}` — {case['condition']}"
            )
    else:
        list_full_lines.append("(none)")

    removals_lines = ["## Proposed removals"]
    if removals:
        for r in removals:
            removals_lines.append(f"- {r.get('agentId')}: `{r.get('caseId')}` — {r.get('reason', '')}")
    else:
        removals_lines.append("(none)")

    return "\n\n".join(
        [
            "\n".join(proposed_lines),
            "\n".join(needs_setup_lines),
            "\n".join(list_full_lines),
            "\n".join(removals_lines),
            PR_FOOTER,
        ]
    )


def render_slack_note(
    run_id: str,
    environment: str,
    pr_url: str | None,
    dry_run: bool,
    drafts: list[dict[str, Any]],
    sources: dict[str, Any],
    counts: dict[str, int],
    spend_tonight: float,
    spend_month_to_date: float,
) -> str:
    """Implementation Notes 2.3. The only surface carrying conversation ids
    (AC: "the only surface containing conversation ids") — never shown in
    the PR."""
    if pr_url:
        pr_line = f"PR: {pr_url}"
    elif dry_run:
        pr_line = "PR: dry run (CASE_SCOUT_OPEN_PRS is off)"
    else:
        pr_line = "PR: none opened (no new cases tonight)"

    case_lines = []
    conversation_ids = []
    for d in drafts:
        case = d["case"]
        case_id = case["caseId"]
        source = sources.get(case_id, {})
        conversation_id = source.get("conversationId", "unknown")
        conversation_ids.append(conversation_id)
        case_lines.append(
            f"- `{case_id}` ({d['agentId']}, severity {d['severity']}) — conversation `{conversation_id}`"
        )
    if not case_lines:
        case_lines = ["(none)"]

    table = databricks_table_for_environment(environment)
    if conversation_ids:
        id_list = ", ".join(f"'{c}'" for c in conversation_ids)
        query = f"SELECT * FROM {table} WHERE conversation_id IN ({id_list}) ORDER BY created_at"
    else:
        query = f"-- no cases tonight; nothing to query from {table}"

    counts_line = (
        f"Counts: covered={counts.get('covered', 0)}, needsSetup={counts.get('needsSetup', 0)}, "
        f"gated={counts.get('gated', 0)}, capped={counts.get('capped', 0)}, listFull={counts.get('listFull', 0)}"
    )
    spend_line = f"Spend: tonight ${spend_tonight:.2f}, month to date ${spend_month_to_date:.2f}"

    return "\n".join(
        [
            f"*Case scout — {run_id}*",
            pr_line,
            "",
            "Cases:",
            *case_lines,
            "",
            "Databricks query:",
            f"```{query}```",
            "",
            counts_line,
            spend_line,
        ]
    )


def _default_post_slack(channel: str, text: str) -> bool:
    token = ai_secrets.secret(SLACK_BOT_TOKEN_ENV)
    if not token:
        print("ERROR: SLACK_BOT_TOKEN not configured; dropping the case scout's Slack note")
        return False
    body = json.dumps({"channel": channel, "text": text}).encode()
    req = Request(
        SLACK_POST_MESSAGE_URL,
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode())
    except Exception as e:
        print(f"ERROR: failed to post the case scout's Slack note: {type(e).__name__}: {e}")
        return False
    if not result.get("ok"):
        print(f"ERROR: Slack chat.postMessage returned an error: {result.get('error')}")
        return False
    return True


def _tonight_counts(bucket: CaseScoutBucket, run_id: str) -> dict[str, int]:
    """Implementation Notes 2.3: "Counts: covered, needs setup, gated,
    capped, list full" — read straight back from the ledger lines
    reader/night.py already wrote for this exact runId, one line per
    decided candidate, so this never has to re-derive an outcome tally
    itself."""
    counts: dict[str, int] = {}
    for line in bucket.read_ledger_lines(run_id[:7]):
        if line.get("runId") != run_id:
            continue
        outcome = line.get("outcome", "unknown")
        counts[outcome] = counts.get(outcome, 0) + 1
    return counts


def _spend_for_run(bucket: CaseScoutBucket, run_id: str) -> float:
    record = bucket.read_run_record(run_id)
    if not record:
        return 0.0
    spend = record.get("spendUsd") or {}
    return float(spend.get("total", 0.0))


def _spend_month_to_date(bucket: CaseScoutBucket, run_id: str) -> float:
    yyyymm = run_id[:7] if len(run_id) >= 7 else ""
    if not yyyymm:
        return 0.0
    total = 0.0
    for other_run_id in bucket.list_run_ids_for_month(yyyymm):
        total += _spend_for_run(bucket, other_run_id)
    return total


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _record_stale_closure(bucket: CaseScoutBucket, pr: dict[str, Any], now: datetime) -> None:
    head_ref = pr.get("headRef", "") or ""
    original_run_id = head_ref.removeprefix("case-scout/")
    sources = bucket.read_run_sources(original_run_id) or {}
    if not sources:
        # Nothing to attribute the closure to (an ancient run, or a
        # hand-opened PR this sweep is still entitled to clean up). The PR
        # itself is already closed by the caller; only the ledger line is
        # skipped.
        return
    yyyymm = original_run_id[:7] if len(original_run_id) >= 7 else now.strftime("%Y-%m")
    for case_id, source in sources.items():
        bucket.append_ledger_line(
            yyyymm,
            {
                "runId": original_run_id,
                "conversationId": source.get("conversationId"),
                "sessionId": source.get("sessionId"),
                "agentId": None,
                "severity": None,
                "outcome": OUTCOME_PR_CLOSED_STALE,
                "caseId": case_id,
                "coveredBy": None,
                "needsSetup": None,
                "gateFailures": [],
                "prNumber": pr.get("number"),
                "failureSummary": "",
                "createdAt": now.isoformat(),
            },
        )


def _close_stale_prs(bucket: CaseScoutBucket, github: GitHubClient, environment: str, now: datetime) -> list[int]:
    """Implementation Details' "Unreviewed-PR cleanup" / Implementation
    Notes 2.8 and 7. Prod-only: dev never opens a real PR (AC #1), so there
    is nothing of the scout's OWN to clean up in dev, and the only
    `case-scout`-labeled PRs a dev Lambda could ever see are prod's real
    ones (same GitHub repo) — a dev deployment has no business closing
    those."""
    if environment != "prod":
        return []

    try:
        open_prs = github.list_open_labeled_prs(LABEL)
    except Exception as e:
        print(
            f"ERROR: case_scout publish: failed to list open {LABEL} PRs for the stale-close sweep: {type(e).__name__}: {e}"
        )
        return []

    cutoff = now - timedelta(days=STALE_PR_MAX_AGE_DAYS)
    closed: list[int] = []
    for pr in open_prs:
        created_at = _parse_iso(pr.get("createdAt"))
        if created_at is None or created_at > cutoff:
            continue
        try:
            github.close_pr(
                pr["number"], reason=f"Closed automatically: unreviewed for over {STALE_PR_MAX_AGE_DAYS} days."
            )
        except Exception as e:
            print(f"ERROR: case_scout publish: failed to close stale PR #{pr['number']}: {type(e).__name__}: {e}")
            continue
        closed.append(pr["number"])
        _record_stale_closure(bucket, pr, now)
    return closed


def _gate_dropped_every_draft_two_nights(bucket: CaseScoutBucket, run_id: str) -> bool:
    """Implementation Notes section 8 alert: "the gate dropped every draft
    two nights running." True only when BOTH of the last two calendar nights
    drafted at least one candidate (outcome "proposed" or "gated" — i.e. the
    model was actually asked and the result went through the gate) and NONE
    of them passed — a night with nothing to score at all is an uneventful
    night, never a gate problem, and must never trip this alert."""
    try:
        today = datetime.fromisoformat(run_id).date()
    except ValueError:
        return False

    for offset in (0, 1):
        night_id = (today - timedelta(days=offset)).isoformat()
        counts: dict[str, int] = {}
        for line in bucket.read_ledger_lines(night_id[:7]):
            if line.get("runId") != night_id:
                continue
            outcome = line.get("outcome", "unknown")
            counts[outcome] = counts.get(outcome, 0) + 1
        drafted = counts.get("proposed", 0) + counts.get("gated", 0)
        if drafted == 0 or counts.get("proposed", 0) > 0:
            return False
    return True


def _advance_marker(bucket: CaseScoutBucket, run_id: str) -> bool:
    """TDD: "The marker moves only after the publish succeeds." Applies the
    candidate reader/main.py computed and stashed in record.json's
    `newMarker` (see that module's docstring), via If-Match against the
    marker's current etag — a stale-etag write raises and is reported as a
    failed advance (AC: "a concurrent publish can't double-advance it"),
    never silently overwritten."""
    marker = bucket.read_marker()
    if marker.updated_by_run == run_id:
        return True  # an earlier attempt for this exact run already advanced it

    record = bucket.read_run_record(run_id)
    new_marker = (record or {}).get("newMarker")
    if new_marker is None:
        # No record.json (e.g. a bundle written directly in a test, outside
        # a real Reader run) — nothing to advance TO, so re-assert the
        # current values under a fresh etag rather than inventing one.
        last_session_start = marker.last_session_start
        processed_session_ids = list(marker.processed_session_ids)
    else:
        last_session_start = new_marker.get("lastSessionStart")
        processed_session_ids = list(new_marker.get("processedSessionIds", []))

    # Guards against a late publish for an OLDER runId (e.g. a stale retry
    # queued behind a more recent run that already published and moved the
    # marker forward) dragging lastSessionStart backwards, which would widen
    # the next query window and re-surface sessions already handled. Nothing
    # retries an old runId today, but the check costs nothing and the
    # alternative — silently rewinding the marker — is the kind of bug that
    # only shows up as a flood of duplicate candidates weeks later.
    current_last = marker.last_session_start
    if current_last is not None and last_session_start is not None:
        if datetime.fromisoformat(last_session_start) < datetime.fromisoformat(current_last):
            print(
                f"case_scout publish: runId={run_id}'s marker candidate ({last_session_start}) is older than "
                f"the current marker ({current_last}); refusing to move it backwards"
            )
            return False

    try:
        bucket.write_marker(
            Marker(
                last_session_start=last_session_start,
                processed_session_ids=processed_session_ids,
                updated_by_run=run_id,
                etag=marker.etag,
            )
        )
        return True
    except Exception as e:
        print(f"ERROR: case_scout publish: failed to advance the marker for runId={run_id}: {type(e).__name__}: {e}")
        return False


@dataclass(frozen=True)
class PublishResult:
    run_id: str
    had_bundle: bool
    pr_opened: bool
    pr_number: int | None
    pr_url: str | None
    dry_run: bool
    note_posted: bool
    marker_advanced: bool
    stale_closed: tuple[int, ...] = field(default_factory=tuple)
    skipped_already_on_main: tuple[str, ...] = field(default_factory=tuple)


def run_publish(
    run_id: str,
    bucket: CaseScoutBucket,
    environment: str,
    now: datetime,
    github: GitHubClient | None = None,
    post_slack: Any = None,
) -> PublishResult:
    github = github or RealGitHubClient()
    post_slack = post_slack or _default_post_slack

    stale_closed = _close_stale_prs(bucket, github, environment, now)

    bundle = bucket.read_run_bundle(run_id)
    if bundle is None:
        print(f"case_scout publish ({environment}): no bundle for runId={run_id}; nothing to publish")
        return PublishResult(
            run_id=run_id,
            had_bundle=False,
            pr_opened=False,
            pr_number=None,
            pr_url=None,
            dry_run=False,
            note_posted=False,
            marker_advanced=False,
            stale_closed=tuple(stale_closed),
        )

    sources = bucket.read_run_sources(run_id) or {}
    drafts = bundle.get("drafts", [])
    needs_setup = bundle.get("needsSetup", [])
    list_full = bundle.get("listFull", [])
    # A later story (S10, "noisy case removal proposals") is what actually
    # produces these — TDD Implementation Details: "this story renders
    # whatever the record provides, or an empty section if none."
    removals = bundle.get("removals", [])

    open_prs_allowed = case_scout_open_prs_enabled(environment)
    dry_run = not open_prs_allowed

    pr_number: int | None = None
    pr_url: str | None = None
    skipped_already_on_main: list[str] = []
    github_step_ok = True

    if drafts and open_prs_allowed:
        try:
            by_agent: dict[str, list[dict[str, Any]]] = {}
            for d in drafts:
                by_agent.setdefault(d["agentId"], []).append(d)

            files_to_commit: dict[str, dict[str, Any]] = {}
            appended_by_agent: dict[str, list[dict[str, Any]]] = {}
            total_appended = 0

            for agent_id, agent_drafts in by_agent.items():
                path = f"{CASES_PATH}/{agent_id}.json"
                existing, _sha = github.read_file(path, DEFAULT_BRANCH)
                if existing is None:
                    existing = {"agentId": agent_id, "cases": []}
                existing_cases = existing.get("cases", [])
                existing_ids = {c.get("caseId") for c in existing_cases if isinstance(c, dict)}

                new_cases = []
                kept_drafts = []
                for d in agent_drafts:
                    case_id = d["case"]["caseId"]
                    if case_id in existing_ids:
                        # AC: "A caseId already on main is never re-added" —
                        # covers both a genuinely re-proposed failure and a
                        # same-runId retry after a partial earlier success.
                        skipped_already_on_main.append(case_id)
                        continue
                    new_cases.append(d["case"])
                    kept_drafts.append(d)
                    existing_ids.add(case_id)

                if not new_cases:
                    continue

                updated = dict(existing)
                updated["cases"] = [*existing_cases, *new_cases]
                files_to_commit[path] = updated
                appended_by_agent[agent_id] = kept_drafts
                total_appended += len(new_cases)

            if files_to_commit:
                branch = f"case-scout/{run_id}"
                title = f"Proposed judge cases, {run_id}"
                commit_message = f"chore(judge): propose {total_appended} cases from production"
                body = render_pr_body(appended_by_agent, needs_setup, list_full, removals)
                pr = github.open_pr(branch, DEFAULT_BRANCH, files_to_commit, commit_message, title, body, LABEL)
                pr_number = pr["number"]
                pr_url = pr["url"]
        except Exception as e:
            github_step_ok = False
            print(
                f"ERROR: case_scout publish ({environment}) runId={run_id}: GitHub step failed: {type(e).__name__}: {e}"
            )

    note_posted = False
    if github_step_ok:
        counts = _tonight_counts(bucket, run_id)
        spend_tonight = _spend_for_run(bucket, run_id)
        spend_mtd = _spend_month_to_date(bucket, run_id)
        note = render_slack_note(
            run_id=run_id,
            environment=environment,
            pr_url=pr_url,
            dry_run=dry_run,
            drafts=drafts,
            sources=sources,
            counts=counts,
            spend_tonight=spend_tonight,
            spend_month_to_date=spend_mtd,
        )
        channel = slack_channel_for_environment(environment)
        note_posted = bool(post_slack(channel, note))

    marker_advanced = False
    if github_step_ok and note_posted:
        marker_advanced = _advance_marker(bucket, run_id)

    if not marker_advanced:
        # AC: "A failed run doesn't advance the marker and triggers an
        # alert" — this function's own contract already ties the two
        # together (_advance_marker only runs, and only succeeds, once the
        # GitHub step and the Slack post both did), so marker_advanced==False
        # at this point in the function IS "the run failed."
        alerts.post_alert(
            environment,
            subject="case scout run failed",
            message=(
                f"runId={run_id}: githubStepOk={github_step_ok} notePosted={note_posted} "
                f"markerAdvanced={marker_advanced}"
            ),
        )

    if _gate_dropped_every_draft_two_nights(bucket, run_id):
        alerts.post_alert(
            environment,
            subject="case scout: the gate dropped every draft two nights running",
            message=f"runId={run_id}: every candidate drafted tonight and last night was gated, none proposed.",
        )

    selfcheck.run_self_check(bucket, github, environment, recent_run_ids=[run_id])

    return PublishResult(
        run_id=run_id,
        had_bundle=True,
        pr_opened=pr_number is not None,
        pr_number=pr_number,
        pr_url=pr_url,
        dry_run=dry_run,
        note_posted=note_posted,
        marker_advanced=marker_advanced,
        stale_closed=tuple(stale_closed),
        skipped_already_on_main=tuple(skipped_already_on_main),
    )
