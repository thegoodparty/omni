"""Noisy-case removal detection (TDD "No list gets an owner"; Implementation
Notes section 2.8; ticket Implementation Details).

The scout proposes removing a case when the BASE arm ("main's arm" — the
judge's own base/candidate split, record.py's `ArmSchema`; base is always
main, never a PR branch) splits its `ATTEMPTS_PER_CASE` runs — 1 or 2 of 3
handled, so neither 0/3 nor 3/3 — in at least half of that case's last
`SWEEP_WINDOW` sweeps. "Handled" is judge_records.py's own definition (a
RunRecord's `status == "produced"`), not a judge verdict: see that module's
docstring for why only that signal is reachable here.

A case failing 0/3 on every recent sweep is NEVER proposed, no matter how
many sweeps show it (Implementation Notes 2.8: "Never retired for failing on
both arms. A case from a prod failure is meant to fail until the agent is
fixed, which is what M4 climbs on.") — this falls out of the split
definition itself (0 is neither 1 nor 2), so there is no separate carve-out
to get wrong, only a boundary to keep right.

Advisory only: nothing here edits a case list or a GitHub file. This module
only produces `{caseId, agentId, reason}` proposals for the Publisher to
render into the PR body's "Proposed removals" section (publisher.py,
Implementation Notes 2.4) — a human reviewer decides whether to actually
remove a case, by editing the case list in that PR or a follow-up.
"""

from dataclasses import dataclass

from case_scout.reader.case_lists import CaseListFetchError, ChatCaseListReader
from case_scout.reader.judge_records import JudgeRecordsReader, SweepAttempt

# "the literal threshold to start" (ticket Implementation Details,
# "Starting threshold") — named constants so retuning is a number change
# here, never a change to the detection logic below.
SWEEP_WINDOW = 6
MIN_SPLIT_SWEEPS = 3  # "at least half" of SWEEP_WINDOW
ATTEMPTS_PER_CASE = 3

# Mirrors gp-api's CHAT_AGENT_IDS (src/chats/evals/judge/agents.ts) — kept
# here, rather than imported, for the same reason case_schema.py mirrors
# ChatCaseSchema: the Reader's Docker image carries no gp-api source
# (case_scout/Dockerfile copies only shared/ and case_scout/), so a real
# import is not available at runtime.
CHAT_AGENT_IDS: tuple[str, ...] = (
    "chief_of_staff",
    "campaign_assistant",
    "ordinance_flow",
    "priority_flow",
    "briefing_annotation",
)


@dataclass(frozen=True)
class RemovalProposal:
    case_id: str
    agent_id: str
    reason: str

    def to_json(self) -> dict[str, str]:
        return {"caseId": self.case_id, "agentId": self.agent_id, "reason": self.reason}


def _group_by_sweep(attempts: list[SweepAttempt]) -> dict[str, list[SweepAttempt]]:
    by_sweep: dict[str, list[SweepAttempt]] = {}
    for attempt in attempts:
        by_sweep.setdefault(attempt.sweep_id, []).append(attempt)
    return by_sweep


def _is_split_sweep(sweep_attempts: list[SweepAttempt]) -> bool:
    handled = sum(1 for a in sweep_attempts if a.handled)
    return 0 < handled < len(sweep_attempts)


def propose_removal_for_case(agent_id: str, case_id: str, judge_records: JudgeRecordsReader) -> RemovalProposal | None:
    """A sweep whose capture for this case was incomplete (not exactly
    ATTEMPTS_PER_CASE recorded attempts) is dropped before counting — it is
    neither a clean pass nor a split, only a partial capture that would
    otherwise muddy both."""
    by_sweep = _group_by_sweep(judge_records.base_arm_attempts(agent_id, case_id))
    complete_sweeps = {
        sweep_id: attempts for sweep_id, attempts in by_sweep.items() if len(attempts) == ATTEMPTS_PER_CASE
    }

    if len(complete_sweeps) < SWEEP_WINDOW:
        # Fewer than a full window of history: degrade to "no proposal"
        # rather than guess from a partial picture (ticket Test Plan).
        return None

    most_recent_first = sorted(
        complete_sweeps.items(),
        key=lambda item: max(a.started_at for a in item[1]),
        reverse=True,
    )
    last_window = most_recent_first[:SWEEP_WINDOW]

    split_count = sum(1 for _, attempts in last_window if _is_split_sweep(attempts))
    if split_count < MIN_SPLIT_SWEEPS:
        return None

    return RemovalProposal(
        case_id=case_id,
        agent_id=agent_id,
        reason=(
            f"base arm split {split_count}/{SWEEP_WINDOW} of its last sweeps "
            f"(neither 0/{ATTEMPTS_PER_CASE} nor {ATTEMPTS_PER_CASE}/{ATTEMPTS_PER_CASE} handled)"
        ),
    )


def propose_removals(
    case_list_reader: ChatCaseListReader,
    judge_records: JudgeRecordsReader,
    agent_ids: tuple[str, ...] = CHAT_AGENT_IDS,
) -> list[dict[str, str]]:
    """Every removal proposal across every chat agent's current case list,
    for the Publisher to render tonight. An agent whose case list cannot be
    fetched right now is skipped, not fatal — same resilience as
    drafting.py's own CaseListFetchError handling — since one GitHub hiccup
    must not cost every other agent's proposals."""
    proposals: list[dict[str, str]] = []
    for agent_id in agent_ids:
        try:
            info = case_list_reader.read(agent_id)
        except CaseListFetchError as e:
            print(f"case_scout noisy_cases: could not read {agent_id}'s case list, skipping removal checks: {e}")
            continue
        for case_id in sorted(info.case_ids):
            proposal = propose_removal_for_case(agent_id, case_id, judge_records)
            if proposal is not None:
                proposals.append(proposal.to_json())
    return proposals
