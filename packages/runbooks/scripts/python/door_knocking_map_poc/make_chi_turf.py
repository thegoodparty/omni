#!/usr/bin/env python3
"""Generate chi_turf.html: binary deck.gl Chicago dots + polygon turf select.

Combines the phone-safe rendering path (4MB binary, typed arrays, GPU) with
the turf-cutter interaction: draw a polygon, see stop counts + party mix and
the 100/150 cap guardrails, optimize the walking order via Geoapify, see the
numbered sequence. Point-in-polygon runs directly over the Float32Array.

Usage: python3 make_chi_turf.py   (serve.py running; open /chi_turf.html)
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
  <title>Chicago turf cutter (binary + deck.gl)</title>
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
      box-shadow: 0 2px 8px rgba(0,0,0,.25); width: 250px; }
    #stats { margin-top: 8px; color: #555; min-height: 70px; }
    button { width: 100%; margin-top: 6px; padding: 10px; font-size: 14px; }
    /* touch-friendly draw controls */
    .maplibregl-ctrl-group button.mapbox-gl-draw_ctrl-draw-btn {
      width: 48px; height: 48px; background-size: 26px 26px;
      background-position: center; background-repeat: no-repeat;
    }
    #finish { display: none; background: #b45309; color: #fff;
      border: none; border-radius: 6px; font-weight: bold; }
  </style>
</head>
<body>
<div id="map"></div>
<div id="panel"><b>Chicago turf cutter (binary)</b>
  <div style="margin-top:6px">Polygon tool (top-right): click corners, then
  click the first point again to finish.</div>
  <div id="mode-hint" style="margin-top:6px;color:#b45309;font-weight:bold"></div>
  <button id="finish">Finish turf</button>
  <div id="stats">downloading binary...</div>
  <button id="optimize" disabled>Optimize walking order</button>
  <div id="order-stats" style="margin-top:8px;color:#555"></div>
</div>
<script>
const KEY = '__KEY__';
const map = new maplibregl.Map({
  container: 'map',
  style: `https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=${KEY}`,
  center: [-87.658, 41.921], zoom: 14,
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
  document.getElementById('mode-hint').textContent = drawing
    ? 'DRAWING: tap corners, then hit Finish turf' : '';
  document.getElementById('finish').style.display = drawing ? 'block' : 'none';
});
document.getElementById('finish').addEventListener('click', () => {
  draw.changeMode('simple_select');
  document.getElementById('finish').style.display = 'none';
  document.getElementById('mode-hint').textContent = '';
  map.getCanvas().style.cursor = '';
  setTimeout(onTurfChange, 60);  // commit regardless of draw.create timing
});

let n = 0, positions, party, colors;
let selIdx = [];           // indices of selected dots
let routeData = null;      // {path: [...], labels: [{position, text}]}
const overlay = new deck.MapboxOverlay({ layers: [] });
map.addControl(overlay);

function layers() {
  const ls = [new deck.ScatterplotLayer({
    id: 'dots',
    data: { length: n, attributes: {
      getPosition: { value: positions, size: 2 },
      getFillColor: { value: colors, size: 4 } } },
    radiusMinPixels: 1, radiusMaxPixels: 6, getRadius: 5, pickable: false,
  })];
  if (selIdx.length) {
    const sp = new Float32Array(selIdx.length * 2);
    selIdx.forEach((di, i) => {
      sp[i*2] = positions[di*2]; sp[i*2+1] = positions[di*2+1];
    });
    ls.push(new deck.ScatterplotLayer({
      id: 'selected',
      data: { length: selIdx.length,
        attributes: { getPosition: { value: sp, size: 2 } } },
      radiusMinPixels: 3, radiusMaxPixels: 9, getRadius: 7,
      getFillColor: [5, 150, 105, 240],
      stroked: true, getLineColor: [255, 255, 255, 255], lineWidthMinPixels: 1,
    }));
  }
  if (routeData) {
    ls.push(new deck.PathLayer({
      id: 'route', data: [{ path: routeData.path }],
      getPath: d => d.path, getColor: [26, 86, 219, 220],
      widthMinPixels: 2.5, getWidth: 3,
    }));
    ls.push(new deck.TextLayer({
      id: 'seq', data: routeData.labels,
      getPosition: d => d.position, getText: d => d.text,
      getSize: 14, getColor: [255, 255, 255, 255],
      background: true, getBackgroundColor: [26, 86, 219, 255],
      backgroundPadding: [3, 2],
    }));
  }
  return ls;
}
function render() { overlay.setProps({ layers: layers() }); }

async function load() {
  const res = await fetch('/chicago_dots.result.bin');
  const buf = await res.arrayBuffer();
  n = new DataView(buf).getUint32(0, true);
  positions = new Float32Array(buf.slice(4, 4 + n * 8));
  party = new Uint8Array(buf, 4 + n * 8, n);
  colors = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = party[i], o = i * 4;
    if (p === 1) { colors[o]=37; colors[o+1]=99; colors[o+2]=235; }
    else if (p === 2) { colors[o]=220; colors[o+1]=38; colors[o+2]=38; }
    else { colors[o]=107; colors[o+1]=114; colors[o+2]=128; }
    colors[o+3] = 180;
  }
  render();
  document.getElementById('stats').textContent =
    `${n.toLocaleString()} dots on the GPU. Draw a polygon.`;
}
map.on('load', load);

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

function onTurfChange() {
  const polys = draw.getAll().features.filter(f => f.geometry.type === 'Polygon');
  routeData = null;
  document.getElementById('order-stats').textContent = '';
  if (!polys.length || !n) {
    selIdx = []; render();
    document.getElementById('stats').textContent = n ? 'Draw a polygon.' : 'loading...';
    document.getElementById('optimize').disabled = true;
    return;
  }
  const ring = polys[polys.length - 1].geometry.coordinates[0];
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const p of ring) {
    if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
    if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
  }
  const t0 = performance.now();
  selIdx = [];
  let dem = 0, rep = 0;
  for (let i = 0; i < n; i++) {
    const x = positions[i*2], y = positions[i*2+1];
    if (x < minx || x > maxx || y < miny || y > maxy) continue;
    if (!pointInRing(x, y, ring)) continue;
    selIdx.push(i);
    if (party[i] === 1) dem++; else if (party[i] === 2) rep++;
  }
  const ms = (performance.now() - t0).toFixed(0);
  render();
  const stops = selIdx.length;
  const hours = (stops / 45).toFixed(1);
  let capMsg = '', color = '#065f46';
  if (stops > 150) { capMsg = 'HARD CAP: over 150 stops, split this turf'; color = '#b91c1c'; }
  else if (stops > 100) { capMsg = `soft warning: ~${hours}h of knocking`; color = '#b45309'; }
  document.getElementById('stats').innerHTML =
    `<b style="color:${color};font-size:15px">${stops.toLocaleString()} stops</b><br>` +
    `households: ${dem} dem-lean · ${rep} rep-lean · ${stops-dem-rep} other<br>` +
    `~${hours} hours at 45 doors/hr<br>` +
    `selection: ${ms}ms over ${n.toLocaleString()} dots (typed arrays)<br>` +
    `<span style="color:${color}">${capMsg}</span>`;
  document.getElementById('optimize').disabled = stops === 0 || stops > 150;
}
map.on('draw.create', onTurfChange);
map.on('draw.update', onTurfChange);
map.on('draw.delete', onTurfChange);

document.getElementById('optimize').addEventListener('click', async () => {
  const btn = document.getElementById('optimize');
  btn.disabled = true; btn.textContent = 'Optimizing...';
  let cx = 0, cy = 0;
  for (const i of selIdx) { cx += positions[i*2]; cy += positions[i*2+1]; }
  cx /= selIdx.length; cy /= selIdx.length;
  const body = {
    mode: 'walk',
    agents: [{ start_location: [cx, cy] }],
    jobs: selIdx.map((di, i) => ({ id: `d${i}`,
      location: [positions[di*2], positions[di*2+1]] })),
  };
  const t0 = performance.now();
  let plan;
  try {
    const res = await fetch(`https://api.geoapify.com/v1/routeplanner?apiKey=${KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body) });
    plan = await res.json();
  } catch (e) { plan = { error: String(e) }; }
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  btn.textContent = 'Optimize walking order'; btn.disabled = false;
  if (!plan.features || !plan.features.length) {
    document.getElementById('order-stats').textContent =
      'optimization failed: ' + JSON.stringify(plan).slice(0, 120);
    return;
  }
  const p = plan.features[0].properties;
  const path = [], labels = [];
  let seq = 0;
  for (const w of p.waypoints) {
    path.push(w.location);
    if (w.actions.some(a => a.type === 'job')) {
      seq += 1;
      labels.push({ position: w.location, text: String(seq) });
    }
  }
  routeData = { path, labels };
  render();
  document.getElementById('order-stats').innerHTML =
    `order for ${seq} stops in ${secs}s (~${(seq+1)*10} credits)<br>` +
    `walk: ${(p.distance/1000).toFixed(1)}km, ${(p.time/3600).toFixed(1)}h + door time`;
});
</script>
</body>
</html>"""


def main() -> None:
    html = HTML.replace("__KEY__", load_env_key())
    out = os.path.join(LOCAL, "chi_turf.html")
    with open(out, "w") as f:
        f.write(html)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
