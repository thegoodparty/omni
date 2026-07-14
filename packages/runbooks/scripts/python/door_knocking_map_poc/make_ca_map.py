#!/usr/bin/env python3
"""Generate ca.html: all ~8.2M California household dots via deck.gl.

Reads the API key from .env; the page fetches /ca_dots.result.bin (binary:
u32 count, f32 lonlat pairs, u8 party) and renders one GPU ScatterplotLayer
over the MapLibre basemap. No GeoJSON anywhere; the whole point is binary in,
GPU out.

Usage: python3 make_ca_map.py  (serve.py must be running; open /ca.html)
"""

import os

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(LOCAL, "local")
os.makedirs(LOCAL, exist_ok=True)


def load_env_key() -> str:
    env = os.path.abspath(os.path.join(LOCAL, "..", "..", ".env"))
    for line in open(env):
        line = line.strip()
        if line.startswith("GEOAPIFY_API_KEY=") and line.split("=", 1)[1]:
            return line.split("=", 1)[1].split(" #", 1)[0].strip().strip("'\"")
    raise SystemExit(f"GEOAPIFY_API_KEY not set in {env}")


def main() -> None:
    # args: [binfile] [center_lon] [center_lat] [zoom] [outname] [title]
    import sys
    a = sys.argv[1:]
    binfile = a[0] if len(a) > 0 else "ca_dots.result.bin"
    center = f"[{a[1]}, {a[2]}]" if len(a) > 2 else "[-119.5, 36.8]"
    zoom = a[3] if len(a) > 3 else "5.6"
    outname = a[4] if len(a) > 4 else "ca.html"
    title = a[5] if len(a) > 5 else "California, every household"
    key = load_env_key()
    html = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>{title}</title>
  <script src="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css" rel="stylesheet">
  <script src="https://unpkg.com/deck.gl@9.0.35/dist.min.js"></script>
  <style>
    body {{ margin: 0; font: 13px sans-serif; }}
    #map {{ height: 100vh; }}
    #panel {{ position: absolute; top: 10px; left: 10px; z-index: 2;
      background: #fff; padding: 12px 14px; border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,.25); width: 250px; }}
  </style>
</head>
<body>
<div id="map"></div>
<div id="panel"><b>{title}</b>
  <div id="stats" style="margin-top:8px;color:#555">downloading binary...</div>
</div>
<script>
const map = new maplibregl.Map({{
  container: 'map',
  style: 'https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey={key}',
  center: {center}, zoom: {zoom},
}});
map.addControl(new maplibregl.NavigationControl());

async function load() {{
  const t0 = performance.now();
  const res = await fetch('/{binfile}');
  const buf = await res.arrayBuffer();
  const tDl = performance.now() - t0;
  const n = new DataView(buf).getUint32(0, true);
  const positions = new Float32Array(buf, 4, n * 2);
  const party = new Uint8Array(buf, 4 + n * 8, n);
  // Build RGBA per point: dem blue, rep red, other gray
  const colors = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {{
    const p = party[i], o = i * 4;
    if (p === 1) {{ colors[o] = 37;  colors[o+1] = 99;  colors[o+2] = 235; }}
    else if (p === 2) {{ colors[o] = 220; colors[o+1] = 38; colors[o+2] = 38; }}
    else {{ colors[o] = 107; colors[o+1] = 114; colors[o+2] = 128; }}
    colors[o+3] = 180;
  }}
  const tPrep = performance.now() - t0 - tDl;

  const overlay = new deck.MapboxOverlay({{
    layers: [new deck.ScatterplotLayer({{
      id: 'ca-dots',
      data: {{ length: n, attributes: {{
        getPosition: {{ value: positions, size: 2 }},
        getFillColor: {{ value: colors, size: 4 }},
      }} }},
      radiusMinPixels: 0.4,
      radiusMaxPixels: 4,
      getRadius: 8,
      pickable: false,
    }})],
  }});
  map.addControl(overlay);
  document.getElementById('stats').innerHTML =
    `${{n.toLocaleString()}} household dots on the GPU<br>` +
    `download: ${{(tDl/1000).toFixed(1)}}s (${{(buf.byteLength/1e6).toFixed(0)}}MB binary)<br>` +
    `prep: ${{(tPrep/1000).toFixed(1)}}s | zoom and pan freely`;
}}
map.on('load', load);
</script>
</body>
</html>"""
    out = os.path.join(HERE, outname)
    with open(out, "w") as f:
        f.write(html)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
