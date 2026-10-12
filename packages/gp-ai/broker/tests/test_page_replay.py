import io
import json
import os
import tempfile
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import boto3
import httpx
import pytest
from botocore.exceptions import ClientError
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from moto import mock_aws

from broker import page_replay as page_replay_module
from broker.browser_fetcher import BrowserFetchResult
from broker.dynamodb_client import JudgeReplayRef, ScopeTicket
from broker.endpoints.http_fetch import (
    get_browser_fetcher,
    get_http_client,
    get_page_replay,
    get_scope_ticket,
    router,
)
from broker.page_replay import PageReplay, _FetchMeta, _HeadMeta, normalize_url

BUCKET = "gp-agent-artifacts-dev"
TABLE = "scope-tickets"
AGENT = "race_opponent_collection"
SWEEP_KEY = f"_judge/replay/sweep/judge-1-1/{AGENT}/case-a-1"
SEED_KEY = f"_judge/replay/seed/{AGENT}/case-a"
URL = "https://example.gov/candidates/jane"

BASE_ISSUED = 1_800_000_000
CANDIDATE_ISSUED = BASE_ISSUED + 600


def _ticket(pk: str, mode: str, *, key: str = SWEEP_KEY, issued_at: int = BASE_ISSUED) -> ScopeTicket:
    return ScopeTicket(
        pk=pk,
        run_id=f"_judge-{pk}",
        organization_slug="org-1",
        experiment_id=AGENT,
        scope={},
        params={},
        exp=issued_at + 3600,
        issued_at=issued_at,
        issued_by="dispatch-lambda-dev",
        is_eval=True,
        replay=JudgeReplayRef(mode=mode, key=key),
    )


def _access_denied(op: str) -> ClientError:
    return ClientError({"Error": {"Code": "AccessDenied", "Message": "Access Denied"}}, op)


class _Stream:
    def __init__(self, data: bytes) -> None:
        self._buf = io.BytesIO(data)
        self.closed = False

    def read(self, size: int = -1) -> bytes:
        return self._buf.read(size)

    def close(self) -> None:
        self.closed = True


@dataclass
class FakeS3:
    """The broker's view of the artifacts bucket: Get and Put, no List.

    Without ListBucket a missing key reads as AccessDenied, which is what
    production sees and what the replay path must treat as a miss.
    """

    now: int = BASE_ISSUED + 10
    objects: dict[str, tuple[bytes, int]] = field(default_factory=dict)
    fail_puts: bool = False
    # Fail the next N writes whose key ends with the suffix.
    fail_next: dict[str, int] = field(default_factory=dict)
    get_error: str | None = None

    def put_object(self, *, Bucket, Key, Body, IfNoneMatch=None):
        assert Bucket == BUCKET
        suffix = next((x for x, n in self.fail_next.items() if n > 0 and Key.endswith(x)), None)
        if suffix is not None:
            self.fail_next[suffix] -= 1
        if self.fail_puts or suffix is not None:
            raise ClientError({"Error": {"Code": "InternalError", "Message": "boom"}}, "PutObject")
        if IfNoneMatch == "*" and Key in self.objects:
            raise ClientError({"Error": {"Code": "PreconditionFailed", "Message": "exists"}}, "PutObject")
        data = Body if isinstance(Body, bytes) else Body.read()
        self.objects[Key] = (data, self.now)
        return {}

    def get_object(self, *, Bucket, Key):
        assert Bucket == BUCKET
        if self.get_error is not None:
            raise ClientError({"Error": {"Code": self.get_error, "Message": "x"}}, "GetObject")
        if Key not in self.objects:
            raise _access_denied("GetObject")
        data, written = self.objects[Key]
        return {
            "Body": _Stream(data),
            "LastModified": datetime.fromtimestamp(written, UTC),
            "ContentLength": len(data),
        }

    def copy_recording(
        self, kind: str, src_url: str, dst_url: str, *, src_key: str = SWEEP_KEY, dst_key: str = SWEEP_KEY
    ):
        """Plant a recording for another URL, as a bench's seed store could."""
        src = f"{src_key}/{kind}/{page_replay_module._url_digest(src_url)}"
        dst = f"{dst_key}/{kind}/{page_replay_module._url_digest(dst_url)}"
        for key in self.keys_under(src):
            self.objects[key.replace(src, dst)] = self.objects[key]

    def keys_under(self, prefix: str) -> list[str]:
        return sorted(k for k in self.objects if k.startswith(prefix))

    def markers(self, ticket: ScopeTicket) -> list[str]:
        prefix = f"{ticket.replay.key}/outcomes/{ticket.run_id}/"
        return [k.removeprefix(prefix).rsplit("-", 1)[0] for k in self.keys_under(prefix)]


