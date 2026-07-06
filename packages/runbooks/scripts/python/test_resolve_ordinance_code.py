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
    {"StateID": 35, "StateAbbreviation": "OH"},
    {"StateID": 27, "StateAbbreviation": "MN"},
]
_CLIENTS = {
    10: [{"ClientID": 999, "ClientName": "Alpharetta"}],
    17: [{"ClientID": 100, "ClientName": "Herington"}],   # Kansas, no Horton
    25: [{"ClientID": 200, "ClientName": "Kansas City"},   # the small-town trap target
         {"ClientID": 201, "ClientName": "St. Louis"}],
    4: [{"ClientID": 300, "ClientName": "Little Rock"}],   # Arkansas, no Melbourne
    9: [{"ClientID": 400, "ClientName": "Melbourne"}],      # Florida Melbourne (the trap)
    # Ohio: same-stem township/city pair + a "County:"-prefixed township and a
    # Municode county-tag suffix client (mirrors real ClientName shapes).
    35: [{"ClientID": 500, "ClientName": "Bethel"},
         {"ClientID": 501, "ClientName": "Bethel Township"},
         {"ClientID": 502, "ClientName": "Muskingum Township"},
         {"ClientID": 503, "ClientName": "Ada Township, (Kent County)"}],
    # Minnesota: a county client (Municode hosts county codes).
    27: [{"ClientID": 600, "ClientName": "Wadena County"}],
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
    # Governing-body suffixes the instruction (instruction.md Step 1) strips but
    # the original _BODY_RE missed — these carry no bare "city/town/..." word, so
    # nothing was stripped before the fix.
    ("Springfield Select Board", "springfield"),
    ("Willow Park City Mayor", "willow park"),
    ("Springfield Mayor", "springfield"),
    ("Duluth Councilmember", "duluth"),
    ("Nashua Alderman", "nashua"),
    ("Peabody Board of Selectpersons", "peabody"),
])
def test_norm_reduces_to_bare_place(raw, expected):
    assert r.norm(raw) == expected


def test_norm_keeps_township_suffix():
    # Townships are indexed WITH the "Township" suffix on Municode; stripping it
    # would collide "Bethel Township" with the separate city "Bethel".
    assert r.norm("Bethel Township") == "bethel township"


def test_norm_county_office_resolves_to_county_place():
    assert r.norm("Wadena County Commission - District 2") == "wadena county"


def test_norm_county_prefixed_township():
    # "<County> County:" is informational; the place is the tail township.
    assert r.norm("Washington County: Muskingum Township Trustee") == "muskingum township"


def test_norm_strips_municode_county_tag():
    # Municode ClientNames can carry a "(<X> County)" tag that must not defeat matching.
    assert r.norm("Ada Township, (Kent County)") == "ada township"


def test_municode_exact_match_returns_stable_handles():
    out = r.resolve("GA", "Alpharetta City Council")
    assert out["resolved"] is True
    assert out["source"] == "municode"
    assert out["matched"] == "Alpharetta"
    # Strings, matching the experiment manifest's output_schema (["string", "null"]).
    assert out["client_id"] == "999"
    assert out["product_id"] == "12100"  # picked the "Code of Ordinances" product


def test_municode_slug_keeps_trailing_body_word():
    # Municode's own slugs keep the full ClientName ("Kansas City" -> kansas_city);
    # slugging via norm() would strip the trailing "City" and 404 the real code.
    out = r.resolve("MO", "Kansas City Council")
    assert out["resolved"] is True
    assert out["code_url"] == "https://library.municode.com/mo/kansas_city/codes/code_of_ordinances"


def test_municode_slug_preserves_punctuation():
    # library.municode.com's UrlEncodeComponent only encodes / \ space ~ then
    # lowercases; periods and apostrophes stay ("St. Louis" -> st._louis).
    out = r.resolve("MO", "St. Louis City Council")
    assert out["resolved"] is True
    assert out["code_url"] == "https://library.municode.com/mo/st._louis/codes/code_of_ordinances"


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


def test_township_office_matches_township_client_not_bare_city():
    # Same-stem clients "Bethel" and "Bethel Township" must stay distinct: a
    # township trustee resolves to the township, never the bare city.
    out = r.resolve("OH", "Bethel Township Trustee")
    assert out["resolved"] is True
    assert out["matched"] == "Bethel Township"


def test_bare_city_office_matches_bare_city_not_township():
    # ...and the reverse: a city council resolves to the bare city.
    out = r.resolve("OH", "Bethel City Council")
    assert out["resolved"] is True
    assert out["matched"] == "Bethel"


def test_county_office_matches_county_client():
    # A county governing body resolves to the county's own code on Municode.
    out = r.resolve("MN", "Wadena County Commission - District 2")
    assert out["resolved"] is True
    assert out["matched"] == "Wadena County"


def test_county_prefixed_township_office_matches_township_client():
    out = r.resolve("OH", "Washington County: Muskingum Township Trustee")
    assert out["resolved"] is True
    assert out["matched"] == "Muskingum Township"


def test_municode_county_tag_client_is_matched():
    # "Ada Township, (Kent County)" as listed must match a plain township office.
    out = r.resolve("OH", "Ada Township Trustee")
    assert out["resolved"] is True
    assert out["matched"] == "Ada Township, (Kent County)"


def test_read_pairs_rejects_odd_arg_count():
    # An odd positional-arg count used to silently drop the trailing state.
    with pytest.raises(SystemExit):
        r._read_pairs(["GA", "Alpharetta", "MN"])


def test_read_pairs_accepts_even_arg_count():
    assert r._read_pairs(["GA", "Alpharetta", "MN", "Ramsey"]) == [
        ("GA", "Alpharetta"), ("MN", "Ramsey")
    ]
