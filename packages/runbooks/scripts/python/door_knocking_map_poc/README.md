# Door-knocking map POC

Proof-of-concept for rendering and filtering the entire voter universe of a
large city **in the browser, on a phone** — the frontend research behind the
door-knocking / turf-cutting feature. Built July 2026.

What it demonstrates, with the measured numbers:

- **460,861 Chicago household dots render smoothly on an iPhone** as a 4MB
  binary (the same data as GeoJSON is 56.5MB and crashes the tab at
  `JSON.parse` — ~1GB of JS objects; the ceiling is the format, not the map).
- **Binary parallel arrays + deck.gl**: one `ArrayBuffer`, typed-array views,
  zero per-dot objects, positions handed to the GPU as vertex buffers.
- **Polygon turf-cutting** with live stats (stops / households / targets)
  counted client-side in ~5ms over the whole city.
- **Full on-device filtering**: 14 encoded dimensions per person (party, age,
  turnout, income, ethnicity, ...) — one typed-array pass re-filters 1.67M
  people in ~31ms per checkbox change, fully offline.
- **California (8.2M dots)**: whole-state rendering on desktop; zoom-gated
  cell loading for phones ("zoom in to see individual doors").
- Live route optimization of a selected turf via the Geoapify Route Planner
  (walking mode, free end).

## ⚠️ Data safety — read before touching anything

This repo is **open source** and the voter data is **L2-licensed**. Therefore:

- **Every fetched or generated artifact lands in `./local/`, which is
  gitignored. Never commit anything from `local/`, and never redirect any
  script's output elsewhere.** That includes the generated `.html` files —
  they embed your personal Geoapify API key at build time.
- The fetch scripts pull from the Databricks mart **with your own
  credentials**; each person runs them for themselves. No voter data — raw,
  aggregated, or encoded — may enter git in any form.
- The pack/binary formats deliberately contain **no names and no IDs**, but
  they are still L2-derived data and stay on your machine.
- Secrets live in `scripts/.env` (two levels up), which is already gitignored
  repo-wide. Never inline a key into a script "just to test".

If `git status` inside this folder ever shows anything besides the `.py`,
`.sh`, `.md`, and `.gitignore` files, stop and investigate.

## Prerequisites

1. **uv** (runs the Python fetchers with their deps): `brew install uv`
2. **Databricks SQL warehouse access** to `goodparty_data_catalog` — a
   personal access token (PAT). Ask the data team if you don't have one.
3. **A free Geoapify API key** (basemap tiles + route optimization):
   sign up at https://www.geoapify.com/ — the free tier is plenty.

## Setup (once)

```bash
cd packages/runbooks
cp scripts/.env.example scripts/.env   # if you don't already have one
```

Then set in `scripts/.env`:

```
DATABRICKS_SERVER_HOSTNAME=dbc-xxxx.cloud.databricks.com
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/xxxx
DATABRICKS_API_KEY=<your PAT>
GEOAPIFY_API_KEY=<your key>
```

## Run

```bash
cd scripts/python/door_knocking_map_poc
./run.sh            # Chicago demos — first run fetches ~5-10 min, then serves
./run.sh --ca       # also fetch/build the California demos (~+5 min, ~150MB)
./run.sh --refresh  # re-fetch data (e.g., after a monthly mart refresh)
```

Then open **http://localhost:8765/** — or the printed LAN URL on your phone
(same Wi-Fi). Re-runs skip fetching if the data is already in `local/`.

## The demo pages

| Page | What it shows |
|---|---|
| `strategy1.html` | Brute-force GeoJSON: all 56.5MB upfront, client-side filters. Works great on desktop; **crashes phones** (that's the point) |
| `strategy2.html` | Zoom-gated viewport fetching from the local server; every pan/filter is a round trip |
| `strategy3.html` | Vector tiles (needs the optional tippecanoe step below) |
| `chi.html` | **The fix**: same Chicago data as a 4MB binary via deck.gl — phone-smooth |
| `chi_stats.html` | Polygon → stops / households / targets counted client-side (~5ms) |
| `chi_turf.html` | Full turf-cutter loop: draw polygon → cap checks → live Geoapify route optimization → numbered walking order |
| `chi_pack.html` | **The star**: 14-dimension on-device filtering over 1.67M people (~31ms/change), polygon stats under current filters |
| `ca.html` (`--ca`) | All 8.2M California dots at once — fine on desktop, exceeds phone memory (also the point) |
| `ca_gated.html` (`--ca`) | The phone-safe version: zoom gate + 0.2° cell fetching, LRU-capped memory |
| `ca_all.html` (`--ca`) | One 74MB download, cell-indexed, renders only viewed cells — no per-cell hosting |
| `test_route_planner.py` + `make_map.py` | CLI smoke test of the Geoapify Route Planner (5 synthetic points) + a rendered route map |

Suggested tour: `strategy1` on your phone (watch it die) → `chi` (watch it
not) → `chi_pack` (play with filters, draw a polygon) → `chi_turf` (optimize
a walking route).

Note: the `chi_stats.html` dots are pre-filtered server-side to an example
audience (Democratic primary voters) — the "dots are the filtered audience"
serving model. `chi_pack.html` is the opposite model: everything ships,
filtering happens on-device. Both are real candidate architectures.

## Optional: vector tiles for strategy3

```bash
brew install tippecanoe
tippecanoe -e local/tiles -l dots -Z7 -z16 --drop-densest-as-needed \
  --extend-zooms-if-still-dropping --no-tile-compression --force \
  local/dots_all.result.json
```

## Costs

Databricks: a handful of flat scans (seconds of warehouse time). Geoapify:
map tiles are ~0.25 credits/tile and a route optimization is ~10
credits/stop — the free tier (3,000 credits/day) comfortably covers demo
usage. The only heavier click is "Optimize walking order" on a large turf
(~1,500 credits for 150 stops).
