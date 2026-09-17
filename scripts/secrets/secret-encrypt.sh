#!/usr/bin/env bash
# Encrypt a secret value into a secret file. Needs NO AWS credentials — it
# encrypts against the public key committed at secrets/gp-secret-write.pub.pem,
# and only CI holds the private half.
#
# The value is read from stdin, never from an argument: arguments are visible to
# every other process on the machine via `ps`.
#
# Usage:
#   printf %s "$VALUE" | scripts/secrets/secret-encrypt.sh secrets/gp-api.prod.json VENDOR_API_KEY
#   scripts/secrets/secret-encrypt.sh --secret-id GP_API_PROD secrets/gp-api.prod.json KEY < value.txt
#
# Options:
#   --secret-id <name>  AWS secret to write into. Required when creating a file.
#   --raw               Keep stdin byte-for-byte. Default strips ONE trailing
#                       newline, because `echo "$KEY" | ...` is the common
#                       invocation and a stray \n silently breaks API auth in a
#                       way that is painful to debug from the other end.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/secret-lib.sh"

# Any plaintext this script handles lives in files under this directory.
umask 077
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

secret_id=''
raw=0
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --secret-id)
      secret_id="${2:?--secret-id needs a value}"
      shift 2
      ;;
    --raw)
      raw=1
      shift
      ;;
    -*) die "unknown option: $1" ;;
    *)
      args+=("$1")
      shift
      ;;
  esac
done

[ "${#args[@]}" -eq 2 ] || die 'usage: secret-encrypt.sh [--secret-id NAME] [--raw] <secret-file> <KEY>'
file="${args[0]}"
key="${args[1]}"

is_valid_key_name "$key" ||
  die "invalid key name '$key'; use SCREAMING_SNAKE_CASE (it becomes an env var)"

require_openssl
command -v jq >/dev/null 2>&1 || die 'jq not found on PATH'

pubkey="$(secret_public_key_path)"
if [ ! -f "$pubkey" ]; then
  die "no public key at $pubkey.
An admin must create the KMS key and commit its public key before secrets can be
encrypted — see the one-time steps in docs/secrets-iac-plan.md."
fi

# The 446-byte threshold and the 512-byte ciphertext length below are both
# properties of RSA-4096. If the committed key is ever a different size, every
# length check in validation silently becomes wrong, so fail loudly instead.
key_bits=$(openssl pkey -pubin -in "$pubkey" -noout -text 2>/dev/null |
  sed -n 's/.*Public-Key: (\([0-9]*\) bit).*/\1/p' | head -1)
[ "$key_bits" = '4096' ] ||
  die "expected an RSA-4096 public key at $pubkey, found '${key_bits:-unreadable}' bits"

cat >"$workdir/plaintext"
if [ "$raw" -eq 0 ]; then
  # Strip exactly one trailing newline, preserving any others.
  printf %s "$(cat "$workdir/plaintext")" >"$workdir/stripped" || true
  mv "$workdir/stripped" "$workdir/plaintext"
fi

size=$(wc -c <"$workdir/plaintext" | tr -d ' ')
[ "$size" -gt 0 ] || die 'refusing to encrypt an empty value (nothing on stdin?)'

rsa_encrypt() {
  openssl pkeyutl -encrypt -pubin -inkey "$pubkey" \
    -pkeyopt rsa_padding_mode:oaep \
    -pkeyopt rsa_oaep_md:sha256 \
    -pkeyopt rsa_mgf1_md:sha256 \
    -in "$1" -out "$2"
}

if [ "$size" -le "$RSA_MAX_PLAINTEXT" ]; then
  rsa_encrypt "$workdir/plaintext" "$workdir/ct"
  entry="$SECRET_FORMAT_VERSION:$SECRET_ALG_RSA:$(b64 <"$workdir/ct")"
  shape='rsa'
else
  # Envelope: one RSA block carries both the AES key and the MAC key (64 bytes
  # total), so a long value costs exactly one extra asymmetric operation.
  #
  # Keys are generated as raw bytes and hex is derived with `od`, rather than
  # generating hex and converting back with `xxd` — xxd ships with vim, which is
  # not something to assume on a CI runner.
  openssl rand 64 >"$workdir/keys"
  head -c 32 "$workdir/keys" >"$workdir/enc_key"
  tail -c 32 "$workdir/keys" >"$workdir/mac_key"
  openssl rand "$ENVELOPE_IV_BYTES" >"$workdir/iv"

  enc_key_hex=$(to_hex "$workdir/enc_key")
  mac_key_hex=$(to_hex "$workdir/mac_key")
  iv_hex=$(to_hex "$workdir/iv")

  rsa_encrypt "$workdir/keys" "$workdir/wrapped"
  openssl enc -aes-256-cbc -K "$enc_key_hex" -iv "$iv_hex" \
    -in "$workdir/plaintext" -out "$workdir/ct"

  # Encrypt-then-MAC over iv||ciphertext, so a flipped iv bit is caught too.
  cat "$workdir/iv" "$workdir/ct" >"$workdir/mac_input"
  mac=$(openssl dgst -sha256 -mac HMAC -macopt "hexkey:$mac_key_hex" -binary \
    <"$workdir/mac_input" | b64)

  entry="$SECRET_FORMAT_VERSION:$SECRET_ALG_ENVELOPE:$(b64 <"$workdir/wrapped")"
  entry="$entry.$(b64 <"$workdir/iv")"
  entry="$entry.$mac"
  entry="$entry.$(b64 <"$workdir/ct")"
  shape='envelope'
fi

if [ -f "$file" ]; then
  existing_id=$(jq -r '.secretId // empty' "$file")
  [ -n "$existing_id" ] || die "$file has no secretId"
  if [ -n "$secret_id" ] && [ "$secret_id" != "$existing_id" ]; then
    die "$file targets $existing_id, but --secret-id said $secret_id"
  fi
  secret_id="$existing_id"
  tmp=$(mktemp "$workdir/out.XXXXXX")
  jq --arg k "$key" --arg v "$entry" '.values[$k] = $v' "$file" >"$tmp"
  mv "$tmp" "$file"
else
  [ -n "$secret_id" ] ||
    die "$file does not exist yet; pass --secret-id <AWS secret name> to create it"
  # Environment comes from the filename so the file, its name, and the sync step
  # that selects on it can never disagree.
  base=$(basename "$file" .json)
  environment="${base##*.}"
  case "$environment" in
    dev | prod) ;;
    *) die "cannot tell the environment from '$base'; name files <service>.<dev|prod>.json" ;;
  esac
  mkdir -p "$(dirname "$file")"
  jq -n --arg id "$secret_id" --arg env "$environment" --arg k "$key" --arg v "$entry" \
    '{secretId: $id, environment: $env, values: {($k): $v}}' >"$file"
fi

# Deliberately says nothing about the value, not even its length.
echo "encrypted $key into $file ($shape, target $secret_id)"
echo 'Commit the file. CI writes the value on the next release train.'
