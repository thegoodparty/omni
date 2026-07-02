#!/usr/bin/env python3
"""Resolve (state, jurisdiction) -> authoritative municipal-code source, no web search.

Tier 1 of the find-existing-ordinances workflow: match a jurisdiction against the two
bulk codifier directories that publish client lists, Municode (api.municode.com) and
General Code / eCode360 (generalcode.com/text-library). A hit means the directory lists
the jurisdiction; listings can be stale (a city may have migrated codifiers), so verify
content before relying on one. Misses fall through to the
web-search + verify tier documented in books/find-existing-ordinances.md.

Stdlib only (urllib) so it runs anywhere. Read-only HTTP GETs, safe to re-run.

Usage:
  python resolve_ordinance_code.py GA "Alpharetta" MN "Ramsey City Council"
  printf 'OH\\tShaker Heights\\nTX\\tMansfield\\n' | python resolve_ordinance_code.py --stdin
Each input is (2-letter state, jurisdiction name); the governing-body suffix
("City Council", "Borough Council", "Village Trustee", ...) is stripped automatically.
Output: one JSON object per line, plus a coverage summary to stderr.
"""
import functools
import json
import re
import sys
import urllib.request

UA = {"User-Agent": "Mozilla/5.0", "X-CSRF": "1"}
MUNI_API = "https://api.municode.com"
MUNI_LIB = "https://library.municode.com/api"
GC_LIBRARY = "https://www.generalcode.com/text-library/"

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}

# Governing-body suffixes, longest-first (mirrors the experiment instruction's
# Step 1 BODY list). Bare "township" is deliberately absent: townships are
# distinct jurisdictions indexed WITH the suffix, handled separately in norm().
_BODY_RE = re.compile(
    r"\s+(city council|city commission(er)?|common council|borough council|"
    r"village board|village trustee|village council|town council|town board|"
    r"town commission|village commission|board of aldermen|board of trustees|"
    r"board of selectmen|board of selectpersons|select board|selectboard|"
    r"town chair(man)?|town supervisor|village president|mayor|city treasurer|"
    r"city clerk|town clerk|city auditor|alderman|alderwoman|councilmember|"
    r"council member|board of commissioners|city|town|village|borough)\b.*$"
)


def _get(url, timeout=30):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


# County-office suffixes (mirrors the experiment instruction's Step 1 CBODY):
# the COUNTY is the jurisdiction, so "County" stays in the name.
_CBODY_RE = re.compile(
    r"^(.*?)\s+county\s+(commission(ers)?|council|legislature|"
    r"board of supervisors|board)\b"
)


def norm(name):
    """Reduce a raw office/place string to a bare, comparable place name.

    For MATCHING only — never build URLs from this: it strips trailing body
    words, so "Kansas City" would slug to /mo/kansas. Use _muni_slug for URLs.
    """
    n = name.lower().strip()
    n = re.sub(r"\(unexpired term\)", "", n)
    n = re.sub(r"\(est\.?\)", "", n)
    n = re.sub(r",?\s*\([^)]*co\.?\)\s*", " ", n)  # Municode county tag: "Ada Township, (Kent Co.)"
    m = _CBODY_RE.match(n)
    if m:
        n = m.group(1).strip() + " county"
        return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", n)).strip()
    n = re.sub(r"^(city|town|village|borough|township|municipality|county) of ", "", n)
    n = re.sub(r"\b(charter|chrtr)\s+township\b", "township", n)
    if re.search(r"\btownship\b", n):
        # Townships are indexed WITH the suffix; drop only role words after it
        # so "Clinton Township Trustee" stays distinct from a city "Clinton".
        n = re.sub(r"(\btownship\b).*$", r"\1", n)
    else:
        n = _BODY_RE.sub("", n)
    n = re.sub(r"[^a-z0-9 ]", "", n)
    return re.sub(r"\s+", " ", n).strip()


def _muni_slug(client_name):
    """library.municode.com's own UrlEncodeComponent (from its JS bundle):
    encode / \\ space ~, then lowercase. All other punctuation is kept —
    "St. Louis" -> "st._louis", "Kansas City" -> "kansas_city"."""
    s = client_name.strip()
    for ch, code in (("/", "-fs-"), ("\\", "-bs-"), (" ", "_"), ("~", "-t-")):
        s = s.replace(ch, code)
    return s.lower()


