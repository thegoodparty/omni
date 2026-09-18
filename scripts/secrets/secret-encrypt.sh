#!/usr/bin/env bash
# Encrypt a secret value, upload the ciphertext to S3, and record the version id
# it came back with in a manifest for review.
#
# The value is encrypted against the public key committed at
# secrets/gp-secret-write.pub.pem before anything leaves this machine, so the
# write-only AWS profile this needs cannot read any secret — not the one being
# written, and not one already there. Only CI holds the private half.
#
# The value is read from stdin, never from an argument: arguments are visible to
# every other process on the machine via `ps`.
#
# Uploading does not deploy anything. The object is inert until the manifest
# change lands on main, which is the reviewed step.
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
command -v aws >/dev/null 2>&1 ||
  die 'aws CLI not found on PATH. Uploading the ciphertext needs the write-only
secrets profile — see docs/secrets.md.'

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
size=$(wc -c <"$workdir/plaintext" | tr -d ' ')

if [ "$raw" -eq 0 ] && [ "$size" -gt 0 ]; then
  # Strip exactly ONE trailing newline, byte-wise.
  #
  # Not `printf %s "$(cat ...)"`: command substitution strips *every* trailing
  # newline and cannot carry NUL bytes, so a multiline value ending in blank
  # lines would be stored as something other than what was encrypted — and
  # silently, since nothing here ever prints the value back.
  if [ "$(tail -c 1 "$workdir/plaintext" | od -An -tx1 | tr -d ' \n')" = '0a' ]; then
    head -c $((size - 1)) "$workdir/plaintext" >"$workdir/stripped"
    mv "$workdir/stripped" "$workdir/plaintext"
    size=$((size - 1))
  fi
fi

# After the strip, so a lone newline counts as empty.
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
  payload="$SECRET_FORMAT_VERSION:$SECRET_ALG_RSA:$(b64 <"$workdir/ct")"
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

  payload="$SECRET_FORMAT_VERSION:$SECRET_ALG_ENVELOPE:$(b64 <"$workdir/wrapped")"
  payload="$payload.$(b64 <"$workdir/iv")"
  payload="$payload.$mac"
  payload="$payload.$(b64 <"$workdir/ct")"
  shape='envelope'
fi

# Environment comes from the filename so the file, its name, and the sync step
# that selects on it can never disagree.
base=$(basename "$file" .json)
environment="${base##*.}"
case "$environment" in
  dev | prod) ;;
  *) die "cannot tell the environment from '$base'; name files <service>.<dev|prod>.json" ;;
esac

if [ -f "$file" ]; then
  existing_id=$(jq -r '.secretId // empty' "$file")
  [ -n "$existing_id" ] || die "$file has no secretId"
  if [ -n "$secret_id" ] && [ "$secret_id" != "$existing_id" ]; then
    die "$file targets $existing_id, but --secret-id said $secret_id"
  fi
  secret_id="$existing_id"
else
  [ -n "$secret_id" ] ||
    die "$file does not exist yet; pass --secret-id <AWS secret name> to create it"
fi

# Refuse to point a dev file at a prod secret (or vice versa). The dev sync
# stage runs before the E2E, so this would be a way to write a prod credential
# without the E2E gate. Validation enforces it too; this is the earlier, clearer
# failure.
secret_id_matches_environment "$secret_id" "$environment" ||
  die "$secret_id is not a $environment secret, but $file is a $environment file.
A $environment file must not write another environment's secret."

# Upload the ciphertext. Every PUT to a versioned bucket creates a new version
# and leaves the previous ones intact, so this is additive — it cannot disturb
# the value currently deployed, which is pinned by the version id already in the
# manifest on main.
bucket="$(secret_payload_bucket)"
object_key="$(secret_object_key "$environment" "$secret_id" "$key")"

printf %s "$payload" >"$workdir/payload"
version_id=$(aws s3api put-object \
  --bucket "$bucket" \
  --key "$object_key" \
  --body "$workdir/payload" \
  --query VersionId --output text 2>"$workdir/s3.err") || {
  sed 's/^/    aws: /' "$workdir/s3.err" >&2
  die "could not upload to s3://$bucket/$object_key.
This needs the write-only secrets profile; see docs/secrets.md. The value has
not been written anywhere."
}

# A bucket with versioning off answers `null`, which would make the manifest
# point at "whatever is at that key right now" instead of at fixed bytes —
# unreviewable and mutable, the opposite of the point. Refuse it.
is_valid_version_id "$version_id" || die "S3 returned version id '$version_id' for
s3://$bucket/$object_key. If that is 'null', versioning is not enabled on the
bucket and the manifest cannot pin a value — see docs/secrets-iac-plan.md."

entry="$SECRET_FORMAT_VERSION:$SECRET_ALG_S3:$version_id"

if [ -f "$file" ]; then
  tmp=$(mktemp "$workdir/out.XXXXXX")
  jq --arg k "$key" --arg v "$entry" '.values[$k] = $v' "$file" >"$tmp"
  mv "$tmp" "$file"
else
  mkdir -p "$(dirname "$file")"
  jq -n --arg id "$secret_id" --arg env "$environment" --arg k "$key" --arg v "$entry" \
    '{secretId: $id, environment: $env, values: {($k): $v}}' >"$file"
fi

# Deliberately says nothing about the value, not even its length.
echo "uploaded $key to s3://$bucket/$object_key ($shape)"
echo "recorded version $version_id in $file"
echo
echo "Nothing is deployed yet. Commit $file and open a PR — merging it is what"
echo "promotes this value, and reverting it is what rolls back."
