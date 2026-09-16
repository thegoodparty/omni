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
    # A missing tsx or a broken toolchain must not fail the agent's edit. Only
    # the check's own verdict (exit 1) is worth interrupting for.
    if [ "$status" -eq 1 ]; then
      printf 'You changed the dashboard nav, and the product map no longer matches it.\n\n%s\n\nThe Campaign Manager and Chief of Staff read that map to answer product questions. Update it now, in this change, before moving on.\n' "$output" >&2
      exit 2
    fi
    exit 0
    ;;
  *packages/gp-webapp/app/dashboard/*page.tsx)
    emit_context "You edited a dashboard route. If this change adds or renames something a user can reach, add or update its entry in $MAP so the Campaign Manager and Chief of Staff can answer questions about it. The coverage check only sees nav tabs, so a feature reached from inside another page is on you. Read the AGENTS.md beside that file. If the change is not user-visible, ignore this."
    exit 0
    ;;
esac

exit 0
