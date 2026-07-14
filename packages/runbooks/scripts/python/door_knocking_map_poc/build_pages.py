#!/usr/bin/env python3
"""Generate the three Chicago dot-strategy comparison pages plus an index.

Same data (460,861 household dots), same filters, same map style; only the
delivery strategy differs. Run serve.py, then open http://localhost:8765/

Usage: python3 build_pages.py
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


PANEL = """
<div id="panel">
  <b>{title}</b>
  <label>Party lean:
    <select id="party">
      <option value="all">All households</option>
      <option value="dem">Dem-leaning</option>
      <option value="rep">Rep-leaning</option>
      <option value="none">No majority party</option>
    </select>
  </label>
  <label>Min voters in household: <span id="minv-label">1</span>
    <input type="range" id="minv" min="1" max="8" value="1" style="width:100%">
  </label>
  <label>Avg age at least: <span id="mina-label">18</span>
    <input type="range" id="mina" min="18" max="80" value="18" style="width:100%">
  </label>
  <div id="stats">loading...</div>
  <div style="margin-top:8px"><a href="/">back to index</a></div>
</div>
"""

SHARED_HEAD = """
  <script src="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css" rel="stylesheet">
  <style>
    body { margin: 0; font: 13px sans-serif; }
    #map { height: 100vh; }
    #panel { position: absolute; top: 10px; left: 10px; z-index: 2;
      background: #fff; padding: 12px 14px; border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,.25); width: 240px; }
    #panel label { display: block; margin-top: 8px; }
    #stats { margin-top: 10px; color: #555; min-height: 48px; }
  </style>
"""

SHARED_JS = """
const PAINT = {
  'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1, 12, 1.8, 14, 4, 16, 7],
  'circle-color': ['case',
    ['>', ['get', 'd'], ['get', 'r']], '#2563eb',
    ['>', ['get', 'r'], ['get', 'd']], '#dc2626',
    '#6b7280'],
  'circle-opacity': 0.75,
};
function filterExpr() {
  const party = document.getElementById('party').value;
  const minv = +document.getElementById('minv').value;
  const mina = +document.getElementById('mina').value;
  const f = ['all', ['>=', ['get', 'v'], minv], ['>=', ['get', 'a'], mina]];
  if (party === 'dem') f.push(['>', ['get', 'd'], ['get', 'r']]);
  if (party === 'rep') f.push(['>', ['get', 'r'], ['get', 'd']]);
  if (party === 'none') f.push(['==', ['get', 'd'], ['get', 'r']]);
  return f;
}
function filterParams() {
  return `party=${document.getElementById('party').value}` +
         `&minv=${document.getElementById('minv').value}` +
         `&mina=${document.getElementById('mina').value}`;
}
function syncLabels() {
  document.getElementById('minv-label').textContent = document.getElementById('minv').value;
  document.getElementById('mina-label').textContent = document.getElementById('mina').value;
}
function newMap(key) {
  const map = new maplibregl.Map({
    container: 'map',
    style: `https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=${key}`,
    center: [-87.66, 41.87], zoom: 10,
  });
  map.addControl(new maplibregl.NavigationControl());
  return map;
}
"""

S1_JS = """
const map = newMap(KEY);
let loaded = 0, tFetch = 0, tParse = 0;
map.on('load', async () => {
  const t0 = performance.now();
  const res = await fetch('/dots_all.result.json');
  const text = await res.text();
  tFetch = performance.now() - t0;
  const t1 = performance.now();
  const dots = JSON.parse(text);
  tParse = performance.now() - t1;
  loaded = dots.features.length;
  map.addSource('dots', { type: 'geojson', data: dots });
  map.addLayer({ id: 'dots', type: 'circle', source: 'dots', paint: PAINT });
  apply();
});
function apply() {
  syncLabels();
  if (!map.getLayer('dots')) return;
  const t = performance.now();
  map.setFilter('dots', filterExpr());
  requestAnimationFrame(() => {
    document.getElementById('stats').innerHTML =
      `${loaded.toLocaleString()} dots loaded upfront<br>` +
      `download: ${(tFetch/1000).toFixed(1)}s | parse: ${(tParse/1000).toFixed(1)}s<br>` +
      `filter apply: ${(performance.now() - t).toFixed(1)}ms (client-side)`;
  });
}
for (const id of ['party', 'minv', 'mina'])
  document.getElementById(id).addEventListener('input', apply);
