#!/usr/bin/env python3
# /// script
# dependencies = ["databricks-sql-connector"]
# ///
"""Build the full client-side filter pack for Chicago.

Three-level structure, little-endian:
  header: u32 nDots, u32 nHouseholds, u32 nPersons
  dots:   f32 lonlat pairs [nDots]
  hh2dot: u32 [nHouseholds]      (household -> dot index)
  p2hh:   u32 [nPersons]         (person -> household index)
  then 14 person-dimension blocks, u8 [nPersons] each, in DIMS order.

No names, no ids — coordinates + encoded filter attributes only.
Usage: uv run fetch_pack.py  ->  chicago_pack.result.bin
"""

import os
import struct
import sys
import time

ENV_FILE = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env"))
HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(LOCAL, "local")
os.makedirs(LOCAL, exist_ok=True)

DIMS = ["party", "age", "votercat", "registered", "status", "marital",
        "children", "veteran", "homeowner", "bizowner", "education",
        "income", "language", "ethnicity"]

QUERY = """
SELECT
  Residence_Addresses_Longitude AS lon,
  Residence_Addresses_Latitude AS lat,
  CONCAT_WS(' ', Residence_Addresses_HouseNumber,
    COALESCE(Residence_Addresses_PrefixDirection,''),
    Residence_Addresses_StreetName,
    COALESCE(Residence_Addresses_Designator,''),
    COALESCE(Residence_Addresses_ApartmentNum,'')) AS hh,
  Parties_Description AS party,
  Voters_Age AS age,
  Voters_VotingPerformanceEvenYearGeneral AS perf,
  CASE WHEN Voters_StateVoterID IS NOT NULL THEN 1 ELSE 0 END AS registered,
  Voters_Active AS status,
  ConsumerData_Marital_Status AS marital,
  ConsumerData_Presence_Of_Children_in_HH AS children,
  ConsumerData_Veteran_In_HH AS veteran,
  ConsumerData_Homeowner_Probability_Model AS homeowner,
  ConsumerData_Occupation_Group AS occgroup,
  ConsumerData_Education_of_Person AS education,
  ConsumerData_Estimated_Income_Amount AS income,
  ConsumerData_Language_Code AS language,
  EthnicGroups_EthnicGroup1Desc AS ethnicity
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform
WHERE Residence_Addresses_State = 'IL'
  AND Residence_Addresses_City = 'Chicago'
  AND Residence_Addresses_Latitude IS NOT NULL
  AND Residence_Addresses_LatLongAccuracy IN
    ('GeoMatchRooftop','RangeInterpolation','ParcelCenter',
     'GeoMatchBuilding','ExactMatch')
"""


def load_env() -> None:
    for line in open(ENV_FILE):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.split(" #", 1)[0].strip().strip("'\""))


def enc_party(v):
    return {"Democratic": 1, "Republican": 2, "Non-Partisan": 3}.get(v, 0) if v else 0

def enc_age(v):
    if v is None: return 0
    if v <= 34: return 1
    if v <= 50: return 2
    if v <= 64: return 3
    return 4

def enc_votercat(v):
    if v is None: return 0
    if v >= 75: return 1   # super voter
    if v >= 50: return 2   # likely voter
    return 3               # low propensity

def enc_status(v):
    return {"A": 1, "I": 2}.get(v, 0)

def enc_marital(v):
    if not v: return 0
    return 1 if "Married" in v else (2 if "Single" in v else 0)

def enc_yn(v):
    return {"Y": 1, "N": 2}.get(v, 0)

def enc_veteran(v):
    return 1 if v == "Y" else 0

def enc_homeowner(v):
    if not v: return 0
    return 1 if "Owner" in v else (2 if v == "Renter" else 0)

def enc_bizowner(v):
    return 1 if v and ("Self" in v or "Business" in v or "Farmer" in v) else 0

