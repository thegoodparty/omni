from __future__ import annotations

import asyncio
import logging
import os

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from broker.browser_fetcher import MAX_BYTES, USER_AGENT, BrowserFetcher, BrowserFetchResult
from broker.dynamodb_client import JudgeReplayRef, ScopeTicket
from broker.page_replay import PageReplay, replay_enabled
from broker.ssrf_guard import resolve_redirects, validate_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/http", tags=["http"])

_DOWNLOAD_STREAM_CHUNK = 1 * 1024 * 1024  # 1 MB

__all__ = ["router", "get_scope_ticket", "get_browser_fetcher", "get_page_replay", "MAX_BYTES"]


class HttpFetchRequest(BaseModel):
    url: str
    purpose: str = ""


def get_scope_ticket() -> ScopeTicket:  # pragma: no cover
    raise NotImplementedError("Must be overridden via dependency_overrides")


def get_browser_fetcher() -> BrowserFetcher:  # pragma: no cover
    raise NotImplementedError("Must be overridden via dependency_overrides")


def get_http_client() -> httpx.AsyncClient:  # pragma: no cover
    raise NotImplementedError("Must be overridden via dependency_overrides")


def get_page_replay() -> PageReplay | None:
    # None rather than raising, unlike the others: an app that never wires
    # replay fetches live for every ticket, which is the safe reading.
    return None


def _active_replay(ticket: ScopeTicket, page_replay: PageReplay | None) -> JudgeReplayRef | None:
    if page_replay is None or ticket.replay is None or not replay_enabled():
        return None
    return ticket.replay


_HEAD_MAX_REDIRECTS = 5
_HEAD_TIMEOUT_S = 15.0
_HEAD_TOTAL_TIMEOUT_S = 25.0


class _HeaderInjectingClient:
    def __init__(self, client: httpx.AsyncClient, headers: dict[str, str]) -> None:
        self._client = client
        self._headers = headers

    def _wrap(self, method: str):
        async def call(url: str, **kwargs):
            merged = {**self._headers, **kwargs.pop("headers", {})}
            return await getattr(self._client, method)(url, headers=merged, **kwargs)

        return call

    def __getattr__(self, name: str):
        return self._wrap(name)


async def _status_check(client: httpx.AsyncClient, url: str) -> tuple[int, str]:
    """Lightweight SSRF-guarded liveness check — NO browser render.

    Verification only needs a status code, so this does a plain HEAD (falling
    back to a body-less GET when a server rejects HEAD with 403/405/501) instead
    of a full Chromium render. It never loads sub-resources, so it can't trip
    the embedded-tracker SSRF red herrings, and it's ~100x cheaper than
    `fetch`. The browser fetcher stays for when you actually need page content.

    Redirect resolution (per-hop `validate_url`, `urljoin` Location handling,
    missing-Location -> 502, hop bound) is delegated to the canonical
    `resolve_redirects` loop in `ssrf_guard` — never re-implemented here.
    """

    async def _run() -> tuple[int, str]:
        head_client = _HeaderInjectingClient(client, {"user-agent": USER_AGENT})
        try:
            resp, final_url = await resolve_redirects(
                head_client, "HEAD", url, timeout=_HEAD_TIMEOUT_S, max_redirects=_HEAD_MAX_REDIRECTS
            )
            if resp.status_code in (403, 405, 501):
                get_client = _HeaderInjectingClient(client, {"user-agent": USER_AGENT, "range": "bytes=0-0"})
                resp, final_url = await resolve_redirects(
                    get_client,
                    "GET",
                    final_url,
                    timeout=_HEAD_TIMEOUT_S,
                    max_redirects=_HEAD_MAX_REDIRECTS,
                )
            return resp.status_code, final_url
        except HTTPException:
            raise
        except httpx.TimeoutException as e:
            raise HTTPException(status_code=504, detail=f"timeout after {_HEAD_TIMEOUT_S}s: {url}") from e
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"connection failed: {type(e).__name__}: {e}") from e

    try:
        return await asyncio.wait_for(_run(), timeout=_HEAD_TOTAL_TIMEOUT_S)
    except TimeoutError as e:
        raise HTTPException(
            status_code=504,
            detail=f"head check exceeded {_HEAD_TOTAL_TIMEOUT_S}s total: {url}",
        ) from e


def _read_chunk(path: str, offset: int, size: int) -> bytes:
    with open(path, "rb") as f:
        f.seek(offset)
        return f.read(size)


async def _stream_file(path: str):
    """Stream a file from disk in 1 MB chunks via asyncio.to_thread so we
    never block the event loop on sync I/O. No aiofiles dep — uses the stdlib
    open() shipped over to a worker thread."""
    offset = 0
    while True:
        chunk = await asyncio.to_thread(_read_chunk, path, offset, _DOWNLOAD_STREAM_CHUNK)
        if not chunk:
            return
        offset += len(chunk)
        yield chunk