"""

S2_JS = """
const MIN_ZOOM = 12;
const map = newMap(KEY);
map.on('load', () => {
  map.addSource('dots', { type: 'geojson',
    data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'dots', type: 'circle', source: 'dots', paint: PAINT });
  refetch();
});
let inflight = null;
async function refetch() {
  syncLabels();
  if (!map.getSource('dots')) return;
  if (map.getZoom() < MIN_ZOOM) {
    map.getSource('dots').setData({ type: 'FeatureCollection', features: [] });
    document.getElementById('stats').innerHTML =
      `zoom in to z${MIN_ZOOM}+ to load dots (current z${map.getZoom().toFixed(1)})<br>` +
      `nothing is downloaded at city zoom`;
    return;
  }
  const b = map.getBounds();
  const url = `/bbox?minx=${b.getWest()}&miny=${b.getSouth()}` +
              `&maxx=${b.getEast()}&maxy=${b.getNorth()}&${filterParams()}`;
  const t0 = performance.now();
  if (inflight) inflight.abort();
  inflight = new AbortController();
  let res;
  try { res = await fetch(url, { signal: inflight.signal }); }
  catch (e) { return; }
  const data = await res.json();
  map.getSource('dots').setData(data);
  document.getElementById('stats').innerHTML =
    `${(+res.headers.get('X-Count')).toLocaleString()} dots in viewport<br>` +
    `round trip: ${(performance.now() - t0).toFixed(0)}ms ` +
    `(server: ${res.headers.get('X-Server-Ms')}ms)<br>` +
    `every pan/zoom/filter refetches`;
}
map.on('moveend', refetch);
for (const id of ['party', 'minv', 'mina'])
  document.getElementById(id).addEventListener('input', refetch);
"""

S3_JS = """
const map = newMap(KEY);
map.on('load', () => {
  map.addSource('dots', { type: 'vector',
    tiles: ['http://localhost:8765/tiles/{z}/{x}/{y}.pbf'],
    minzoom: 7, maxzoom: 16 });
  map.addLayer({ id: 'dots', type: 'circle', source: 'dots',
    'source-layer': 'dots', paint: PAINT });
  apply();
});
function apply() {
  syncLabels();
  if (!map.getLayer('dots')) return;
  const t = performance.now();
  map.setFilter('dots', filterExpr());
  requestAnimationFrame(() => {
    document.getElementById('stats').innerHTML =
      `dots stream in as ~25KB tiles per viewport<br>` +
      `low zoom shows a density subsample (baked)<br>` +
      `filter apply: ${(performance.now() - t).toFixed(1)}ms (client-side)`;
  });
}
for (const id of ['party', 'minv', 'mina'])
  document.getElementById(id).addEventListener('input', apply);
"""

TURF_PANEL = """
<div id="panel">
  <b>Turf cutter test</b>
  <div style="margin-top:8px">Click the polygon tool (top-right), click
  corners on the map, then press Enter or click the first point to finish.</div>
  <div id="mode-hint" style="margin-top:6px;color:#b45309;font-weight:bold"></div>
  <div id="stats" style="margin-top:10px;min-height:90px">loading dots...</div>
  <button id="optimize" disabled style="width:100%;margin-top:6px;padding:6px">
    Optimize walking order</button>
  <div id="order-stats" style="margin-top:8px;color:#555"></div>
  <div style="margin-top:8px"><a href="/">back to index</a></div>
</div>
"""

TURF_JS = """
const map = newMap(KEY);
// mapbox-gl-draw targets mapboxgl-* classes; MapLibre renders maplibregl-*.
MapboxDraw.constants.classes.CANVAS = 'maplibregl-canvas';
MapboxDraw.constants.classes.CONTROL_BASE = 'maplibregl-ctrl';
MapboxDraw.constants.classes.CONTROL_PREFIX = 'maplibregl-ctrl-';
MapboxDraw.constants.classes.CONTROL_GROUP = 'maplibregl-ctrl-group';
MapboxDraw.constants.classes.ATTRIBUTION = 'maplibregl-ctrl-attrib';
const draw = new MapboxDraw({
  displayControlsDefault: false,
  controls: { polygon: true, trash: true },
});
map.addControl(draw, 'top-right');
map.doubleClickZoom.disable();  // don't fight the polygon-finish dblclick
map.on('draw.modechange', e => {
  const drawing = e.mode === 'draw_polygon';
  map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
  document.getElementById('mode-hint').textContent = drawing
    ? 'DRAWING: click corners on the map; press Enter or click the first point to finish'
    : '';
});

let allDots = [];
let selected = [];

