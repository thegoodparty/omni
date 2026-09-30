set -euo pipefail
if [ -f "$CLI" ]; then
  echo "present=true" >> "$GITHUB_OUTPUT"

  # AND CAN IT ACTUALLY SWEEP YET? The wave-0 skeleton throws
  # `only --dry-run is implemented` for any argv without
  # `--dry-run`, and its entry point turns that into exit 1. So a
  # `--live` request against the skeleton would post "this is a live
  # sweep, it starts now", pay for a checkout and a full workspace
  # build, and then go red — with the plan comment still claiming a
  # sweep was starting. Today that is unreachable only because no
  # agent has a case list; it becomes reachable the moment the first
  # one lands, which is before the runner track is due.
  #
  # Read out of the source because the only other way to ask is to
  # run the CLI without `--dry-run`, and running it speculatively is
  # precisely the thing that must not happen. The string goes away
  # when the runner lands, and so does this check.
  if grep -q 'only --dry-run is implemented' "$CLI"; then
    echo "sweep_capable=false" >> "$GITHUB_OUTPUT"
    echo "::notice::the CLI on this branch implements the plan only, so a live sweep would fail; the plan comment says so instead of promising one"
  else
    echo "sweep_capable=true" >> "$GITHUB_OUTPUT"
  fi
  exit 0
fi
echo "present=false" >> "$GITHUB_OUTPUT"
echo "sweep_capable=false" >> "$GITHUB_OUTPUT"
echo "::warning::$WORKSPACE/$CLI is not on this branch yet (it lands in #2198), so there is no plan to price. The guards, the fork check and the ref resolution above all ran."
{
  echo '### Universal Judge: the CLI has not landed yet'
  echo ''
  echo "\`$WORKSPACE/$CLI\` does not exist on this branch. It lands in the"
  echo 'wave-0 PR. Everything this job does before invoking it — the fork'
  echo 'check, the ref resolution, the agent selection — ran and is in the log.'
} >> "$GITHUB_STEP_SUMMARY"
