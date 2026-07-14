#!/usr/bin/env python3
"""Generate chi_stats.html: polygon-select stats over parallel-array dots.

The experiment: dots carry ONLY households and targets counts. Draw a
polygon; the browser loops the typed arrays and reports stops (dots),
households (full addresses), and targets, with timing. Mobile-friendly
draw controls.

Usage: python3 make_chi_stats.py   (open /chi_stats.html)
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


HTML = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Chicago: polygon stats (stops / households / targets)</title>
  <script src="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css" rel="stylesheet">
  <script src="https://unpkg.com/deck.gl@9.0.35/dist.min.js"></script>
  <script src="https://unpkg.com/@mapbox/mapbox-gl-draw@1.4.3/dist/mapbox-gl-draw.js"></script>
  <link href="https://unpkg.com/@mapbox/mapbox-gl-draw@1.4.3/dist/mapbox-gl-draw.css" rel="stylesheet">
  <style>
    body { margin: 0; font: 13px sans-serif; }
    #map { height: 100vh; }
    #panel { position: absolute; top: 10px; left: 10px; z-index: 2;
      background: #fff; padding: 12px 14px; border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,.25); width: 240px; }
    #stats { margin-top: 8px; min-height: 84px; }
    #stats .big { font-size: 20px; font-weight: bold; }
    button { width: 100%; margin-top: 6px; padding: 10px; font-size: 14px; }
    .maplibregl-ctrl-group button.mapbox-gl-draw_ctrl-draw-btn {
      width: 48px; height: 48px; background-size: 26px 26px;
      background-position: center; background-repeat: no-repeat; }
    #finish { display: none; background: #b45309; color: #fff;
      border: none; border-radius: 6px; font-weight: bold; }
  </style>
</head>
<body>
<div id="map"></div>
<div id="panel"><b>Polygon stats experiment</b>
  <div style="margin-top:6px;color:#555">Filter applied server-side (example:
  Democratic primary voters) — every dot IS the audience. Draw a polygon;
  stats count client-side.</div>
  <button id="finish">Finish shape</button>
  <div id="stats">downloading binary...</div>
</div>
<script>
const KEY = '__KEY__';
const map = new maplibregl.Map({
  container: 'map',
  style: `https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=${KEY}`,
  center: [-87.66, 41.90], zoom: 11,
});
map.addControl(new maplibregl.NavigationControl());
map.doubleClickZoom.disable();

MapboxDraw.constants.classes.CANVAS = 'maplibregl-canvas';
MapboxDraw.constants.classes.CONTROL_BASE = 'maplibregl-ctrl';
MapboxDraw.constants.classes.CONTROL_PREFIX = 'maplibregl-ctrl-';
MapboxDraw.constants.classes.CONTROL_GROUP = 'maplibregl-ctrl-group';
const draw = new MapboxDraw({ displayControlsDefault: false,
  controls: { polygon: true, trash: true } });
map.addControl(draw, 'top-right');
map.on('draw.modechange', e => {
  const drawing = e.mode === 'draw_polygon';
  map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
  document.getElementById('finish').style.display = drawing ? 'block' : 'none';
});
document.getElementById('finish').addEventListener('click', () => {
  draw.changeMode('simple_select');
  document.getElementById('finish').style.display = 'none';
  map.getCanvas().style.cursor = '';
  setTimeout(update, 60);
});

let n = 0, positions, households, targets;

map.on('load', async () => {
  const res = await fetch('/chicago_stats.result.bin');
  const buf = await res.arrayBuffer();
  n = new DataView(buf).getUint32(0, true);
  positions  = new Float32Array(buf.slice(4, 4 + n * 8));
  households = new Uint8Array(buf, 4 + n * 8, n);
  targets    = new Uint8Array(buf, 4 + n * 9, n);
  const colors = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    colors[o]=13; colors[o+1]=148; colors[o+2]=136; colors[o+3]=170;
  }
  map.addControl(new deck.MapboxOverlay({ layers: [
    new deck.ScatterplotLayer({
      id: 'dots',
      data: { length: n, attributes: {
        getPosition: { value: positions, size: 2 },
        getFillColor: { value: colors, size: 4 } } },
      radiusMinPixels: 1, radiusMaxPixels: 6, getRadius: 5, pickable: false,
    })] }));
  document.getElementById('stats').innerHTML =
    `${n.toLocaleString()} dots loaded (${(buf.byteLength/1e6).toFixed(1)}MB).<br>` +
    `every dot is a target household. Draw a polygon.`;
});

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

function update() {
  const polys = draw.getAll().features.filter(f => f.geometry.type === 'Polygon');
  if (!polys.length || !n) return;
  const ring = polys[polys.length - 1].geometry.coordinates[0];
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const p of ring) {
    if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
    if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
  }
  const t0 = performance.now();
  let stops = 0, hh = 0, tg = 0;
  for (let i = 0; i < n; i++) {
    const x = positions[i*2], y = positions[i*2+1];
    if (x < minx || x > maxx || y < miny || y > maxy) continue;
    if (!pointInRing(x, y, ring)) continue;
    stops++; hh += households[i]; tg += targets[i];
  }
  const ms = (performance.now() - t0).toFixed(1);
  document.getElementById('stats').innerHTML =
    `<span class="big">${stops.toLocaleString()}</span> stops (doors)<br>` +
    `<span class="big">${hh.toLocaleString()}</span> households (full addresses)<br>` +
    `<span class="big">${tg.toLocaleString()}</span> targets<br>` +
    `<span style="color:#888">counted in ${ms}ms, client-side</span>`;
}
map.on('draw.create', update);
map.on('draw.update', update);
map.on('draw.delete', update);
</script>
</body>
</html>"""


def main() -> None:
    html = HTML.replace("__KEY__", load_env_key())
    out = os.path.join(LOCAL, "chi_stats.html")
    with open(out, "w") as f:
        f.write(html)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