map.on('load', async () => {
  const res = await fetch('/dots_all.result.json');
  const dots = await res.json();
  allDots = dots.features;
  map.addSource('dots', { type: 'geojson', data: dots });
  map.addLayer({ id: 'dots', type: 'circle', source: 'dots', paint: PAINT });
  map.addSource('selected', { type: 'geojson',
    data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'selected', type: 'circle', source: 'selected',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 6, 16, 9],
             'circle-color': '#059669', 'circle-opacity': 0.95,
             'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
  map.addSource('route', { type: 'geojson',
    data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route',
    paint: { 'line-color': '#1a56db', 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
    filter: ['==', ['geometry-type'], 'LineString'] });
  map.addLayer({ id: 'route-seq', type: 'symbol', source: 'route',
    layout: { 'text-field': ['get', 'seq'], 'text-size': 13,
              'text-font': ['Open Sans Semibold'], 'text-allow-overlap': true },
    paint: { 'text-color': '#fff', 'text-halo-color': '#1a56db', 'text-halo-width': 2 },
    filter: ['==', ['geometry-type'], 'Point'] });
  document.getElementById('stats').textContent =
    `${allDots.length.toLocaleString()} household dots loaded. Draw a polygon.`;
});

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) &&
        (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function onTurfChange() {
  const polys = draw.getAll().features.filter(f => f.geometry.type === 'Polygon');
  map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
  document.getElementById('order-stats').textContent = '';
  if (!polys.length) {
    selected = [];
    map.getSource('selected').setData({ type: 'FeatureCollection', features: [] });
    document.getElementById('stats').textContent = 'Draw a polygon.';
    document.getElementById('optimize').disabled = true;
    return;
  }
  const ring = polys[polys.length - 1].geometry.coordinates[0];
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs);
  const miny = Math.min(...ys), maxy = Math.max(...ys);
  const t0 = performance.now();
  selected = allDots.filter(f => {
    const c = f.geometry.coordinates;
    return c[0] >= minx && c[0] <= maxx && c[1] >= miny && c[1] <= maxy &&
           pointInRing(c, ring);
  });
  const ms = (performance.now() - t0).toFixed(0);
  map.getSource('selected').setData({ type: 'FeatureCollection', features: selected });

  const stops = selected.length;
  let voters = 0, dem = 0, rep = 0;
  for (const f of selected) {
    voters += f.properties.v; dem += f.properties.d; rep += f.properties.r;
  }
  const other = voters - dem - rep;
  const hours = (stops / 45).toFixed(1);
  let capMsg = '', color = '#065f46';
  if (stops > 150) { capMsg = `HARD CAP: over 150 stops, split this turf`; color = '#b91c1c'; }
  else if (stops > 100) { capMsg = `soft warning: ~${hours}h of knocking`; color = '#b45309'; }
  document.getElementById('stats').innerHTML =
    `<b style="color:${color};font-size:15px">${stops.toLocaleString()} stops · ` +
    `${voters.toLocaleString()} voters</b><br>` +
    `${dem.toLocaleString()} dem · ${rep.toLocaleString()} rep · ` +
    `${other.toLocaleString()} other/unaffiliated<br>` +
    `~${hours} hours of knocking at 45 doors/hr<br>` +
    `selection took ${ms}ms over 460K dots<br>` +
    `<span style="color:${color}">${capMsg}</span>`;
  document.getElementById('optimize').disabled = stops === 0 || stops > 150;
}
map.on('draw.create', onTurfChange);
map.on('draw.update', onTurfChange);
map.on('draw.delete', onTurfChange);

document.getElementById('optimize').addEventListener('click', async () => {
  const btn = document.getElementById('optimize');
  btn.disabled = true; btn.textContent = 'Optimizing...';
  const cx = selected.reduce((s, f) => s + f.geometry.coordinates[0], 0) / selected.length;
  const cy = selected.reduce((s, f) => s + f.geometry.coordinates[1], 0) / selected.length;
  const body = {
    mode: 'walk',
    agents: [{ start_location: [cx, cy] }],
    jobs: selected.map((f, i) => ({ id: `d${i}`, location: f.geometry.coordinates })),
  };
  const t0 = performance.now();
  const res = await fetch(`https://api.geoapify.com/v1/routeplanner?apiKey=${KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) });
  const plan = await res.json();
  const ms = ((performance.now() - t0) / 1000).toFixed(1);
  btn.textContent = 'Optimize walking order'; btn.disabled = false;
  if (!plan.features || !plan.features.length) {
    document.getElementById('order-stats').textContent =
      'optimization failed: ' + JSON.stringify(plan).slice(0, 120);
    return;
  }
  const p = plan.features[0].properties;
  const feats = [];
  let seq = 0;
  const pathCoords = [];
  for (const w of p.waypoints) {
    pathCoords.push(w.location);
    const isJob = w.actions.some(a => a.type === 'job');
    if (!isJob) continue;
    seq += 1;
    feats.push({ type: 'Feature',
      geometry: { type: 'Point', coordinates: w.location },
      properties: { seq: String(seq) } });
  }
  feats.push({ type: 'Feature',
    geometry: { type: 'LineString', coordinates: pathCoords }, properties: {} });
  map.getSource('route').setData({ type: 'FeatureCollection', features: feats });
  document.getElementById('order-stats').innerHTML =
    `order for ${seq} stops in ${ms}s (${(seq + 1) * 10} credits)<br>` +
    `walk: ${(p.distance / 1000).toFixed(1)}km, ${(p.time / 3600).toFixed(1)}h + door time`;
});
"""

INDEX = """<!doctype html>
<html><head><meta charset="utf-8"><title>Chicago dot strategies</title>
<style>body{font:15px/1.5 sans-serif;max-width:760px;margin:40px auto;padding:0 20px}
h1{font-size:22px} li{margin:10px 0}</style></head><body>
<h1>Chicago at full scale: 460,861 household dots, three ways</h1>
<p>Same data (every household of the mayoral electorate, party mix + size +
age per dot), same map, same filters. Only the delivery strategy differs.</p>
<ol>
<li><a href="/strategy1.html">Strategy 1: brute force</a> —
download all 56.5MB upfront, filter client-side. Measures the honest cost of
"just load everything."</li>
<li><a href="/strategy2.html">Strategy 2: viewport fetch</a> —
nothing at city zoom; at z12+ each pan and each filter change queries the
server for the current view. Measures the felt latency of refetching.</li>
<li><a href="/strategy3.html">Strategy 3: vector tiles</a> —
dots pre-baked into static tiles (26MB total, ~25KB per tile); density
subsample at low zoom, full detail at high zoom, filters client-side.</li>
<li><a href="/turf.html">Turf cutter test</a> —
draw a polygon over the dots to select a turf; live stop/voter counts with
the 100/150 cap guardrails, then optimize the walking order via the real
Geoapify Route Planner and see the numbered sequence on the map.</li>
</ol>
<p><b>Binary + deck.gl pages</b> (phone-safe: typed arrays on the GPU, no
GeoJSON parse):</p>
<ol>
<li><a href="/chi.html">Chicago, every household (4MB binary)</a> —
the same 460K dots that crash a phone as GeoJSON.</li>
<li><a href="/chi_turf.html">Chicago turf cutter (binary)</a> —
polygon select + caps + optimize, running on the binary rendering path.</li>
<li><a href="/ca.html">California, every household (74MB binary)</a> —
all 8.2M dots; a stress test, may exceed phone memory.</li>
<li><a href="/chi_stats.html">Polygon stats experiment</a> —
dots carry only households + targets counts; draw a polygon, get
stops / households / targets summed client-side with timing.</li>
<li><a href="/ca_all.html">California, one download + gated render</a> —
the whole 74MB downloaded once (no per-cell hosting), held in memory,
only viewport cells rendered past z11. Tests resident-memory tolerance.</li>
<li><a href="/chi_pack.html">Chicago: full on-device filtering</a> —
14 encoded dimensions per person (party, age, turnout, income, ethnicity...);
every filter change is a typed-array pass on the phone; polygon stats count
spots / households / targeted under the current filters.</li>
<li><a href="/ca_gated.html">California, gated (phone-safe)</a> —
no dots until z11 ("zoom in to see individual doors"), then only the
viewport's grid cells load (LRU-capped memory).</li>
</ol>
<p>Watch the stats box on each page: download/parse cost (1), round-trip per
interaction (2), filter latency (all three).</p>
</body></html>"""


def page(title: str, body_js: str, key: str, panel: str = None,
         head_extra: str = "") -> str:
    return f"""<!doctype html>
<html>
<head><meta charset="utf-8"><title>{title}</title>{SHARED_HEAD}{head_extra}</head>
<body>
<div id="map"></div>
{panel if panel is not None else PANEL.format(title=title)}
<script>
const KEY = '{key}';
{SHARED_JS}
{body_js}
</script>
</body>
</html>"""


DRAW_HEAD = """
  <script src="https://unpkg.com/@mapbox/mapbox-gl-draw@1.4.3/dist/mapbox-gl-draw.js"></script>
  <link href="https://unpkg.com/@mapbox/mapbox-gl-draw@1.4.3/dist/mapbox-gl-draw.css" rel="stylesheet">
"""


def main() -> None:
    key = load_env_key()
    pages = {
        "strategy1.html": page("Strategy 1: brute force (56.5MB upfront)", S1_JS, key),
        "strategy2.html": page("Strategy 2: viewport fetch (z12+)", S2_JS, key),
        "strategy3.html": page("Strategy 3: vector tiles (pre-baked)", S3_JS, key),
        "turf.html": page("Turf cutter test", TURF_JS, key, panel=TURF_PANEL,
                          head_extra=DRAW_HEAD),
        "index.html": INDEX,
    }
    for name, html in pages.items():
        with open(os.path.join(HERE, name), "w") as f:
            f.write(html)
        print(f"wrote {name}")


if __name__ == "__main__":
    main()
