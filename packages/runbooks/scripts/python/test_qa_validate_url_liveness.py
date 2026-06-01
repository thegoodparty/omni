"""urls_resolve — bibliography URL liveness check (offline/deterministic).

All network and DNS access is monkeypatched; these tests NEVER touch the
network. Covers:

- URL extraction from structured paths (sources[].url, run_metadata.
  agenda_packet_url) and the UNION with inline [Label](URL) citations.
- a reachable URL -> pass; a dead URL -> annotate (never block).
- a private-IP / metadata-IP host -> SSRF-rejected, annotate (never block).
- a non-http scheme -> rejected.
- the _ip_is_blocked / _ssrf_check_url helpers directly.
- the meeting_briefing spec runs the check by default (enabled, no CLI flag).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import qa_validate

HERE = Path(__file__).resolve().parent
SPEC_PATH = HERE / "meeting_briefing_product_spec.json"


def _find(results, check_id: str):
    return next((r for r in results if r.check_id == check_id), None)


@pytest.fixture
def spec() -> dict:
    return qa_validate.load_product_spec(SPEC_PATH)


def _spec_urls_only() -> dict:
    """Real product spec with Layer-1 schema disabled and no inline citation
    paths, so a partial artifact exercises urls_resolve without tripping the
    other claim/source checks. url_check stays default-on."""
    s = qa_validate.load_product_spec(SPEC_PATH)
    s["output_format"].pop("schema", None)
    s["citation_paths"] = []
    return s


def _artifact(source_urls=None, agenda_url=None):
    return {
        "run_metadata": {"agenda_packet_url": agenda_url},
        "sources": [
            {"id": f"s{i}", "url": u} for i, u in enumerate(source_urls or [])
        ],
        "claims": [],
        "items": [],
    }


# ── SSRF helper unit tests ────────────────────────────────────────────────────

@pytest.mark.parametrize("ip", [
    "127.0.0.1",        # loopback
    "10.0.0.1",         # private
    "192.168.1.1",      # private
    "172.16.0.1",       # private
    "169.254.169.254",  # cloud metadata (link-local + explicit)
    "169.254.1.1",      # link-local
    "0.0.0.0",          # unspecified
    "224.0.0.1",        # multicast
    "::1",              # loopback v6
    "fc00::1",          # private v6 (unique-local)
    "not-an-ip",        # unparseable -> fail closed
])
def test_ip_is_blocked_true(ip):
    assert qa_validate._ip_is_blocked(ip) is True


@pytest.mark.parametrize("ip", ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1"])
def test_ip_is_blocked_false(ip):
    assert qa_validate._ip_is_blocked(ip) is False


def test_ssrf_check_rejects_non_http_scheme():
    assert "scheme" in (qa_validate._ssrf_check_url("ftp://example.com/x") or "")
    assert "scheme" in (qa_validate._ssrf_check_url("file:///etc/passwd") or "")
    assert "scheme" in (qa_validate._ssrf_check_url("javascript:alert(1)") or "")


def test_ssrf_check_rejects_private_host(monkeypatch):
    monkeypatch.setattr(
        qa_validate.socket, "getaddrinfo",
        lambda host, port: [(2, 1, 6, "", ("10.1.2.3", 0))],
    )
    reason = qa_validate._ssrf_check_url("http://internal.example/")
    assert reason is not None and "blocked IP" in reason


def test_ssrf_check_rejects_metadata_host(monkeypatch):
    monkeypatch.setattr(
        qa_validate.socket, "getaddrinfo",
        lambda host, port: [(2, 1, 6, "", ("169.254.169.254", 0))],
    )
    reason = qa_validate._ssrf_check_url("http://metadata/")
    assert reason is not None and "blocked IP" in reason


def test_ssrf_check_allows_public_host(monkeypatch):
    monkeypatch.setattr(
        qa_validate.socket, "getaddrinfo",
        lambda host, port: [(2, 1, 6, "", ("93.184.216.34", 0))],
    )
    assert qa_validate._ssrf_check_url("https://example.com/doc.pdf") is None


def test_ssrf_check_blocks_if_any_resolved_ip_unsafe(monkeypatch):
    # Host resolving to one public + one private IP must be blocked.
    monkeypatch.setattr(
        qa_validate.socket, "getaddrinfo",
        lambda host, port: [
            (2, 1, 6, "", ("93.184.216.34", 0)),
            (2, 1, 6, "", ("127.0.0.1", 0)),
        ],
    )
    assert qa_validate._ssrf_check_url("https://example.com/") is not None


# ── Extraction + probing (network stubbed) ────────────────────────────────────

def _stub_safe_dns(monkeypatch):
    """Every host resolves to a single public IP unless overridden per-test."""
    monkeypatch.setattr(
        qa_validate.socket, "getaddrinfo",
        lambda host, port: [(2, 1, 6, "", ("93.184.216.34", 0))],
    )


def test_extracts_structured_url_paths(monkeypatch):
    seen = []

    def fake_probe(url):
        seen.append(url)
        return 200, None

    _stub_safe_dns(monkeypatch)
    monkeypatch.setattr(qa_validate.urllib.request, "build_opener",
                        lambda *a, **k: _FakeOpener(fake_probe))

    artifact = _artifact(
        source_urls=["https://example.com/a", "https://example.com/b"],
        agenda_url="https://example.com/agenda.pdf",
    )
    res = qa_validate.run_deterministic(artifact, _spec_urls_only())
    chk = _find(res, "urls_resolve")
    assert chk is not None
    assert chk.details["unique_urls"] == 3
    assert set(seen) == {
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/agenda.pdf",
    }


def test_reachable_url_passes(monkeypatch):
    _stub_safe_dns(monkeypatch)
    monkeypatch.setattr(qa_validate.urllib.request, "build_opener",
                        lambda *a, **k: _FakeOpener(lambda u: (200, None)))
    artifact = _artifact(source_urls=["https://example.com/ok"])
    chk = _find(qa_validate.run_deterministic(artifact, _spec_urls_only()), "urls_resolve")
    assert chk is not None
    assert chk.status == "pass"
    assert chk.route == "pass"


def test_dead_url_annotates_not_blocks(monkeypatch):
    _stub_safe_dns(monkeypatch)
    monkeypatch.setattr(qa_validate.urllib.request, "build_opener",
                        lambda *a, **k: _FakeOpener(lambda u: (404, "Not Found")))
    artifact = _artifact(source_urls=["https://example.com/gone"])
    chk = _find(qa_validate.run_deterministic(artifact, _spec_urls_only()), "urls_resolve")
    assert chk is not None
    assert chk.status == "warning"
    assert chk.route == "annotate"  # advisory, never block
    assert chk.details["failures"][0]["status"] == 404


def test_unreachable_url_annotates(monkeypatch):
    _stub_safe_dns(monkeypatch)
    monkeypatch.setattr(qa_validate.urllib.request, "build_opener",
                        lambda *a, **k: _FakeOpener(lambda u: (None, "URLError: timed out")))
    artifact = _artifact(source_urls=["https://example.com/timeout"])
    chk = _find(qa_validate.run_deterministic(artifact, _spec_urls_only()), "urls_resolve")
    assert chk.status == "warning"
    assert chk.route == "annotate"


def test_private_ip_host_rejected_annotates(monkeypatch):
    # DNS points the host at a private IP -> SSRF reject, never probed.
    monkeypatch.setattr(
        qa_validate.socket, "getaddrinfo",
        lambda host, port: [(2, 1, 6, "", ("10.0.0.5", 0))],
    )

    def boom(u):
        raise AssertionError("must not probe an SSRF-rejected URL")

    monkeypatch.setattr(qa_validate.urllib.request, "build_opener",
                        lambda *a, **k: _FakeOpener(boom))
    artifact = _artifact(source_urls=["http://internal.example/secret"])
    chk = _find(qa_validate.run_deterministic(artifact, _spec_urls_only()), "urls_resolve")
    assert chk is not None
    assert chk.status == "warning"
    assert chk.route == "annotate"
    assert len(chk.details["rejected"]) == 1
    assert "blocked IP" in chk.details["rejected"][0]["reason"]


def test_metadata_ip_host_rejected(monkeypatch):
    monkeypatch.setattr(
        qa_validate.socket, "getaddrinfo",
        lambda host, port: [(2, 1, 6, "", ("169.254.169.254", 0))],
    )
    monkeypatch.setattr(qa_validate.urllib.request, "build_opener",
                        lambda *a, **k: _FakeOpener(lambda u: (_ for _ in ()).throw(
                            AssertionError("must not probe metadata IP"))))
    artifact = _artifact(agenda_url="http://169.254.169.254/latest/meta-data/")
    chk = _find(qa_validate.run_deterministic(artifact, _spec_urls_only()), "urls_resolve")
    assert chk.route == "annotate"
    assert len(chk.details["rejected"]) == 1


def test_non_http_scheme_rejected(monkeypatch):
    _stub_safe_dns(monkeypatch)
    monkeypatch.setattr(qa_validate.urllib.request, "build_opener",
                        lambda *a, **k: _FakeOpener(lambda u: (200, None)))
    artifact = _artifact(source_urls=["ftp://example.com/x"])
    chk = _find(qa_validate.run_deterministic(artifact, _spec_urls_only()), "urls_resolve")
    assert chk is not None
    assert chk.route == "annotate"
    assert chk.details["rejected"][0]["reason"].startswith("non-http(s) scheme")


def test_union_inline_citations_and_structured(monkeypatch):
    seen = []
    _stub_safe_dns(monkeypatch)
    monkeypatch.setattr(qa_validate.urllib.request, "build_opener",
                        lambda *a, **k: _FakeOpener(lambda u: (seen.append(u), (200, None))[1]))
    s = _spec_urls_only()
    s["citation_paths"] = ["summary"]
    artifact = _artifact(source_urls=["https://example.com/struct"])
    artifact["summary"] = "See [the report](https://example.com/inline)."
    qa_validate.run_deterministic(artifact, s)
    assert "https://example.com/struct" in seen
    assert "https://example.com/inline" in seen


# ── Default-on behavior ───────────────────────────────────────────────────────

def test_default_on_for_meeting_briefing_spec(spec, monkeypatch):
    # spec.url_check.enabled is true → check runs with check_urls left as None
    # (i.e. no --check-urls flag).
    _stub_safe_dns(monkeypatch)
    seen = []
    monkeypatch.setattr(qa_validate.urllib.request, "build_opener",
                        lambda *a, **k: _FakeOpener(lambda u: (seen.append(u), (200, None))[1]))
    artifact = _artifact(
        source_urls=["https://example.com/src"],
        agenda_url="https://example.com/agenda",
    )
    chk = _find(qa_validate.run_deterministic(artifact, spec, check_urls=None), "urls_resolve")
    assert chk is not None  # ran without the CLI flag
    assert set(seen) == {"https://example.com/src", "https://example.com/agenda"}


def test_force_disable_overrides_enabled_spec(spec, monkeypatch):
    monkeypatch.setattr(qa_validate.urllib.request, "build_opener",
                        lambda *a, **k: _FakeOpener(lambda u: (_ for _ in ()).throw(
                            AssertionError("must not probe when force-disabled"))))
    artifact = _artifact(source_urls=["https://example.com/src"])
    chk = _find(qa_validate.run_deterministic(artifact, spec, check_urls=False), "urls_resolve")
    assert chk is None  # force-disabled


def test_no_urls_self_skips(spec):
    # agenda_packet_url None and no source urls -> nothing to probe -> no finding.
    artifact = _artifact(source_urls=[], agenda_url=None)
    chk = _find(qa_validate.run_deterministic(artifact, spec, check_urls=None), "urls_resolve")
    assert chk is None


# ── Fake opener (stands in for build_opener().open) ───────────────────────────

class _FakeResp:
    def __init__(self, status):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _FakeOpener:
    """Mimics urllib's OpenerDirector. `fn(url) -> (status, err)`; a non-None
    err with status set raises HTTPError, a None status raises URLError."""

    def __init__(self, fn):
        self._fn = fn

    def open(self, req, timeout=None):
        url = req.full_url
        status, err = self._fn(url)
        if status is None:
            raise qa_validate.urllib.error.URLError(err or "unreachable")
        if status != 200:
            raise qa_validate.urllib.error.HTTPError(url, status, err or "", {}, None)  # type: ignore[arg-type]
        return _FakeResp(status)


def test_manifest_spec_json_is_valid():
    # Guard: the edited spec stays valid JSON and carries the new config.
    cfg = json.loads(SPEC_PATH.read_text())["url_check"]
    assert cfg["enabled"] is True
    assert "sources[].url" in cfg["url_paths"]
    assert "run_metadata.agenda_packet_url" in cfg["url_paths"]
