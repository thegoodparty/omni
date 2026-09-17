#!/usr/bin/env bash
# Apply one terraform root for CI.
#
# Deliberately the mirror image of ci-plan-root.sh: that script always exits 0 so
# the assemble step can report on every root, whereas this one exits NON-ZERO on
# failure. That is what makes `wait-all` short-circuit — a failed apply must stop
# the steps after it rather than let a deploy be reported as successful. Note the
# probe finding: sibling background steps already in flight are NOT killed, which
# is what we want here, since aborting a terraform apply mid-write can orphan a
# state lock.
#
# Usage: ci-apply-root.sh <env>/<root> [image-tag] [image-tag-playwright]
#   ci-apply-root.sh dev/broker broker-a1b2c3d
#   ci-apply-root.sh dev/shared-infra
#   ci-apply-root.sh dev/autopilot-agent-fargate autopilot-agent-a1b2c3d autopilot-agent-playwright-a1b2c3d
# The 3rd arg is a second image tag, only meaningful for the one root
# (autopilot-agent-fargate) with a second, Playwright-installed image variant
# — passed as -var docker_image_tag_playwright=<tag>. Every other root ignores it.
set -uo pipefail

root="${1:?usage: ci-apply-root.sh <env>/<root> [image-tag] [image-tag-playwright]}"
image_tag="${2:-}"
image_tag_playwright="${3:-}"
slug="${root//\//-}"
log_dir="${APPLY_DIR:-/tmp/tfapply}"
mkdir -p "$log_dir"
log="$log_dir/$slug.txt"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="$here/environments/$root"

fail() {
  echo "::error::$root: $1"
  echo "$1" >>"$log"
  # THE REASON, NOT JUST THE VERDICT. Every terraform call below writes to $log
  # and, on this path, nothing ever reads it: `wait-all` short-circuits on a
  # failed apply, so the convergence check in release.yml that would have
  # tailed it never runs. That left `prod/shared-infra: plan failed` as the
  # entire public record of a red release train on 2026-09-16 — accurate, and
  # of no use to the human or the bot that has to act on it. Terraform redacts
  # sensitive values itself and the convergence check already tails these same
  # logs into the job output, so there is nothing here that was not already
  # printable.
  if [ -s "$log" ]; then
    echo "::group::$root: last 60 lines of $log"
    tail -60 "$log"
    echo "::endgroup::"
  fi
  exit 1
}

[ -d "$dir" ] || fail "no such root"
cd "$dir" || fail "cannot cd into $dir"

# -lock-timeout: this apply writes state and must hold the exclusive lock, but a
# concurrent PR plan (or another root's operation) can hold it briefly. Wait it
# out instead of failing instantly on "Error acquiring the state lock".
args=(-input=false -no-color -lock-timeout=10m)
[ -n "$image_tag" ] && args+=(-var "docker_image_tag=$image_tag")
[ -n "$image_tag_playwright" ] && args+=(-var "docker_image_tag_playwright=$image_tag_playwright")

terraform init -input=false -no-color >"$log" 2>&1 || fail "init failed"

terraform plan "${args[@]}" -detailed-exitcode -out=tfplan >>"$log" 2>&1
code=$?
case "$code" in
  0) echo "$root: no changes"; exit 0 ;;   # nothing to do; not a failure
  2) ;;                                    # changes to apply
  *) fail "plan failed" ;;
esac

# Destroys and replaces never apply unattended. A replace is delete+create, which
# can drop data and cause downtime, so it is gated the same as a pure delete —
# the operator reads the plan and applies by hand.
# aws_ecs_task_definition is immutable: pinning a new image tag ALWAYS produces a
# replace (delete+create of the revision). That is the normal shape of every
# deploy, so counting it as destructive would refuse to ever deploy anything.
# It is the ONLY type exempted; a replace of a bucket, table, role or anything
# else still stops the apply.
# Fails CLOSED. ci-plan-root.sh can afford to default these to 0 — the worst
# outcome there is a wrong annotation on a PR comment. Here a silent 0 would let
# a destructive plan apply unreviewed, so a missing jq or unexpected terraform
# output must stop the apply rather than wave it through.
json=$(terraform show -json tfplan 2>&1) || fail "terraform show failed: $json"
destroys=$(jq '[.resource_changes[]? | select(.change.actions == ["delete"])] | length' <<<"$json") \
  || fail "could not evaluate the destroy guard (jq failed); refusing to apply"
replaces=$(jq '[.resource_changes[]?
                | select(.type != "aws_ecs_task_definition")
                | select((.change.actions | index("delete")) and (.change.actions | index("create")))]
               | length' <<<"$json") \
  || fail "could not evaluate the replace guard (jq failed); refusing to apply"
if [ "${destroys:-0}" != "0" ] || [ "${replaces:-0}" != "0" ]; then
  terraform show -no-color tfplan >>"$log" 2>&1
  fail "plan would destroy ${destroys} and replace ${replaces} resource(s); refusing to apply automatically"
fi

terraform apply -input=false -no-color -lock-timeout=10m tfplan >>"$log" 2>&1 || fail "apply failed"
echo "$root: applied"
