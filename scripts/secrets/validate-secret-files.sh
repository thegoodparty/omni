#!/usr/bin/env bash
# Structurally validate the promotion manifests under secrets/. Runs on PRs and
# pre-commit.
#
# This check NEVER decrypts and needs no AWS credentials at all — not even S3
# read. That is deliberate: a PR-time job holding kms:Decrypt is a read path, and
# a PR can edit the workflow that runs it, so a decrypting validator would hand
# any contributor a way to exfiltrate every secret. Everything here is checkable
# from the manifest alone.
#
# What that catches:
#   - a plaintext secret pasted in where a version id belongs (no v1:s3: prefix)
#   - a `null` version id, i.e. a bucket without versioning, which would make the
#     manifest point at mutable bytes instead of pinning a value
#   - a manifest whose secretId belongs to the other environment
#   - a key name that is not a usable env var
#   - a stray file dropped into secrets/
#   - the same key declared for one environment but not the other (warning)
#
# What it cannot catch, because the payload is not in the repo: a truncated or
# wrong-key ciphertext, and a version id that does not exist. Both surface on the
# train — the dev stage fetches and decrypts BOTH environments' payloads before
# any deploy, so they fail there rather than during a prod promotion.
#
# Usage: validate-secret-files.sh [file...]   (defaults to every secrets/*.json)
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/secret-lib.sh"

command -v jq >/dev/null 2>&1 || die 'jq not found on PATH'
require_openssl

failures=0

fail() {
  local file="$1" message="$2"
  echo "::error file=$file::$message"
  echo "  $file: $message" >&2
  failures=$((failures + 1))
}

# A manifest entry. Echoes a reason on failure.
#
# Only `v1:s3:` belongs in a manifest. An `rsa`/`env` payload here means someone
# committed the ciphertext itself instead of uploading it — harmless to the
# secret, but this repo is public and the whole reason for the S3 indirection is
# that a ciphertext committed here can never be withdrawn.
check_entry() {
  local alg="$1" payload="$2"

  case "$alg" in
    "$SECRET_ALG_S3") ;;
    "$SECRET_ALG_RSA" | "$SECRET_ALG_ENVELOPE")
      echo "is a raw $alg ciphertext, not a version id. Payloads go to S3, never into this public repo — re-add it with scripts/secrets/secret-encrypt.sh"
      return 1
      ;;
    *)
      echo "has an unrecognized format '$alg'"
      return 1
      ;;
  esac

  if [ "$payload" = 'null' ]; then
    echo "version id is 'null', which means the bucket is not versioned. The manifest would point at whatever is at that key rather than pinning a value"
    return 1
  fi
  if ! is_valid_version_id "$payload"; then
    echo "'$payload' is not a usable S3 version id"
    return 1
  fi
  return 0
}

validate_file() {
  local file="$1"

  if ! jq -e . "$file" >/dev/null 2>&1; then
    fail "$file" 'not valid JSON'
    return
  fi

  local unexpected
  unexpected=$(jq -r 'keys - ["secretId","environment","values"] | join(", ")' "$file")
  [ -z "$unexpected" ] && unexpected=''
  if [ -n "$unexpected" ]; then
    fail "$file" "unexpected top-level key(s): $unexpected"
  fi

  local secret_id environment
  secret_id=$(jq -r '.secretId // empty' "$file")
  environment=$(jq -r '.environment // empty' "$file")

  [ -n "$secret_id" ] || fail "$file" 'missing secretId'

  # The filename is the source of truth for the environment, so the sync step
  # (which selects files by filename) can never disagree with the file's body.
  local base filename_env
  base=$(basename "$file" .json)
  filename_env="${base##*.}"
  case "$filename_env" in
    dev | prod) ;;
    *) fail "$file" "filename must be <service>.<dev|prod>.json" ;;
  esac
  if [ -n "$environment" ] && [ "$environment" != "$filename_env" ]; then
    fail "$file" "environment is '$environment' but the filename says '$filename_env'"
  fi

  # The AWS target has to belong to the file's environment. Otherwise a
  # `*.dev.json` could name a prod secret and be written by the dev sync stage,
  # which runs before the E2E — see secret_id_matches_environment.
  case "$filename_env" in
    dev | prod)
      if [ -n "$secret_id" ] &&
        ! secret_id_matches_environment "$secret_id" "$filename_env"; then
        fail "$file" "secretId '$secret_id' is not a $filename_env secret (it must end with _$(printf %s "$filename_env" | tr '[:lower:]' '[:upper:]') or -$filename_env); a $filename_env file must not write another environment's secret"
      fi
      ;;
  esac

  if ! jq -e '.values | type == "object"' "$file" >/dev/null 2>&1; then
    fail "$file" 'values must be an object'
    return
  fi

  local key entry alg_payload alg payload reason
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    is_valid_key_name "$key" ||
      fail "$file" "key '$key' must be SCREAMING_SNAKE_CASE (it becomes an env var)"

    entry=$(jq -r --arg k "$key" '.values[$k]' "$file")

    if ! alg_payload=$(parse_entry "$entry"); then
      fail "$file" "key '$key' is not a recognized entry. If this is a plaintext secret, it is now burned: rotate it, then re-add it with scripts/secrets/secret-encrypt.sh"
      continue
    fi
    alg="${alg_payload%% *}"
    payload="${alg_payload#* }"

    if ! reason=$(check_entry "$alg" "$payload"); then
      fail "$file" "key '$key' $reason"
    fi
  done < <(jq -r '.values | keys[]' "$file" 2>/dev/null)
}

