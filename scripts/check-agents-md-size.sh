#!/usr/bin/env bash
# Fails when any git-tracked AGENTS.md is larger than the cap (100 KB = 102400 bytes).
#
# Nested AGENTS.md files auto-load into an agent's context whenever it opens a file
# in that directory. An oversized one makes runs thrash on autocompaction (a 701 KB
# outreach/AGENTS.md did exactly that). Keep AGENTS.md a short index of pointers,
# invariants and gotchas, and move detail into linked topic files (docs/*.md).
#
# Usage: bash scripts/check-agents-md-size.sh   (run from anywhere inside the repo)

set -euo pipefail

CAP_BYTES=102400

cd "$(git rev-parse --show-toplevel)"

failed=0
while IFS= read -r -d '' file; do
  [ -f "$file" ] || continue # tracked but deleted in the working tree
  size=$(wc -c <"$file" | tr -d ' ')
  if [ "$size" -gt "$CAP_BYTES" ]; then
    echo "ERROR: $file is $size bytes ($((size / 1024)) KB), over the $CAP_BYTES-byte (100 KB) AGENTS.md cap." >&2
    echo "       Split it: keep a short index AGENTS.md and move detail into linked docs/*.md files." >&2
    failed=1
  fi
done < <(git ls-files -z -- 'AGENTS.md' '**/AGENTS.md')

if [ "$failed" -ne 0 ]; then
  exit 1
fi
echo "All tracked AGENTS.md files are within the 100 KB cap."
