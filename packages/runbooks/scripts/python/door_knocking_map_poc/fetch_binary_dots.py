#!/usr/bin/env python3
# /// script
# dependencies = ["databricks-sql-connector"]
# ///
"""Fetch ALL California household dots as compact binary for the deck.gl test.

Output ca_dots.result.bin layout (little-endian):
  u32 count
  f32 positions[count*2]  (lon, lat interleaved)
  u8  party[count]        (0 = no majority/other, 1 = dem-lean, 2 = rep-lean)

~8.2M dots ≈ 74MB. Household aggregates only, no individual records.
Usage: uv run fetch_ca.py
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

QUERY = """
SELECT
  Residence_Addresses_Longitude AS lon,
  Residence_Addresses_Latitude  AS lat,
  CASE
    WHEN SUM(CASE WHEN Parties_Description = 'Democratic' THEN 1 ELSE 0 END) >
         SUM(CASE WHEN Parties_Description = 'Republican' THEN 1 ELSE 0 END) THEN 1
    WHEN SUM(CASE WHEN Parties_Description = 'Republican' THEN 1 ELSE 0 END) >
         SUM(CASE WHEN Parties_Description = 'Democratic' THEN 1 ELSE 0 END) THEN 2
    ELSE 0
  END AS party
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform
WHERE Residence_Addresses_State = '{state}'
  {city_clause}
  AND Residence_Addresses_Latitude IS NOT NULL
  AND Residence_Addresses_LatLongAccuracy IN
    ('GeoMatchRooftop','RangeInterpolation','ParcelCenter',
     'GeoMatchBuilding','ExactMatch')
GROUP BY 1, 2
"""


def load_env() -> None:
    if os.path.exists(ENV_FILE):
        for line in open(ENV_FILE):
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                v = v.split(" #", 1)[0].strip().strip("'\"")
                os.environ.setdefault(k.strip(), v)


def main() -> None:
    # args: [state] [city] — default CA statewide; e.g. `fetch_ca.py IL Chicago`
    state = sys.argv[1] if len(sys.argv) > 1 else "CA"
    city = sys.argv[2] if len(sys.argv) > 2 else None
    city_clause = f"AND Residence_Addresses_City = '{city}'" if city else ""
    query = QUERY.format(state=state, city_clause=city_clause)
    outname = (f"{city or state}".lower().replace(" ", "_")) + "_dots.result.bin"
    load_env()
    from databricks import sql

    t0 = time.time()
    pos = bytearray()
    party = bytearray()
    n = 0
    with sql.connect(
        server_hostname=os.environ["DATABRICKS_SERVER_HOSTNAME"],
        http_path=os.environ["DATABRICKS_HTTP_PATH"],
        access_token=os.environ["DATABRICKS_API_KEY"],
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            while True:
                rows = cur.fetchmany(250_000)
                if not rows:
                    break
                for r in rows:
                    pos += struct.pack("<ff", r.lon, r.lat)
                    party.append(r.party)
                n += len(rows)
                print(f"  {n:,} rows ({time.time()-t0:.0f}s)", file=sys.stderr)

    out = os.path.join(HERE, outname)
    with open(out, "wb") as f:
        f.write(struct.pack("<I", n))
        f.write(pos)
        f.write(party)
    print(f"wrote {n:,} CA household dots to {out} "
          f"({os.path.getsize(out)/1e6:.0f} MB) in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