# `docs/secrets.md` states the rule as "one key, every environment: same name in
# dev and prod, different values" — but the two files are encrypted separately,
# so nothing else notices when a key lands in only one of them. That asymmetry
# is invisible on a green train: gp-api and election-api build their task
# definitions from whatever keys the blob happens to hold, so a key added to dev
# only passes the E2E and is then simply missing in prod at runtime.
#
# A warning, not a failure. One-sided keys are legitimate (a sandbox-only
# credential, or a service mid-migration whose prod keys have not moved yet), so
# this points at the asymmetry and leaves the judgement to the reviewer.
#
# Always reads the whole directory, never just the files passed in: the
# counterpart of a changed file is usually the one that was NOT touched, and
# pre-commit passes only what is staged.
report_environment_drift() {
  local dir dev_file prod_file service only_dev only_prod
  dir="$(secret_files_dir)"
  [ -d "$dir" ] || return 0

  while IFS= read -r dev_file; do
    service=$(basename "$dev_file" .dev.json)
    prod_file="$dir/$service.prod.json"
    [ -f "$prod_file" ] || continue
    jq -e '.values | type == "object"' "$dev_file" >/dev/null 2>&1 || continue
    jq -e '.values | type == "object"' "$prod_file" >/dev/null 2>&1 || continue

    only_dev=$(jq -r --slurpfile p "$prod_file" \
      '(.values | keys) - ($p[0].values | keys) | join(", ")' "$dev_file")
    only_prod=$(jq -r --slurpfile d "$dev_file" \
      '(.values | keys) - ($d[0].values | keys) | join(", ")' "$prod_file")

    if [ -n "$only_dev" ]; then
      echo "::warning file=$dev_file::declared for dev but not prod: $only_dev. If prod needs it too, add it to $service.prod.json — a missing prod key is invisible until the service reads it."
    fi
    if [ -n "$only_prod" ]; then
      echo "::warning file=$prod_file::declared for prod but not dev: $only_prod. Its first and only decrypt will be the prod stage, after the E2E has already passed."
    fi
  done < <(find "$dir" -name '*.dev.json' -type f | sort)
}

# Anything in secrets/ that is neither a secret file nor the public key is
# suspicious — a .env or a "notes.txt" dropped in here is how plaintext leaks.
check_for_stray_files() {
  local dir file
  dir="$(secret_files_dir)"
  [ -d "$dir" ] || return 0
  while IFS= read -r file; do
    case "$(basename "$file")" in
      *.json | gp-secret-write.pub.pem | README.md | AGENTS.md | CLAUDE.md) ;;
      *) fail "$file" 'unexpected file in secrets/; only <service>.<env>.json, the committed public key, and the docs files belong here' ;;
    esac
  done < <(find "$dir" -type f)
}

files=("$@")
if [ "${#files[@]}" -eq 0 ]; then
  dir="$(secret_files_dir)"
  if [ -d "$dir" ]; then
    while IFS= read -r f; do files+=("$f"); done < <(find "$dir" -name '*.json' -type f | sort)
  fi
fi

check_for_stray_files
report_environment_drift

for file in ${files[@]+"${files[@]}"}; do
  [ -f "$file" ] || continue
  case "$file" in
    *.json) validate_file "$file" ;;
  esac
done

if [ "$failures" -gt 0 ]; then
  echo >&2
  echo "secret file validation failed with $failures problem(s)." >&2
  echo 'See docs/secrets.md for the workflow.' >&2
  exit 1
fi

count="${#files[@]}"
echo "secret files valid (${count} file(s) checked)"
