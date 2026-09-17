#!/usr/bin/env bash
# Decrypt the committed secret files for one environment and write the values
# into AWS Secrets Manager. CI only — needs kms:Decrypt on alias/gp-secret-write
# plus PutSecretValue on the target secrets, which is exactly the role
# github-actions-secrets-sync holds and nothing else does.
#
# This runs OUTSIDE terraform and pulumi on purpose. Routing values through IaC
# would put every plaintext into the state bucket, which is the leak this whole
# pipeline exists to avoid (see docs/secrets-iac-plan.md, Phase 4). IaC keeps
# owning the secret container, the IAM, and which keys are wired into tasks.
#
# Must run BEFORE the service deploys in each stage: gp-api and election-api
# enumerate the live secret's keys at deploy time, so a key written after their
# deploy lands in the blob but is not in the task definition until the next
# train.
#
# Usage: ci-sync-secrets.sh <dev|prod> [--dry-run]
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/secret-lib.sh"

# Never trace this script — the shell would echo decrypted values.
set +x

environment="${1:?usage: ci-sync-secrets.sh <dev|prod> [--dry-run]}"
dry_run=0
[ "${2:-}" = '--dry-run' ] && dry_run=1

case "$environment" in
  dev | prod) ;;
  *) die "environment must be dev or prod, got '$environment'" ;;
esac

command -v jq >/dev/null 2>&1 || die 'jq not found on PATH'
command -v aws >/dev/null 2>&1 || die 'aws CLI not found on PATH'
require_openssl

umask 077
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

# --- decryption ---

# Decrypts one RSA-OAEP block into $2. Asymmetric KMS decrypt requires both
# --key-id and --encryption-algorithm; there is no default.
kms_decrypt() {
  local blob_file="$1" out_file="$2" b64_out
  b64_out=$(aws kms decrypt \
    --key-id "$KMS_KEY_ALIAS" \
    --encryption-algorithm "$KMS_ENCRYPTION_ALGORITHM" \
    --ciphertext-blob "fileb://$blob_file" \
    --query Plaintext --output text 2>"$workdir/kms.err") || {
    # The error text is AWS's, not ours, and never contains plaintext.
    sed 's/^/    aws: /' "$workdir/kms.err" >&2
    return 1
  }
  printf %s "$b64_out" | b64_decode >"$out_file"
}

# Writes the decrypted value of an entry into $2. Returns non-zero on any
# failure, and never prints the value.
decrypt_entry() {
  local entry="$1" out_file="$2" alg_payload alg payload

  alg_payload=$(parse_entry "$entry") || {
    echo '    unrecognized ciphertext format' >&2
    return 1
  }
  alg="${alg_payload%% *}"
  payload="${alg_payload#* }"

  if [ "$alg" = "$SECRET_ALG_RSA" ]; then
    printf %s "$payload" | b64_decode >"$workdir/ct.bin" || return 1
    kms_decrypt "$workdir/ct.bin" "$out_file" || return 1
    return 0
  fi

  local IFS='.'
  read -r -a parts <<<"$payload"
  [ "${#parts[@]}" -eq 4 ] || {
    echo '    malformed envelope' >&2
    return 1
  }
  unset IFS

  printf %s "${parts[0]}" | b64_decode >"$workdir/wrapped.bin" || return 1
  printf %s "${parts[1]}" | b64_decode >"$workdir/iv.bin" || return 1
  printf %s "${parts[2]}" | b64_decode >"$workdir/mac.expected" || return 1
  printf %s "${parts[3]}" | b64_decode >"$workdir/body.bin" || return 1

  kms_decrypt "$workdir/wrapped.bin" "$workdir/keys.bin" || return 1
  [ "$(wc -c <"$workdir/keys.bin" | tr -d ' ')" -eq 64 ] || {
    echo '    wrapped key block is not 64 bytes' >&2
    return 1
  }
  head -c 32 "$workdir/keys.bin" >"$workdir/enc_key"
  tail -c 32 "$workdir/keys.bin" >"$workdir/mac_key"

  # Verify before decrypting (encrypt-then-MAC over iv||ciphertext). Not a
  # constant-time compare, which is fine: both sides are our own ciphertext in a
  # CI runner, with no attacker in a position to time it.
  cat "$workdir/iv.bin" "$workdir/body.bin" >"$workdir/mac_input"
  openssl dgst -sha256 -mac HMAC -macopt "hexkey:$(to_hex "$workdir/mac_key")" \
    -binary <"$workdir/mac_input" >"$workdir/mac.actual"
  cmp -s "$workdir/mac.expected" "$workdir/mac.actual" || {
    echo '    envelope MAC does not verify; the file was corrupted or tampered with' >&2
    return 1
  }

  openssl enc -d -aes-256-cbc \
    -K "$(to_hex "$workdir/enc_key")" \
    -iv "$(to_hex "$workdir/iv.bin")" \
    -in "$workdir/body.bin" -out "$out_file" 2>/dev/null || {
    echo '    envelope body failed to decrypt' >&2
    return 1
  }
}

# --- per-file sync ---

total_changed=0
total_failed=0

