#!/usr/bin/env bash
# Runs the analytics governance guard (DATA-2432) while an agent edits code that sends
# analytics events, so a broken OKR instrument or a dead event listing is fixed before a
# diff exists. Same checker as the Analytics guard CI job.
#
# Blocks (exit 2, report fed back to the agent) only on a real finding. A guard that
# cannot run says so as context and never fails the edit: CI is the backstop.
set -uo pipefail

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
# The root comes from the edited file, not from this script: settings are shared across
# worktrees, so the file may sit in a different checkout than the hook, and that
# checkout's guard and history are the ones that apply. Physical paths on both sides,
# because git prints a resolved toplevel (/private/var/... on macOS) and the payload may not.
file_dir="$(cd "$(dirname "$file_path")" 2>/dev/null && pwd -P)" || exit 0
file_path="$file_dir/$(basename "$file_path")"
REPO_ROOT="$(git -C "$file_dir" rev-parse --show-toplevel 2>/dev/null)"
[ -n "$REPO_ROOT" ] || exit 0
PY_DIR="$REPO_ROOT/packages/runbooks/scripts/python"
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

# uv and argparse exit 2 as well, so a 2 is only a block when the guard's own json says so.
json_out="$(mktemp)"
trap 'rm -f "$json_out"' EXIT
export ANALYTICS_GUARD_JSON="$json_out"

if [ -n "${ANALYTICS_GUARD_CMD:-}" ]; then
  output="$(cd "$REPO_ROOT" && bash -c "$ANALYTICS_GUARD_CMD" 2>&1)"
  status=$?
else
  [ -d "$PY_DIR" ] || exit 0
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
  output="$(cd "$PY_DIR" && ${limit[@]:-} uv run --quiet governance_guard.py check \
    --base "$base" --repo "$REPO_ROOT" --json "$json_out" 2>&1)"
  status=$?
fi

if [ "$status" = "2" ]; then
  verdict="$(python3 -c '
import json, sys
try:
    print(json.load(open(sys.argv[1])).get("status", ""))
except Exception:
    print("")' "$json_out" 2>/dev/null)"
  [ "$verdict" = "block" ] || status=1
fi

case "$status" in
  2)
    printf 'This edit breaks analytics governance. Fix it now, in this change:\n\n%s\n\nIf you are midway through moving this call site, finish the move; the check re-runs on your next edit.\n' "$output" >&2
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
