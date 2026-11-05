"""The Reader's view-reading interface (TDD section 1, "Discover" +
Implementation Notes 2.1), and its two implementations.

The interface is deliberately narrow — one method, taking the window the
Reader wants and the staff filter, returning plain `Message` values — so the
Reader's own logic (segmentation, scoring, drafting) never needs to know
whether it is reading the real `case_scout_messages` Databricks view or a
fake. The real view (`gp-data-platform`/`gp-terraform-dataplatform` PRs, per
the epic card) does not exist yet; every test in this package exercises
`FakeCaseScoutMessageReader` instead, so this story never blocks on it.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

import httpx

from case_scout import ai_secrets

# Field-level contract, Implementation Notes 2.1. No email, phone or user id
# column reaches this type — the view itself omits them.


@dataclass(frozen=True)
class ToolCall:
    tool: str
    input: str


@dataclass(frozen=True)
class Message:
    conversation_id: str
    scope: str
    message_id: str
    role: str
    content: str
    created_at: datetime
    tool_calls: list[ToolCall] = field(default_factory=list)
    is_internal: bool = False
    denylist: list[str] = field(default_factory=list)


class CaseScoutMessageReader(Protocol):
    """The swappable interface every Reader story depends on, never a
    concrete reader. `since=None` means "no marker yet — read everything
    available" (the scout's first-ever run); callers that already computed
    the 60-minute overlap (pipeline.py) pass that adjusted timestamp here,
    not the raw marker value."""

    def fetch_since(self, since: datetime | None, is_internal_filter: bool) -> list[Message]: ...


class FakeCaseScoutMessageReader:
    """The reader every test in this story (and every later Reader story,
    per the ticket) exercises against. Holds a fixed in-memory set of
    messages and reproduces the real reader's two filters — the time window
    and `is_internal` — so a test can assert on segmentation/dedup/overlap
    behavior without a Databricks connection."""

    def __init__(self, messages: list[Message]):
        self._messages = list(messages)

    def fetch_since(self, since: datetime | None, is_internal_filter: bool) -> list[Message]:
        result = self._messages
        if since is not None:
            result = [m for m in result if m.created_at >= since]
        if is_internal_filter:
            result = [m for m in result if not m.is_internal]
        return sorted(result, key=lambda m: (m.conversation_id, m.created_at))


# --- Concrete Databricks implementation ---------------------------------
#
# Not exercised by this story's tests (the real view doesn't exist yet — see
# this package's module docstring), but built against the field contract in
# Implementation Notes 2.1 so it is a drop-in once that view lands, per the
# ticket's instruction not to block on it. The first real exercise of this
# class is the TDD's own "first dev check" (Implementation Notes 1.9):
# querying `mart_case_scout.case_scout_messages_dev` as `sp_case_scout`.

_PROD_VIEW = "mart_case_scout.case_scout_messages"
_DEV_VIEW = "mart_case_scout.case_scout_messages_dev"

# One bounded pass per run, paged if needed (Implementation Notes 1.9: a
# 60-second statement timeout on every query through the RDS Proxy). A page
# comfortably finishes well under that even on a cold warehouse; a hard cap
# on pages keeps one run from turning into an unbounded loop if a marker
# somehow regresses far into the past.
_PAGE_SIZE = 2000
_MAX_PAGES = 25

_ENV_PREFIX = "CASE_SCOUT_DATABRICKS_"


class _OAuthM2MCredentials:
    """A databricks-sql-connector `credentials_provider`: a zero-arg
    callable returning a header-factory callable (the protocol
    `ExternalAuthProvider` expects — see databricks.sql.auth.authenticators).

    Hand-rolled against Databricks' documented OIDC client-credentials
    endpoint rather than pulling in `databricks-sdk` for one token fetch:
    this repo's other Databricks consumers (gp-api's
    `databricksConnection.ts`, `docs/databricks.md`) already describe OAuth
    M2M as client_id/client_secret against the SQL connector, and adding a
    second SDK dependency for a single POST isn't worth it. `httpx` is
    already a transitive dependency via `gp-shared`.
    """

    def __init__(self, hostname: str, client_id: str, client_secret: str):
        self._hostname = hostname.removeprefix("https://").rstrip("/")
        self._client_id = client_id
        self._client_secret = client_secret
        self._access_token: str | None = None
        self._expires_at: float = 0.0

    def __call__(self) -> Callable[[], dict[str, str]]:
        return self._header_factory

    def _header_factory(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token()}"}

    def _token(self) -> str:
        if self._access_token is None or time.monotonic() >= self._expires_at:
            self._refresh()
        assert self._access_token is not None
        return self._access_token

    def _refresh(self) -> None:
        response = httpx.post(
            f"https://{self._hostname}/oidc/v1/token",
            data={"grant_type": "client_credentials", "scope": "all-apis"},
            auth=(self._client_id, self._client_secret),
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
        self._access_token = payload["access_token"]
        # Refresh a minute early rather than racing the token's own expiry.
        self._expires_at = time.monotonic() + float(payload.get("expires_in", 3600)) - 60


def _env_credentials() -> tuple[str, str, str]:
    """Resolves the scout's own `sp_case_scout` OAuth M2M identity from the
    shared AI_SECRETS_<ENV> bundle (ai_secrets.secret honors a same-named
    env var first, which is what lets tests and local runs set these
    directly without AWS — see ai_secrets.py's own docstring)."""
    hostname = ai_secrets.secret(f"{_ENV_PREFIX}SERVER_HOSTNAME")
    http_path = ai_secrets.secret(f"{_ENV_PREFIX}HTTP_PATH")
    client_id = ai_secrets.secret(f"{_ENV_PREFIX}CLIENT_ID")
    client_secret = ai_secrets.secret(f"{_ENV_PREFIX}CLIENT_SECRET")
    missing = [
        name
        for name, value in (
            ("SERVER_HOSTNAME", hostname),
            ("HTTP_PATH", http_path),
            ("CLIENT_ID", client_id),
            ("CLIENT_SECRET", client_secret),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(
            f"missing {_ENV_PREFIX}{{{', '.join(missing)}}} — the scout's Databricks "
            "identity is a manual secrets step this card's description names as "
            "work outside omni, not yet done"
        )
    return hostname, http_path, client_id


def _row_to_message(row: dict[str, Any]) -> Message:
    return Message(
        conversation_id=row["conversation_id"],
        scope=row["scope"],
        message_id=row["message_id"],
        role=row["role"],
        content=row["content"],
        created_at=row["created_at"],
        tool_calls=[ToolCall(tool=tc["tool"], input=tc["input"]) for tc in (row.get("tool_calls") or [])],
        is_internal=bool(row["is_internal"]),
        denylist=list(row.get("denylist") or []),
    )


class DatabricksCaseScoutMessageReader:
    """Queries the `case_scout_messages` view over live federation
    (Implementation Notes 1.9 / 2.1). `environment` picks the prod view or
    its `_dev` twin — never a flag the caller has to get right by hand,
    since reading the wrong one in prod would read staff-filtered test
    data instead of production messages."""

    def __init__(self, environment: str):
        self._view = _PROD_VIEW if environment == "prod" else _DEV_VIEW

    def fetch_since(self, since: datetime | None, is_internal_filter: bool) -> list[Message]:
        from databricks import sql as databricks_sql

        hostname, http_path, client_id = _env_credentials()
        client_secret = ai_secrets.secret(f"{_ENV_PREFIX}CLIENT_SECRET")
        credentials_provider = _OAuthM2MCredentials(hostname, client_id, client_secret)

        where_clauses = ["deleted_at IS NULL"]
        params: dict[str, Any] = {}
        if since is not None:
            where_clauses.append("created_at >= :since")
            params["since"] = since
        if is_internal_filter:
            where_clauses.append("is_internal = false")
        where_sql = " AND ".join(where_clauses)

        messages: list[Message] = []
        with databricks_sql.connect(
            server_hostname=hostname,
            http_path=http_path,
            credentials_provider=credentials_provider,
        ) as connection:
            for page in range(_MAX_PAGES):
                # ORDER BY created_at alone isn't unique — rows sharing a
                # timestamp can be skipped or duplicated across OFFSET pages.
                # conversation_id, message_id breaks every tie deterministically
                # (message_id is the view's own primary key column).
                query = (
                    f"SELECT conversation_id, scope, message_id, role, content, created_at, "
                    f"tool_calls, is_internal, denylist FROM {self._view} "
                    f"WHERE {where_sql} "
                    f"ORDER BY created_at ASC, conversation_id ASC, message_id ASC "
                    f"LIMIT :limit OFFSET :offset"
                )
                with connection.cursor() as cursor:
                    cursor.execute(query, {**params, "limit": _PAGE_SIZE, "offset": page * _PAGE_SIZE})
                    columns = [desc[0] for desc in cursor.description or []]
                    rows = [dict(zip(columns, row, strict=True)) for row in cursor.fetchall() or []]
                if not rows:
                    break
                messages.extend(_row_to_message(r) for r in rows)
                if len(rows) < _PAGE_SIZE:
                    break
        return messages
