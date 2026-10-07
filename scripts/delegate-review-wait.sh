#!/usr/bin/env bash
set -euo pipefail

usage='usage: scripts/delegate-review-wait.sh <pr> [--sha <sha>] [--trigger] [--timeout <minutes>]

Waits for delegate-reviewer to finish reviewing one commit of a PR, then prints
its verdict and findings. Defaults to the PR head commit.

  --trigger   post "delegate review" first, and only accept a verdict that
              lands after it. Use this for every review after the first push.
              Delegate reviews each commit once, so this only works on a
              commit it has not reviewed yet.
  --timeout   minutes to wait before giving up (default 20).

exit codes:
  0  approved
  1  commented with findings
  2  review failed (re-trigger with --trigger)
  3  no verdict before the timeout
  4  commit no longer reviewable (superseded, or approval dismissed because
     the PR moved on)
  5  --trigger refused: delegate already reviewed this commit. Push a new
     commit, then re-run with --trigger'

REPO=thegoodparty/omni
BOT='delegate-reviewer[bot]'
PR=''
SHA=''
TRIGGER=0
TIMEOUT_MIN=20
POLL_SECONDS=20

while [ $# -gt 0 ]; do
  case "$1" in
    --sha) SHA="$2"; shift 2 ;;
    --trigger) TRIGGER=1; shift ;;
    --timeout) TIMEOUT_MIN="$2"; shift 2 ;;
    -h|--help) echo "$usage"; exit 0 ;;
    *) PR="$1"; shift ;;
  esac
done

[ -n "$PR" ] || { echo "$usage" >&2; exit 64; }
[ -n "$SHA" ] || SHA=$(gh pr view "$PR" -R "$REPO" --json headRefOid --jq .headRefOid)
FULL=$(gh api "repos/$REPO/commits/$SHA" --jq .sha 2>/dev/null) || { echo "No commit $SHA in $REPO" >&2; exit 64; }
SHA=$FULL
SHORT=${SHA:0:7}

SINCE=''
if [ "$TRIGGER" = 1 ]; then
  SINCE=$(gh api "repos/$REPO/issues/$PR/comments" -f body='delegate review' --jq .created_at)
  echo "Posted \"delegate review\" on #$PR at $SINCE" >&2
fi

echo "Waiting for delegate on #$PR at $SHORT (timeout ${TIMEOUT_MIN}m)" >&2
DEADLINE=$(( $(date +%s) + TIMEOUT_MIN * 60 ))
STATE=''
DESC=''
while :; do
  STATUS=$(gh api "repos/$REPO/commits/$SHA/statuses?per_page=100" \
    | jq -c --arg since "$SINCE" \
      '[.[] | select(.context == "pr-reviewer" and .created_at > $since)] | first // {}')
  STATE=$(jq -r '.state // ""' <<<"$STATUS")
  DESC=$(jq -r '.description // ""' <<<"$STATUS")
  case "$STATE" in success|failure|error) break ;; esac
  if [ "$TRIGGER" = 1 ] && gh api "repos/$REPO/issues/$PR/comments?since=$SINCE&per_page=100" \
    | jq -e --arg bot "$BOT" --arg short "$SHORT" --arg since "$SINCE" \
      'any(.[]; .user.login == $bot and .created_at > $since and (.body | startswith("`" + $short + "` already has a review run")))' >/dev/null; then
    echo "Delegate already reviewed #$PR at $SHORT and reviews each commit once. Push a new commit, then re-run with --trigger."
    exit 5
  fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "No verdict on #$PR at $SHORT after ${TIMEOUT_MIN}m. Latest status: ${STATE:-none} ${DESC}"
    if [ -z "$STATE" ] && [ "$TRIGGER" = 0 ]; then
      echo "Delegate only reviews the first push on its own. Re-run with --trigger to request a review."
    fi
    exit 3
  fi
  sleep "$POLL_SECONDS"
done

echo "Delegate on #$PR at $SHORT: $DESC"

REVIEW=$(gh api --paginate "repos/$REPO/pulls/$PR/reviews?per_page=100" \
  | jq -s -c --arg sha "$SHA" --arg since "$SINCE" --arg bot "$BOT" \
    '[.[][] | select(.user.login == $bot and .commit_id == $sha and .submitted_at > $since)]
     | sort_by(.submitted_at) | last // {}')
REVIEW_ID=$(jq -r '.id // ""' <<<"$REVIEW")

if [ -n "$REVIEW_ID" ]; then
  echo "$(jq -r '.html_url' <<<"$REVIEW")"
  echo
  jq -r '.body' <<<"$REVIEW"
  gh api --paginate "repos/$REPO/pulls/$PR/reviews/$REVIEW_ID/comments?per_page=100" \
    | jq -s -r '.[][] | "\n### \(.path):\(.line // .original_line // "file")\n\(.html_url)\n\n\(.body)"'
fi

case "$STATE:$DESC" in
  success:Superseded*|success:Approved,\ then\ dismissed*) exit 4 ;;
  success:Approved*) exit 0 ;;
  success:*) exit 1 ;;
  *) exit 2 ;;
esac
