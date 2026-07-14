#!/usr/bin/env bash
# Door-knocking map POC: fetch data (yourself, from Databricks), build the
# demo pages, start the local server. See README.md.
#
# Usage:
#   ./run.sh              # Chicago demos (default; ~5-10 min first run)
#   ./run.sh --ca         # also fetch + build the California demos (~+5 min)
#   ./run.sh --refresh    # re-fetch data even if already present in local/
#
# Everything generated lands in ./local/ (gitignored). Nothing here may ever
# be committed: the data is L2-licensed and the pages embed your API key.
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE="../../.env"
WITH_CA=false; REFRESH=false
for arg in "$@"; do
  case "$arg" in
    --ca) WITH_CA=true ;;
    --refresh) REFRESH=true ;;
    *) echo "unknown flag: $arg"; exit 1 ;;
  esac
done

# ---- preflight -------------------------------------------------------------
if ! command -v uv >/dev/null; then
  echo "ERROR: uv is required (https://docs.astral.sh/uv/). brew install uv"; exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Copy scripts/.env.example to scripts/.env first."; exit 1
fi
for var in DATABRICKS_SERVER_HOSTNAME DATABRICKS_HTTP_PATH DATABRICKS_API_KEY GEOAPIFY_API_KEY; do
  if ! grep -qE "^${var}=." "$ENV_FILE"; then
    echo "ERROR: $var is not set in scripts/.env (see scripts/.env.example)"; exit 1
  fi
done
mkdir -p local

fetch () {  # fetch <output-file> <cmd...>
  local out="local/$1"; shift
  if [ -f "$out" ] && [ "$REFRESH" = false ]; then
    echo "== $out already present, skipping (use --refresh to re-fetch)"
  else
    echo "== fetching $out"; "$@"
  fi
}

# ---- Chicago data (from Databricks; requires warehouse access) -------------
fetch dots_all.result.json       uv run fetch_dots.py --all
fetch chicago_dots.result.bin    uv run fetch_binary_dots.py IL Chicago
fetch chicago_stats.result.bin   uv run fetch_stats_dots.py
fetch chicago_pack.result.bin    uv run fetch_pack.py

# ---- California data (optional) --------------------------------------------
if [ "$WITH_CA" = true ]; then
  fetch ca_dots.result.bin       uv run fetch_binary_dots.py
  fetch ca_sorted.result.bin     python3 sort_ca.py
  [ -d local/cells/ca ] && [ "$REFRESH" = false ] || python3 split_ca.py
fi

# ---- build all pages --------------------------------------------------------
echo "== building pages"
python3 build_pages.py
python3 make_chi_stats.py
python3 make_chi_turf.py
python3 make_chi_pack.py
python3 make_ca_map.py chicago_dots.result.bin -87.66 41.87 10.5 chi.html "Chicago, every household (binary)"
if [ "$WITH_CA" = true ]; then
  python3 make_ca_map.py     # ca.html (whole-state stress test)
  python3 make_ca_gated.py
  python3 make_ca_all.py
fi

# ---- serve -------------------------------------------------------------------
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)
echo ""
echo "==============================================================="
echo "  Desktop:  http://localhost:8765/"
[ -n "$IP" ] && echo "  Phone:    http://$IP:8765/   (same Wi-Fi)"
echo "==============================================================="
echo ""
exec python3 serve.py
