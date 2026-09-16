#!/usr/bin/env bash
# Keeps the assistants' product map current WHILE a feature is being built,
# so the CI gate never has to fail.
#
# Fires after an agent edits a file. Two cases:
#   1. The dashboard nav registry changed  -> run the coverage check, and on
#      failure hand the agent the exact fix (exit 2 feeds stderr back to it).
#   2. A dashboard route page changed      -> nudge, because a reachable
#      feature belongs in the map even when it never becomes a nav tab, which
#      the coverage check cannot see.
#
# Never blocks on anything else, and never fails the edit for an unrelated
# reason: a missing tsx or an unreadable repo exits 0 silently.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAV_REGISTRY='packages/gp-webapp/app/dashboard/shared/DashboardMenu.tsx'
MAP='packages/gp-api/src/chats/general/product-knowledge/productMap.ts'

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
  *"$NAV_REGISTRY")
    output="$(cd "$REPO_ROOT" && npx tsx scripts/product-map-coverage.ts 2>&1)"
    status=$?
    # Exit 2 is the check's verdict that the map is stale, and the only case
    # worth interrupting an edit for. Anything else non-zero is the check
    # failing to run at all (the nav registry moved, the scrape fell below its
    # floor, tsx did not start) — say that instead, because telling an agent
    # the map is out of date when the checker crashed sends it to edit the
    # wrong file.
    if [ "$status" -eq 2 ]; then
      printf 'You changed the dashboard nav, and the product map no longer matches it.\n\n%s\n\nThe Campaign Manager and Chief of Staff read that map to answer product questions. Update it now, in this change, before moving on.\n' "$output" >&2
      exit 2
    fi
    if [ "$status" -ne 0 ]; then
      # Non-blocking: a broken local toolchain should not fail the edit, and
      # CI still enforces the map either way.
      emit_context "The product-map coverage check could not run, so nothing was verified about the assistants' product map. This is the checker failing, not the map being wrong — fix the checker (or the nav registry it reads) rather than editing productMap.ts. Output: $output"
    fi
    exit 0
    ;;
  *packages/gp-webapp/app/dashboard/*page.tsx)
    emit_context "You edited a dashboard route. If this change adds or renames something a user can reach, add or update its entry in $MAP so the Campaign Manager and Chief of Staff can answer questions about it. The coverage check only sees nav tabs, so a feature reached from inside another page is on you. Read the AGENTS.md beside that file. If the change is not user-visible, ignore this."
    exit 0
    ;;
esac

exit 0
