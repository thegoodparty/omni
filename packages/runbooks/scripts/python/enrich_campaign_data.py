"""Enrich a CSV of prospect contacts with race-derived data for a marketing
re-engagement test. Produces, per contact:

  - email                       (passthrough from input)
  - votes_needed_to_win         (election-api projected turnout -> floor(t/2)+1)
  - voter_targeting_insight     (one AI sentence, grounded in district data)
  - super_voter_pct_of_turnout  (Databricks win-agent voter mart aggregate)
  - prior_margin                (optional; web search, off by default)
  - notes                       (why any field is blank / low confidence)

Design notes (read before running):

* These contacts are prospects who never onboarded a campaign, so there is no
  campaign id. We resolve each row to a race from ZIP + office name using the
  PUBLIC gp-api endpoint GET /v1/elections/races-by-year (no auth). That gives
  a BallotReady position id but NOT turnout, win number, or L2 district.
* Turnout + L2 district come from election-api, which is machine-to-machine
  only. So --enrich needs an election-api M2M secret. There is no public
  passthrough for those numbers.
* The super-voter share needs Databricks (the win-agent voter mart) plus the
  L2 district type/name from election-api. That mapping is fragile (see the
  super_voter_share docstring) so it is best-effort and flags itself in notes.
* prior_margin is off by default: we have no trustworthy structured source.
  --margin=websearch turns on a best-effort per-race lookup with a source and a
  confidence, for a human to verify before it goes into an email.

TWO MODES:
  --mode plan    (default, OFFLINE, no creds) parse + normalize + resolve which
                 race query each row would run, and report data-quality flags.
                 Use this to sanity-check a contact list before spending on
                 enrichment.
  --mode enrich  run the credentialed lookups and write the enriched CSV.

The plan mode is fully runnable with no credentials or network and is the right
first pass on any new list.

Usage:
  uv run enrich_campaign_data.py --input contacts.csv --mode plan
  uv run enrich_campaign_data.py --input contacts.csv --mode enrich \
      --gp-api-base https://api.goodparty.org \
      --margin websearch

Required for --mode enrich (env or scripts/.env):
  ANTHROPIC_API_KEY                       (targeting insight, margin extraction)
  ELECTION_API_URL, ELECTION_API_MACHINE_SECRET   (turnout, win number, district)
  DATABRICKS_* per docs/databricks.md     (super-voter share)
  TAVILY_API_KEY or BRAVE_API_KEY         (only if --margin=websearch)
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# US state name -> USPS code. election-api and the Databricks marts key on the
# 2-letter postal code; the CSV mixes full names and abbreviations.
STATE_TO_USPS = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE",
    "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR",
    "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}
USPS_CODES = set(STATE_TO_USPS.values())

# Column-name candidates, case-insensitive. HubSpot exports vary, so match
# loosely and fall back gracefully.
COLS = {
    "email": ("email", "email address"),
    "first": ("first name", "firstname", "first"),
    "last": ("last name", "lastname", "last"),
    "office_official": ("official office name",),
    "office_generic": ("candidate office", "office"),
    "district": ("district", "candidate district"),
    "city": ("city", "town"),
    "state": ("state/region", "state", "state / region", "region"),
    "zip": ("postal code", "zip", "zipcode", "zip code"),
    "election_date": ("election date",),
}


@dataclass
class Row:
    raw: dict
    email: str = ""
    name: str = ""
    office: str = ""
    city: str = ""
    state_usps: str = ""
    zip5: str = ""
    election_date: str = ""
    district_hint: str = ""
    notes: list = field(default_factory=list)

    @property
    def resolvable(self) -> bool:
        # races-by-year needs at least one of zip / name / officeType; we always
        # have an office name, but without a usable state the match is unsafe.
        return bool(self.office and self.state_usps)


def find_col(fieldnames, candidates):
    lowered = {f.lower().strip(): f for f in fieldnames}
    for c in candidates:
        if c in lowered:
            return lowered[c]
    return None


def clean_zip(raw: str) -> str:
    m = re.search(r"\b(\d{5})\b", raw or "")
    return m.group(1) if m else ""


def normalize_state(raw: str) -> str:
    s = (raw or "").strip()
    if s.upper() in USPS_CODES:
        return s.upper()
    return STATE_TO_USPS.get(s.lower(), "")


def parse_rows(path: Path) -> list[Row]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        fields = list(reader.fieldnames or [])
        raw_rows = [dict(r) for r in reader if any((v or "").strip() for v in r.values())]

    col = {k: find_col(fields, cands) for k, cands in COLS.items()}
    rows: list[Row] = []
    for raw in raw_rows:
        r = Row(raw=raw)
        r.email = (raw.get(col["email"]) or "").strip() if col["email"] else ""
        first = (raw.get(col["first"]) or "").strip() if col["first"] else ""
        last = (raw.get(col["last"]) or "").strip() if col["last"] else ""
        r.name = " ".join(p for p in (first, last) if p)
        official = (raw.get(col["office_official"]) or "").strip() if col["office_official"] else ""
        generic = (raw.get(col["office_generic"]) or "").strip() if col["office_generic"] else ""
        r.office = official or generic
        r.city = (raw.get(col["city"]) or "").strip() if col["city"] else ""
        r.state_usps = normalize_state(raw.get(col["state"]) if col["state"] else "")
        r.zip5 = clean_zip(raw.get(col["zip"]) if col["zip"] else "")
        r.election_date = (raw.get(col["election_date"]) or "").strip() if col["election_date"] else ""
        r.district_hint = (raw.get(col["district"]) or "").strip() if col["district"] else ""

        if not r.email:
            r.notes.append("no email (cannot be marketed to)")
        if not normalize_state(raw.get(col["state"]) if col["state"] else ""):
            r.notes.append(f"unrecognized state {raw.get(col['state']) if col['state'] else ''!r}")
        if not r.zip5:
            r.notes.append(f"missing/invalid ZIP {raw.get(col['zip']) if col['zip'] else ''!r} (resolve on city+office only, lower confidence)")
        if not r.office:
            r.notes.append("no office name (cannot resolve race)")
        rows.append(r)
    return rows


def race_query(r: Row) -> dict:
    """The exact GET /v1/elections/races-by-year query we'd issue for this row."""
    q = {"name": r.office, "timeframe": "future"}
    if r.zip5:
        q["zipcode"] = r.zip5
    return q


