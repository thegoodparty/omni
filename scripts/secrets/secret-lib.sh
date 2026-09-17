#!/usr/bin/env bash
# Shared definitions for the write-only secret pipeline. Sourced, not executed.
#
# The whole point of this pipeline is that adding a secret needs no AWS
# credentials: an engineer encrypts against a public key committed to this repo,
# and only CI can decrypt. So everything in here that an engineer touches must be
# pure openssl — no `aws` calls, no network.
#
# See docs/secrets.md for the workflow and docs/secrets-iac-plan.md for why the
# design looks like this.

# --- Ciphertext wire format ---
#
# One entry is a single string, so a secret file diffs one line per key and needs
# no nested parsing. Two shapes:
#
#   v1:rsa:<b64 ciphertext>
#     Direct RSA-OAEP-SHA-256 against the KMS public key. Ciphertext is always
#     exactly 512 bytes (the RSA-4096 modulus), which is what lets validation
#     catch a truncated paste without being able to decrypt anything.
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

# RSA-4096 with OAEP-SHA-256 holds k - 2*hLen - 2 = 512 - 64 - 2 bytes.
readonly RSA_MAX_PLAINTEXT=446
readonly RSA_CIPHERTEXT_BYTES=512
readonly ENVELOPE_WRAPPED_BYTES=512 # RSA-wrapped 64-byte key pair
readonly ENVELOPE_IV_BYTES=16
readonly ENVELOPE_MAC_BYTES=32

readonly KMS_KEY_ALIAS='alias/gp-secret-write'
readonly KMS_ENCRYPTION_ALGORITHM='RSAES_OAEP_SHA_256'

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
    "$SECRET_ALG_RSA" | "$SECRET_ALG_ENVELOPE") ;;
    *) return 1 ;;
  esac
  echo "$alg ${entry#*:}"
}
