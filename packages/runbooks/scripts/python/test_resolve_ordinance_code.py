"""Behavioral contract for resolve_ordinance_code.

Network is faked (fakes over mocks): a fixture swaps the module's `_get` for a
routed in-memory fixture and clears the lru_caches, so every test exercises the
real matching logic deterministically. The load-bearing test is the same-name
trap: a state-scoped lookup must never leak a same-named city from another state.
"""
import json

import pytest

import resolve_ordinance_code as r

# Fake directory data. Municode is keyed by StateID; only the queried state's
# clients are ever returned, which is what protects against cross-state collisions.
_STATES = [
    {"StateID": 10, "StateAbbreviation": "GA"},
    {"StateID": 17, "StateAbbreviation": "KS"},
    {"StateID": 25, "StateAbbreviation": "MO"},
    {"StateID": 4, "StateAbbreviation": "AR"},
    {"StateID": 9, "StateAbbreviation": "FL"},
]
_CLIENTS = {
    10: [{"ClientID": 999, "ClientName": "Alpharetta"}],
    17: [{"ClientID": 100, "ClientName": "Herington"}],   # Kansas, no Horton
    25: [{"ClientID": 200, "ClientName": "Kansas City"}],  # the small-town trap target
    4: [{"ClientID": 300, "ClientName": "Little Rock"}],   # Arkansas, no Melbourne
    9: [{"ClientID": 400, "ClientName": "Melbourne"}],      # Florida Melbourne (the trap)
}
_PRODUCTS = {999: [{"ProductID": 12100, "ProductName": "Code of Ordinances"}]}
_GC_HTML = """
<h2>New Jersey</h2>
<ul><li><a href="https://ecode360.com/CL0966">City of Clifton</a></li></ul>
<h2>Michigan</h2>
<ul><li><a href="https://ecode360.com/BE1993">Village of Bellevue</a></li></ul>
"""


def _fake_get(url, timeout=30):
    if url.endswith("/States"):
        return json.dumps(_STATES).encode()
    if "/Clients/stateId/" in url:
        sid = int(url.rsplit("/", 1)[1])
        return json.dumps(_CLIENTS.get(sid, [])).encode()
    if "/Products/clientId/" in url:
        cid = int(url.rsplit("/", 1)[1])
        return json.dumps(_PRODUCTS.get(cid, [])).encode()
    if "generalcode.com" in url:
        return _GC_HTML.encode()
    raise AssertionError(f"unexpected url {url}")


@pytest.fixture(autouse=True)
def _fake_network(monkeypatch):
    monkeypatch.setattr(r, "_get", _fake_get)
    r._muni_states.cache_clear()
    r._muni_clients.cache_clear()
    r._gc_index.cache_clear()
    yield


@pytest.mark.parametrize("raw,expected", [
    ("Horton City Commission", "horton"),
    ("Cressona Borough Council", "cressona"),
    ("Shaker Heights City Council", "shaker heights"),
    ("Bellevue Village Trustee (unexpired term)", "bellevue"),
    ("City of Albertville", "albertville"),
    ("FAIRHOPE CITY (EST.)", "fairhope"),
    ("Melbourne City Council - Ward 4, Position 2", "melbourne"),
])
def test_norm_reduces_to_bare_place(raw, expected):
    assert r.norm(raw) == expected


def test_municode_exact_match_returns_stable_handles():
    out = r.resolve("GA", "Alpharetta City Council")
    assert out["resolved"] is True
    assert out["source"] == "municode"
    assert out["matched"] == "Alpharetta"
    assert out["client_id"] == 999
    assert out["product_id"] == 12100  # picked the "Code of Ordinances" product


def test_same_name_trap_is_not_matched_across_states():
    # Melbourne exists on Municode in FL, not AR. Querying AR must NOT return FL's code.
    out = r.resolve("AR", "Melbourne City Council")
    assert out["resolved"] is False
    assert out["source"] is None


def test_uncodified_small_town_returns_unresolved():
    # Horton KS is on neither directory; the only same-name hit (Kansas City MO) is
    # a different state AND a different name, so nothing must match.
    out = r.resolve("KS", "Horton City Commission")
    assert out["resolved"] is False


def test_generalcode_match_within_state():
    out = r.resolve("NJ", "Clifton City Council")
    assert out["resolved"] is True
    assert out["source"] == "generalcode/ecode360"
    assert out["code_url"] == "https://ecode360.com/CL0966"


def test_generalcode_strips_prefix_and_body_suffix():
    # "Village of Bellevue" (directory) vs "Bellevue Village Trustee" (input) must match.
    out = r.resolve("MI", "Bellevue Village Trustee")
    assert out["resolved"] is True
    assert out["code_url"] == "https://ecode360.com/BE1993"


def test_generalcode_rejects_same_name_other_state():
    # Clifton is listed under NJ only; a MI query for Clifton must not match it.
    out = r.resolve("MI", "Clifton City Council")
    assert out["resolved"] is False