@dataclass
class FakeFetcher:
    results: list[BrowserFetchResult] = field(default_factory=list)
    calls: list[str] = field(default_factory=list)

    async def fetch(self, url: str) -> BrowserFetchResult:
        self.calls.append(url)
        return self.results.pop(0) if len(self.results) > 1 else self.results[0]


def _page(body: bytes, *, final_url: str = URL + "/", content_type: str = "text/plain", status: int = 200):
    return BrowserFetchResult(
        status=status,
        content_type=content_type,
        final_url=final_url,
        byte_size=len(body),
        body=body,
        body_path=None,
    )


def _download(payload: bytes) -> BrowserFetchResult:
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp.write(payload)
    tmp.close()
    return BrowserFetchResult(
        status=200,
        content_type="application/pdf",
        final_url=URL + ".pdf",
        byte_size=len(payload),
        body=None,
        body_path=tmp.name,
    )


@pytest.fixture
def ddb():
    with mock_aws():
        client = boto3.client("dynamodb", region_name="us-west-2")
        client.create_table(
            TableName=TABLE,
            AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        for pk in ("base", "base-2", "candidate"):
            client.put_item(TableName=TABLE, Item={"pk": {"S": pk}})
        yield client


@pytest.fixture(autouse=True)
def _replay_on_and_no_dns(monkeypatch):
    monkeypatch.setenv("REPLAY_ENABLED", "true")

    async def _validate(url: str) -> None:
        if "169.254" in url:
            raise HTTPException(status_code=400, detail="SSRF blocked")

    monkeypatch.setattr("broker.endpoints.http_fetch.validate_url", _validate)
    monkeypatch.setattr("broker.ssrf_guard.validate_url", _validate)


class Harness:
    def __init__(self, ddb, *, wired: bool = True) -> None:
        self.s3 = FakeS3()
        self.fetcher = FakeFetcher()
        self.head_calls: list[str] = []
        self.head_status = 200
        self.ticket: ScopeTicket | None = None

        def handler(req: httpx.Request) -> httpx.Response:
            self.head_calls.append(str(req.url))
            return httpx.Response(self.head_status)

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_scope_ticket] = lambda: self.ticket
        app.dependency_overrides[get_browser_fetcher] = lambda: self.fetcher
        app.dependency_overrides[get_http_client] = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
        if wired:
            replay = PageReplay(s3_client=self.s3, bucket=BUCKET, dynamodb_client=ddb, table_name=TABLE)
            app.dependency_overrides[get_page_replay] = lambda: replay
        self.client = TestClient(app)

    def fetch(self, ticket: ScopeTicket, url: str = URL, *results: BrowserFetchResult) -> httpx.Response:
        self.ticket = ticket
        self.fetcher.calls.clear()
        if results:
            self.fetcher.results = list(results)
        return self.client.post("/http/fetch", json={"url": url})

    def head(self, ticket: ScopeTicket, url: str = URL) -> httpx.Response:
        self.ticket = ticket
        self.head_calls.clear()
        return self.client.post("/http/head", json={"url": url})

    def as_candidate(self) -> None:
        self.s3.now = CANDIDATE_ISSUED + 5


BASE = _ticket("base", "record")
CANDIDATE = _ticket("candidate", "replay", issued_at=CANDIDATE_ISSUED)


