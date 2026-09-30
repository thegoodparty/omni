set -euo pipefail

# Newlines out before echoing, the same as judge.yml's `skip()`:
# `::notice::` is a line-oriented protocol and the step summary is
# markdown. Nothing reaching this can carry one today, so it closes a
# class rather than a hole — but the two functions should not
# disagree about whether that matters.
deny() {
  local msg="${1//$'\n'/ }"
  msg="${msg//$'\r'/ }"
  echo "::notice::$msg"
  echo "allowed=false" >> "$GITHUB_OUTPUT"
  { echo '### Universal Judge: not run'; echo ''; echo "$msg"; } \
    >> "$GITHUB_STEP_SUMMARY"
  exit 0
}

# stderr is kept so the HTTP status can be read back and the two
# failures told apart. A 404 is "not a collaborator"; anything else is
# the lookup itself failing, and telling an engineer they have no
# access to omni when the real problem is this job's token would cost
# exactly the afternoon this file is elsewhere careful about.
#
# omni is public, so a complete stranger comes back 200 with `read`
# rather than 404 — the `case` below is what turns them away, and the
# 404 branch is narrower than it looks.
if ! perm="$(gh api "repos/$GH_REPO/collaborators/$ACTOR/permission" \
  --jq .permission 2>"$RUNNER_TEMP/perm-error")"; then
  cat "$RUNNER_TEMP/perm-error" >&2
  if grep -q 'HTTP 404' "$RUNNER_TEMP/perm-error"; then
    deny "@$ACTOR is not a collaborator on this repository, so the judge is not starting."
  fi
  deny "the permission lookup for @$ACTOR failed; the status is in the log. A sweep spends real money and a check that cannot be answered is a no. If this is happening to everyone it is this job's \`permissions\` block, not anyone's access — the endpoint is listed under Metadata (read)."
fi

case "$perm" in
  admin|maintain|write) ;;
  *)
    deny "@$ACTOR has '$perm' on this repository; a judge sweep needs write."
    ;;
esac

echo "allowed=true" >> "$GITHUB_OUTPUT"
echo "@$ACTOR has '$perm'"
