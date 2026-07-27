#!/usr/bin/env python3
"""Local server for the Chicago dot-strategy comparison.

Serves the repo directory statically (strategy pages, dots_all.result.json,
vector tiles under tiles/) plus a /bbox endpoint for strategy 2 (viewport
fetch with server-side filters over the full dataset held in memory).

Usage: python3 serve.py   (then open http://localhost:8765/)
"""

import json
import os
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(HERE, "local")
os.makedirs(LOCAL, exist_ok=True)
PORT = 8765
MAX_FEATURES = 25000

print("loading dots_all.result.json into memory...")
_t = time.time()
try:
    DOTS = json.load(open(os.path.join(LOCAL, "dots_all.result.json")))["features"]
except FileNotFoundError:
    print("dots_all.result.json not found in local/ — /bbox (strategy 2) disabled")
    DOTS = []
# Precompute plain tuples for fast scanning: (lon, lat, v, d, r, a, feature)
INDEX = [
    (f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][1],
     f["properties"]["v"], f["properties"]["d"], f["properties"]["r"],
     f["properties"]["a"] or 0, f)
    for f in DOTS
]
print(f"loaded {len(INDEX):,} dots in {time.time()-_t:.1f}s")


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if urlparse(self.path).path == "/bbox":
            return self.bbox()
        return super().do_GET()

    def bbox(self):
        q = parse_qs(urlparse(self.path).query)
        minx, miny = float(q["minx"][0]), float(q["miny"][0])
        maxx, maxy = float(q["maxx"][0]), float(q["maxy"][0])
        party = q.get("party", ["all"])[0]
        minv = int(q.get("minv", ["1"])[0])
        mina = int(q.get("mina", ["18"])[0])

        t0 = time.time()
        feats = []
        for lon, lat, v, d, r, a, f in INDEX:
            if not (minx <= lon <= maxx and miny <= lat <= maxy):
                continue
            if v < minv or a < mina:
                continue
            if party == "dem" and not d > r:
                continue
            if party == "rep" and not r > d:
                continue
            if party == "none" and d != r:
                continue
            feats.append(f)
            if len(feats) >= MAX_FEATURES:
                break
        body = json.dumps({"type": "FeatureCollection", "features": feats},
                          separators=(",", ":")).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("X-Count", str(len(feats)))
        self.send_header("X-Server-Ms", f"{(time.time()-t0)*1000:.0f}")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # quiet
        pass


if __name__ == "__main__":
    os.chdir(LOCAL)
    print(f"serving on http://localhost:{PORT}/ (and LAN interfaces)")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
