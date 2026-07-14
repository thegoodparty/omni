#!/usr/bin/env python3
"""Smoke test for Geoapify Route Planner API: 5 doors in Chicago, walking.

Verifies the things our research flagged as unconfirmed:
  1. mode=walk works on the Route Planner (optimization) endpoint
  2. a jobs-only request (no shipments/time windows) behaves as a simple TSP
  3. omitting agent end_location gives "end at the last door" (free end)
  4. the response contains the visit order, ETAs, and leg times we plan to store

Usage: put GEOAPIFY_API_KEY=... in .env next to this script, then:
  python3 test_route_planner.py
Raw response is saved to route_planner.result.json (gitignored).
"""

import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(LOCAL, "local")
os.makedirs(LOCAL, exist_ok=True)


def load_env_key() -> str:
    path = os.path.abspath(os.path.join(LOCAL, "..", "..", ".env"))
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line.startswith("GEOAPIFY_API_KEY=") and line.split("=", 1)[1]:
                return line.split("=", 1)[1].split(" #", 1)[0].strip().strip("'\"")
    key = os.environ.get("GEOAPIFY_API_KEY", "")
    if not key:
        sys.exit(f"No key found. Put GEOAPIFY_API_KEY=<your key> in {path}")
    return key


# 5 doors in Lincoln Park, Chicago. Geoapify uses [lon, lat] order (GeoJSON).
START = [-87.6580, 41.9200]  # where the canvasser "parks"
DOORS = {
    "door-1": [-87.6553, 41.9214],
    "door-2": [-87.6589, 41.9222],
    "door-3": [-87.6612, 41.9195],
    "door-4": [-87.6547, 41.9180],
    "door-5": [-87.6570, 41.9235],
}


def main() -> None:
    key = load_env_key()
    body = {
        "mode": "walk",
        "agents": [{"start_location": START}],  # no end_location: want free end
        "jobs": [{"id": jid, "location": loc} for jid, loc in DOORS.items()],
    }
    req = urllib.request.Request(
        f"https://api.geoapify.com/v1/routeplanner?apiKey={key}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:500]}")

    out = os.path.join(LOCAL, "route_planner.result.json")
    with open(out, "w") as f:
        json.dump(data, f, indent=2)

    features = data.get("features", [])
    if not features:
        sys.exit(f"No agent plans in response; see {out}")

    props = features[0]["properties"]
    print(f"agent mode:      {props.get('mode')}")
    print(f"total time:      {props.get('time')}s")
    print(f"total distance:  {props.get('distance')}m")
    print()
    print("visit order:")
    for action in props.get("actions", []):
        if action.get("type") == "job":
            jid = action.get("job_id", f"job index {action.get('job_index')}")
            print(f"  {jid:8s}  start_time +{action.get('start_time')}s")
        else:
            print(f"  ({action.get('type')})")

    legs = props.get("legs", [])
    if legs:
        print()
        print(f"legs: {len(legs)} (n jobs + 1 means it returned to start; "
              f"n jobs means free end)")
        for i, leg in enumerate(legs):
            print(f"  leg {i}: {leg.get('time')}s, {leg.get('distance')}m")

    issues = data.get("properties", {}).get("issues")
    if issues:
        print(f"\nissues reported: {issues}")
    print(f"\nraw response: {out}")


if __name__ == "__main__":
    main()