def enc_education(v):
    if not v: return 0
    if "Graduate" in v: return 4
    if v.startswith("Completed College"): return 3
    if "Attended" in v: return 2
    return 1  # HS or less

def enc_income(v):
    if not v: return 0
    try: amt = int(str(v).replace("$", "").replace(",", ""))
    except ValueError: return 0
    if amt < 50000: return 1
    if amt < 100000: return 2
    if amt < 150000: return 3
    return 4

def enc_language(v):
    if not v: return 0
    return 1 if v == "English" else (2 if v == "Spanish" else 3)

def enc_ethnicity(v):
    if not v: return 0
    return {"European": 1, "Hispanic and Portuguese": 2,
            "Likely African-American": 3, "East and South Asian": 4}.get(v, 5)


def main() -> None:
    load_env()
    from databricks import sql

    t0 = time.time()
    t_fetch = t_encode = 0.0
    dot_idx, hh_idx = {}, {}
    dots = bytearray()
    hh2dot = bytearray()
    p2hh = bytearray()
    dim_bytes = {d: bytearray() for d in DIMS}
    n = 0

    with sql.connect(
        server_hostname=os.environ["DATABRICKS_SERVER_HOSTNAME"],
        http_path=os.environ["DATABRICKS_HTTP_PATH"],
        access_token=os.environ["DATABRICKS_API_KEY"],
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(QUERY)
            while True:
                tf = time.time()
                rows = cur.fetchmany(250_000)
                t_fetch += time.time() - tf
                if not rows:
                    break
                te = time.time()
                for r in rows:
                    coord = (r.lon, r.lat)
                    d = dot_idx.get(coord)
                    if d is None:
                        d = len(dot_idx)
                        dot_idx[coord] = d
                        dots += struct.pack("<ff", r.lon, r.lat)
                    h = hh_idx.get(r.hh)
                    if h is None:
                        h = len(hh_idx)
                        hh_idx[r.hh] = h
                        hh2dot += struct.pack("<I", d)
                    p2hh += struct.pack("<I", h)
                    dim_bytes["party"].append(enc_party(r.party))
                    dim_bytes["age"].append(enc_age(r.age))
                    dim_bytes["votercat"].append(enc_votercat(r.perf))
                    dim_bytes["registered"].append(r.registered)
                    dim_bytes["status"].append(enc_status(r.status))
                    dim_bytes["marital"].append(enc_marital(r.marital))
                    dim_bytes["children"].append(enc_yn(r.children))
                    dim_bytes["veteran"].append(enc_veteran(r.veteran))
                    dim_bytes["homeowner"].append(enc_homeowner(r.homeowner))
                    dim_bytes["bizowner"].append(enc_bizowner(r.occgroup))
                    dim_bytes["education"].append(enc_education(r.education))
                    dim_bytes["income"].append(enc_income(r.income))
                    dim_bytes["language"].append(enc_language(r.language))
                    dim_bytes["ethnicity"].append(enc_ethnicity(r.ethnicity))
                t_encode += time.time() - te
                n += len(rows)
                print(f"  {n:,} rows ({time.time()-t0:.0f}s)", file=sys.stderr)

    t_exec = time.time() - t0 - t_fetch - t_encode  # query exec + connect overhead
    out = os.path.join(LOCAL, "chicago_pack.result.bin")
    with open(out, "wb") as f:
        f.write(struct.pack("<III", len(dot_idx), len(hh_idx), n))
        f.write(dots)
        f.write(hh2dot)
        f.write(p2hh)
        for d in DIMS:
            f.write(dim_bytes[d])
    print(f"dots={len(dot_idx):,} households={len(hh_idx):,} persons={n:,} "
          f"-> {out} ({os.path.getsize(out)/1e6:.1f} MB) in {time.time()-t0:.0f}s")
    tw = time.time()
    print(f"TIMING query+connect={t_exec:.1f}s fetch_transfer={t_fetch:.1f}s "
          f"encode={t_encode:.1f}s write=(included above)")


if __name__ == "__main__":
    main()