@functools.lru_cache(maxsize=1)
def _muni_states():
    return {s["StateAbbreviation"]: s["StateID"] for s in json.loads(_get(f"{MUNI_API}/States"))}


@functools.lru_cache(maxsize=60)
def _muni_clients(state_id):
    return json.loads(_get(f"{MUNI_API}/Clients/stateId/{state_id}"))


def resolve_municode(state, name):
    sid = _muni_states().get(state)
    if not sid:
        return None
    target = norm(name)
    # Same-name trap: two entries normalizing equal (e.g. same-named townships in
    # two counties) make either pick a coin flip — fall through to the web tier.
    cands = [c for c in _muni_clients(sid) if norm(c["ClientName"]) == target]
    if len(cands) != 1:
        return None
    c = cands[0]
    cid = c["ClientID"]
    try:
        prods = json.loads(_get(f"{MUNI_API}/Products/clientId/{cid}"))
    except Exception:
        prods = []
    code = next((p for p in prods if "ordinance" in (p.get("ProductName") or "").lower()), None)
    pid = (code or (prods[0] if prods else {})).get("ProductID")
    slug = _muni_slug(c["ClientName"])
    return {
        "source": "municode",
        "matched": c["ClientName"],
        "client_id": str(cid),
        "product_id": str(pid) if pid is not None else None,
        "code_url": f"https://library.municode.com/{state.lower()}/{slug}/codes/code_of_ordinances",
        "confidence": "high",
    }


@functools.lru_cache(maxsize=1)
def _gc_index():
    html = _get(GC_LIBRARY).decode("utf-8", "replace")
    out, cur_state = [], None
    pat = re.compile(
        r'(<h[1-4][^>]*>\s*([A-Za-z .]+?)\s*</h[1-4]>)'
        r'|(<a[^>]+href="(https://ecode360\.com/[A-Za-z0-9]+)"[^>]*>(.*?)</a>)',
        re.S | re.I,
    )
    for m in pat.finditer(html):
        if m.group(2) and m.group(2).strip() in STATE_NAMES.values():
            cur_state = m.group(2).strip()
        elif m.group(4):
            place = re.sub("<[^>]+>", "", m.group(5)).strip()
            if place:
                out.append((cur_state, place, m.group(4)))
    return out


def resolve_generalcode(state, name):
    want_state = STATE_NAMES.get(state, state).lower()
    target = norm(name)
    for st, place, url in _gc_index():
        if st and st.lower() == want_state and norm(place) == target:
            return {"source": "generalcode/ecode360", "matched": place, "code_url": url, "confidence": "high"}
    return None


def resolve(state, name):
    r = resolve_municode(state, name) or resolve_generalcode(state, name)
    if r:
        return {"state": state, "input": name, "resolved": True, **r}
    return {"state": state, "input": name, "resolved": False, "source": None,
            "code_url": None, "confidence": "none",
            "next": "web-search tier (see books/find-existing-ordinances.md): American Legal or city-hosted"}


def _read_pairs(argv):
    if argv and argv[0] == "--stdin":
        return [tuple(ln.split("\t", 1)) for ln in sys.stdin.read().splitlines() if "\t" in ln]
    return [(argv[i], argv[i + 1]) for i in range(0, len(argv) - 1, 2)]


def main():
    pairs = _read_pairs(sys.argv[1:])
    if not pairs:
        print(__doc__)
        return
    hits = 0
    for st, nm in pairs:
        try:
            r = resolve(st.strip().upper(), nm.strip())
        except Exception as e:
            r = {"state": st, "input": nm, "resolved": False, "error": str(e)}
        hits += 1 if r.get("resolved") else 0
        print(json.dumps(r))
    n = len(pairs)
    print(f"\nTier-1 directory coverage: {hits}/{n} ({round(100 * hits / n)}%) resolved; "
          f"{n - hits} need the web-search tier.", file=sys.stderr)


if __name__ == "__main__":
    main()
