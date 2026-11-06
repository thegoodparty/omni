"""Read-only access to the Universal Judge's own sweep records (gp-api
`src/chats/evals/judge/records.ts`/`record.ts`), for the noisy-case removal
detector (`noisy_cases.py`, Implementation Notes section 2.8).

The judge keeps every arm's per-attempt result at
`_judge/<sweepId>/records/<arm>/<agentId>/<caseId>-<attempt>.json` in
`gp-agent-artifacts-<environment>` — a bucket and a prefix this module never
writes to and never owns; it belongs to the judge sweep
(infrastructure/modules/universal-judge-sweep-policy). This story's Terraform
grant (infrastructure/modules/case-scout) opens read-only access scoped to
exactly that `records/` prefix, never `manifests/` or `rulings/` — which is
why "handled" below reads a `RunRecord`'s own `status` field
(`produced`/`blocked`/`infraError`) rather than a judge's yes/no verdict on
`handledWhen`: a verdict lives under `rulings/`, which this role cannot read.
"Handled" here means "this attempt's run produced a real answer", the signal
Implementation Notes 2.8 calls noise — a case unreliable to even capture,
independent of whether the answer was right.

Only the base arm matters here ("main's arm", ticket Implementation
Details) — the candidate arm is a PR's own branch, not production — so this
reader never requests it.
"""

import json
import re
from dataclasses import dataclass
from typing import Any, Protocol

import boto3
from botocore.exceptions import ClientError

JUDGE_RECORDS_BUCKET_ENV = "JUDGE_RECORDS_BUCKET"

JUDGE_PREFIX = "_judge"
BASE_ARM = "base"

HANDLED_STATUS = "produced"

# Mirrors recordKey's shape exactly (gp-api records.ts):
# _judge/<sweepId>/records/<arm>/<agentId>/<caseId>-<attempt>.json. caseId
# itself may contain hyphens, so the attempt number is split off the END of
# the filename, not the first hyphen after the prefix.
_RECORD_KEY_RE = re.compile(
    r"^_judge/(?P<sweepId>[^/]+)/records/(?P<arm>[^/]+)/(?P<agentId>[^/]+)/(?P<caseId>.+)-(?P<attempt>\d+)\.json$"
)


@dataclass(frozen=True)
class SweepAttempt:
    """One base-arm attempt at one case, as much as the removal detector
    needs: which sweep it was, when it ran (for ordering sweeps by
    recency), and whether it was handled."""

    sweep_id: str
    started_at: str
    status: str

    @property
    def handled(self) -> bool:
        return self.status == HANDLED_STATUS


class JudgeRecordsReader(Protocol):
    """The seam noisy_cases.py depends on — never a concrete S3 client —
    same pattern as CaseScoutMessageReader (reader/messages.py) and
    ChatCaseListReader (reader/case_lists.py)."""

    def base_arm_attempts(self, agent_id: str, case_id: str) -> list[SweepAttempt]:
        """Every base-arm attempt recorded for this agent/case, across
        every sweep this store holds, unordered and ungrouped — the caller
        groups by sweep and orders by recency."""
        ...


class FakeJudgeRecordsReader:
    """In-memory double for tests. Holds attempts for every (agentId,
    caseId) pair a test seeds, so a test can describe a case's sweep
    history directly without ever touching S3."""

    def __init__(self, attempts: dict[tuple[str, str], list[SweepAttempt]] | None = None):
        self._attempts = {k: list(v) for k, v in (attempts or {}).items()}

    def base_arm_attempts(self, agent_id: str, case_id: str) -> list[SweepAttempt]:
        return list(self._attempts.get((agent_id, case_id), []))


class S3JudgeRecordsReader:
    """Reads base-arm sweep records straight from the judge's own bucket.
    No pagination helper beyond boto3's own paginator — a prefix scan under
    `_judge/` across one case is bounded by how many sweeps have ever run,
    not by live traffic, so this never needs to be fast, only correct."""

    def __init__(self, bucket_name: str | None = None, s3_client: Any = None):
        self.bucket_name = bucket_name or _judge_records_bucket_from_env()
        self._s3 = s3_client or boto3.client("s3")

    def base_arm_attempts(self, agent_id: str, case_id: str) -> list[SweepAttempt]:
        attempts: list[SweepAttempt] = []
        paginator = self._s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket_name, Prefix=f"{JUDGE_PREFIX}/"):
            for obj in page.get("Contents", []):
                match = _RECORD_KEY_RE.match(obj["Key"])
                if match is None:
                    continue
                if match["arm"] != BASE_ARM or match["agentId"] != agent_id or match["caseId"] != case_id:
                    continue
                record = self._get_json(obj["Key"])
                if record is None:
                    continue
                status = record.get("status")
                started_at = record.get("startedAt")
                if not isinstance(status, str) or not isinstance(started_at, str):
                    # A record this malformed cannot be trusted either way
                    # (handled or not) — skipped rather than guessed, the
                    # same spirit as bucket.py's unparseable-ledger-line skip.
                    continue
                attempts.append(SweepAttempt(sweep_id=match["sweepId"], started_at=started_at, status=status))
        return attempts

    def _get_json(self, key: str) -> dict[str, Any] | None:
        try:
            response = self._s3.get_object(Bucket=self.bucket_name, Key=key)
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                return None
            raise
        result: dict[str, Any] = json.loads(response["Body"].read())
        return result


def _judge_records_bucket_from_env() -> str:
    import os

    name = os.environ.get(JUDGE_RECORDS_BUCKET_ENV, "")
    if not name:
        raise RuntimeError(f"{JUDGE_RECORDS_BUCKET_ENV} is not set; cannot address the judge's records bucket")
    return name
