#!/usr/bin/env bash
# Shared definitions for the write-only secret pipeline. Sourced, not executed.
#
# An engineer can write any secret, including a prod one, and can never read one.
# Encryption is against a public key committed to this repo, so the value is
# already ciphertext before it leaves the machine; the private half lives in KMS
# where only the release train can reach it.
#
# See docs/secrets.md for the workflow and docs/secrets-iac-plan.md for why the
# design looks like this.

# --- Where the ciphertext lives ---
#
# In S3, not in git. This repo is PUBLIC, and a committed ciphertext is
# world-readable and permanently archived by third parties — strong encryption
# today is not the same as strong encryption for the lifetime of the credential,
# and a public commit cannot be withdrawn. The bucket blocks public access and
# has versioning on.
#
# What git holds instead is the *promotion*: a manifest naming each key and the
# S3 version id to deploy. That splits the two actions apart, and only the second
# one needs review:
#
#   writing a payload   — anyone with the write role, no review, and INERT.
#                         Nothing reads an object until a version id points at it.
#   promoting a payload — a one-line manifest diff, so it is a PR with CODEOWNERS
#                         on it, and reverting the PR rolls the value back.
#
# The object key is derived, never stored: <environment>/<secretId>/<KEY>. A
# version id therefore cannot be pointed at some other key's payload — it would
# simply not exist at the derived path, and the fetch fails loudly.

# --- Wire format ---
#
# One entry is a single string, so a manifest diffs one line per key. Three
# shapes. The manifest on disk only ever holds the first; the other two are the
# payload formats found *inside* an S3 object.
#
#   v1:s3:<version id>
#     What is committed. Keeping the `v1:` prefix is what lets validation reject
#     a hand-pasted plaintext: anything without a recognized prefix is treated as
#     a possible leak rather than passed through.
#
#   v1:rsa:<b64 ciphertext>
#     Direct RSA-OAEP-SHA-256 against the KMS public key. Ciphertext is always
#     exactly 512 bytes (the RSA-4096 modulus), which is what catches a truncated
#     payload without decrypting anything.
#
#   v1:env:<b64 wrapped-keys>.<b64 iv>.<b64 mac>.<b64 ciphertext>
#     Envelope for values over RSA_MAX_PLAINTEXT. A 32-byte AES key and a
#     32-byte HMAC key are concatenated and RSA-wrapped (64 bytes, comfortably
#     under the limit); the value is AES-256-CBC encrypted and then MAC'd
#     (encrypt-then-MAC over iv||ciphertext).
#
# Why CBC+HMAC and not GCM: `openssl enc` refuses AEAD ciphers outright ("enc:
# AEAD ciphers not supported") on both OpenSSL 3 and the LibreSSL that ships as
# /usr/bin/openssl on macOS, and there is no CLI path to pass a GCM tag. An
# engineer encrypting a secret must not need a Python or Node toolchain, so the
# format is constrained to what the openssl CLI can actually do.
# shellcheck disable=SC2034
# This file is sourced, so every constant below is read by a consumer script,
# not by this file. shellcheck cannot see across the `source` and reports each
# one as unused.
readonly SECRET_FORMAT_VERSION='v1'
readonly SECRET_ALG_RSA='rsa'
readonly SECRET_ALG_ENVELOPE='env'
readonly SECRET_ALG_S3='s3'

# RSA-4096 with OAEP-SHA-256 holds k - 2*hLen - 2 = 512 - 64 - 2 bytes.
readonly RSA_MAX_PLAINTEXT=446
readonly RSA_CIPHERTEXT_BYTES=512
readonly ENVELOPE_WRAPPED_BYTES=512 # RSA-wrapped 64-byte key pair
readonly ENVELOPE_IV_BYTES=16
readonly ENVELOPE_MAC_BYTES=32

readonly KMS_KEY_ALIAS='alias/gp-secret-write'
readonly KMS_ENCRYPTION_ALGORITHM='RSAES_OAEP_SHA_256'

readonly SECRET_PAYLOAD_BUCKET_DEFAULT='goodparty-secret-payloads'

# Overridable only under SECRET_SELFTEST, like the two paths below, so a stray
# export cannot redirect the release train at a bucket somebody else controls.
secret_payload_bucket() {
  if secret_selftest_mode && [ -n "${SECRET_PAYLOAD_BUCKET:-}" ]; then
    echo "$SECRET_PAYLOAD_BUCKET"
    return
  fi
  echo "$SECRET_PAYLOAD_BUCKET_DEFAULT"
}

# Derived, never stored: a version id can only ever resolve against the key it
# was uploaded for. See the header.
secret_object_key() {
  local environment="$1" secret_id="$2" key="$3"
  printf '%s/%s/%s' "$environment" "$secret_id" "$key"
}

