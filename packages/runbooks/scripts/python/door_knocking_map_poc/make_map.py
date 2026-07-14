#!/usr/bin/env python3
"""Render the Route Planner smoke-test result as a local map page.

Reads route_planner.result.json (from test_route_planner.py), calls the
Geoapify Routing API for the street-following walk path along the optimized
order, and writes map.result.html (gitignored): MapLibre GL + Geoapify tiles,
numbered stops, straight-line skeleton, and the street path.

Usage: python3 make_map.py && open map.result.html
"""

import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(LOCAL, "local")
os.makedirs(LOCAL, exist_ok=True)


def load_env_key() -> str:
    for line in open(os.path.join(LOCAL, ".env")):
        if line.strip().startswith("GEOAPIFY_API_KEY=") and line.strip().split("=", 1)[1]:
            return line.strip().split("=", 1)[1]
    sys.exit("No key in .env")


def main() -> None:
    key = load_env_key()
    plan = json.load(open(os.path.join(LOCAL, "route_planner.result.json")))
    props = plan["features"][0]["properties"]

    # Ordered waypoints ([lon, lat]) and their labels from the plan
    waypoints = [w["location"] for w in props["waypoints"]]
    labels = []
    for w in props["waypoints"]:
        kinds = [a.get("type") for a in w.get("actions", [])]
        if "start" in kinds:
            labels.append("start")
        elif "end" in kinds and len(w.get("actions", [])) == 1:
            labels.append("end")
        else:
            job = next((a for a in w["actions"] if a["type"] == "job"), {})
            labels.append(job.get("job_id", "job"))

    # Street-following path from the Routing API (waypoints are lat,lon here)
    wp_param = "|".join(f"{lat},{lon}" for lon, lat in waypoints)
    url = (f"https://api.geoapify.com/v1/routing?waypoints={wp_param}"
           f"&mode=walk&apiKey={key}")
    with urllib.request.urlopen(url, timeout=30) as resp:
        route = json.loads(resp.read())
    street_geom = route["features"][0]["geometry"]

    stops_geojson = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature",
             "geometry": {"type": "Point", "coordinates": wp},
             "properties": {"label": labels[i],
                            "n": "S" if labels[i] == "start" else str(i)}}
            for i, wp in enumerate(waypoints)
        ],
    }
    skeleton_geom = plan["features"][0]["geometry"]  # straight-line legs

    html = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Turf walk order: smoke test</title>
  <script src="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css" rel="stylesheet">
  <style>
    body {{ margin: 0; }}
    #map {{ height: 100vh; }}
    .stop-marker {{
      background: #1a56db; color: #fff; border-radius: 50%;
      width: 26px; height: 26px; display: flex; align-items: center;
      justify-content: center; font: bold 13px sans-serif;
      border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4);
    }}
    .stop-marker.start {{ background: #057a55; }}
  </style>
</head>
<body>
<div id="map"></div>
<script>
const stops = {json.dumps(stops_geojson)};
const streetPath = {json.dumps(street_geom)};
const skeleton = {json.dumps(skeleton_geom)};

const map = new maplibregl.Map({{
  container: 'map',
  style: 'https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey={key}',
  center: {json.dumps(waypoints[0])},
  zoom: 15,
}});
map.addControl(new maplibregl.NavigationControl());

map.on('load', () => {{
  map.addSource('skeleton', {{ type: 'geojson', data: skeleton }});
  map.addLayer({{ id: 'skeleton', type: 'line', source: 'skeleton',
    paint: {{ 'line-color': '#9ca3af', 'line-width': 2, 'line-dasharray': [2, 2] }} }});

  map.addSource('street', {{ type: 'geojson', data: streetPath }});
  map.addLayer({{ id: 'street', type: 'line', source: 'street',
    paint: {{ 'line-color': '#1a56db', 'line-width': 4, 'line-opacity': 0.8 }} }});

  const bounds = new maplibregl.LngLatBounds();
  for (const f of stops.features) {{
    bounds.extend(f.geometry.coordinates);
    const el = document.createElement('div');
    el.className = 'stop-marker' + (f.properties.label === 'start' ? ' start' : '');
    el.textContent = f.properties.n;
    new maplibregl.Marker({{ element: el }})
      .setLngLat(f.geometry.coordinates)
      .setPopup(new maplibregl.Popup().setText(f.properties.label))
      .addTo(map);
  }}
  map.fitBounds(bounds, {{ padding: 60 }});
}});
</script>
</body>
</html>"""

    out = os.path.join(LOCAL, "map.result.html")
    with open(out, "w") as f:
        f.write(html)
    print(f"wrote {out}")
    print("open it with: open map.result.html")


if __name__ == "__main__":
    main()