class TestFetchReplay:
    def test_hit_serves_the_base_response_byte_for_byte(self, ddb):
        h = Harness(ddb)
        live = h.fetch(BASE, URL, _page(b"Jane Doe, city council", final_url=URL + "?redirected=1"))
        assert live.status_code == 200

        h.as_candidate()
        replayed = h.fetch(CANDIDATE, URL, _page(b"something newer"))

        assert h.fetcher.calls == []
        assert replayed.content == live.content == b"Jane Doe, city council"
        for header in ("content-type", "x-source-url", "x-byte-size", "x-upstream-status"):
            assert replayed.headers[header] == live.headers[header]
        assert h.s3.markers(CANDIDATE) == ["fetch-hit"]

    def test_upstream_status_and_content_type_survive(self, ddb):
        h = Harness(ddb)
        h.fetch(BASE, URL, _page(b'{"partial": true}', status=203, content_type="application/json"))
        h.as_candidate()
        r = h.fetch(CANDIDATE, URL, _page(b"live"))
        assert r.headers["x-upstream-status"] == "203"
        assert r.headers["content-type"] == "application/json"
        assert r.content == b'{"partial": true}'

    @pytest.mark.parametrize("status", [403, 404, 429, 503])
    def test_an_error_response_is_not_recorded(self, ddb, status):
        h = Harness(ddb)
        h.fetch(BASE, URL, _page(b"challenge page", status=status))
        h.as_candidate()
        assert h.fetch(CANDIDATE, URL, _page(b"live")).content == b"live"
        assert h.s3.markers(CANDIDATE) == ["fetch-miss"]

    @pytest.mark.parametrize(
        "meta",
        [
            b'{"status": 200}',
            b"[]",
            b"not json",
            b'{"status": "200", "content_type": "t", "final_url": "u", "byte_size": 8}',
        ],
    )
    def test_unreadable_metadata_is_a_miss(self, ddb, meta):
        h = Harness(ddb)
        h.fetch(BASE, URL, _page(b"recorded"))
        meta_key = next(k for k in h.s3.keys_under(f"{SWEEP_KEY}/fetch/") if k.endswith(".json"))
        h.s3.objects[meta_key] = (meta, h.s3.objects[meta_key][1])
        r = h.fetch(CANDIDATE, URL, _page(b"live"))
        assert r.status_code == 200
        assert r.content == b"live"

    def test_metadata_comes_only_from_the_writer_that_created_the_body(self, ddb):
        h = Harness(ddb)
        h.s3.fail_next = {".json": 2}
        h.fetch(BASE, URL, _page(b"first", final_url=URL + "/a"))
        h.fetch(BASE, URL, _page(b"other", final_url=URL + "/b"))
        h.as_candidate()
        assert h.fetch(CANDIDATE, URL, _page(b"live")).content == b"live"

    def test_one_failed_metadata_write_is_retried(self, ddb):
        h = Harness(ddb)
        h.s3.fail_next = {".json": 1}
        h.fetch(BASE, URL, _page(b"recorded"))
        h.as_candidate()
        assert h.fetch(CANDIDATE, URL, _page(b"live")).content == b"recorded"

    def test_miss_fetches_live_and_marks_a_miss(self, ddb):
        h = Harness(ddb)
        h.as_candidate()
        r = h.fetch(CANDIDATE, URL, _page(b"live page"))
        assert r.status_code == 200
        assert r.content == b"live page"
        assert h.fetcher.calls == [URL]
        assert h.s3.markers(CANDIDATE) == ["fetch-miss"]

    def test_replay_never_records(self, ddb):
        h = Harness(ddb)
        h.as_candidate()
        h.fetch(CANDIDATE, URL, _page(b"live page"))
        assert h.s3.keys_under(f"{SWEEP_KEY}/fetch/") == []

    def test_duplicate_url_keeps_the_first_response(self, ddb):
        h = Harness(ddb)
        h.fetch(BASE, URL, _page(b"first"))
        h.fetch(BASE, URL, _page(b"second, different"))
        h.as_candidate()
        assert h.fetch(CANDIDATE, URL, _page(b"live")).content == b"first"

    def test_a_write_after_the_candidate_started_is_a_miss(self, ddb):
        h = Harness(ddb)
        h.s3.now = CANDIDATE_ISSUED  # a base case that outlived its poll
        h.fetch(BASE, URL, _page(b"late base fetch"))
        r = h.fetch(CANDIDATE, URL, _page(b"live"))
        assert r.content == b"live"
        assert h.s3.markers(CANDIDATE) == ["fetch-miss"]

    def test_missing_recording_reads_as_access_denied_and_is_a_miss(self, ddb):
        h = Harness(ddb)
        with pytest.raises(ClientError) as raised:
            h.s3.get_object(Bucket=BUCKET, Key=f"{SWEEP_KEY}/fetch/nothing.json")
        assert raised.value.response["Error"]["Code"] == "AccessDenied"
        assert h.fetch(CANDIDATE, URL, _page(b"live")).content == b"live"

    def test_any_read_error_fetches_live(self, ddb):
        h = Harness(ddb)
        h.fetch(BASE, URL, _page(b"recorded"))
        h.s3.get_error = "SlowDown"
        r = h.fetch(CANDIDATE, URL, _page(b"live"))
        assert r.status_code == 200
        assert r.content == b"live"

    def test_a_body_that_disagrees_with_its_metadata_is_a_miss(self, ddb):
        h = Harness(ddb)
        h.fetch(BASE, URL, _page(b"recorded"))
        body_key = next(k for k in h.s3.keys_under(f"{SWEEP_KEY}/fetch/") if k.endswith(".body"))
        h.s3.objects[body_key] = (b"truncated", h.s3.objects[body_key][1])
        assert h.fetch(CANDIDATE, URL, _page(b"live")).content == b"live"

    def test_failed_record_leaves_the_live_response_alone(self, ddb):
        h = Harness(ddb)
        h.s3.fail_puts = True
        r = h.fetch(BASE, URL, _page(b"live page", final_url=URL + "/final"))
        assert r.status_code == 200
        assert r.content == b"live page"
        assert r.headers["x-source-url"] == URL + "/final"

    def test_blocked_url_fails_the_same_on_replay(self, ddb):
        h = Harness(ddb)
        blocked = "https://169.254.169.254/latest"
        h.fetch(BASE, URL, _page(b"recorded"))
        h.s3.copy_recording("fetch", URL, blocked)
        r = h.fetch(CANDIDATE, blocked, _page(b"x"))
        assert r.status_code == 400
        assert h.s3.markers(CANDIDATE) == []

    def test_seed_store_written_before_dispatch_replays_for_both_arms(self, ddb):
        h = Harness(ddb)
        h.fetch(BASE, URL, _page(b"planted page"))
        h.s3.copy_recording("fetch", URL, URL, dst_key=SEED_KEY)
        h.as_candidate()
        for pk in ("base", "candidate"):
            arm = _ticket(pk, "replay", key=SEED_KEY, issued_at=CANDIDATE_ISSUED)
            assert h.fetch(arm, URL, _page(b"live")).content == b"planted page"
            assert h.s3.markers(arm) == ["fetch-hit"]


