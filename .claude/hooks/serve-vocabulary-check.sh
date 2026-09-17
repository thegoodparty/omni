#!/usr/bin/env bash
# Keeps Serve copy in the Serve vocabulary WHILE it is being written, so the
# CI gate never has to fail.
#
# Fires after an agent edits a file, and checks only that file. Two cases:
#   1. The file carries Serve copy -> run the check, and on a violation hand
#      the agent the exact fix (exit 2 feeds stderr back to it).
#   2. The file is shared Win/Serve outreach code -> nudge, because a new
#      string added to a shared flow reaches a Serve user too, and the check
#      cannot see copy chosen by a bare `isServe ? a : b` ternary.
#
# Never blocks on anything else, and never fails the edit for an unrelated
# reason: a missing tsx or an unreadable package exits 0 silently.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WEBAPP='packages/gp-webapp'
DOC='docs/product-vocabulary.md'

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

# Package-relative path, which is what the checker matches SERVE_ONLY_DIRS on.
case "$file_path" in
  *"$WEBAPP"/*) rel="${file_path##*"$WEBAPP"/}" ;;
  *) exit 0 ;;
esac

case "$rel" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;
esac
case "$rel" in
  *.test.ts | *.test.tsx | *.stories.tsx) exit 0 ;;
esac

output="$(cd "$REPO_ROOT/$WEBAPP" && npx tsx scripts/check-serve-vocabulary.ts "$rel" 2>&1)"
status=$?

# Exit 2 is the check's verdict that Serve copy says a Win-only word, and the
# only case worth interrupting an edit for. Anything else non-zero is the check
# failing to run at all (the package moved, tsx did not start) — say that
# instead, because telling an agent its copy is wrong when the checker crashed
# sends it to edit the wrong file.
if [ "$status" -eq 2 ]; then
  printf 'The Serve copy you just wrote uses Win-only vocabulary.\n\n%s\n\nFix it now, in this change, before moving on.\n' "$output" >&2
  exit 2
fi

if [ "$status" -ne 0 ]; then
  # Non-blocking: a broken local toolchain should not fail the edit, and CI
  # still enforces the vocabulary either way.
  emit_context "The Serve vocabulary check could not run, so nothing was verified about this file's copy. This is the checker failing, not the copy being wrong — fix the checker rather than rewording the product. Output: $output"
  exit 0
fi

# Shared Win/Serve surfaces. The check reads SERVE_* declarations and `serve:`
# branches; a string picked by a ternary, or one unconditional string shown to
# both surfaces, is invisible to it and is on whoever wrote it.
case "$rel" in
  app/dashboard/outreach/* | app/dashboard/door-knocking/* | app/dashboard/contacts/* | app/dashboard/shared/*)
    if grep -qE 'isServe|isWin|isElectedOfficial|isServeOrg|serveMode' "$REPO_ROOT/$WEBAPP/$rel" 2>/dev/null; then
      emit_context "You edited a shared Win/Serve surface. Any string you added is read by an elected official too: they have constituents, an office and a term — no voters, election, candidate or ballot, and no \"campaign\" in the run-for-office sense (an outreach campaign is fine). The automated check only sees SERVE_* declarations and \`serve:\` branches, so a string picked by an isServe ternary is on you. Give the component a mode-keyed copy object rather than renaming the Win string, which must not change. Rule and models: $DOC. If the change adds no user-facing string, ignore this."
    fi
    ;;
esac

exit 0
