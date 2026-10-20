#!/usr/bin/env bash
# One-shot teardown of GP Bot's AWS resources, run by the release train.
#
# ci-apply-root.sh refuses any plan that deletes something, on purpose, and
# stays that way. This is the explicit alternative for a whole retired system:
# it destroys exactly the roots and addresses named below, prints the destroy
# plan before applying it, and refuses a plan containing anything but deletes.
# It exists for one release. The change that deletes GP Bot's code deletes this
# script and the steps that call it.
#
# The three GP Bot roots live under retiring/, not environments/, so the
# coverage check and the convergence check never look at them.
#
# Idempotent: a root whose state is already empty is skipped, so every release
# after the first one is a no-op.
#
# Usage: ci-destroy-gp-bot.sh <apply|plan> <dev|prod>
#   apply  destroy (release train, deploy role)
#   plan   write the destroy plan JSON to $PLAN_DIR and print it, never apply
#          (PR TF plan job, plan role, dev only)
set -euo pipefail

mode="${1:?usage: ci-destroy-gp-bot.sh <apply|plan> <dev|prod>}"
env="${2:?usage: ci-destroy-gp-bot.sh <apply|plan> <dev|prod>}"
case "$mode" in apply | plan) ;; *) echo "::error::unknown mode $mode" >&2; exit 2 ;; esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
plan_dir="${PLAN_DIR:-/tmp/tfplans}"
mkdir -p "$plan_dir"

# shared-infra's /clickup/webhook route. Its code is already gone from
# environments/prod/shared-infra, so these are orphans in its state.
shared_infra_targets=(
  aws_lb_listener_rule.clickup_bot
  aws_lb_target_group_attachment.clickup_bot
  aws_lambda_permission.clickup_bot_alb_invoke
  aws_lb_target_group.clickup_bot
)

destroy() {
  local dir="$1"
  shift
  local slug
  slug="destroy-$(basename "$(dirname "$dir")")-$(basename "$dir")"
  cd "$dir"
  echo "::group::$slug"
  terraform init -input=false -no-color

  local in_state
  in_state=$(terraform state list)
  local targets=()
  local addr
  for addr in "$@"; do
    case "$addr" in
      -target=*) grep -qxF "${addr#-target=}" <<<"$in_state" && targets+=("$addr") ;;
    esac
  done
  if [ -z "$in_state" ] || { [ "$#" -gt 0 ] && [ "${#targets[@]}" -eq 0 ]; }; then
    echo "$slug: nothing left to destroy"
    echo "::endgroup::"
    return
  fi

  local args=(-destroy -input=false -no-color -out=destroy.tfplan)
  if [ "$mode" = plan ]; then
    args+=(-lock=false)
  else
    args+=(-lock-timeout=10m)
  fi
  # Required by the engineer-agent roots, unused by a destroy, and undeclared
  # (so rejected) everywhere else.
  if grep -q 'variable "docker_image_tag"' main.tf; then
    args+=(-var docker_image_tag=retired)
  fi

  terraform plan "${args[@]}" ${targets[@]+"${targets[@]}"}
  local json
  json=$(terraform show -json destroy.tfplan)
  local unexpected deletes
  unexpected=$(jq '[.resource_changes[]? | select(.change.actions != ["delete"] and .change.actions != ["no-op"] and .change.actions != ["read"])] | length' <<<"$json")
  deletes=$(jq '[.resource_changes[]? | select(.change.actions == ["delete"])] | length' <<<"$json")
  if [ "$unexpected" != "0" ]; then
    echo "::error::$slug: destroy plan contains $unexpected non-delete change(s); refusing"
    exit 1
  fi
  echo "$slug: $deletes resource(s) to destroy"
  echo "$slug: $deletes resource(s) to destroy" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"

  if [ "$mode" = plan ]; then
    echo "$json" >"$plan_dir/$slug.json"
  else
    terraform apply -input=false -no-color -lock-timeout=10m destroy.tfplan
    echo "$slug: destroyed"
  fi
  rm -f destroy.tfplan
  echo "::endgroup::"
}

if [ "$env" = dev ]; then
  destroy "$here/retiring/dev/engineer-agent-fargate"
else
  # Order matters. shared-infra's route points at the clickup-bot Lambda, and
  # clickup-bot reads engineer-agent-fargate's state outputs, so each goes
  # before the thing it depends on.
  destroy "$here/environments/prod/shared-infra" "${shared_infra_targets[@]/#/-target=}"
  # Terraform drops a data source that left the config on the next apply, and
  # it never shows as a delete. Removed here anyway because prod shared-infra
  # is not planned on PRs, so nothing would show it before the train.
  if [ "$mode" = apply ]; then
    cd "$here/environments/prod/shared-infra"
    if grep -qxF data.terraform_remote_state.clickup_bot <<<"$(terraform state list)"; then
      terraform state rm -lock-timeout=10m data.terraform_remote_state.clickup_bot
    fi
  fi
  destroy "$here/retiring/prod/clickup-bot"
  destroy "$here/retiring/prod/engineer-agent-fargate"
fi
