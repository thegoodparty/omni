#!/usr/bin/env bash
# Keeps docs/feature-map.md current WHILE a feature is being built, so the CI
# gate never has to fail.
#
# Fires after an agent edits a file under the webapp's app/ dir or the map
# itself, runs the feature-map check, and on a stale map hands the agent the
# exact fix (exit 2 feeds stderr back to it).
#
# Never blocks on anything else, and never fails the edit for an unrelated
# reason: a missing tsx or an unreadable repo exits 0 silently.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FEATURE_MAP='docs/feature-map.md'

payload="$(cat)"
file_path="$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("")
    sys.exit(0)
i = d.get("tool_input") or {}
r = d.get("tool_response") or {}
print(i.get("file_path") or (r.get("filePath") if isinstance(r, dict) else "") or "")
' 2>/dev/null)"

[ -n "$file_path" ] || exit 0

emit_context() {
  python3 -c '
import json, sys
print(json.dumps({
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": sys.argv[1],
  }
}))' "$1"
}

case "$file_path" in
  *"$FEATURE_MAP" | *packages/gp-webapp/app/*)
    output="$(cd "$REPO_ROOT" && npx tsx scripts/feature-map-check.ts 2>&1)"
    status=$?
    # Exit 2 is the check's verdict that the map is stale. Anything else
    # non-zero is the check failing to run at all (the map or nav registry
    # moved, a scrape fell below its floor, tsx did not start), so say that
    # instead of sending the agent to edit the map.
    if [ "$status" -eq 2 ]; then
      printf 'docs/feature-map.md no longer matches the repo.\n\n%s\n\nAgents use that map to find their way around the product. Update it now, in this change, before moving on. Every claim in it must come from reading the code.\n' "$output" >&2
      exit 2
    fi
    if [ "$status" -ne 0 ]; then
      # Non-blocking: a broken local toolchain should not fail the edit, and
      # CI still enforces the map either way.
      emit_context "The feature-map check could not run, so nothing was verified about $FEATURE_MAP. This is the checker failing, not the map being wrong. Output: $output"
    fi
    exit 0
    ;;
esac

exit 0
