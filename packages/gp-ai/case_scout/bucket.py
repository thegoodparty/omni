"""Read/write helpers for the scout's private bucket (`case-scout-<env>`).

One client so later stories (Reader, gate, Publisher) share one place that
knows the object shapes, rather than hand-rolling S3 calls each time. Shapes
match Implementation Notes section 2.2 of the Universal Judge Case Iteration
TDD exactly — this module ships no business logic of its own, only typed
read/write helpers over those paths:

    marker.json               lastSessionStart, processedSessionIds   (moved after publish)
    claims/<runDate>          If-None-Match: *                        (one run a night)
    ledger/<yyyy-mm>.jsonl    conversationId, agentId, outcome, caseId, prNumber
    runs/<runId>/bundle.json  drafts that passed the gate
    runs/<runId>/sources.json caseId -> conversationId
    runs/<runId>/record.json  counts and spend by stage

No object here holds a transcript or any PII — see the TDD's PII gate (section
4): this bucket is reached only after a draft passes the gate, or it is the
scout's own bookkeeping (the marker, claims, the ledger).
"""

import json
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.exceptions import ClientError

BUCKET_NAME_ENV = "CASE_SCOUT_BUCKET"

MARKER_KEY = "marker.json"


def _claim_key(run_date: str) -> str:
    return f"claims/{run_date}"


def _ledger_key(yyyymm: str) -> str:
    return f"ledger/{yyyymm}.jsonl"


def _bundle_key(run_id: str) -> str:
    return f"runs/{run_id}/bundle.json"


def _sources_key(run_id: str) -> str:
    return f"runs/{run_id}/sources.json"


def _record_key(run_id: str) -> str:
    return f"runs/{run_id}/record.json"


@dataclass(frozen=True)
class Marker:
    """marker.json's fields, plus the S3 etag write_marker needs for its
    If-Match — carrying the etag on the dataclass (rather than returning a
    bare tuple) keeps "read, then write back the same version" a single
    round-trippable value."""

    last_session_start: str | None
    processed_session_ids: list[str]
    updated_by_run: str | None
    etag: str | None

    def to_json(self) -> dict[str, Any]:
        return {
            "lastSessionStart": self.last_session_start,
            "processedSessionIds": self.processed_session_ids,
            "updatedByRun": self.updated_by_run,
        }


class AlreadyClaimedError(Exception):
    """Raised by claim_run when the night is already claimed — a normal,
    expected outcome (one run a night), never a surprise. Callers that want
    the boolean shape should use claim_run's return value instead of
    catching this; it exists for callers that would rather branch on an
    exception than inspect a bool."""


