set -euo pipefail

# Validated again on the way in. `agents` originates in a PR comment
# on one path, and it is about to become a command-line argument.
if ! [[ "$REQUESTED" =~ ^[a-z0-9_]+(,[a-z0-9_]+)*$ ]]; then
  echo "::error::agents '$REQUESTED' is not an agent id, a comma-separated list of them, 'all', or 'auto'"
  exit 1
fi

if [ "$REQUESTED" != "auto" ]; then
  echo "agents=$REQUESTED" >> "$GITHUB_OUTPUT"
  echo "selection: $REQUESTED (as asked for)"
  exit 0
fi

# `gh pr diff` rather than a local `git diff` against a fetched base.
# It is the PR's own three-dot diff by definition, so there is no
# merge-base to compute and no second place for "what does this branch
# change" to disagree with GitHub. It also needs no git history and no
# git credentials, which matters because the checkout above runs with
# `persist-credentials: false` and a `git fetch origin` after it is not
# something to rely on.
changed="$(gh pr diff "$PR_NUMBER" --name-only)"

touched=""
add() { case ",$touched," in *",$1,"*) ;; *) touched="${touched:+$touched,}$1" ;; esac; }

while IFS= read -r path; do
  [ -n "$path" ] || continue
  case "$path" in
    # Chat agents. The directory name is kebab-case and the agent id
    # is the Prisma ChatScope value, and for campaign-manager the two
    # do not match, which is why this is a table and not a tr.
    packages/gp-api/src/chats/general/chief-of-staff/*)  add chief_of_staff ;;
    packages/gp-api/src/chats/general/campaign-manager/*) add campaign_assistant ;;
    packages/gp-api/src/chats/general/ordinance-flow/*)  add ordinance_flow ;;
    packages/gp-api/src/chats/general/priority-flow/*)   add priority_flow ;;
    # Background agents. One directory per published experiment, and
    # the directory name IS the agent id.
    packages/runbooks/experiments/_schema/*) ;;
    packages/runbooks/experiments/*/*)
      id="${path#packages/runbooks/experiments/}"
      add "${id%%/*}"
      ;;
  esac
done <<EOF
$changed
EOF

if [ -z "$touched" ]; then
  echo "::notice::auto selection matched no agent; nothing to judge"
  echo "agents=" >> "$GITHUB_OUTPUT"
  exit 0
fi

# The same allowlist the explicit path gets, over what `auto` derived.
# Everything in the chat table above is a literal, but a background id
# is a directory name out of `gh pr diff`, and it is about to become a
# `--agents=` argument and the contents of a backtick span in a
# comment this bot authors. A directory with a backtick in its name
# would break out of that span. The rejected value is not echoed, for
# the same reason it is rejected.
if ! [[ "$touched" =~ ^[a-z0-9_]+(,[a-z0-9_]+)*$ ]]; then
  echo "::error::auto selection derived an agent id that is not lowercase snake_case, so it is not being passed on. Look for a newly added directory under packages/runbooks/experiments in this PR."
  exit 1
fi

echo "agents=$touched" >> "$GITHUB_OUTPUT"
echo "selection: $touched (auto, from the diff against $BASE_REF)"
