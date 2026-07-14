#!/usr/bin/env python3
"""Re-pack ca_dots.result.bin sorted by grid cell, with an embedded cell index.

Output ca_sorted.result.bin layout (little-endian, all blocks 4-byte aligned):
  u32 count
  u32 numCells
  numCells x { i32 cellX, i32 cellY, u32 dotOffset, u32 dotCount }
  f32 positions[count*2]   (sorted so each cell's dots are contiguous)
  u8  party[count]

One file serves the whole state; the client holds it and renders only the
cells in view via zero-copy subarray views.

Usage: python3 sort_ca.py
"""

import os
import struct
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(LOCAL, "local")
os.makedirs(LOCAL, exist_ok=True)
CELL = 0.2


def main() -> None:
    buf = open(os.path.join(LOCAL, "ca_dots.result.bin"), "rb").read()
    n = struct.unpack_from("<I", buf, 0)[0]
    pos_off, party_off = 4, 4 + n * 8

    cells = defaultdict(lambda: (bytearray(), bytearray()))
    for i in range(n):
        lon, lat = struct.unpack_from("<ff", buf, pos_off + i * 8)
        key = (int(lon // CELL), int(lat // CELL))
        p, q = cells[key]
        p += buf[pos_off + i * 8: pos_off + i * 8 + 8]
        q.append(buf[party_off + i])

    out = os.path.join(LOCAL, "ca_sorted.result.bin")
    keys = sorted(cells.keys())
    with open(out, "wb") as f:
        f.write(struct.pack("<II", n, len(keys)))
        offset = 0
        for k in keys:
            cnt = len(cells[k][1])
            f.write(struct.pack("<iiII", k[0], k[1], offset, cnt))
            offset += cnt
        for k in keys:
            f.write(cells[k][0])
        for k in keys:
            f.write(cells[k][1])
    print(f"wrote {n:,} dots, {len(keys)} cells -> {out} "
          f"({os.path.getsize(out)/1e6:.0f} MB)")


if __name__ == "__main__":
    main()