# S3 version ids are opaque strings, and AWS does not publish a charset beyond
# "URL-safe, up to 1024 bytes" — observed ids include `+`, `/`, `=`, `.`, `-`
# and `_`. So this is deliberately permissive about content and strict about the
# two things that actually matter: no colon (which would break the `v1:s3:`
# split), and not the literal `null`.
#
# `null` is what S3 returns for an object in a bucket where versioning was never
# enabled or has been suspended. Accepting it would silently turn every promotion
# into "whatever is at that key right now", which is exactly the unreviewed
# mutable path this design exists to remove.
is_valid_version_id() {
  local version_id="$1"
  [ "$version_id" != 'null' ] || return 1
  [ "${#version_id}" -le 1024 ] || return 1
  [[ "$version_id" =~ ^[A-Za-z0-9+/=._-]+$ ]]
}

# Resolved relative to this file so every script works from any cwd.
secret_repo_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
}

# Both paths are overridable so secret-selftest.sh can drive the real scripts
# against a throwaway keypair and a scratch directory.
#
# The overrides are honored ONLY under SECRET_SELFTEST=1. They are otherwise
# ignored, including if they are set — a stray SECRET_FILES_DIR in the
# environment would otherwise silently redirect the release train to read
# somebody else's directory and write the wrong values to a live secret. Found
# the hard way: a leftover export from a debugging session made a sanity check
# read a scratch dir and report success.
secret_selftest_mode() {
  [ "${SECRET_SELFTEST:-}" = '1' ]
}

secret_public_key_path() {
  if secret_selftest_mode && [ -n "${SECRET_PUBLIC_KEY:-}" ]; then
    echo "$SECRET_PUBLIC_KEY"
    return
  fi
  echo "$(secret_repo_root)/secrets/gp-secret-write.pub.pem"
}

secret_files_dir() {
  if secret_selftest_mode && [ -n "${SECRET_FILES_DIR:-}" ]; then
    echo "$SECRET_FILES_DIR"
    return
  fi
  echo "$(secret_repo_root)/secrets"
}

die() {
  echo "error: $*" >&2
  exit 1
}

# --- openssl ---
#
# Both OpenSSL 3 and macOS's LibreSSL 3.3 honor `rsa_oaep_md` and — verified
# before this was written — reject an unknown `-pkeyopt` rather than ignoring it.
# That matters: a silent fallback to OAEP-SHA-1 would produce ciphertext KMS
# cannot decrypt, and we would only find out in the release train. Since unknown
# options hard-fail, a successful encrypt is proof the digest was applied.
require_openssl() {
  command -v openssl >/dev/null 2>&1 || die 'openssl not found on PATH'
}

# base64 without line wrapping, which differs between GNU coreutils and BSD/macOS.
b64() {
  openssl base64 -A
}

# Lowercase hex of a file's bytes, for openssl's -K/-iv arguments. `od` is POSIX
# and present everywhere; `xxd` ships with vim and is not safe to assume on a CI
# runner.
to_hex() {
  od -An -tx1 -v <"$1" | tr -d ' \n'
}

b64_decode() {
  openssl base64 -d -A
}

# Byte length of a base64 string's decoded payload, or empty if it isn't valid
# base64. Used by validation, which must never decrypt.
b64_decoded_len() {
  local encoded="$1" decoded_len
  decoded_len=$(printf %s "$encoded" | openssl base64 -d -A 2>/dev/null | wc -c | tr -d ' ') || return 1
  [ -n "$decoded_len" ] || return 1
  echo "$decoded_len"
}

# A secret key name. Uppercase, digits, underscores; must start with a letter.
# Matches what the services expect as an environment variable name.
is_valid_key_name() {
  [[ "$1" =~ ^[A-Z][A-Z0-9_]*$ ]]
}

# Does this AWS secret name belong to this environment?
#
# Load-bearing for more than tidiness. The sync role can PutSecretValue on both
# environments' secrets, and the dev sync runs BEFORE the E2E while the prod
# sync runs after it. Without this check a file named `*.dev.json` could carry
# `secretId: GP_API_PROD` and write a prod credential in the dev stage, skipping
# the E2E gate entirely — so the environment in the filename has to constrain
# the AWS target, not just the file's own `environment` field.
#
# Every secret here is suffixed with its environment (`GP_API_PROD`,
# `AI_SECRETS_DEV`, `broker-prod`), so the suffix is the check. Case-insensitive
# on the separator and the token to allow both naming styles in use.
secret_id_matches_environment() {
  local secret_id="$1" environment="$2" lowered
  lowered=$(printf %s "$secret_id" | tr '[:upper:]' '[:lower:]')
  [[ "$lowered" =~ [_-]"$environment"$ ]]
}

# Splits an entry into "<alg> <payload>" on stdout, or fails if the prefix is not
# a format this version understands. Deliberately strict — an unrecognized entry
# is treated as a possible plaintext leak, not as something to pass through.
parse_entry() {
  local entry="$1" version alg
  version="${entry%%:*}"
  [ "$version" = "$SECRET_FORMAT_VERSION" ] || return 1
  entry="${entry#*:}"
  alg="${entry%%:*}"
  case "$alg" in
    "$SECRET_ALG_RSA" | "$SECRET_ALG_ENVELOPE" | "$SECRET_ALG_S3") ;;
    *) return 1 ;;
  esac
  echo "$alg ${entry#*:}"
}
