#!/usr/bin/env bash
# Simulate the CI deploy role's IAM permissions against every dev root's
# terraform plan, so a missing apply-time permission fails the PR here
# instead of surfacing post-merge on the release train's real `terraform
# apply` (three autopilot slices hit exactly that gap in one day, 2026-09-13).
#
# Reads the `<slug>.json` plan files ci-plan-root.sh writes into $PLAN_DIR —
# run this AFTER the "Wait for all" step in the TF plan (dev) job, so every
# root's plan (and its .json) already exists.
#
# All the logic — the resource-type -> IAM action/ARN table, batching,
# fail-open handling — lives in simulate_apply_perms.py. This script is
# deliberately dumb: resolve where things are, invoke it, forward its exit
# code. See that file's module docstring for why it's plain `python3` and not
# `uv run` (avoids syncing gp-ai's full scientific-stack root deps for a
# stdlib + `aws` CLI script).
#
# Usage: ci-simulate-apply-perms.sh
#   env: PLAN_DIR         plan output dir (default /tmp/tfplans)
#        DEPLOY_ROLE_ARN  override the simulated principal (default: the
#                         account's github-actions-pulumi-deploy role)
#        AWS_REGION       region used to predict ARNs (default us-west-2)
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Self-test first, no AWS calls: it's the only automated coverage the mapping
# / verdict / fail-open logic below has (this file lives outside the uv
# workspace, so `make test` never runs it), so a regression there must fail
# the PR loudly and fast rather than only surface as a wrong verdict on the
# real run that follows.
if ! python3 "$here/simulate_apply_perms.py" --self-test; then
  echo "::error::simulate-apply-perms: --self-test failed; refusing to run the real check on unverified logic" >&2
  exit 1
fi

python3 "$here/simulate_apply_perms.py" \
  --plan-dir "${PLAN_DIR:-/tmp/tfplans}" \
  ${DEPLOY_ROLE_ARN:+--deploy-role-arn "$DEPLOY_ROLE_ARN"} \
  ${AWS_REGION:+--region "$AWS_REGION"}
