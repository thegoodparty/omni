#!/bin/bash
# Convert an EO's roadmap markdown variants to clean PDFs.
# Required tools: pandoc, Google Chrome.
# Usage:   generate-roadmap-pdf.sh <eo-slug> <pdfs-dir>
# Example: generate-roadmap-pdf.sh jane-doe "$ROADMAP_OUTPUT_DIR/jane-doe/pdfs"
#
# Looks for <pdfs-dir>/../<eo-slug>-variant-d-long.md and -variant-d-tactical.md.
# Set CHROME_BIN to override the Chrome path (defaults to the macOS location).
set -euo pipefail

EO_SLUG="${1:?Usage: generate-roadmap-pdf.sh <eo-slug> <pdfs-dir>}"
PDFS_DIR="${2:?Usage: generate-roadmap-pdf.sh <eo-slug> <pdfs-dir>}"
PARENT_DIR="$(dirname "$PDFS_DIR")"
CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

mkdir -p "$PDFS_DIR"

for VARIANT in "variant-d-long" "variant-d-tactical"; do
  MD_FILE="$PARENT_DIR/${EO_SLUG}-${VARIANT}.md"
  HTML_FILE="$PDFS_DIR/${EO_SLUG}-${VARIANT}.html"
  PDF_FILE="$PDFS_DIR/${EO_SLUG}-${VARIANT}.pdf"

  if [ ! -f "$MD_FILE" ]; then
    echo "ERROR: $MD_FILE not found"; exit 1
  fi

  echo "=== Building ${EO_SLUG}-${VARIANT} ==="

  # Markdown to HTML. --metadata pagetitle (not title) suppresses the pandoc title block.
  pandoc "$MD_FILE" -s \
    --metadata pagetitle="${EO_SLUG} Roadmap" \
    -o "$HTML_FILE"

  # HTML to PDF. --no-pdf-header-footer removes Chrome's default URL/date/page-number headers.
  "$CHROME" --headless=new --disable-gpu \
    --no-pdf-header-footer \
    --print-to-pdf="$PDF_FILE" \
    "file://$HTML_FILE" 2>&1 | tail -1

  ls -la "$PDF_FILE"
done

echo "=== Done. PDFs at $PDFS_DIR ==="