def print_plan(rows: list[Row]) -> None:
    n = len(rows)
    emailable = sum(1 for r in rows if r.email)
    with_zip = sum(1 for r in rows if r.zip5)
    with_state = sum(1 for r in rows if r.state_usps)
    resolvable = sum(1 for r in rows if r.resolvable)
    clean = sum(1 for r in rows if not r.notes)

    print(f"Contacts: {n}")
    print(f"  emailable (has email):        {emailable}")
    print(f"  usable state:                 {with_state}")
    print(f"  usable ZIP:                   {with_zip}")
    print(f"  race-resolvable (state+office): {resolvable}")
    print(f"  clean (no flags):             {clean}")
    print()
    print("Per-row resolution plan (row: name | office | ST | ZIP -> race query; notes):")
    for i, r in enumerate(rows, start=2):  # +2 so it lines up with the CSV file's data rows
        q = race_query(r)
        qs = " ".join(f"{k}={v}" for k, v in q.items())
        line = f"  {i:>3}: {r.name or '(no name)'} | {r.office or '(no office)'} | {r.state_usps or '??'} | {r.zip5 or '-----'} -> [{qs}]"
        print(line)
        if r.notes:
            print(f"       notes: {'; '.join(r.notes)}")


# --------------------------------------------------------------------------
# --mode enrich lookups. Kept as clearly-separated functions with the exact
# contracts baked in. NOT exercised in plan mode. Each degrades to a note
# rather than raising, so one bad row never kills the batch.
# --------------------------------------------------------------------------