class TestNormalizedMatching:
    @pytest.mark.parametrize(
        "variant",
        [
            URL + "#section-2",
            "HTTPS://EXAMPLE.GOV/candidates/jane",
            URL + "?utm_source=x&utm_campaign=y",
            URL + "?fbclid=abc",
            URL + "?gclid=abc",
        ],
    )
    def test_variants_of_the_recorded_url_hit(self, ddb, variant):
        h = Harness(ddb)
        h.fetch(BASE, URL, _page(b"recorded"))
        h.as_candidate()
        assert h.fetch(CANDIDATE, variant, _page(b"live")).content == b"recorded"
        assert h.fetcher.calls == []

    def test_live_fetch_goes_to_the_url_the_agent_sent(self, ddb):
        h = Harness(ddb)
        sent = URL + "?utm_source=x#top"
        h.fetch(BASE, sent, _page(b"page"))
        assert h.fetcher.calls == [sent]

    def test_query_order_does_not_matter(self):
        assert normalize_url("https://a.gov/p?b=2&a=1") == normalize_url("https://a.gov/p?a=1&b=2")

    def test_path_case_and_real_params_still_matter(self):
        assert normalize_url("https://a.gov/Page") != normalize_url("https://a.gov/page")
        assert normalize_url("https://a.gov/p?id=1") != normalize_url("https://a.gov/p?id=2")
        assert normalize_url("https://a.gov/p?utm=1") != normalize_url("https://a.gov/p")

    def test_userinfo_keeps_its_case(self):
        assert normalize_url("https://Me@A.GOV/p") == "https://Me@a.gov/p"


