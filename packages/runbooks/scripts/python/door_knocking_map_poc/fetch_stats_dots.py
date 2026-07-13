#!/usr/bin/env python3
# /// script
# dependencies = ["databricks-sql-connector"]
# ///
"""Fetch Chicago dots with per-dot household and target counts (binary).

Layout: u32 count | f32 lonlat pairs | u8 households | u8 targets
The filter (stand-in: Democratic primary voters) is applied SERVER-SIDE, so
dots are the target universe only: a dot exists only where >=1 target lives.
- households = distinct full addresses among targets at the coordinate
- targets    = target people at the coordinate

Usage: uv run fetch_stats_dots.py  ->  chicago_stats.result.bin
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
  COUNT(DISTINCT CONCAT_WS(' ',
    Residence_Addresses_HouseNumber,
    COALESCE(Residence_Addresses_PrefixDirection, ''),
    Residence_Addresses_StreetName,
    COALESCE(Residence_Addresses_Designator, ''),
    COALESCE(Residence_Addresses_ApartmentNum, ''))) AS households,
  COUNT(*) AS targets
FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform
WHERE Residence_Addresses_State = 'IL'
  AND Residence_Addresses_City = 'Chicago'
  AND Residence_Addresses_Latitude IS NOT NULL
  AND Parties_Description = 'Democratic'
  AND Residence_Addresses_LatLongAccuracy IN
    ('GeoMatchRooftop','RangeInterpolation','ParcelCenter',
     'GeoMatchBuilding','ExactMatch')
GROUP BY 1, 2
"""


def load_env() -> None:
    for line in open(ENV_FILE):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            v = v.split(" #", 1)[0].strip().strip("'\"")
            os.environ.setdefault(k.strip(), v)


def main() -> None:
    load_env()
    from databricks import sql

    t0 = time.time()
    pos, hh, tg = bytearray(), bytearray(), bytearray()
    n = 0
    with sql.connect(
        server_hostname=os.environ["DATABRICKS_SERVER_HOSTNAME"],
        http_path=os.environ["DATABRICKS_HTTP_PATH"],
        access_token=os.environ["DATABRICKS_API_KEY"],
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(QUERY)
            while True:
                rows = cur.fetchmany(250_000)
                if not rows:
                    break
                for r in rows:
                    pos += struct.pack("<ff", r.lon, r.lat)
                    hh.append(min(r.households, 255))
                    tg.append(min(r.targets, 255))
                n += len(rows)
                print(f"  {n:,} rows", file=sys.stderr)

    out = os.path.join(LOCAL, "chicago_stats.result.bin")
    with open(out, "wb") as f:
        f.write(struct.pack("<I", n))
        f.write(pos)
        f.write(hh)
        f.write(tg)
    print(f"wrote {n:,} dots to {out} ({os.path.getsize(out)/1e6:.1f} MB) "
          f"in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