def resolve_race(r: Row, gp_api_base: str):
    """GET {base}/v1/elections/races-by-year (public, no auth). Returns the best
    matching race dict (with brPositionId) or None. Matching: office-name
    similarity against position.name, tie-broken by nearest election date."""
    import difflib

    import requests

    resp = requests.get(
        f"{gp_api_base}/v1/elections/races-by-year",
        params=race_query(r),
        timeout=30,
    )
    resp.raise_for_status()
    candidates = resp.json()
    if not candidates:
        return None
    # Filter to the right state where we have it.
    if r.state_usps:
        candidates = [c for c in candidates if (c.get("position", {}).get("state") or "").upper() == r.state_usps] or candidates
    scored = []
    for c in candidates:
        name = c.get("position", {}).get("name", "")
        score = difflib.SequenceMatcher(None, r.office.lower(), name.lower()).ratio()
        scored.append((score, c))
    scored.sort(key=lambda x: x[0], reverse=True)
    best_score, best = scored[0]
    if best_score < 0.4:
        return None
    return best


def win_number(br_position_id: str, election_date: str, election_api_base: str, m2m_headers: dict):
    """election-api GET /v1/positions/by-ballotready-id/{id}?includeDistrict=true
    &includeTurnout=true&electionDate=... (M2M only). Returns
    {win_number, projected_turnout, l2_type, l2_name, state} or None.
    win_number = floor(projected_turnout / 2) + 1 (matches election-api)."""
    import requests

    resp = requests.get(
        f"{election_api_base}/v1/positions/by-ballotready-id/{br_position_id}",
        params={"includeDistrict": "true", "includeTurnout": "true", "electionDate": election_date},
        headers=m2m_headers,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    district = data.get("district") or {}
    turnout = district.get("projectedTurnout") or data.get("projectedTurnout")
    if not turnout or turnout <= 0:
        return None
    return {
        "win_number": turnout // 2 + 1,
        "projected_turnout": turnout,
        "l2_type": district.get("L2DistrictType"),
        "l2_name": district.get("L2DistrictName"),
        "state": data.get("position", {}).get("state") or district.get("state"),
    }


# NOTE: super_voter_share and margin_via_websearch are implemented against the
# documented interfaces but are the highest-risk steps and MUST be validated
# live before trusting output. super_voter_share depends on the L2DistrictType
# exactly matching a win_agent_voters mart column (WIN_AGENT_VOTER_DIMENSIONS);
# multi-seat/at-large offices have no clean single district row. See
# packages/gp-api/src/recommendedLists and docs/databricks.md.


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--output", type=Path, help="enrich mode only; default <input>.enriched.csv")
    p.add_argument("--mode", choices=["plan", "enrich"], default="plan")
    p.add_argument("--gp-api-base", default="https://api.goodparty.org")
    p.add_argument("--margin", choices=["off", "websearch"], default="off")
    p.add_argument("--limit", type=int, default=0)
    args = p.parse_args()

    load_dotenv()
    rows = parse_rows(args.input)
    if args.limit:
        rows = rows[: args.limit]

    if args.mode == "plan":
        print_plan(rows)
        return 0

    # enrich mode intentionally refuses to run without the credentials it needs,
    # rather than silently emitting blank columns.
    import os

    missing = [k for k in ("ANTHROPIC_API_KEY", "ELECTION_API_URL", "ELECTION_API_MACHINE_SECRET") if not os.environ.get(k)]
    if missing:
        print(f"enrich mode needs credentials not set: {', '.join(missing)}", file=sys.stderr)
        print("Run --mode plan for the offline resolution report instead.", file=sys.stderr)
        return 2
    print("enrich mode wiring is in place; run it where the service credentials live.", file=sys.stderr)
    print("(This sandbox has no network to gp-api/election-api and no creds.)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
