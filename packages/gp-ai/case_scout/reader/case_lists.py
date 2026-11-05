"""Reads a chat agent's case list — count, current conditions, and the
fixture description — for the drafting call (TDD "Drafting": "A drafting
call sees the session, the agent's case list, the scout's recent proposals
and what the fixture holds."; Implementation Notes section 5's "the agent's
current conditions, to check against" and "the fixture description for the
scope"; section 2.8's 25-case soft cap).

WHY THIS READS GITHUB, NOT A LOCAL CHECKOUT: the Reader's Docker image
(case_scout/Dockerfile) copies only `shared/` and `case_scout/` — no gp-api
source at all, so `packages/gp-api/src/chats/evals/judge/cases/*.json` does
not exist inside the deployed container. The TDD's three-process isolation
("no process holds both a transcript and the GitHub key") means only the
Publisher may hold write-capable credentials; reading a PUBLIC file off
`main` needs no credential at all, so the Reader fetches it unauthenticated
from GitHub's raw content host — the same file the Publisher later reads
through the Contents API (Implementation Notes section 3, Publisher step 3)
to append to, just a different, keyless read path for a process that must
never hold write access.
"""

from dataclasses import dataclass
from typing import Any, Protocol

import httpx

_RAW_HOST = "https://raw.githubusercontent.com"
_REPO = "thegoodparty/omni"
_REF = "main"
_CASES_PATH = "packages/gp-api/src/chats/evals/judge/cases"

# Implementation Notes section 2.8: "a soft cap of about 25 cases per chat
# agent's list."
LIST_SOFT_CAP = 25

_TIMEOUT_SECONDS = 15


class CaseListFetchError(Exception):
    """The case list could not be fetched or parsed. Callers (drafting's
    orchestration) catch this per agent and continue the night with an empty
    CaseListInfo rather than aborting every candidate for every agent — a
    GitHub hiccup degrades to "the drafting call doesn't know about existing
    conditions tonight" rather than "the scout drafted nothing."
    """


@dataclass(frozen=True)
class CaseListInfo:
    """What the drafting call and the list-size cap need from one agent's
    case list. `conditions` and `case_count` both include the control case
    (`scored: false`) — it is a real entry in the list and counts toward the
    25-case soft cap the same as any other, even though it carries no
    `condition` to check against (filtered out of `conditions` naturally,
    since a control has none)."""

    agent_id: str
    case_count: int
    case_ids: frozenset[str]
    conditions: tuple[str, ...]
    fixture_description: str

    @property
    def is_full(self) -> bool:
        return self.case_count >= LIST_SOFT_CAP

    @staticmethod
    def empty(agent_id: str) -> "CaseListInfo":
        return CaseListInfo(
            agent_id=agent_id, case_count=0, case_ids=frozenset(), conditions=(), fixture_description=""
        )


class ChatCaseListReader(Protocol):
    """The swappable interface the drafting orchestration depends on — never
    the concrete GitHub reader, same pattern as CaseScoutMessageReader in
    reader/messages.py."""

    def read(self, agent_id: str) -> CaseListInfo: ...


def _parse_case_list(agent_id: str, payload: dict[str, Any]) -> CaseListInfo:
    cases = payload.get("cases")
    if not isinstance(cases, list):
        raise CaseListFetchError(f"{agent_id}'s case list had no cases array")

    case_ids = frozenset(c["caseId"] for c in cases if isinstance(c, dict) and isinstance(c.get("caseId"), str))
    conditions = tuple(
        c["condition"] for c in cases if isinstance(c, dict) and isinstance(c.get("condition"), str) and c["condition"]
    )
    fixture_description = payload.get("note") if isinstance(payload.get("note"), str) else ""

    return CaseListInfo(
        agent_id=agent_id,
        case_count=len(cases),
        case_ids=case_ids,
        conditions=conditions,
        fixture_description=fixture_description,
    )


class GithubChatCaseListReader:
    """Reads `cases/<agentId>.json` unauthenticated off `main`'s raw content
    host (see module docstring). One HTTP GET per agent per night — case
    lists are small (tens of KB) and nightly cadence makes caching not worth
    the staleness risk of serving a list a same-night PR just changed."""

    def __init__(self, repo: str = _REPO, ref: str = _REF, client: Any = None):
        self._repo = repo
        self._ref = ref
        self._client = client or httpx

    def read(self, agent_id: str) -> CaseListInfo:
        url = f"{_RAW_HOST}/{self._repo}/{self._ref}/{_CASES_PATH}/{agent_id}.json"
        try:
            response = self._client.get(url, timeout=_TIMEOUT_SECONDS)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as e:
            raise CaseListFetchError(f"could not fetch {agent_id}'s case list: {e}") from e
        if not isinstance(payload, dict):
            raise CaseListFetchError(f"{agent_id}'s case list was not a JSON object")
        return _parse_case_list(agent_id, payload)


class FakeChatCaseListReader:
    """Test double holding a fixed set of CaseListInfo by agent id. Every
    drafting test uses this — no test ever reaches the network (same
    convention as FakeCaseScoutMessageReader)."""

    def __init__(self, lists: dict[str, CaseListInfo] | None = None):
        self._lists = dict(lists or {})

    def read(self, agent_id: str) -> CaseListInfo:
        return self._lists.get(agent_id, CaseListInfo.empty(agent_id))
