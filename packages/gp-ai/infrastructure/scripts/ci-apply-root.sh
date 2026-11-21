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

# Name the state object(s) this root was reading. Terraform's read error reports
# only a byte offset, and the state bucket is not readable by anything except the
# deploy role this job already runs as, so without this the log says "plan
# failed" and nothing else. Metadata only — size, timestamps, version ids. Never
# the body: gp-ai state has historically carried secret values, which is exactly
# why the bucket is locked down (docs/secrets-iac-plan.md).
state_triage() {
  local cfg=.terraform/terraform.tfstate bucket="" key="" obj
  local keys=()
  if [ -r "$cfg" ]; then
    bucket=$(jq -r '.backend.config.bucket // empty' "$cfg" 2>/dev/null) || bucket=""
    key=$(jq -r '.backend.config.key // empty' "$cfg" 2>/dev/null) || key=""
    [ -n "$key" ] && keys+=("$key")
  fi
  # The unreadable object can be a sibling's: terraform_remote_state goes through
  # the same S3 client, and this job plans roots that other steps are applying.
  while IFS= read -r key; do
    [ -n "$key" ] && keys+=("$key")
  done < <(awk '/data "terraform_remote_state"/{inb=1; next} inb && /^}/{inb=0} inb && /key[[:space:]]*=/{gsub(/.*=[[:space:]]*"|".*/,""); print}' ./*.tf 2>/dev/null)
  if [ -z "$bucket" ] || [ "${#keys[@]}" -eq 0 ]; then
    echo "::warning::$root: could not tell which state object the plan was reading"
    return 0
  fi
  echo "::group::$root: state objects this root reads"
  for obj in "${keys[@]}"; do
    echo "s3://$bucket/$obj"
    aws s3api head-object --bucket "$bucket" --key "$obj" \
      --query '{size_bytes:ContentLength,last_modified:LastModified,etag:ETag,version_id:VersionId}' \
      --output json 2>&1 || echo "  (head-object failed: this role cannot read the object)"
    echo "recent versions, newest first:"
    aws s3api list-object-versions --bucket "$bucket" --prefix "$obj" --max-items 5 \
      --query 'Versions[].[VersionId,Size,LastModified,IsLatest]' --output text 2>&1 \
      || echo "  (list-object-versions failed: this role cannot read the object)"
  done
  echo "::endgroup::"
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

# shared-infra's ALB rules match x-api-key against SERVE_API_KEY (see that
# root's variables.tf). The apply reads it here, under the deploy role, rather
# than through a data source, which would write the whole AI_SECRETS_<ENV> blob
# to state and make every plan need GetSecretValue on it. jq's stderr is
# discarded because its errors can quote the input.
if [[ "$root" == */shared-infra ]]; then
  secret_id="AI_SECRETS_$(printf %s "${root%%/*}" | tr '[:lower:]' '[:upper:]')"
  TF_VAR_serve_api_key=$(aws secretsmanager get-secret-value --secret-id "$secret_id" \
      --query SecretString --output text 2>>"$log" | jq -er '.SERVE_API_KEY' 2>/dev/null) \
    || fail "could not read SERVE_API_KEY from $secret_id"
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$TF_VAR_serve_api_key"
  export TF_VAR_serve_api_key
fi

# One retry, and only for the S3 backend's unparseable-state signature. A plan
# writes nothing and releases its lock when it exits, so re-running it is safe;
# an APPLY is never retried (docs/deployment.md) because a retry on top of a
# half-applied run is not idempotent.
#
# The signature: "Unsupported state file format / the state file could not be
# parsed as JSON: syntax error at byte offset N" plus "does not have a version
# attribute". The backend sizes its read buffer from HeadObject and discards how
# many bytes the download actually wrote (hashicorp/terraform#39440, open, and
# the code is unchanged in the 1.15.8 this job pins), so a body shorter than the
# HEAD comes back NUL-padded and cannot parse — while the object itself is fine.
# On 2026-11-15 that failed prod/autopilot-bot once; the next release read the
# same object and reported "no changes".
#
# The trigger is structural here, not bad luck: terraform_remote_state reads a
# sibling root's object without taking its lock, and this job applies eleven
# roots, ten of them in parallel. broker, pmf-engine-control-plane,
# pmf-engine-fargate and autopilot-bot each read a key another step in this same
# job is writing, and that graph is cyclic (broker <-> pmf-engine-fargate <->
# pmf-engine-control-plane), so ordering cannot close the window the way it does
# for shared-infra.
plan_log=$(mktemp)
trap 'rm -f "$plan_log"' EXIT
plan_attempt=1
while :; do
  terraform plan "${args[@]}" -detailed-exitcode -out=tfplan >"$plan_log" 2>&1
  code=$?
  cat "$plan_log" >>"$log"
  case "$code" in
    0) echo "$root: no changes"; exit 0 ;;   # nothing to do; not a failure
    2) break ;;                              # changes to apply
  esac
  if [ "$plan_attempt" -eq 1 ] && grep -q 'Unsupported state file format' "$plan_log"; then
    plan_attempt=2
    echo "$root: state read came back unparseable; retrying the plan once" >>"$log"
    sleep 5
    continue
  fi
  state_triage
  fail "plan failed"
done

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
