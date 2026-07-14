#!/usr/bin/env python3
"""Generate ca_gated.html: zoom-gated California via binary grid cells.

Below the gate zoom: no dots, a "zoom in to see individual doors" banner.
At gate zoom and deeper: fetch only the 0.2-degree cells under the viewport
(binary, deck.gl typed arrays), with an LRU cache so memory stays bounded.

Usage: python3 make_ca_gated.py   (open /ca_gated.html)
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
  <title>California, gated: zoom in for doors</title>
  <script src="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css" rel="stylesheet">
  <script src="https://unpkg.com/deck.gl@9.0.35/dist.min.js"></script>
  <style>
    body { margin: 0; font: 13px sans-serif; }
    #map { height: 100vh; }
    #panel { position: absolute; top: 10px; left: 10px; z-index: 2;
      background: #fff; padding: 10px 12px; border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,.25); max-width: 240px; }
    #gate { position: absolute; bottom: 30px; left: 50%;
      transform: translateX(-50%); z-index: 2; background: rgba(17,24,39,.85);
      color: #fff; padding: 8px 16px; border-radius: 20px; display: none; }
  </style>
</head>
<body>
<div id="map"></div>
<div id="panel"><b>California, gated</b>
  <div id="stats" style="margin-top:6px;color:#555">loading manifest...</div>
</div>
<div id="gate">zoom in to see individual doors</div>
<script>
const KEY = '__KEY__';
const GATE_ZOOM = 11;
const CACHE_MAX = 30;

const map = new maplibregl.Map({
  container: 'map',
  style: `https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=${KEY}`,
  center: [-119.5, 36.8], zoom: 5.6,
});
map.addControl(new maplibregl.NavigationControl());
const overlay = new deck.MapboxOverlay({ layers: [] });
map.addControl(overlay);

let manifest = null, cellDeg = 0.2;
const cache = new Map();  // cellId -> {positions, colors, count, center}
let fetchedMB = 0;

function colorize(party, n) {
  const colors = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = party[i], o = i * 4;
    if (p === 1) { colors[o]=37; colors[o+1]=99; colors[o+2]=235; }
    else if (p === 2) { colors[o]=220; colors[o+1]=38; colors[o+2]=38; }
    else { colors[o]=107; colors[o+1]=114; colors[o+2]=128; }
    colors[o+3] = 190;
  }
  return colors;
}

async function loadCell(cid) {
  if (cache.has(cid)) return cache.get(cid);
  const res = await fetch(`/cells/ca/${cid}.bin`);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  fetchedMB += buf.byteLength / 1e6;
  const n = new DataView(buf).getUint32(0, true);
  const positions = new Float32Array(buf.slice(4, 4 + n * 8));
  const party = new Uint8Array(buf, 4 + n * 8, n);
  const [cx, cy] = cid.split('_').map(Number);
  const entry = { positions, colors: colorize(party, n), count: n,
                  center: [(cx + 0.5) * cellDeg, (cy + 0.5) * cellDeg] };
  cache.set(cid, entry);
  return entry;
}

function evict(centerLon, centerLat) {
  if (cache.size <= CACHE_MAX) return;
  const byDist = [...cache.entries()].sort((a, b) => {
    const da = (a[1].center[0]-centerLon)**2 + (a[1].center[1]-centerLat)**2;
    const db = (b[1].center[0]-centerLon)**2 + (b[1].center[1]-centerLat)**2;
    return db - da;
  });
  while (cache.size > CACHE_MAX) cache.delete(byDist.shift()[0]);
}

let refreshSeq = 0;
async function refresh() {
  if (!manifest) return;
  const seq = ++refreshSeq;
  const z = map.getZoom();
  if (z < GATE_ZOOM) {
    overlay.setProps({ layers: [] });
    document.getElementById('gate').style.display = 'block';
    document.getElementById('stats').innerHTML =
      `8,246,183 households statewide<br>dots appear at z${GATE_ZOOM}+ (current z${z.toFixed(1)})`;
    return;
  }
  document.getElementById('gate').style.display = 'none';
  const b = map.getBounds();
  const wanted = [];
  for (let cx = Math.floor(b.getWest()/cellDeg); cx <= Math.floor(b.getEast()/cellDeg); cx++)
    for (let cy = Math.floor(b.getSouth()/cellDeg); cy <= Math.floor(b.getNorth()/cellDeg); cy++) {
      const cid = `${cx}_${cy}`;
      if (manifest.cells[cid]) wanted.push(cid);
    }
  await Promise.all(wanted.map(loadCell));
  if (seq !== refreshSeq) return;  // stale: user moved again
  const c = map.getCenter();
  evict(c.lng, c.lat);
  let dots = 0;
  const layers = wanted.filter(cid => cache.has(cid)).map(cid => {
    const e = cache.get(cid);
    dots += e.count;
    return new deck.ScatterplotLayer({
      id: `cell-${cid}`,
      data: { length: e.count, attributes: {
        getPosition: { value: e.positions, size: 2 },
        getFillColor: { value: e.colors, size: 4 } } },
      radiusMinPixels: 1, radiusMaxPixels: 6, getRadius: 5, pickable: false,
    });
  });
  overlay.setProps({ layers });
  document.getElementById('stats').innerHTML =
    `${dots.toLocaleString()} dots in view (${wanted.length} cells)<br>` +
    `${cache.size} cells cached | ${fetchedMB.toFixed(1)}MB fetched total`;
}

map.on('load', async () => {
  manifest = await (await fetch('/cells/ca/manifest.json')).json();
  cellDeg = manifest.cell;
  refresh();
});
map.on('moveend', refresh);
</script>
</body>
</html>"""


def main() -> None:
    html = HTML.replace("__KEY__", load_env_key())
    out = os.path.join(LOCAL, "ca_gated.html")
    with open(out, "w") as f:
        f.write(html)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