class TestDownloads:
    def test_recorded_download_replays(self, ddb):
        h = Harness(ddb)
        assert h.fetch(BASE, URL + ".pdf", _download(b"%PDF-1.7 agenda")).content == b"%PDF-1.7 agenda"
        h.as_candidate()
        replayed = h.fetch(CANDIDATE, URL + ".pdf", _page(b"live"))
        assert replayed.content == b"%PDF-1.7 agenda"
        assert replayed.headers["content-type"] == "application/pdf"

    def test_recording_a_download_still_removes_its_temp_file(self, ddb):
        h = Harness(ddb)
        result = _download(b"%PDF-1.7 agenda")
        h.fetch(BASE, URL + ".pdf", result)
        assert not os.path.exists(result.body_path)

    def test_oversized_download_is_not_recorded_and_replays_as_a_miss(self, ddb, monkeypatch):
        monkeypatch.setattr(page_replay_module, "MAX_RECORDED_DOWNLOAD_BYTES", 8)
        h = Harness(ddb)
        result = _download(b"%PDF-1.7 a long agenda")
        assert h.fetch(BASE, URL + ".pdf", result).content == b"%PDF-1.7 a long agenda"
        assert not os.path.exists(result.body_path)
        assert h.s3.keys_under(f"{SWEEP_KEY}/fetch/") == []

        h.as_candidate()
        assert h.fetch(CANDIDATE, URL + ".pdf", _page(b"live")).content == b"live"
        assert h.s3.markers(CANDIDATE) == ["fetch-miss"]

    def test_failed_download_record_still_removes_the_temp_file(self, ddb):
        h = Harness(ddb)
        h.s3.fail_puts = True
        result = _download(b"%PDF-1.7")
        assert h.fetch(BASE, URL + ".pdf", result).status_code == 200
        assert not os.path.exists(result.body_path)


class TestHeadReplay:
    def test_hit_returns_the_recorded_status_without_a_request(self, ddb):
        h = Harness(ddb)
        h.head_status = 204
        assert h.head(BASE).json() == {"status": 204, "final_url": URL}
        h.as_candidate()
        h.head_status = 200
        assert h.head(CANDIDATE).json() == {"status": 204, "final_url": URL}
        assert h.head_calls == []
        assert h.s3.markers(CANDIDATE) == ["head-hit"]

    def test_an_error_status_is_not_recorded(self, ddb):
        h = Harness(ddb)
        h.head_status = 404
        h.head(BASE)
        h.as_candidate()
        h.head_status = 200
        assert h.head(CANDIDATE).json()["status"] == 200
        assert h.s3.markers(CANDIDATE) == ["head-miss"]

    def test_unreadable_metadata_is_a_miss(self, ddb):
        h = Harness(ddb)
        h.head(BASE)
        meta_key = h.s3.keys_under(f"{SWEEP_KEY}/head/")[0]
        h.s3.objects[meta_key] = (b"[]", h.s3.objects[meta_key][1])
        assert h.head(CANDIDATE).status_code == 200
        assert h.head_calls == [URL]

    def test_miss_checks_live(self, ddb):
        h = Harness(ddb)
        h.as_candidate()
        assert h.head(CANDIDATE).json()["status"] == 200
        assert h.head_calls == [URL]
        assert h.s3.markers(CANDIDATE) == ["head-miss"]

    def test_head_and_fetch_recordings_are_separate(self, ddb):
        h = Harness(ddb)
        h.head(BASE)
        h.fetch(BASE, URL + "/fetched", _page(b"page", status=500))
        h.as_candidate()
        assert h.fetch(CANDIDATE, URL, _page(b"live")).content == b"live"
        assert h.head(CANDIDATE, URL + "/fetched").json()["status"] == 200
        assert h.head_calls == [URL + "/fetched"]

    def test_blocked_url_fails_the_same_on_replay(self, ddb):
        h = Harness(ddb)
        blocked = "https://169.254.169.254/x"
        h.head(BASE)
        h.s3.copy_recording("head", URL, blocked)
        assert h.head(CANDIDATE, blocked).status_code == 400
        assert h.s3.markers(CANDIDATE) == []


