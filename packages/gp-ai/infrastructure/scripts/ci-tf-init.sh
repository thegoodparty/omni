#!/usr/bin/env bash
# `terraform init` with a bounded retry for registry/CDN failures.
#
# Sourced by ci-apply-root.sh and ci-plan-root.sh, which both ran init exactly
# once. Init is cold on every run: no root commits its `.terraform` directory, and
# there is no provider cache in this repo, so each of the 24 roots downloads its
# own copies — 24 of them need hashicorp/aws, whose 6.71.0 zip is 167 MiB.
#
# Terraform retries the registry DISCOVERY call itself (my repro of a reset
# against it reports "giving up after 4 attempt(s)"), but a provider PACKAGE
# download gets one attempt. A single reset from the CDN therefore fails init
# outright: run 44006719139 (ENG-11669) lost dev/autopilot-agent-fargate and
# dev/autopilot-bot that way in the same job, from two different Fastly IPs, 40s
# apart, while the nine sibling roots in that job installed the same providers
# fine. The train has no automatic recovery for it either: release-retry.sh
# excludes anything that runs Terraform, and rightly so, because a job that dies
# mid-apply can leave a state lock and a half-applied root. That failure mode has
# to be caught here, before the lock is taken.
#
# Retried only on a TRANSIENT signature, so a real error still fails on the first
# attempt and still short-circuits wait-all: a wrong provider source, a version
# that does not exist, a checksum mismatch, a bad backend and an undeclared
# variable all fail the same way and as fast as they did before.
#
# Usage (sourced): tf_init_with_retry <logfile>
# Appends every attempt's output to <logfile>; returns non-zero only when the
# last attempt is still failing.
#
# Env: CI_TF_INIT_ATTEMPTS (default 3), CI_TF_INIT_BACKOFF_SECONDS (base, default 5).

# Every line here is a network failure against the registry or the package CDN.
# Deliberately absent: "does not have a provider named", "doesn't match any of
# the checksums", "Unsupported state file format", "AccessDenied" — those are
# ours to fix and a retry only delays the report.
tf_init_transient_re='connection reset by peer|connection refused|i/o timeout|TLS handshake timeout|no such host|Temporary failure in name resolution|giving up after [0-9]+ attempt|(502|503|504) (Bad Gateway|Service Unavailable|Gateway Timeout)'

tf_init_with_retry() {
  local log="${1:?usage: tf_init_with_retry <logfile>}"
  local attempts="${CI_TF_INIT_ATTEMPTS:-3}"
  local backoff="${CI_TF_INIT_BACKOFF_SECONDS:-5}"
  local attempt=1 out rc delay

  out="$(mktemp)" || return 1

  while :; do
    # Captured to its own file so the retry decision reads THIS attempt, not the
    # concatenation appended to the log below.
    if terraform init -input=false -no-color >"$out" 2>&1; then
      cat "$out" >>"$log"
      rm -f "$out"
      return 0
    else
      rc=$?
    fi
    cat "$out" >>"$log"

    if [ "$attempt" -ge "$attempts" ] || ! grep -qE "$tf_init_transient_re" "$out"; then
      rm -f "$out"
      return "$rc"
    fi

    delay=$((backoff * (1 << (attempt - 1))))
    echo "::warning::terraform init attempt $attempt/$attempts failed on a transient registry error; retrying in ${delay}s"
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

# Self-test: drives the retry against a stub `terraform` so the classification is
# exercised, not just written down. Run by gp-ai.yml's terraform-plan job.
if [ "${BASH_SOURCE[0]}" = "$0" ] && [ "${1:-}" = "--self-test" ]; then
  set -uo pipefail
  export CI_TF_INIT_BACKOFF_SECONDS=0
  tf_self_test_fail=0
  tf_self_test_dir="$(mktemp -d)"
  tf_self_test_log="$tf_self_test_dir/init.log"
  tf_self_test_calls="$tf_self_test_dir/calls"

  # $1 = output the stub prints, $2 = its exit code, $3 = how many attempts pass
  tf_self_test_stub() {
    local output="$1" code="$2" pass_after="$3"
    local n
    n=$(($(cat "$tf_self_test_calls" 2>/dev/null || echo 0) + 1))
    echo "$n" >"$tf_self_test_calls"
    if [ "$n" -gt "$pass_after" ] || [ "$code" = 0 ]; then
      return 0
    fi
    printf '%s\n' "$output"
    return "$code"
  }

  assert() {
    local name="$1" got="$2" want="$3"
    if [ "$got" != "$want" ]; then
      echo "FAIL $name: got '$got', want '$want'"
      tf_self_test_fail=1
    else
      echo "ok $name"
    fi
  }

  # 1. The transient reset from ENG-11669, twice, then success.
  reset='Error: Failed to install provider
Error while installing hashicorp/aws v6.71.0: releases.hashicorp.com: Get
"https://releases.hashicorp.com/terraform-provider-aws/6.71.0/terraform-provider-aws_6.71.0_linux_amd64.zip":
read tcp 10.1.0.55:34064->13.226.53.32:443: read: connection reset by peer'
  : >"$tf_self_test_log"; rm -f "$tf_self_test_calls"
  terraform() { tf_self_test_stub "$reset" 1 2; }
  tf_init_with_retry "$tf_self_test_log"; assert "transient-then-success code" "$?" "0"
  assert "transient-then-success attempts" "$(cat "$tf_self_test_calls")" "3"
  assert "transient-then-success log keeps every attempt" \
    "$(grep -c 'connection reset by peer' "$tf_self_test_log")" "2"

  # 2. A real config error is not retried at all.
  config='Error: Failed to query available provider packages
provider registry registry.terraform.io does not have a provider named
registry.terraform.io/hashicorp/nosuchprovider'
  : >"$tf_self_test_log"; rm -f "$tf_self_test_calls"
  terraform() { tf_self_test_stub "$config" 1 99; }
  tf_init_with_retry "$tf_self_test_log"; assert "config-error code" "$?" "1"
  assert "config-error attempts" "$(cat "$tf_self_test_calls")" "1"

  # 3. A transient error that never clears is still bounded.
  : >"$tf_self_test_log"; rm -f "$tf_self_test_calls"
  terraform() { tf_self_test_stub "$reset" 1 99; }
  tf_init_with_retry "$tf_self_test_log"; assert "bounded code" "$?" "1"
  assert "bounded attempts" "$(cat "$tf_self_test_calls")" "3"

  rm -rf "$tf_self_test_dir"
  if [ "$tf_self_test_fail" != 0 ]; then
    echo "::error::ci-tf-init.sh --self-test failed; the retry logic is not trustworthy"
    exit 1
  fi
  echo "ci-tf-init.sh self-test passed"
  exit 0
fi