@router.post("/fetch")
async def http_fetch(
    req: HttpFetchRequest,
    ticket: ScopeTicket = Depends(get_scope_ticket),
    fetcher: BrowserFetcher = Depends(get_browser_fetcher),
    page_replay: PageReplay | None = Depends(get_page_replay),
):
    replay = _active_replay(ticket, page_replay)
    try:
        await validate_url(req.url)

        if replay is not None and replay.mode == "replay":
            assert page_replay is not None
            recorded = await page_replay.lookup_fetch(ticket, replay, req.url)
            await page_replay.mark(ticket, replay, "fetch", hit=recorded is not None)
            if recorded is not None:
                logger.info(
                    "http_fetch replayed run_id=%s status=%d content_type=%s bytes=%d purpose=%s url=%s",
                    ticket.run_id,
                    recorded.status,
                    recorded.content_type,
                    recorded.byte_size,
                    req.purpose or "",
                    req.url,
                )
                return StreamingResponse(
                    recorded.body,
                    media_type=recorded.content_type,
                    headers={
                        "X-Source-URL": recorded.final_url,
                        "X-Byte-Size": str(recorded.byte_size),
                        "X-Upstream-Status": str(recorded.status),
                    },
                )

        result = await fetcher.fetch(req.url)

        try:
            await validate_url(result.final_url)
        except HTTPException:
            # final URL is a private/blocked target — clean up any temp file
            # the fetcher handed back before raising.
            if result.body_path:
                try:
                    os.unlink(result.body_path)
                except OSError:
                    logger.warning(
                        "failed to unlink download tmp_path=%s after SSRF post-validate",
                        result.body_path,
                    )
            raise

        logger.info(
            "http_fetch ok run_id=%s status=%d content_type=%s bytes=%d purpose=%s url=%s",
            ticket.run_id,
            result.status,
            result.content_type,
            result.byte_size,
            req.purpose or "",
            req.url,
        )

        headers = {
            "X-Source-URL": result.final_url,
            "X-Byte-Size": str(result.byte_size),
            "X-Upstream-Status": str(result.status),
        }

        recording = replay is not None and replay.mode == "record"

        if result.body_path is not None:
            # Download path: stream from disk; BackgroundTask unlinks the
            # temp file after the response is fully sent.
            if recording:
                assert page_replay is not None and replay is not None
                background = BackgroundTask(_record_then_unlink, page_replay, ticket, replay, req.url, result)
            else:
                background = BackgroundTask(_unlink_quietly, result.body_path)
            return StreamingResponse(
                _stream_file(result.body_path),
                media_type=result.content_type,
                headers=headers,
                background=background,
            )

        # Page-response path: single in-memory chunk.
        body = result.body or b""

        async def _iter():
            yield body

        page_background = None
        if recording:
            assert page_replay is not None and replay is not None
            page_background = BackgroundTask(
                page_replay.record_fetch,
                ticket,
                replay,
                req.url,
                status=result.status,
                content_type=result.content_type,
                final_url=result.final_url,
                byte_size=result.byte_size,
                body=body,
            )

        return StreamingResponse(
            _iter(),
            media_type=result.content_type,
            headers=headers,
            background=page_background,
        )
    except HTTPException as e:
        logger.warning(
            "http_fetch failed run_id=%s status=%d purpose=%s url=%s detail=%s",
            ticket.run_id,
            e.status_code,
            req.purpose or "",
            req.url,
            e.detail,
        )
        raise


@router.post("/head")
async def http_head(
    req: HttpFetchRequest,
    background_tasks: BackgroundTasks,
    ticket: ScopeTicket = Depends(get_scope_ticket),
    client: httpx.AsyncClient = Depends(get_http_client),
    page_replay: PageReplay | None = Depends(get_page_replay),
):
    """Fast, non-browser liveness check (rung 2 of WebSearch -> http/head ->
    http/fetch). Returns the status code without rendering the page. Callers
    escalate to /fetch (browser) only when this is blocked (e.g. 403 from a
    Cloudflare-protected site that a bare request can't pass)."""
    replay = _active_replay(ticket, page_replay)
    try:
        recorded = None
        if replay is not None and replay.mode == "replay":
            assert page_replay is not None
            # _status_check validates the URL itself; a hit skips it, so check
            # here and keep a blocked URL failing the same way on both paths.
            await validate_url(req.url)
            recorded = await page_replay.lookup_head(ticket, replay, req.url)
            await page_replay.mark(ticket, replay, "head", hit=recorded is not None)
        if recorded is not None:
            status, final_url = recorded.status, recorded.final_url
        else:
            status, final_url = await _status_check(client, req.url)
    except HTTPException as e:
        logger.warning(
            "http_head failed run_id=%s status=%d purpose=%s url=%s detail=%s",
            ticket.run_id,
            e.status_code,
            req.purpose or "",
            req.url,
            e.detail,
        )
        raise
    logger.info(
        "http_head ok run_id=%s status=%d purpose=%s url=%s replayed=%s",
        ticket.run_id,
        status,
        req.purpose or "",
        req.url,
        recorded is not None,
    )
    if replay is not None and replay.mode == "record":
        assert page_replay is not None
        background_tasks.add_task(page_replay.record_head, ticket, replay, req.url, status=status, final_url=final_url)
    return {"status": status, "final_url": final_url}


def _record_then_unlink(
    page_replay: PageReplay, ticket: ScopeTicket, replay: JudgeReplayRef, url: str, result: BrowserFetchResult
) -> None:
    assert result.body_path is not None
    try:
        page_replay.record_fetch(
            ticket,
            replay,
            url,
            status=result.status,
            content_type=result.content_type,
            final_url=result.final_url,
            byte_size=result.byte_size,
            body_path=result.body_path,
        )
    finally:
        _unlink_quietly(result.body_path)


def _unlink_quietly(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        logger.warning("failed to unlink download tmp_path=%s after response", path)
