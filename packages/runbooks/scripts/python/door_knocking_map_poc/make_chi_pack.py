#!/usr/bin/env python3
"""Generate chi_pack.html: full on-device filtering over the Chicago pack.

14 encoded dimensions per person; filtering is one typed-array pass, poly
stats count spots / households / targeted among current matches.

Usage: python3 make_chi_pack.py   (open /chi_pack.html)
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
  <title>Chicago: full on-device filtering</title>
  <script src="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css" rel="stylesheet">
  <script src="https://unpkg.com/deck.gl@9.0.35/dist.min.js"></script>
  <script src="https://unpkg.com/@mapbox/mapbox-gl-draw@1.4.3/dist/mapbox-gl-draw.js"></script>
  <link href="https://unpkg.com/@mapbox/mapbox-gl-draw@1.4.3/dist/mapbox-gl-draw.css" rel="stylesheet">
  <style>
    body { margin: 0; font: 13px sans-serif; }
    #map { height: 100vh; }
    #panel { position: absolute; top: 10px; left: 10px; z-index: 2;
      background: #fff; padding: 10px 12px; border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,.25); width: 258px;
      max-height: 92vh; overflow-y: auto; }
    details { margin-top: 6px; border-top: 1px solid #eee; padding-top: 4px; }
    summary { cursor: pointer; font-weight: 600; }
    summary .dim-count { color: #0d9488; font-weight: 400; }
    label.v { display: inline-block; margin: 2px 8px 2px 0; white-space: nowrap; }
    #totals { margin: 6px 0; padding: 6px; background: #f0fdfa; border-radius: 6px; }
    #polystats { margin: 6px 0; padding: 6px; background: #eff6ff; border-radius: 6px; min-height: 40px;}
    button { width: 100%; margin-top: 6px; padding: 9px; font-size: 14px; }
    .maplibregl-ctrl-group button.mapbox-gl-draw_ctrl-draw-btn {
      width: 48px; height: 48px; background-size: 26px 26px;
      background-position: center; background-repeat: no-repeat; }
    #finish { display: none; background: #b45309; color: #fff;
      border: none; border-radius: 6px; font-weight: bold; }
  </style>
</head>
<body>
<div id="map"></div>
<div id="panel">
  <b>Chicago: on-device filtering</b>
  <div id="loadinfo" style="color:#555;margin-top:4px">downloading pack...</div>
  <div id="totals"></div>
  <div id="polystats">draw a polygon for area stats<br>
    <button id="finish">Finish shape</button></div>
  <div id="dims"></div>
  <button id="reset">Reset all filters</button>
</div>
<script>
const KEY = '__KEY__';
const DIMS = [
 {k:'party', label:'Political party', vals:[[1,'Democratic'],[2,'Republican'],[3,'Non-Partisan'],[0,'Other/Unknown']]},
 {k:'age', label:'Age range', vals:[[1,'18-34'],[2,'35-50'],[3,'51-64'],[4,'65+'],[0,'Unknown']]},
 {k:'votercat', label:'Voter category (even-yr general turnout)', vals:[[1,'Super (75%+)'],[2,'Likely (50-74%)'],[3,'Low (<50%)'],[0,'Unknown']]},
 {k:'registered', label:'Registered (has state voter ID)', vals:[[1,'Yes'],[0,'No/Unknown']]},
 {k:'status', label:'Voter status', vals:[[1,'Active'],[2,'Inactive'],[0,'Unknown']]},
 {k:'marital', label:'Marital status', vals:[[1,'Married (incl. inferred)'],[2,'Single (incl. inferred)'],[0,'Unknown']]},
 {k:'children', label:'Children under 18 in household', vals:[[1,'Yes'],[2,'No'],[0,'Unknown']]},
 {k:'veteran', label:'Veteran in household', vals:[[1,'Yes'],[0,'No/Unknown']]},
 {k:'homeowner', label:'Homeowner', vals:[[1,'Owner'],[2,'Renter'],[0,'Unknown']]},
 {k:'bizowner', label:'Business owner / self-employed', vals:[[1,'Likely'],[0,'No/Unknown']]},
 {k:'education', label:'Education', vals:[[1,'HS or less'],[2,'Some college'],[3,'College'],[4,'Graduate'],[0,'Unknown']]},
 {k:'income', label:'Household income (est.)', vals:[[1,'<$50k'],[2,'$50-100k'],[3,'$100-150k'],[4,'$150k+'],[0,'Unknown']]},
 {k:'language', label:'Language', vals:[[1,'English'],[2,'Spanish'],[3,'Other'],[0,'Unknown']]},
 {k:'ethnicity', label:'Ethnicity group (L2 modeled)', vals:[[1,'White/European'],[2,'Hispanic/Latino'],[3,'Black'],[4,'Asian'],[5,'Other'],[0,'Unknown']]},
];

const map = new maplibregl.Map({
  container: 'map',
  style: `https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=${KEY}`,
  center: [-87.66, 41.90], zoom: 10.5,
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
  const on = e.mode === 'draw_polygon';
  map.getCanvas().style.cursor = on ? 'crosshair' : '';
  document.getElementById('finish').style.display = on ? 'block' : 'none';
});
document.getElementById('finish').addEventListener('click', () => {
  draw.changeMode('simple_select');
  document.getElementById('finish').style.display = 'none';
  map.getCanvas().style.cursor = '';
  setTimeout(polyStats, 60);
});
const overlay = new deck.MapboxOverlay({ layers: [] });
map.addControl(overlay);

let nD=0, nH=0, nP=0, positions, hh2dot, p2hh, dim = {};
let matched, hhm;   // per-dot matched persons / matched households

async function load() {
  const t0 = performance.now();
  const res = await fetch('/chicago_pack.result.bin');
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  nD = dv.getUint32(0, true); nH = dv.getUint32(4, true); nP = dv.getUint32(8, true);
  let o = 12;
  positions = new Float32Array(buf.slice(o, o + nD*8)); o += nD*8;
  hh2dot = new Uint32Array(buf.slice(o, o + nH*4)); o += nH*4;
  p2hh = new Uint32Array(buf.slice(o, o + nP*4)); o += nP*4;
  for (const d of DIMS) { dim[d.k] = new Uint8Array(buf, o, nP); o += nP; }
  matched = new Uint32Array(nD); hhm = new Uint32Array(nD);
  document.getElementById('loadinfo').textContent =
    `${(buf.byteLength/1e6).toFixed(1)}MB pack: ${nD.toLocaleString()} dots, ` +
    `${nH.toLocaleString()} households, ${nP.toLocaleString()} people ` +
    `(${((performance.now()-t0)/1000).toFixed(1)}s)`;
  buildPanel();
  runFilter();
}
map.on('load', load);

function buildPanel() {
  const host = document.getElementById('dims');
  for (const d of DIMS) {
    const det = document.createElement('details');
    det.innerHTML = `<summary>${d.label} <span class="dim-count" id="c-${d.k}"></span></summary>` +
      d.vals.map(([code, lab]) =>
        `<label class="v"><input type="checkbox" data-dim="${d.k}" value="${code}" checked> ${lab}</label>`
      ).join('');
    host.appendChild(det);
  }
  host.addEventListener('change', runFilter);
  document.getElementById('reset').addEventListener('click', () => {
    host.querySelectorAll('input').forEach(cb => cb.checked = true);
    runFilter();
  });
}

const hhSeen = { arr: null };
function runFilter() {
  const t0 = performance.now();
  // build allowed masks; collect only dims with something unchecked
  const active = [];
  for (const d of DIMS) {
    const boxes = [...document.querySelectorAll(`input[data-dim="${d.k}"]`)];
    if (boxes.every(b => b.checked)) { markCount(d.k, ''); continue; }
    const mask = new Uint8Array(8);
    boxes.forEach(b => { if (b.checked) mask[+b.value] = 1; });
    active.push([dim[d.k], mask, d.k]);
  }
  if (!hhSeen.arr) hhSeen.arr = new Uint8Array(nH); else hhSeen.arr.fill(0);
  matched.fill(0); hhm.fill(0);
  let people = 0, households = 0;
  outer:
  for (let i = 0; i < nP; i++) {
    for (let a = 0; a < active.length; a++) {
      if (!active[a][1][active[a][0][i]]) continue outer;
    }
    people++;
    const h = p2hh[i], dt = hh2dot[h];
    matched[dt]++;
    if (!hhSeen.arr[h]) { hhSeen.arr[h] = 1; hhm[dt]++; households++; }
  }
  let dots = 0;
  const colors = new Uint8Array(nD*4);
  for (let i = 0; i < nD; i++) {
    const o = i*4;
    if (matched[i] > 0) { dots++; colors[o]=13; colors[o+1]=148; colors[o+2]=136; colors[o+3]=190; }
    else { colors[o]=190; colors[o+1]=195; colors[o+2]=200; colors[o+3]=60; }
  }
  overlay.setProps({ layers: [new deck.ScatterplotLayer({
    id: 'dots',
    data: { length: nD, attributes: {
      getPosition: { value: positions, size: 2 },
      getFillColor: { value: colors, size: 4 } } },
    radiusMinPixels: 1, radiusMaxPixels: 6, getRadius: 5, pickable: false,
    updateTriggers: { getFillColor: Math.random() },
  })]});
  document.getElementById('totals').innerHTML =
    `<b>${people.toLocaleString()}</b> matching people · ` +
    `<b>${households.toLocaleString()}</b> households · ` +
    `<b>${dots.toLocaleString()}</b> dots<br>` +
    `<span style="color:#888">filtered ${nP.toLocaleString()} people in ` +
    `${(performance.now()-t0).toFixed(0)}ms on-device (${active.length} active dims)</span>`;
  polyStats();
}
function markCount(k, txt) {
  const el = document.getElementById('c-' + k);
  if (el) el.textContent = txt;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}
function polyStats() {
  const el = document.getElementById('polystats');
  const polys = draw.getAll().features.filter(f => f.geometry.type === 'Polygon');
  if (!polys.length || !nD) return;
  const ring = polys[polys.length-1].geometry.coordinates[0];
  let minx=1e9, miny=1e9, maxx=-1e9, maxy=-1e9;
  for (const p of ring) {
    if (p[0]<minx) minx=p[0]; if (p[0]>maxx) maxx=p[0];
    if (p[1]<miny) miny=p[1]; if (p[1]>maxy) maxy=p[1];
  }
  const t0 = performance.now();
  let spots=0, hh=0, tg=0;
  for (let i = 0; i < nD; i++) {
    const x = positions[i*2], y = positions[i*2+1];
    if (x<minx||x>maxx||y<miny||y>maxy) continue;
    if (!pointInRing(x, y, ring)) continue;
    if (matched[i] > 0) { spots++; hh += hhm[i]; tg += matched[i]; }
  }
  el.innerHTML = `<b>${spots.toLocaleString()}</b> spots · ` +
    `<b>${hh.toLocaleString()}</b> households · ` +
    `<b>${tg.toLocaleString()}</b> targeted voters<br>` +
    `<span style="color:#888">in polygon, under current filters ` +
    `(${(performance.now()-t0).toFixed(1)}ms)</span>` +
    `<br><button id="finish" style="display:none">Finish shape</button>`;
}
map.on('draw.create', polyStats);
map.on('draw.update', polyStats);
map.on('draw.delete', polyStats);
</script>
</body>
</html>"""


def main() -> None:
    html = HTML.replace("__KEY__", load_env_key())
    out = os.path.join(LOCAL, "chi_pack.html")
    with open(out, "w") as f:
        f.write(html)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
