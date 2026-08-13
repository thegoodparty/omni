#!/usr/bin/env python3
"""Generate ca_all.html: whole California downloaded once, zoom-gated render.

The experiment: ONE static file (74MB, cell-sorted with embedded index) is
downloaded and held in memory; below the gate zoom nothing renders; past it,
only the viewport's cells become GPU layers, extracted as zero-copy subarray
views. Tests whether a phone tolerates the resident 74MB. No per-cell
hosting: any static file server works.

Usage: python3 make_ca_all.py   (open /ca_all.html)
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
  <title>California: one download, gated render</title>
  <script src="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css" rel="stylesheet">
  <script src="https://unpkg.com/deck.gl@9.0.35/dist.min.js"></script>
  <style>
    body { margin: 0; font: 13px sans-serif; }
    #map { height: 100vh; }
    #panel { position: absolute; top: 10px; left: 10px; z-index: 2;
      background: #fff; padding: 10px 12px; border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,.25); max-width: 250px; }
    #gate { position: absolute; bottom: 30px; left: 50%;
      transform: translateX(-50%); z-index: 2; background: rgba(17,24,39,.85);
      color: #fff; padding: 8px 16px; border-radius: 20px; display: none; }
  </style>
</head>
<body>
<div id="map"></div>
<div id="panel"><b>CA: one download, gated render</b>
  <div id="stats" style="margin-top:6px;color:#555">starting download...</div>
</div>
<div id="gate">zoom in to see individual doors</div>
<script>
const KEY = '__KEY__';
const GATE_ZOOM = 11;
const CELL = 0.2;

const map = new maplibregl.Map({
  container: 'map',
  style: `https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=${KEY}`,
  center: [-119.5, 36.8], zoom: 5.6,
});
map.addControl(new maplibregl.NavigationControl());
const overlay = new deck.MapboxOverlay({ layers: [] });
map.addControl(overlay);

let n = 0, positions, party;
const index = new Map();          // "cx_cy" -> {off, cnt}
const colorCache = new Map();     // cell id -> Uint8Array (small, capped)

async function download() {
  const res = await fetch('/ca_sorted.result.bin');
  const total = +res.headers.get('Content-Length') || 0;
  const bytes = new Uint8Array(total);   // preallocate: no assembly spike
  const reader = res.body.getReader();
  let got = 0;
  const t0 = performance.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes.set(value, got);
    got += value.length;
    document.getElementById('stats').textContent =
      `downloading: ${(got/1e6).toFixed(0)} / ${(total/1e6).toFixed(0)} MB`;
  }
  const buf = bytes.buffer;
  const dv = new DataView(buf);
  n = dv.getUint32(0, true);
  const numCells = dv.getUint32(4, true);
  for (let c = 0; c < numCells; c++) {
    const o = 8 + c * 16;
    index.set(`${dv.getInt32(o, true)}_${dv.getInt32(o+4, true)}`,
      { off: dv.getUint32(o+8, true), cnt: dv.getUint32(o+12, true) });
  }
  const posStart = 8 + numCells * 16;
  positions = new Float32Array(buf, posStart, n * 2);
  party = new Uint8Array(buf, posStart + n * 8, n);
  document.getElementById('stats').innerHTML =
    `${n.toLocaleString()} dots resident in memory ` +
    `(${(total/1e6).toFixed(0)}MB, ${(performance.now()-t0)/1000 | 0}s)<br>` +
    `zoom past z${GATE_ZOOM} to render`;
  refresh();
}

function cellColors(cid, off, cnt) {
  if (colorCache.has(cid)) return colorCache.get(cid);
  const c = new Uint8Array(cnt * 4);
  for (let i = 0; i < cnt; i++) {
    const p = party[off + i], o = i * 4;
    if (p === 1) { c[o]=37; c[o+1]=99; c[o+2]=235; }
    else if (p === 2) { c[o]=220; c[o+1]=38; c[o+2]=38; }
    else { c[o]=107; c[o+1]=114; c[o+2]=128; }
    c[o+3] = 190;
  }
  if (colorCache.size > 40) colorCache.delete(colorCache.keys().next().value);
  colorCache.set(cid, c);
  return c;
}

function refresh() {
  if (!n) return;
  const z = map.getZoom();
  if (z < GATE_ZOOM) {
    overlay.setProps({ layers: [] });
    document.getElementById('gate').style.display = 'block';
    return;
  }
  document.getElementById('gate').style.display = 'none';
  const b = map.getBounds();
  const layers = [];
  let dots = 0, cells = 0;
  for (let cx = Math.floor(b.getWest()/CELL); cx <= Math.floor(b.getEast()/CELL); cx++)
    for (let cy = Math.floor(b.getSouth()/CELL); cy <= Math.floor(b.getNorth()/CELL); cy++) {
      const cid = `${cx}_${cy}`;
      const e = index.get(cid);
      if (!e) continue;
      cells++; dots += e.cnt;
      layers.push(new deck.ScatterplotLayer({
        id: `cell-${cid}`,
        data: { length: e.cnt, attributes: {
          getPosition: { value: positions.subarray(e.off*2, (e.off+e.cnt)*2), size: 2 },
          getFillColor: { value: cellColors(cid, e.off, e.cnt), size: 4 } } },
        radiusMinPixels: 1, radiusMaxPixels: 6, getRadius: 5, pickable: false,
      }));
    }
  overlay.setProps({ layers });
  document.getElementById('stats').innerHTML =
    `${dots.toLocaleString()} dots on GPU (${cells} cells in view)<br>` +
    `74MB resident; zero fetches after load`;
}

map.on('load', download);
map.on('moveend', refresh);
</script>
</body>
</html>"""


def main() -> None:
    html = HTML.replace("__KEY__", load_env_key())
    out = os.path.join(LOCAL, "ca_all.html")
    with open(out, "w") as f:
        f.write(html)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