class CaseScoutBucket:
    """Thin S3 wrapper for the scout's bucket. Every method takes/returns
    plain dicts and primitives — no AWS types leak past this module — so a
    caller (the Lambda, the Reader, a test) never needs to know this is S3
    rather than, say, a local dir in a future test double."""

    def __init__(self, bucket_name: str | None = None, s3_client: Any = None):
        self.bucket_name = bucket_name or _bucket_name_from_env()
        self._s3 = s3_client or boto3.client("s3")

    def read_marker(self) -> Marker:
        """The current marker, or an empty one (no etag) if none has ever
        been written — the scout's first-ever run has nothing to resume
        from, which is not an error."""
        try:
            response = self._s3.get_object(Bucket=self.bucket_name, Key=MARKER_KEY)
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                return Marker(last_session_start=None, processed_session_ids=[], updated_by_run=None, etag=None)
            raise
        body = json.loads(response["Body"].read())
        return Marker(
            last_session_start=body.get("lastSessionStart"),
            processed_session_ids=list(body.get("processedSessionIds", [])),
            updated_by_run=body.get("updatedByRun"),
            etag=response["ETag"],
        )

    def write_marker(self, marker: Marker) -> None:
        """Advances the marker. If-Match against the etag the marker was
        read with when one exists (so two publishes can't both advance it —
        TDD section 2.2), or an unconditional first write when there has
        never been one. Callers must read_marker() immediately before
        calling this, in the same run, so the etag is current."""
        kwargs: dict[str, Any] = {}
        if marker.etag is not None:
            kwargs["IfMatch"] = marker.etag
        else:
            # First-ever write: refuse to clobber a marker written since this
            # caller last checked, same spirit as the If-Match branch — only
            # here "since this caller last checked" means "ever", because an
            # etag-less read means the caller believes the key doesn't exist.
            kwargs["IfNoneMatch"] = "*"
        self._s3.put_object(
            Bucket=self.bucket_name,
            Key=MARKER_KEY,
            Body=json.dumps(marker.to_json()).encode(),
            ContentType="application/json",
            **kwargs,
        )

    def claim_run(self, run_date: str) -> bool:
        """Claims the night via claims/<runDate> with If-None-Match: * — one
        run a night (TDD section 2.2 / section 3 step 1). Returns True if
        this call won the claim, False if the night was already claimed.
        Never raises on an ordinary lost race; only a real S3 failure
        propagates."""
        try:
            self._s3.put_object(
                Bucket=self.bucket_name,
                Key=_claim_key(run_date),
                Body=b"{}",
                ContentType="application/json",
                IfNoneMatch="*",
            )
            return True
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("PreconditionFailed", "412"):
                return False
            raise

    def is_claimed(self, run_date: str) -> bool:
        try:
            self._s3.head_object(Bucket=self.bucket_name, Key=_claim_key(run_date))
            return True
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey"):
                return False
            raise

    def append_ledger_line(self, yyyymm: str, line: dict[str, Any]) -> None:
        """Appends one JSON line to ledger/<yyyy-mm>.jsonl. S3 has no native
        append, so this is a read-modify-write — acceptable here because the
        Publisher is the only writer (TDD: reading/publishing are separate
        processes) and ledger writes are one-per-decided-candidate, not a
        hot path."""
        key = _ledger_key(yyyymm)
        try:
            existing = self._s3.get_object(Bucket=self.bucket_name, Key=key)["Body"].read()
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                existing = b""
            else:
                raise
        new_line = json.dumps(line).encode()
        body = existing + (b"\n" if existing and not existing.endswith(b"\n") else b"") + new_line + b"\n"
        self._s3.put_object(Bucket=self.bucket_name, Key=key, Body=body, ContentType="application/jsonl")

    def write_run_bundle(self, run_id: str, bundle: dict[str, Any]) -> None:
        self._put_json(_bundle_key(run_id), bundle)

    def read_run_bundle(self, run_id: str) -> dict[str, Any] | None:
        """The run's bundle.json, or None if it was never written (a stub
        publish invoked before the Reader runs, or a run that produced no
        drafts and skipped writing one — TDD section 3: "If there are no
        drafts, it posts the note only"). Callers must treat None as a
        no-drafts publish, never an error."""
        return self._get_json(_bundle_key(run_id))

    def write_run_sources(self, run_id: str, sources: dict[str, Any]) -> None:
        self._put_json(_sources_key(run_id), sources)

    def read_run_sources(self, run_id: str) -> dict[str, Any] | None:
        return self._get_json(_sources_key(run_id))

    def write_run_record(self, run_id: str, record: dict[str, Any]) -> None:
        self._put_json(_record_key(run_id), record)

    def read_run_record(self, run_id: str) -> dict[str, Any] | None:
        return self._get_json(_record_key(run_id))

    def _put_json(self, key: str, value: dict[str, Any]) -> None:
        self._s3.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=json.dumps(value).encode(),
            ContentType="application/json",
        )

    def _get_json(self, key: str) -> dict[str, Any] | None:
        try:
            response = self._s3.get_object(Bucket=self.bucket_name, Key=key)
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                return None
            raise
        result: dict[str, Any] = json.loads(response["Body"].read())
        return result


def _bucket_name_from_env() -> str:
    import os

    name = os.environ.get(BUCKET_NAME_ENV, "")
    if not name:
        raise RuntimeError(f"{BUCKET_NAME_ENV} is not set; cannot address the scout's bucket")
    return name
