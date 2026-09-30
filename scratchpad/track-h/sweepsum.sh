set -euo pipefail
{
  echo '### Universal Judge sweep'
  echo ''
  echo "| | |"
  echo "| --- | --- |"
  echo "| agents | \`$AGENTS\` |"
  echo "| candidate | \`$CANDIDATE_SHA\` |"
  echo "| base | \`$BASE_REF\` |"
  echo "| estimated before the run | ~\$$ESTIMATE_USD |"
  echo "| outcome | $JOB_STATUS |"
  echo ''
  echo "Output is in [the run log]($RUN_URL). The verdict itself is the report"
  echo 'track'"'"'s to publish.'
} >> "$GITHUB_STEP_SUMMARY"