class TestRunCaps:
    def test_saves_stop_at_the_object_cap(self, ddb, monkeypatch):
        monkeypatch.setattr(page_replay_module, "MAX_OBJECTS_PER_RUN", 4)
        h = Harness(ddb)
        for n in range(3):
            h.fetch(BASE, f"{URL}/{n}", _page(b"page"))
        assert len(h.s3.keys_under(f"{SWEEP_KEY}/fetch/")) == 4

    def test_saves_stop_at_the_byte_cap(self, ddb, monkeypatch):
        monkeypatch.setattr(page_replay_module, "MAX_BYTES_PER_RUN", 250)
        h = Harness(ddb)
        h.fetch(BASE, f"{URL}/1", _page(b"x" * 100))
        h.fetch(BASE, f"{URL}/2", _page(b"x" * 100))
        assert len(h.s3.keys_under(f"{SWEEP_KEY}/fetch/")) == 2

    def test_refetching_a_saved_url_does_not_use_up_the_cap(self, ddb, monkeypatch):
        # One page (body and metadata), one HEAD record, then room for one more page.
        monkeypatch.setattr(page_replay_module, "MAX_OBJECTS_PER_RUN", 5)
        h = Harness(ddb)
        for _ in range(3):
            h.fetch(BASE, URL, _page(b"page"))
            h.head(BASE)
        h.fetch(BASE, f"{URL}/new", _page(b"page"))
        assert len(h.s3.keys_under(f"{SWEEP_KEY}/fetch/")) == 4

    def test_a_failed_save_does_not_use_up_the_cap(self, ddb, monkeypatch):
        monkeypatch.setattr(page_replay_module, "MAX_OBJECTS_PER_RUN", 2)
        h = Harness(ddb)
        h.s3.fail_next = {".body": 3}
        for n in range(3):
            h.fetch(BASE, f"{URL}/{n}", _page(b"page"))
        h.fetch(BASE, f"{URL}/ok", _page(b"page"))
        assert len(h.s3.keys_under(f"{SWEEP_KEY}/fetch/")) == 2

    def test_a_lost_metadata_write_gives_back_its_share_of_the_cap(self, ddb, monkeypatch):
        # Body (1) stays after its metadata fails twice; the next page's two
        # objects fit only if the metadata's slot came back.
        monkeypatch.setattr(page_replay_module, "MAX_OBJECTS_PER_RUN", 3)
        h = Harness(ddb)
        h.s3.fail_next = {".json": 2}
        h.fetch(BASE, f"{URL}/1", _page(b"page"))
        h.fetch(BASE, f"{URL}/2", _page(b"page"))
        assert len(h.s3.keys_under(f"{SWEEP_KEY}/fetch/")) == 3

    def test_caps_are_shared_by_every_broker_task(self, ddb, monkeypatch):
        monkeypatch.setattr(page_replay_module, "MAX_OBJECTS_PER_RUN", 2)
        first, second = Harness(ddb), Harness(ddb)
        second.s3 = first.s3
        first.fetch(BASE, f"{URL}/1", _page(b"page"))
        second.fetch(BASE, f"{URL}/2", _page(b"page"))
        assert len(first.s3.keys_under(f"{SWEEP_KEY}/fetch/")) == 2

    def test_a_deleted_ticket_records_nothing_and_leaves_no_item(self, ddb):
        h = Harness(ddb)
        gone = _ticket("ended-run", "record")
        assert h.fetch(gone, URL, _page(b"page")).status_code == 200
        assert h.s3.keys_under(f"{SWEEP_KEY}/fetch/") == []
        assert "Item" not in ddb.get_item(TableName=TABLE, Key={"pk": {"S": "ended-run"}})


class TestSwitchOff:
    @pytest.mark.parametrize("value", [None, "false", "1"])
    def test_switch_off_leaves_both_arms_live(self, ddb, monkeypatch, value):
        if value is None:
            monkeypatch.delenv("REPLAY_ENABLED")
        else:
            monkeypatch.setenv("REPLAY_ENABLED", value)
        h = Harness(ddb)
        h.fetch(BASE, URL, _page(b"base"))
        h.head(BASE)
        h.as_candidate()
        assert h.fetch(CANDIDATE, URL, _page(b"live")).content == b"live"
        assert h.head(CANDIDATE).json()["status"] == 200
        assert h.s3.objects == {}

    def test_an_app_that_never_wired_replay_fetches_live(self, ddb):
        h = Harness(ddb, wired=False)
        h.as_candidate()
        assert h.fetch(CANDIDATE, URL, _page(b"live")).content == b"live"
        assert h.head(CANDIDATE).json()["status"] == 200
        assert h.s3.objects == {}


