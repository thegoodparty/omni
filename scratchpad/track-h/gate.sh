set -euo pipefail

# Newlines out of the reason before it is echoed. `::notice::` is a
# line-oriented protocol and $GITHUB_STEP_SUMMARY is markdown, so a
# value carrying a newline could forge a second workflow command or a
# heading. Only `pr_number` reaches this from outside, and only from
# someone who already has write access, so this closes the class
# rather than a live hole.
skip() {
  local msg="${1//$'\n'/ }"
  msg="${msg//$'\r'/ }"
  echo "::notice::skipped: $msg"
  echo "skip=true" >> "$GITHUB_OUTPUT"
  { echo '### Universal Judge: skipped'; echo ''; echo "$msg"; } \
    >> "$GITHUB_STEP_SUMMARY"
  exit 0
}

case "$PR_NUMBER" in
  ''|*[!0-9]*) skip "pr_number '$PR_NUMBER' is not a number" ;;
esac

pr="$(gh pr view "$PR_NUMBER" \
  --json state,isCrossRepository,headRefOid,baseRefName)"

state="$(jq -r '.state' <<<"$pr")"
fork="$(jq -r '.isCrossRepository' <<<"$pr")"
sha="$(jq -r '.headRefOid' <<<"$pr")"
base="$(jq -r '.baseRefName' <<<"$pr")"

[ "$state" = "OPEN" ] || skip "PR #$PR_NUMBER is $state, not open"

if [ "$fork" = "true" ]; then
  skip "fork PR. omni is public, so a fork event carries no secrets and the judge will not check out or run fork code with ours. Push the branch to this repository to judge it."
fi

# Both refs are re-validated even though they came from the GitHub API,
# because both are about to reach a `git` argument and a `checkout`
# ref. A 40-hex SHA and a ref name cannot be a flag or a shell
# metacharacter once they have passed these.
# Matched in the shell rather than through a pipe to `grep -q`: with
# `pipefail` set, a `grep -q` that exits on its first match can leave
# the writer with EPIPE and fail the step for the wrong reason.
if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::head SHA '$sha' is not a 40-character hex object id"
  exit 1
fi
if ! [[ "$base" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]]; then
  echo "::error::base ref '$base' is not a plain branch name"
  exit 1
fi

{
  echo "skip=false"
  echo "candidate_sha=$sha"
  echo "base_ref=$base"
} >> "$GITHUB_OUTPUT"
echo "PR #$PR_NUMBER: candidate $sha, base $base"
