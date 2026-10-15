"""Record and replay of page fetches for Universal Judge runs.

A judge run's ticket can carry a `replay` setting (`JudgeReplayRef`): `record`
saves each successful `/http/fetch` and `/http/head` response under the
ticket's store key, and `replay` serves the saved copy instead of fetching
live. Every failure here reads as "no recording": a record that fails leaves
the live response alone, and a replay read that fails fetches live.

Layout under `<key>/` in the artifacts bucket:

- `fetch/<sha256>.body` and `fetch/<sha256>.json`: a fetched body and its
  response metadata. The body is written first with `IfNoneMatch`, so it is
  the lock: only the writer that created it writes the metadata, and a
  metadata object always describes the body beside it.
- `head/<sha256>.json`: a HEAD check's status and final URL.
- `outcomes/<run_id>/<fetch|head>-<hit|miss>-<uuid>`: one empty marker per
  replay-mode request, counted by the judge. Markers never carry a URL.

`<sha256>` hashes the normalized requested URL, so a redirect is matched on
where the agent asked to go, and the recorded final URL is served unchanged.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal, TypeVar
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field

from broker.dynamodb_client import JudgeReplayRef, ScopeTicket

logger = logging.getLogger(__name__)

# Per recording run. Only saves that create an object count, so a URL
# fetched twice costs one, and a run that hits these has fetched hundreds of
# distinct pages.
MAX_OBJECTS_PER_RUN = 500
MAX_BYTES_PER_RUN = 500 * 1024 * 1024
# Downloads go up to 250 MB live. One PDF shouldn't fill a run's budget, so
# larger ones aren't recorded and replay as a miss.
MAX_RECORDED_DOWNLOAD_BYTES = 50 * 1024 * 1024

_STREAM_CHUNK = 1 * 1024 * 1024
_TRACKING_PARAMS = frozenset({"fbclid", "gclid"})

Kind = Literal["fetch", "head"]


def replay_enabled() -> bool:
    """Whether this broker deployment may record or replay page fetches.

    Off unless set: Terraform sets it in the dev broker only, so prod carries
    the code but can never mint a ticket that runs it. The fetch handlers
    check it again on every request, so turning it off stops a run already
    holding a replay ticket.
    """
    return os.environ.get("REPLAY_ENABLED", "").strip().lower() == "true"


def normalize_url(url: str) -> str:
    """The form two requests must share to match a recording.

    Drops the fragment and tracking parameters, lowercases the scheme and
    host, and sorts the query. Only the lookup key uses it; the live fetch
    always goes to the URL the agent sent.
    """
    parts = urlsplit(url)
    userinfo, at, hostport = parts.netloc.rpartition("@")
    query = sorted(
        (name, value)
        for name, value in parse_qsl(parts.query, keep_blank_values=True)
        if not name.lower().startswith("utm_") and name.lower() not in _TRACKING_PARAMS
    )
    return urlunsplit((parts.scheme.lower(), f"{userinfo}{at}{hostport.lower()}", parts.path, urlencode(query), ""))


def _url_digest(url: str) -> str:
    return hashlib.sha256(normalize_url(url).encode("utf-8")).hexdigest()


class _FetchMeta(BaseModel):
    # Read back from S3, and in seeded mode written by a bench, so a bad one
    # must read as a miss rather than reach the handler.
    model_config = ConfigDict(extra="forbid", strict=True)

    status: int = Field(..., ge=100, le=599)
    content_type: str
    final_url: str
    byte_size: int = Field(..., ge=0)


class _HeadMeta(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    status: int = Field(..., ge=100, le=599)
    final_url: str


MetaT = TypeVar("MetaT", _FetchMeta, _HeadMeta)


@dataclass(frozen=True)
class RecordedFetch:
    status: int
    content_type: str
    final_url: str
    byte_size: int
    body: AsyncIterator[bytes]


@dataclass(frozen=True)
class RecordedHead:
    status: int
    final_url: str


class PageReplay:
    def __init__(self, s3_client, bucket: str, dynamodb_client, table_name: str) -> None:
        self._s3 = s3_client
        self._bucket = bucket
        self._dynamodb = dynamodb_client
        self._table_name = table_name

    async def lookup_fetch(self, ticket: ScopeTicket, ref: JudgeReplayRef, url: str) -> RecordedFetch | None:
        base = f"{ref.key}/fetch/{_url_digest(url)}"
        meta = await self._read_meta(ticket, f"{base}.json", _FetchMeta)
        if meta is None:
            return None
        try:
            obj = await asyncio.to_thread(self._s3.get_object, Bucket=self._bucket, Key=f"{base}.body")
        except Exception as e:
            logger.warning("page_replay body read failed run_id=%s error=%s", ticket.run_id, type(e).__name__)
            return None
        stream = obj["Body"]
        if obj.get("ContentLength") != meta.byte_size:
            stream.close()
            logger.warning("page_replay body size mismatch run_id=%s", ticket.run_id)
            return None
        return RecordedFetch(
            status=meta.status,
            content_type=meta.content_type,
            final_url=meta.final_url,
            byte_size=meta.byte_size,
            body=_stream_body(stream),
        )

    async def lookup_head(self, ticket: ScopeTicket, ref: JudgeReplayRef, url: str) -> RecordedHead | None:
        meta = await self._read_meta(ticket, f"{ref.key}/head/{_url_digest(url)}.json", _HeadMeta)
        if meta is None:
            return None
        return RecordedHead(status=meta.status, final_url=meta.final_url)

    def record_fetch(
        self,
        ticket: ScopeTicket,
        ref: JudgeReplayRef,
        url: str,
        *,
        status: int,
        content_type: str,
        final_url: str,
        byte_size: int,
        body: bytes | None = None,
        body_path: str | None = None,
    ) -> None:
        """Save one fetch. Runs after the response is sent, and never raises."""
        try:
            # Only successful fetches are saved. An error page the base arm
            # saw may be transient, and the candidate gets its own try.
            if status >= 400:
                return
            if body_path is not None and byte_size > MAX_RECORDED_DOWNLOAD_BYTES:
                logger.info("page_replay download too large to record run_id=%s bytes=%d", ticket.run_id, byte_size)
                return
            meta = (
                _FetchMeta(status=status, content_type=content_type, final_url=final_url, byte_size=byte_size)
                .model_dump_json()
                .encode("utf-8")
            )
            size = byte_size + len(meta)
            if not self._reserve(ticket, size, objects=2):
                return
            base = f"{ref.key}/fetch/{_url_digest(url)}"
            try:
                if body_path is not None:
                    with open(body_path, "rb") as f:
                        created = self._put_once(ticket, f"{base}.body", f)
                else:
                    created = self._put_once(ticket, f"{base}.body", body or b"")
            except Exception:
                created = False
            if not created:
                self._release(ticket, size, objects=2)
                return
            # Only the writer that created the body writes its metadata, so a
            # recording never pairs one response's body with another's
            # headers. That makes a lost metadata write permanent for the URL,
            # so it gets one retry.
            if not self._put_once(ticket, f"{base}.json", meta) and not self._put_once(ticket, f"{base}.json", meta):
                # The body stays, and the lifecycle rule removes it, so only
                # the metadata's share comes back.
                self._release(ticket, len(meta), objects=1)
        except Exception as e:
            logger.warning("page_replay record failed run_id=%s error=%s", ticket.run_id, type(e).__name__)

    def record_head(self, ticket: ScopeTicket, ref: JudgeReplayRef, url: str, *, status: int, final_url: str) -> None:
        """Save one HEAD check. Runs after the response is sent, and never raises."""
        try:
            if status >= 400:
                return
            meta = _HeadMeta(status=status, final_url=final_url).model_dump_json().encode("utf-8")
            if not self._reserve(ticket, len(meta), objects=1):
                return
            if not self._put_once(ticket, f"{ref.key}/head/{_url_digest(url)}.json", meta):
                self._release(ticket, len(meta), objects=1)
        except Exception as e:
            logger.warning("page_replay record failed run_id=%s error=%s", ticket.run_id, type(e).__name__)

    async def mark(self, ticket: ScopeTicket, ref: JudgeReplayRef, kind: Kind, hit: bool) -> None:
        outcome = "hit" if hit else "miss"
        key = f"{ref.key}/outcomes/{ticket.run_id}/{kind}-{outcome}-{uuid.uuid4().hex}"
        try:
            await asyncio.to_thread(self._s3.put_object, Bucket=self._bucket, Key=key, Body=b"")
        except Exception as e:
            logger.warning("page_replay marker failed run_id=%s error=%s", ticket.run_id, type(e).__name__)

    async def _read_meta(self, ticket: ScopeTicket, key: str, model: type[MetaT]) -> MetaT | None:
        """A recording's metadata, or None for anything but a usable one.

        The broker has no ListBucket on the bucket, so a missing key comes
        back as AccessDenied rather than NoSuchKey; both are a miss.
        """
        try:
            obj = await asyncio.to_thread(self._s3.get_object, Bucket=self._bucket, Key=key)
            # Written after this run started, so it came from a base run that
            # outlived its poll. Serving it would make the replay depend on
            # timing, so it's a miss.
            if obj["LastModified"].timestamp() >= ticket.issued_at:
                obj["Body"].close()
                return None
            raw = await asyncio.to_thread(obj["Body"].read)
            return model.model_validate_json(raw)
        except Exception as e:
            code = getattr(e, "response", {}).get("Error", {}).get("Code", type(e).__name__)
            if code not in ("NoSuchKey", "AccessDenied", "404", "403"):
                logger.warning("page_replay read failed run_id=%s error=%s", ticket.run_id, code)
            return None

    def _put_once(self, ticket: ScopeTicket, key: str, body) -> bool:
        """Create the object unless it already exists. A lost race is normal:
        parallel subagents and broker tasks fetch the same page, and the
        first response wins."""
        try:
            self._s3.put_object(Bucket=self._bucket, Key=key, Body=body, IfNoneMatch="*")
            return True
        except Exception as e:
            code = getattr(e, "response", {}).get("Error", {}).get("Code", type(e).__name__)
            if code not in ("PreconditionFailed", "ConditionalRequestConflict"):
                logger.warning("page_replay write failed run_id=%s error=%s", ticket.run_id, code)
            return False

    def _reserve(self, ticket: ScopeTicket, size: int, *, objects: int) -> bool:
        """Count a save against the run's caps, atomically across broker tasks.

        Stamped on the run's ticket item like the data-query counter, so it
        is shared by every task and deleted with the ticket.
        """
        try:
            self._dynamodb.update_item(
                TableName=self._table_name,
                Key={"pk": {"S": ticket.pk}},
                UpdateExpression="ADD replay_objects :objects, replay_bytes :size",
                ConditionExpression=(
                    "attribute_exists(pk)"
                    " AND (attribute_not_exists(replay_objects) OR replay_objects <= :max_objects)"
                    " AND (attribute_not_exists(replay_bytes) OR replay_bytes <= :max_bytes)"
                ),
                ExpressionAttributeValues={
                    ":objects": {"N": str(objects)},
                    ":size": {"N": str(size)},
                    ":max_objects": {"N": str(MAX_OBJECTS_PER_RUN - objects)},
                    ":max_bytes": {"N": str(MAX_BYTES_PER_RUN - size)},
                },
            )
            return True
        except Exception as e:
            code = getattr(e, "response", {}).get("Error", {}).get("Code", type(e).__name__)
            if code == "ConditionalCheckFailedException":
                logger.info("page_replay run cap reached run_id=%s", ticket.run_id)
            else:
                logger.warning("page_replay reserve failed run_id=%s error=%s", ticket.run_id, code)
            return False

    def _release(self, ticket: ScopeTicket, size: int, *, objects: int) -> None:
        """Give back a reservation whose save created nothing, so duplicate
        fetches and lost races don't use up the run's caps."""
        try:
            self._dynamodb.update_item(
                TableName=self._table_name,
                Key={"pk": {"S": ticket.pk}},
                UpdateExpression="ADD replay_objects :objects, replay_bytes :size",
                ConditionExpression="attribute_exists(pk)",
                ExpressionAttributeValues={":objects": {"N": str(-objects)}, ":size": {"N": str(-size)}},
            )
        except Exception as e:
            code = getattr(e, "response", {}).get("Error", {}).get("Code", type(e).__name__)
            if code != "ConditionalCheckFailedException":
                logger.warning("page_replay release failed run_id=%s error=%s", ticket.run_id, code)


async def _stream_body(stream) -> AsyncIterator[bytes]:
    try:
        while True:
            chunk = await asyncio.to_thread(stream.read, _STREAM_CHUNK)
            if not chunk:
                return
            yield chunk
    finally:
        stream.close()