sync_file() {
  local file="$1"
  local secret_id
  secret_id=$(jq -r '.secretId // empty' "$file")
  [ -n "$secret_id" ] || {
    echo "::error file=$file::missing secretId"
    total_failed=$((total_failed + 1))
    return
  }

  echo "$file -> $secret_id"

  # The container is IaC's job, so a missing secret is a real error, not
  # something to paper over by creating it here.
  if ! aws secretsmanager get-secret-value --secret-id "$secret_id" \
    --query SecretString --output text >"$workdir/live.json" 2>"$workdir/get.err"; then
    sed 's/^/    aws: /' "$workdir/get.err" >&2
    echo "::error file=$file::cannot read $secret_id. The secret container is created by terraform/pulumi — it must exist before values can be written."
    total_failed=$((total_failed + 1))
    return
  fi
  # Fail rather than defaulting to `{}`. The merge below is a read-modify-write
  # over a blob that holds keys this file does not declare, so treating an
  # unreadable live value as empty would write only the declared keys and drop
  # every other one — exactly the wipe the no-prune rule exists to prevent. A
  # secret IaC just created already holds `{}`, which is valid JSON, so nothing
  # legitimate needs the fallback.
  if ! jq -e 'type == "object"' "$workdir/live.json" >/dev/null 2>&1; then
    echo "::error file=$file::$secret_id does not currently hold a JSON object. Refusing to sync, because overwriting it would drop any key not declared here. Inspect it by hand."
    total_failed=$((total_failed + 1))
    return
  fi

  local keys=() key i=0
  while IFS= read -r key; do
    [ -n "$key" ] && keys+=("$key")
  done < <(jq -r '.values | keys[]' "$file")

  local changed_keys=() jq_args=() jq_program='.'
  local entry

  for key in ${keys[@]+"${keys[@]}"}; do
    entry=$(jq -r --arg k "$key" '.values[$k]' "$file")

    if ! decrypt_entry "$entry" "$workdir/new.$i"; then
      echo "::error file=$file::key '$key' failed to decrypt. Most likely it was encrypted against a stale public key — re-run secret-encrypt.sh."
      total_failed=$((total_failed + 1))
      continue
    fi

    # Compare against the live value and skip unchanged keys. This is what makes
    # the step idempotent: OAEP is randomized, so re-encrypting an identical
    # value yields a different ciphertext and the file diff cannot tell you
    # whether anything actually changed. Without this, every train would cut a
    # new secret version for every key forever.
    #
    # `jq -j` (no trailing newline) matters — `-r` would append one and make
    # every key look changed.
    if jq -j --arg k "$key" 'if has($k) then .[$k] else "\u0000ABSENT" end' \
      "$workdir/live.json" >"$workdir/live.$i" 2>/dev/null &&
      cmp -s "$workdir/live.$i" "$workdir/new.$i"; then
      continue
    fi

    changed_keys+=("$key")
    # --rawfile, not --arg: an --arg value would be visible in `ps` output to
    # every other process on the runner.
    jq_args+=(--rawfile "v$i" "$workdir/new.$i")
    jq_program="$jq_program | .[\"$key\"] = \$v$i"
    i=$((i + 1))
  done

  # Keys live in the blob but absent from the file are reported, never removed.
  # Implicit pruning plus a partially migrated file equals wiping prod
  # credentials; deletion is an explicit, separate action.
  local undeclared
  undeclared=$(jq -r --slurpfile decl <(jq '.values | keys' "$file") \
    'keys - $decl[0] | join(", ")' "$workdir/live.json")
  [ -n "$undeclared" ] &&
    echo "    note: live keys not declared here, left untouched: $undeclared"

  if [ "${#changed_keys[@]}" -eq 0 ]; then
    echo '    no changes'
    return
  fi

  echo "    ${#changed_keys[@]} key(s) to write: ${changed_keys[*]}"
  total_changed=$((total_changed + ${#changed_keys[@]}))

  if [ "$dry_run" -eq 1 ]; then
    echo '    dry run, not writing'
    return
  fi

  # Read-modify-write: one blob holds many keys, several of them not managed
  # here yet, so the payload must start from the live value.
  jq "${jq_args[@]}" "$jq_program" "$workdir/live.json" >"$workdir/next.json" || {
    echo "::error file=$file::failed to build the new secret payload"
    total_failed=$((total_failed + 1))
    return
  }

  if ! aws secretsmanager put-secret-value --secret-id "$secret_id" \
    --secret-string "file://$workdir/next.json" >/dev/null 2>"$workdir/put.err"; then
    sed 's/^/    aws: /' "$workdir/put.err" >&2
    echo "::error file=$file::PutSecretValue failed for $secret_id"
    total_failed=$((total_failed + 1))
    return
  fi
  echo '    written'
}

files=()
dir="$(secret_files_dir)"
if [ -d "$dir" ]; then
  while IFS= read -r f; do files+=("$f"); done \
    < <(find "$dir" -name "*.$environment.json" -type f | sort)
fi

if [ "${#files[@]}" -eq 0 ]; then
  echo "no secret files for $environment; nothing to sync"
  exit 0
fi

# Validate before touching AWS: a malformed file should fail here, loudly and
# for free, rather than half-way through writing a multi-key secret.
"$(dirname "${BASH_SOURCE[0]}")/validate-secret-files.sh" ${files[@]+"${files[@]}"} ||
  die 'secret files failed validation; refusing to sync'

for file in "${files[@]}"; do
  sync_file "$file"
done

echo
if [ "$total_failed" -gt 0 ]; then
  die "$total_failed secret(s) failed to sync"
fi
echo "sync complete for $environment ($total_changed key(s) written)"
