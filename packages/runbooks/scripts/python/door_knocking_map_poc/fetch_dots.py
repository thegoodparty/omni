#!/usr/bin/env python3
# /// script
# dependencies = ["databricks-sql-connector"]
# ///
"""Fetch up to 50K Chicago household dots from the mart for the map-scale test.

Household-level aggregates only (coordinate, voter count, party mix, avg age);
no individual voter records. Writes dots.result.json (gitignored) as GeoJSON.

Usage: uv run fetch_dots.py
Creds: DATABRICKS_* vars from scripts/.env (see scripts/.env.example).
"""

import json
import os
import sys

ENV_FILE = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env"))
HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(LOCAL, "local")
os.makedirs(LOCAL, exist_ok=True)

USABLE_ACCURACY = ("'GeoMatchRooftop','RangeInterpolation','ParcelCenter',"
                   "'GeoMatchBuilding','ExactMatch'")

QUERY_TEMPLATE = f"""
SELECT
  Residence_Addresses_Longitude AS lon,
  Residence_Addresses_Latitude  AS lat,
  COUNT(*) AS voters,
  SUM(CASE WHEN Parties_Description = 'Democratic' THEN 1 ELSE 0 END) AS dem,
  SUM(CASE WHEN Parties_Description = 'Republican' THEN 1 ELSE 0 END) AS rep,
  CAST(AVG(Voters_Age) AS INT) AS avg_age
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform
WHERE Residence_Addresses_State = 'IL'
  AND Residence_Addresses_City = 'Chicago'
  AND Residence_Addresses_Latitude IS NOT NULL
  AND Residence_Addresses_LatLongAccuracy IN ({USABLE_ACCURACY})
GROUP BY 1, 2
{{limit}}
"""


def load_env() -> None:
    if os.path.exists(ENV_FILE):
        for line in open(ENV_FILE):
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                v = v.split(" #", 1)[0].strip().strip("'\"")  # drop inline comments
                os.environ.setdefault(k.strip(), v)


def main() -> None:
    all_mode = "--all" in sys.argv
    query = QUERY_TEMPLATE.format(limit="" if all_mode else "LIMIT 50000")
    outname = "dots_all.result.json" if all_mode else "dots.result.json"
    load_env()
    from databricks import sql

    for var in ("DATABRICKS_SERVER_HOSTNAME", "DATABRICKS_HTTP_PATH",
                "DATABRICKS_API_KEY"):
        if not os.environ.get(var):
            sys.exit(f"Missing {var}")

    with sql.connect(
        server_hostname=os.environ["DATABRICKS_SERVER_HOSTNAME"],
        http_path=os.environ["DATABRICKS_HTTP_PATH"],
        access_token=os.environ["DATABRICKS_API_KEY"],
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            rows = cur.fetchall()

    features = [
        {"type": "Feature",
         "geometry": {"type": "Point",
                      "coordinates": [round(r.lon, 6), round(r.lat, 6)]},
         "properties": {"v": r.voters, "d": r.dem, "r": r.rep,
                        "a": r.avg_age}}
        for r in rows
    ]
    out = os.path.join(HERE, outname)
    with open(out, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f,
                  separators=(",", ":"))
    size_mb = os.path.getsize(out) / 1e6
    print(f"wrote {len(features):,} household dots to {out} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
