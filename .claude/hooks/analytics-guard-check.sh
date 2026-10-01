#!/usr/bin/env bash
# Runs the analytics governance guard (DATA-2432) while an agent edits code that sends
# analytics events, so a broken OKR instrument or a dead event listing is fixed before a
# diff exists. Same checker as the Analytics guard CI job.
#
# Blocks (exit 2, report fed back to the agent) only on a real finding. A guard that
# cannot run says so as context and never fails the edit: CI is the backstop.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PY_DIR="$REPO_ROOT/packages/runbooks/scripts/python"

payload="$(cat)"
file_path="$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print(""); sys.exit(0)
i = d.get("tool_input") or {}
r = d.get("tool_response") or {}
print(i.get("file_path") or (r.get("filePath") if isinstance(r, dict) else "") or "")
' 2>/dev/null)"
[ -n "$file_path" ] || exit 0
# A path outside the repo root is left unstripped by this substitution, so it falls
# through the case below (no prefix matches) and exits 0 rather than matching by accident.
rel="${file_path#"$REPO_ROOT"/}"

emit_context() {
  python3 -c '
import json, sys
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": sys.argv[1]}}))' "$1"
}

case "$rel" in
  packages/gp-webapp/helpers/analyticsHelper.ts|packages/gp-api/src/vendors/segment/segment.types.ts|packages/runbooks/scripts/python/monitored_events.yaml) ;;
  packages/gp-webapp/*|packages/gp-api/*|packages/gp-admin/*)
    case "$rel" in *.ts|*.tsx|*.js|*.jsx) ;; *) exit 0 ;; esac
    # The edit may have just deleted the last tracking call, so look at the diff as well
    # as the file: a removal leaves nothing to match in the file itself.
    if ! grep -qE 'EVENTS|trackEvent|AnalyticsService' "$file_path" 2>/dev/null \
      && ! git -C "$REPO_ROOT" diff -U0 HEAD -- "$rel" 2>/dev/null | grep -qE 'EVENTS|trackEvent|AnalyticsService'; then
      exit 0
    fi
    ;;
  *) exit 0 ;;
esac

if [ -n "${ANALYTICS_GUARD_CMD:-}" ]; then
  output="$(bash -c "$ANALYTICS_GUARD_CMD" 2>&1)"
  status=$?
else
  base="$(git -C "$REPO_ROOT" merge-base origin/main HEAD 2>/dev/null)"
  if [ -z "$base" ]; then
    emit_context "The analytics guard could not run (no merge base with origin/main). The Analytics guard CI check will run on the PR."
    exit 0
  fi
  # `timeout` is GNU coreutils, not stock on macOS (only on PATH via a manual gnubin
  # tweak). Fall back to `gtimeout`, then to no bounding command at all — the hook's
  # settings.json entry already carries "timeout": 60, so Claude Code bounds the run.
  if command -v timeout >/dev/null 2>&1; then
    limit=(timeout 50)
  elif command -v gtimeout >/dev/null 2>&1; then
    limit=(gtimeout 50)
  else
    limit=()
  fi
  # Unquoted `${limit[@]:-}` (not `"${limit[@]}"`): stock macOS bash 3.2 treats a
  # quoted empty array as unbound under `set -u`, and even the `:-` fallback only
  # suppresses that error when unquoted. `limit` only ever holds bare words (no
  # spaces/globs), so skipping the quoting here is safe.
  output="$(cd "$PY_DIR" && ${limit[@]:-} uv run --quiet governance_guard.py check --base "$base" 2>&1)"
  status=$?
fi

case "$status" in
  2)
    printf 'This edit breaks analytics governance. Fix it now, in this change:\n\n%s\n' "$output" >&2
    exit 2
    ;;
  0)
    if printf '%s' "$output" | grep -q '\*\*Warnings\*\*'; then
      emit_context "Analytics guard warnings for this change (not blocking):
$output"
    fi
    exit 0
    ;;
  *)
    emit_context "The analytics guard could not run on this edit, so nothing was checked. The Analytics guard CI check will run on the PR.
$output"
    exit 0
    ;;
esac
