"""Ledger-history lookups the drafting orchestration needs (Implementation
Notes section 2.2's ledger line shape, section 10.4's duplicate key, and
section 7's 30-day rejection suppression).

This module only reads lines already in the bucket's ledger/<yyyy-mm>.jsonl
objects (via CaseScoutBucket.read_ledger_lines, which drafting.py's caller
loads once per run and passes in here) — it never talks to S3 itself, so
every function here is a plain, fast-to-test transform over a list of dicts.

Outcome vocabulary. Implementation Notes 2.2 names six outcomes (proposed,
covered, needsSetup, gated, capped, listFull). Three more record what
happened to a proposed case's PR, all written by the Publisher in prod.

publisher.py's _reconcile_pr_outcomes writes the first two once the PR
leaves the open state. Each copies the "proposed" line's runId,
conversationId, sessionId, agentId, severity, caseId and failureSummary,
adds prNumber, and lands in the ledger month it is written in (so the
Reader's 30-day month window always holds it while it still matters):

  - "merged": the case's PR merged. Carries `mergedAt`.
    trailing_merge_share counts it by caseId to move the nightly cap
    (section 10.7).
  - "rejected": a reviewer closed the PR without merging (section 7:
    "record that from PR closure... for 30 days"). Carries `closedAt`.
    find_rejection reads it to suppress re-proposing the same failure for
    30 days from then.

publisher.py's _close_stale_prs writes the third:

  - "prClosedStale": the scout itself closed the PR after 7 days unreviewed.
    Not a rejection, so nothing here reads it; the proposal counts as not
    merged in trailing_merge_share, and the failure is open again once
    find_duplicate's 30 days from the proposal pass. Written with
    agentId None, so parse_ledger_lines skips it.

Outcomes are per PR, not per case: a reviewer who drops one case from a PR
and merges the rest records "merged" for every case the PR proposed.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

DUPLICATE_WINDOW_DAYS = 30
REJECTION_SUPPRESSION_WINDOW_DAYS = 30
RECENT_PROPOSALS_WINDOW_DAYS = 30


def _normalize_summary(summary: str) -> str:
    return " ".join(summary.strip().lower().split())


def dedup_key(conversation_id: str, agent_id: str, failure_summary: str) -> tuple[str, str, str]:
    """Implementation Notes 10.4: "The ledger key that stops a repeat
    proposal... is conversation id plus agent plus the drafting call's
    one-line failure summary." Same key shape backs rejection suppression
    (section 7: "by the same conversation, agent and summary key")."""
    return (conversation_id, agent_id, _normalize_summary(failure_summary))


@dataclass(frozen=True)
class LedgerEntry:
    """One decoded ledger/<yyyy-mm>.jsonl line. Fields beyond what this
    module reads (runId, prNumber, severity, gateFailures, ...) are not
    modeled here — callers that need to re-append a line pass the raw dict
    through unchanged; this dataclass exists only for the fields the lookup
    functions below actually compare on."""

    conversation_id: str
    agent_id: str
    outcome: str
    case_id: str | None
    failure_summary: str
    created_at: datetime | None
    closed_at: datetime | None

    @property
    def key(self) -> tuple[str, str, str]:
        return dedup_key(self.conversation_id, self.agent_id, self.failure_summary)


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def parse_ledger_lines(raw_lines: list[dict[str, Any]]) -> list[LedgerEntry]:
    """Decodes raw ledger dicts (as read off the bucket) into LedgerEntry,
    skipping any line missing the fields every outcome carries
    (conversationId, agentId, outcome) rather than raising — a malformed
    historical line should never crash tonight's run over data this run
    didn't write."""
    entries = []
    for raw in raw_lines:
        conversation_id = raw.get("conversationId")
        agent_id = raw.get("agentId")
        outcome = raw.get("outcome")
        if not (isinstance(conversation_id, str) and isinstance(agent_id, str) and isinstance(outcome, str)):
            continue
        entries.append(
            LedgerEntry(
                conversation_id=conversation_id,
                agent_id=agent_id,
                outcome=outcome,
                case_id=raw.get("caseId") if isinstance(raw.get("caseId"), str) else None,
                failure_summary=raw.get("failureSummary") if isinstance(raw.get("failureSummary"), str) else "",
                created_at=_parse_timestamp(raw.get("createdAt")),
                closed_at=_parse_timestamp(raw.get("closedAt")),
            )
        )
    return entries


def find_duplicate(
    entries: list[LedgerEntry], conversation_id: str, agent_id: str, failure_summary: str, now: datetime
) -> LedgerEntry | None:
    """A prior "proposed" line for the same (conversation, agent, failure
    summary) key within the last DUPLICATE_WINDOW_DAYS, or None. Only
    "proposed" lines count: a candidate that was "covered", "needsSetup",
    "gated", "capped" or "listFull" on an earlier night produced no case to
    point a repeat at, so there is nothing to deduplicate against."""
    cutoff = now - timedelta(days=DUPLICATE_WINDOW_DAYS)
    key = dedup_key(conversation_id, agent_id, failure_summary)
    candidates = [
        e
        for e in entries
        if e.outcome == "proposed" and e.key == key and e.created_at is not None and e.created_at >= cutoff
    ]
    candidates.sort(key=lambda e: e.created_at, reverse=True)
    return candidates[0] if candidates else None


def find_rejection(
    entries: list[LedgerEntry], conversation_id: str, agent_id: str, failure_summary: str, now: datetime
) -> LedgerEntry | None:
    """A "rejected" line for the same key, closed within the last
    REJECTION_SUPPRESSION_WINDOW_DAYS from `closedAt` (Implementation Notes
    section 7: "suppress re-proposing the same underlying failure... for 30
    days [from closure]... After 30 days, or if the case was never proposed
    at all, the failure is open again if it recurs.")."""
    cutoff = now - timedelta(days=REJECTION_SUPPRESSION_WINDOW_DAYS)
    key = dedup_key(conversation_id, agent_id, failure_summary)
    matches = [
        e
        for e in entries
        if e.outcome == "rejected" and e.key == key and e.closed_at is not None and e.closed_at >= cutoff
    ]
    matches.sort(key=lambda e: e.closed_at, reverse=True)
    return matches[0] if matches else None


def recent_proposals_for_agent(entries: list[LedgerEntry], agent_id: str, now: datetime) -> list[LedgerEntry]:
    """Implementation Notes section 5: "the ledger's last 30 days of
    proposals for that agent" — part of the drafting call's system
    instructions, so the model itself can recognize a conversation it
    already turned into a case and answer "covered by" without needing
    find_duplicate's code-level backstop to catch every case."""
    cutoff = now - timedelta(days=RECENT_PROPOSALS_WINDOW_DAYS)
    return sorted(
        (
            e
            for e in entries
            if e.outcome == "proposed"
            and e.agent_id == agent_id
            and e.created_at is not None
            and e.created_at >= cutoff
        ),
        key=lambda e: e.created_at,
        reverse=True,
    )


def yyyymm_keys_covering(end: datetime, days: int) -> list[str]:
    """The set of ledger/<yyyy-mm>.jsonl month keys a [end - days, end]
    window can touch — at most 2 months for any window this module uses
    (<=30 days), since a window can only ever straddle one month boundary.
    Order is oldest first, de-duplicated, so a one-month window returns a
    single key."""
    start = end - timedelta(days=days)
    seen: list[str] = []
    for stamp in (start, end):
        key = stamp.strftime("%Y-%m")
        if key not in seen:
            seen.append(key)
    return seen