class TestRecordingStaysOffTheEventLoop:
    """The saves are sync boto3 calls, so they must run in Starlette's
    threadpool rather than on the loop that serves every other request."""

    def test_saves_run_on_a_worker_thread(self, ddb, monkeypatch):
        threads: dict[str, int] = {}
        h = Harness(ddb)
        fetch = h.fetcher.fetch

        async def fetch_on_loop(url: str) -> BrowserFetchResult:
            threads["loop"] = threading.get_ident()
            return await fetch(url)

        for name in ("record_fetch", "record_head"):
            original = getattr(PageReplay, name)

            def spy(self, *args, _original=original, _name=name, **kwargs):
                threads[_name] = threading.get_ident()
                return _original(self, *args, **kwargs)

            monkeypatch.setattr(PageReplay, name, spy)
        monkeypatch.setattr(h.fetcher, "fetch", fetch_on_loop)

        h.fetch(BASE, URL, _page(b"page"))
        h.fetch(BASE, URL + ".pdf", _download(b"%PDF-1.7"))
        h.head(BASE)

        assert {"loop", "record_fetch", "record_head"} <= threads.keys()
        assert threads["record_fetch"] != threads["loop"]
        assert threads["record_head"] != threads["loop"]


class TestOutcomeMarkers:
    def test_markers_carry_only_the_outcome(self, ddb):
        h = Harness(ddb)
        h.fetch(BASE, URL, _page(b"recorded"))
        h.as_candidate()
        h.fetch(CANDIDATE, URL, _page(b"live"))
        h.fetch(CANDIDATE, URL + "/other", _page(b"live"))
        h.head(CANDIDATE)
        prefix = f"{SWEEP_KEY}/outcomes/{CANDIDATE.run_id}/"
        keys = h.s3.keys_under(prefix)
        assert sorted(h.s3.markers(CANDIDATE)) == ["fetch-hit", "fetch-miss", "head-miss"]
        for key in keys:
            assert h.s3.objects[key][0] == b""
            assert "example" not in key and "jane" not in key

    def test_a_failed_marker_write_still_serves_the_page(self, ddb):
        h = Harness(ddb)
        h.s3.fail_puts = True
        h.as_candidate()
        assert h.fetch(CANDIDATE, URL, _page(b"live")).content == b"live"


# The Universal Judge writes seeded pages straight into a seed store (gp-api
# `chats/evals/judge/runners/background.ts`, seedPageKeys and seedPageMeta). It
# hashes the URL as written, so each one must already be in this module's
# normalized form, and its metadata must be what _FetchMeta and _HeadMeta
# read. The judge's own schema is the gate on every PR; this runs when the
# broker changes, so a change here can't quietly stop matching them.
JUDGE_DIR = Path(__file__).resolve().parents[3] / "gp-api" / "src" / "chats" / "evals" / "judge"


def _seeded_urls() -> list[str]:
    lists = [*sorted((JUDGE_DIR / "cases").glob("*.json")), *sorted((JUDGE_DIR / "fixtures" / "seeded").glob("*.json"))]
    return [
        page["url"]
        for path in lists
        for case in json.loads(path.read_text())["cases"]
        for page in case.get("seedPages", [])
    ]


class TestJudgeSeededPages:
    def test_the_example_list_is_found(self):
        assert "https://www.example.com/people/jordan-rivera" in _seeded_urls()

    @pytest.mark.parametrize("url", _seeded_urls())
    def test_every_seeded_url_is_already_normalized(self, url):
        assert normalize_url(url) == url

    def test_the_judges_metadata_parses(self):
        meta = _FetchMeta.model_validate_json(
            '{"status":200,"content_type":"text/html",'
            '"final_url":"https://www.example.com/people/jordan-rivera",'
            '"byte_size":29}'
        )
        assert meta.byte_size == 29

    def test_the_judges_head_answer_parses(self):
        head = _HeadMeta.model_validate_json(
            '{"status":200,"final_url":"https://www.example.com/people/jordan-rivera"}'
        )
        assert head.status == 200
