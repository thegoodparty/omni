#!/usr/bin/env python3
"""Split ca_dots.result.bin into 0.2-degree grid cell binaries for gated loading.

Writes cells/ca/{lonIdx}_{latIdx}.bin (same format: u32 count, f32 lonlat
pairs, u8 party) plus cells/ca/manifest.json mapping cell id -> dot count.

Usage: python3 split_ca.py
"""

import json
import os
import struct
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(LOCAL, "local")
os.makedirs(LOCAL, exist_ok=True)
CELL = 0.2  # degrees
OUT = os.path.join(LOCAL, "cells", "ca")


def main() -> None:
    buf = open(os.path.join(LOCAL, "ca_dots.result.bin"), "rb").read()
    n = struct.unpack_from("<I", buf, 0)[0]
    pos_off, party_off = 4, 4 + n * 8

    cells = defaultdict(lambda: (bytearray(), bytearray()))
    for i in range(n):
        lon, lat = struct.unpack_from("<ff", buf, pos_off + i * 8)
        party = buf[party_off + i]
        key = (int(lon // CELL), int(lat // CELL))
        p, q = cells[key]
        p += struct.pack("<ff", lon, lat)
        q.append(party)

    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    for (cx, cy), (p, q) in cells.items():
        count = len(q)
        cid = f"{cx}_{cy}"
        with open(os.path.join(OUT, f"{cid}.bin"), "wb") as f:
            f.write(struct.pack("<I", count))
            f.write(p)
            f.write(q)
        manifest[cid] = count

    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump({"cell": CELL, "cells": manifest}, f)
    sizes = sorted(len(q) for _, q in cells.values())
    print(f"{n:,} dots -> {len(cells)} cells; "
          f"largest cell {sizes[-1]:,} dots ({sizes[-1]*9/1e6:.1f} MB), "
          f"median {sizes[len(sizes)//2]:,}")


if __name__ == "__main__":
    main()
