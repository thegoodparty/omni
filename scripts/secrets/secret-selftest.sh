#!/usr/bin/env bash
# End-to-end self-test for the secret pipeline. No AWS credentials, no network.
#
# It generates a throwaway RSA-4096 keypair, stubs the `aws` CLI with a local
# implementation of the three calls the pipeline makes, and drives the real
# encrypt / validate / sync scripts against them. That covers the parts that are
# otherwise only exercised by a live release train, where a bug means a
# half-written prod secret.
#
# Runs in CI on every PR that touches scripts/secrets/. Run it by hand the same
# way: scripts/secrets/secret-selftest.sh
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT

pass=0
fail=0

ok() {
  pass=$((pass + 1))
  echo "  ok    $1"
}

bad() {
  fail=$((fail + 1))
  echo "  FAIL  $1"
  [ -n "${2:-}" ] && echo "        $2"
}

check_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    ok "$label"
  else
    bad "$label" "expected [$expected], got [$actual]"
  fi
}

check_contains() {
  local label="$1" needle="$2" haystack="$3"
  case "$haystack" in
    *"$needle"*) ok "$label" ;;
    *) bad "$label" "expected to find [$needle]" ;;
  esac
}

# --- fixture: throwaway keypair standing in for the KMS key ---

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 \
  -out "$root/priv.pem" 2>/dev/null
openssl rsa -pubout -in "$root/priv.pem" -out "$root/pub.pem" 2>/dev/null

# secret-lib.sh ignores these two unless SECRET_SELFTEST is set, so a stray
# export cannot redirect a real run.
export SECRET_SELFTEST=1
export SECRET_PUBLIC_KEY="$root/pub.pem"
export SECRET_FILES_DIR="$root/secrets"
export SECRET_PAYLOAD_BUCKET='selftest-payloads'
mkdir -p "$SECRET_FILES_DIR"

# --- fixture: stub `aws` ---
#
# Implements exactly the three calls ci-sync-secrets.sh makes. The "live" secret
# store is one JSON file per secret id under $root/live. Asymmetric KMS decrypt
# is the throwaway private key, with the same OAEP-SHA-256 parameters KMS uses —
# which is what makes this a real test of the wire format rather than a mock.
mkdir -p "$root/bin" "$root/live"
cat >"$root/bin/aws" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
service="$1"; shift
action="$1"; shift

arg() {
  local want="$1"; shift
  while [ $# -gt 0 ]; do
    [ "$1" = "$want" ] && { echo "$2"; return 0; }
    shift
  done
  return 1
}

case "$service:$action" in
  kms:decrypt)
    blob=$(arg --ciphertext-blob "$@") || exit 64
    echo "kms-calls" >> "$AWS_STUB_ROOT/counts.kms"
    openssl pkeyutl -decrypt -inkey "$AWS_STUB_ROOT/priv.pem" \
      -pkeyopt rsa_padding_mode:oaep \
      -pkeyopt rsa_oaep_md:sha256 \
      -pkeyopt rsa_mgf1_md:sha256 \
      -in "${blob#fileb://}" 2>/dev/null | openssl base64 -A
    ;;
  secretsmanager:get-secret-value)
    id=$(arg --secret-id "$@") || exit 64
    f="$AWS_STUB_ROOT/live/$id.json"
    [ -f "$f" ] || { echo "ResourceNotFoundException: $id" >&2; exit 254; }
    cat "$f"
    ;;
  secretsmanager:put-secret-value)
    id=$(arg --secret-id "$@") || exit 64
    src=$(arg --secret-string "$@") || exit 64
    echo "put" >> "$AWS_STUB_ROOT/counts.put"
    cp "${src#file://}" "$AWS_STUB_ROOT/live/$id.json"
    echo '{"VersionId":"stub"}'
    ;;
  # Versioned object store: $root/s3/<object key>/<version id>. Every put mints
  # a new version and leaves the old ones readable, which is the property the
  # whole promotion model rests on, so the stub has to honor it rather than
  # overwrite.
  s3api:put-object)
    key=$(arg --key "$@") || exit 64
    body=$(arg --body "$@") || exit 64
    n=$(( $(cat "$AWS_STUB_ROOT/s3.seq" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "$AWS_STUB_ROOT/s3.seq"
    # Shaped like a real S3 version id, including the characters that make a
    # naive charset check fail: base64-ish with + / = . _ -
    vid="3HL4kqtJlcpXroDTDmJ+rmSpXd3dIbrHY=.v_${n}-x"
    mkdir -p "$AWS_STUB_ROOT/s3/$key"
    cp "$body" "$AWS_STUB_ROOT/s3/$key/$vid"
    echo "$vid"
    ;;
  s3api:get-object)
    key=$(arg --key "$@") || exit 64
    vid=$(arg --version-id "$@") || exit 64
    out="${!#}"   # the aws CLI takes the destination as a trailing positional
    f="$AWS_STUB_ROOT/s3/$key/$vid"
    [ -f "$f" ] || { echo "NoSuchVersion: $key ($vid)" >&2; exit 254; }
    cp "$f" "$out"
    echo '{"VersionId":"stub"}'
    ;;
  *)
    echo "stub aws: unexpected call $service $action" >&2
    exit 99
    ;;
esac
STUB
chmod +x "$root/bin/aws"
cp "$root/priv.pem" "$root/priv.pem" 2>/dev/null || true
export AWS_STUB_ROOT="$root"
export PATH="$root/bin:$PATH"

encrypt() { "$here/secret-encrypt.sh" "$@"; }
validate() { "$here/validate-secret-files.sh" "$@"; }
sync_env() { "$here/ci-sync-secrets.sh" "$@"; }

# jq -j, not -r: -r appends a newline, which would make every comparison here
# disagree with the value that was actually stored.
live_value() {
  jq -j --arg k "$2" 'if has($k) then .[$k] else "__ABSENT__" end' "$root/live/$1.json"
}

put_count() { wc -l <"$root/counts.put" 2>/dev/null | tr -d ' ' || echo 0; }

# What the manifest pins for a key, e.g. "v1:s3:3HL4...".
manifest_entry() {
  jq -r --arg k "$2" '.values[$k]' "$1"
}

# The ciphertext the manifest points at, read straight out of the stub bucket.
# Lets the tests assert on the payload format, which is no longer in the repo.
payload_of() {
  local manifest="$1" key="$2" secret_id environment version_id
  secret_id=$(jq -r '.secretId' "$manifest")
  environment=$(jq -r '.environment' "$manifest")
  version_id=$(manifest_entry "$manifest" "$key")
  version_id="${version_id#v1:s3:}"
  cat "$root/s3/$environment/$secret_id/$key/$version_id"
}

# ============================================================
echo 'crypto roundtrip'
# ============================================================

echo '{}' >"$root/live/GP_API_DEV.json"
file="$SECRET_FILES_DIR/gp-api.dev.json"

short_value='sk-test-0123456789-short'
printf %s "$short_value" | encrypt --secret-id GP_API_DEV "$file" SHORT_KEY >/dev/null
validate "$file" >/dev/null 2>&1 && ok 'short value validates' || bad 'short value validates'
sync_env dev >/dev/null 2>&1
check_eq 'short value roundtrips through sync' "$short_value" "$(live_value GP_API_DEV SHORT_KEY)"

# Over the 446-byte RSA-OAEP ceiling, so this exercises the envelope path. A PEM
# private key is the realistic case (AI_SECRETS_PROD already holds one).
long_value=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null)
printf %s "$long_value" | encrypt "$file" LONG_KEY >/dev/null
case "$(payload_of "$file" LONG_KEY)" in
  v1:env:*) ok 'long value selected the envelope format' ;;
  *) bad 'long value selected the envelope format' ;;
esac
sync_env dev >/dev/null 2>&1
check_eq 'long value roundtrips through the envelope' "$long_value" "$(live_value GP_API_DEV LONG_KEY)"

# Values that break naive shell/JSON handling.
tricky='a"b'"'"'c\d$e`f{"json":true}
second line	tab ünïcödé'
printf %s "$tricky" | encrypt "$file" TRICKY_KEY >/dev/null
sync_env dev >/dev/null 2>&1
check_eq 'value with quotes, newlines, $, backticks and unicode survives' \
  "$tricky" "$(live_value GP_API_DEV TRICKY_KEY)"

# ============================================================
echo 'trailing newline handling'
# ============================================================

printf 'value-with-newline\n' | encrypt "$file" STRIPPED_KEY >/dev/null
sync_env dev >/dev/null 2>&1
check_eq 'one trailing newline is stripped by default' \
  'value-with-newline' "$(live_value GP_API_DEV STRIPPED_KEY)"

printf 'value-with-newline\n' | encrypt --raw "$file" RAW_KEY >/dev/null
sync_env dev >/dev/null 2>&1
check_eq '--raw keeps the trailing newline' \
  "$(printf 'value-with-newline\n')" "$(live_value GP_API_DEV RAW_KEY)"

# Exactly ONE newline, not all of them: `printf %s "$(cat ...)"` would strip all
# three and silently store something other than what was encrypted. "multi\n\n\n"
# is 8 bytes in, so 7 back out. Piped into wc rather than compared as a string,
# because command substitution would itself eat the trailing newlines.
printf 'multi\n\n\n' | encrypt "$file" MULTI_NL_KEY >/dev/null
sync_env dev >/dev/null 2>&1
check_eq 'only one trailing newline is stripped, not all of them' \
  '7' "$(live_value GP_API_DEV MULTI_NL_KEY | wc -c | tr -d ' ')"

if printf '\n' | encrypt "$file" ONLY_NL_KEY >/dev/null 2>&1; then
  bad 'a lone newline counts as empty and is refused'
else
  ok 'a lone newline counts as empty and is refused'
fi

# ============================================================
echo 'the manifest is the promotion'
# ============================================================

# What is committed must be a version id and nothing else. This repo is public,
# so a ciphertext in the manifest is a payload that can never be withdrawn.
case "$(manifest_entry "$file" SHORT_KEY)" in
  v1:s3:*) ok 'the manifest records a version id, not a ciphertext' ;;
  *) bad 'the manifest records a version id, not a ciphertext' ;;
esac
check_eq 'the ciphertext itself is not in the manifest' \
  '0' "$(grep -c 'v1:rsa:\|v1:env:' "$file" || true)"

# The property the whole design rests on: uploading is unreviewed, so it must be
# inert. A payload in the bucket that no merged manifest points at cannot reach
# a running service.
printf %s 'sk-test-rotated-later' | encrypt "$file" PROMOTE_KEY >/dev/null
sync_env dev >/dev/null 2>&1
check_eq 'the baseline value is live before the test' \
  'sk-test-rotated-later' "$(live_value GP_API_DEV PROMOTE_KEY)"

cp "$file" "$root/manifest-pinned.json"
printf %s 'uploaded-but-never-promoted' | encrypt "$file" PROMOTE_KEY >/dev/null
promoted_entry=$(manifest_entry "$file" PROMOTE_KEY)
cp "$root/manifest-pinned.json" "$file" # un-promote: keep the old version pinned
sync_env dev >/dev/null 2>&1
check_eq 'an uploaded but unpromoted payload is never deployed' \
  'sk-test-rotated-later' "$(live_value GP_API_DEV PROMOTE_KEY)"

# Promoting it is a one-line manifest change, which is what a PR reviews.
jq --arg v "$promoted_entry" '.values.PROMOTE_KEY = $v' "$file" >"$root/tmp.json"
mv "$root/tmp.json" "$file"
sync_env dev >/dev/null 2>&1
check_eq 'promoting the version id deploys it' \
  'uploaded-but-never-promoted' "$(live_value GP_API_DEV PROMOTE_KEY)"

# And reverting that change is a rollback, with no re-encryption: the older
# version is still in the bucket, so the previous value comes straight back.
cp "$root/manifest-pinned.json" "$file"
sync_env dev >/dev/null 2>&1
check_eq 'reverting the manifest rolls the value back' \
  'sk-test-rotated-later' "$(live_value GP_API_DEV PROMOTE_KEY)"

# A version id that does not exist must fail loudly, never fall back to latest.
jq '.values.PROMOTE_KEY = "v1:s3:no-such-version"' "$file" >"$root/tmp.json"
mv "$root/tmp.json" "$file"
if sync_env dev >/dev/null 2>&1; then
  bad 'a missing version id fails instead of falling back'
else
  ok 'a missing version id fails instead of falling back'
fi
check_eq 'the live value survived the failed sync' \
  'sk-test-rotated-later' "$(live_value GP_API_DEV PROMOTE_KEY)"
cp "$root/manifest-pinned.json" "$file"

# ============================================================
echo 'idempotency'
# ============================================================

sync_env dev >/dev/null 2>&1
before=$(put_count)
out=$(sync_env dev 2>&1)
after=$(put_count)
check_eq 'a second sync writes nothing' "$before" "$after"
case "$out" in
  *'no changes'*) ok 'a second sync reports no changes' ;;
  *) bad 'a second sync reports no changes' "$out" ;;
esac

# Re-encrypting the SAME value must still be a no-op, even though OAEP makes the
# ciphertext different every time. This is the check that keeps the release train
# from cutting a new secret version on every run forever.
printf %s "$short_value" | encrypt "$file" SHORT_KEY >/dev/null
before=$(put_count)
sync_env dev >/dev/null 2>&1
after=$(put_count)
check_eq 're-encrypting an unchanged value is still a no-op' "$before" "$after"

printf %s 'sk-test-rotated' | encrypt "$file" SHORT_KEY >/dev/null
sync_env dev >/dev/null 2>&1
check_eq 'a rotated value is written' 'sk-test-rotated' "$(live_value GP_API_DEV SHORT_KEY)"

# ============================================================
echo 'no implicit pruning'
# ============================================================

jq '.MANUAL_LEGACY_KEY = "set-by-hand-years-ago"' "$root/live/GP_API_DEV.json" \
  >"$root/tmp.json" && mv "$root/tmp.json" "$root/live/GP_API_DEV.json"
out=$(sync_env dev 2>&1)
check_eq 'an undeclared live key is preserved' \
  'set-by-hand-years-ago' "$(live_value GP_API_DEV MANUAL_LEGACY_KEY)"
case "$out" in
  *MANUAL_LEGACY_KEY*) ok 'an undeclared live key is reported' ;;
  *) bad 'an undeclared live key is reported' "$out" ;;
esac

# ============================================================
echo 'environment isolation'
# ============================================================

echo '{}' >"$root/live/GP_API_PROD.json"
printf %s 'prod-only-value' | encrypt --secret-id GP_API_PROD \
  "$SECRET_FILES_DIR/gp-api.prod.json" PROD_KEY >/dev/null
sync_env dev >/dev/null 2>&1
check_eq 'syncing dev does not touch a prod secret' \
  '__ABSENT__' "$(live_value GP_API_PROD PROD_KEY)"
sync_env prod >/dev/null 2>&1
check_eq 'syncing prod writes the prod secret' \
  'prod-only-value' "$(live_value GP_API_PROD PROD_KEY)"

# A dev file must not be able to name a prod secret. The dev sync runs before
# the E2E, so this would be a route to writing a prod credential without the
# E2E gate — and the sync role can PutSecretValue on both environments.
if printf %s 'x' | encrypt --secret-id GP_API_PROD \
  "$SECRET_FILES_DIR/crossenv.dev.json" X_KEY >/dev/null 2>&1; then
  bad 'encrypt refuses a dev file targeting a prod secret'
else
  ok 'encrypt refuses a dev file targeting a prod secret'
fi
rm -f "$SECRET_FILES_DIR/crossenv.dev.json"

# Same invariant, enforced on a hand-written file that bypassed the script.
jq -n --arg v "$(jq -r '.values.SHORT_KEY' "$file")" \
  '{secretId:"GP_API_PROD", environment:"dev", values:{X_KEY:$v}}' \
  >"$SECRET_FILES_DIR/crossenv.dev.json"
if validate "$SECRET_FILES_DIR/crossenv.dev.json" >/dev/null 2>&1; then
  bad 'validation rejects a dev file targeting a prod secret'
else
  ok 'validation rejects a dev file targeting a prod secret'
fi
rm -f "$SECRET_FILES_DIR/crossenv.dev.json"

# ============================================================
echo 'verify-only'
# ============================================================

# The dev stage runs this over the prod files, so it must prove the ciphertext
# decrypts without reading or writing the live secret.
prod_file="$SECRET_FILES_DIR/gp-api.prod.json"

verify_out=$(sync_env prod --verify-only 2>&1)
check_contains 'verify-only reports the keys it decrypted' \
  'key(s) decrypt cleanly' "$verify_out"
check_contains 'verify-only says nothing was written' \
  'nothing was read or written' "$verify_out"

prod_live_before=$(cat "$root/live/GP_API_PROD.json")
printf %s 'rotated-in-verify-test' | encrypt "$prod_file" PROD_KEY >/dev/null
sync_env prod --verify-only >/dev/null 2>&1
check_eq 'verify-only does not write a changed value' \
  "$prod_live_before" "$(cat "$root/live/GP_API_PROD.json")"

# It must catch exactly what the dev sync cannot: a prod ciphertext encrypted
# against a key that is no longer the one CI decrypts with.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out "$root/stale.pem" 2>/dev/null
openssl rsa -pubout -in "$root/stale.pem" -out "$root/stale.pub.pem" 2>/dev/null
SECRET_PUBLIC_KEY="$root/stale.pub.pem" \
  bash -c "printf %s stale | '$here/secret-encrypt.sh' '$prod_file' STALE_PROD_KEY" >/dev/null
if sync_env prod --verify-only >/dev/null 2>&1; then
  bad 'verify-only fails on a stale-key prod ciphertext'
else
  ok 'verify-only fails on a stale-key prod ciphertext'
fi
jq 'del(.values.STALE_PROD_KEY)' "$prod_file" >"$root/tmp.json"
mv "$root/tmp.json" "$prod_file"

# A prod-side problem must not be able to block a dev deploy, so verify-only
# never touches Secrets Manager — not even to read.
mv "$root/live/GP_API_PROD.json" "$root/live-prod-backup.json"
if sync_env prod --verify-only >/dev/null 2>&1; then
  ok 'verify-only ignores the live secret entirely'
else
  bad 'verify-only ignores the live secret entirely'
fi
mv "$root/live-prod-backup.json" "$root/live/GP_API_PROD.json"

# ============================================================
echo 'dev/prod drift'
# ============================================================

# "One key, every environment" is a documented rule that nothing else enforces.
# A key in only one file passes a green train and is missing at runtime.
printf %s 'dev-only-value' | encrypt "$file" DEV_ONLY_KEY >/dev/null
drift_out=$(validate 2>&1)
check_contains 'a dev-only key is reported as drift' \
  'declared for dev but not prod' "$drift_out"
check_contains 'the drifting key is named' 'DEV_ONLY_KEY' "$drift_out"
check_contains 'a prod-only key is reported as drift' \
  'declared for prod but not dev: PROD_KEY' "$drift_out"

# Reported, not rejected: one-sided keys are legitimate mid-migration.
if validate >/dev/null 2>&1; then
  ok 'drift is a warning, not a validation failure'
else
  bad 'drift is a warning, not a validation failure'
fi

# ============================================================
echo 'unreadable live secret'
# ============================================================

# If the live value is not a JSON object, the read-modify-write cannot preserve
# the keys this file does not declare — so it must refuse, not start from {} and
# silently drop them.
cp "$root/live/GP_API_DEV.json" "$root/live-backup.json"
printf %s '"not-an-object"' >"$root/live/GP_API_DEV.json"
if sync_env dev >/dev/null 2>&1; then
  bad 'sync refuses a live secret that is not a JSON object'
else
  ok 'sync refuses a live secret that is not a JSON object'
fi
check_eq 'the unreadable live secret was left untouched' \
  '"not-an-object"' "$(cat "$root/live/GP_API_DEV.json")"
# Restore, because the sections below drive sync against this secret.
mv "$root/live-backup.json" "$root/live/GP_API_DEV.json"

# ============================================================
echo 'validation rejects bad input'
# ============================================================

reject() {
  local label="$1" f="$2"
  if validate "$f" >/dev/null 2>&1; then
    bad "$label"
  else
    ok "$label"
  fi
  rm -f "$f"
}

bad_dir="$SECRET_FILES_DIR"

jq -n '{secretId:"X_DEV", environment:"dev", values:{PLAIN_KEY:"just-a-plaintext-secret"}}' \
  >"$bad_dir/plain.dev.json"
reject 'rejects a committed plaintext value' "$bad_dir/plain.dev.json"

# The public-repo guard: a payload belongs in the bucket, so a real ciphertext
# in a manifest is rejected even though it is perfectly well-formed.
jq -n --arg v "$(payload_of "$file" SHORT_KEY)" \
  '{secretId:"X_DEV", environment:"dev", values:{RAW_KEY:$v}}' \
  >"$bad_dir/raw.dev.json"
reject 'rejects a raw ciphertext committed instead of a version id' "$bad_dir/raw.dev.json"

jq -n '{secretId:"X_DEV", environment:"dev", values:{E_KEY:"v1:env:AAAA.BBBB"}}' \
  >"$bad_dir/badenv.dev.json"
reject 'rejects a raw envelope committed instead of a version id' "$bad_dir/badenv.dev.json"

# `null` is what S3 answers when versioning is off. Accepting it would make the
# manifest point at mutable bytes, so the promotion would stop being a promotion.
jq -n '{secretId:"X_DEV", environment:"dev", values:{N_KEY:"v1:s3:null"}}' \
  >"$bad_dir/null.dev.json"
reject 'rejects a null version id (bucket not versioned)' "$bad_dir/null.dev.json"

jq -n '{secretId:"X_DEV", environment:"dev", values:{B_KEY:"v1:s3:has spaces"}}' \
  >"$bad_dir/badvid.dev.json"
reject 'rejects a malformed version id' "$bad_dir/badvid.dev.json"

jq -n '{secretId:"X_PROD", environment:"prod", values:{K:"v1:s3:abc123"}}' \
  >"$bad_dir/mismatch.dev.json"
reject 'rejects environment that disagrees with the filename' "$bad_dir/mismatch.dev.json"

jq -n '{secretId:"X_DEV", environment:"dev", values:{"lower_case":"v1:s3:abc123"}}' \
  >"$bad_dir/case.dev.json"
reject 'rejects a lowercase key name' "$bad_dir/case.dev.json"

jq -n '{secretId:"X_DEV", environment:"dev", values:{}, oops:"typo"}' \
  >"$bad_dir/extra.dev.json"
reject 'rejects an unexpected top-level key' "$bad_dir/extra.dev.json"

printf 'DB_PASSWORD=hunter2\n' >"$bad_dir/leaked.env"
if validate >/dev/null 2>&1; then
  bad 'rejects a stray non-secret file in secrets/'
else
  ok 'rejects a stray non-secret file in secrets/'
fi
rm -f "$bad_dir/leaked.env"

# secrets/ carries its own AGENTS.md (plus the CLAUDE.md symlink the sync script
# maintains, and a README for anyone browsing). That is what stops an agent
# editing these files from going looking for AWS access, so the stray-file check
# must not treat the docs as a leak.
printf '# docs\n' >"$bad_dir/AGENTS.md"
printf '# docs\n' >"$bad_dir/README.md"
ln -sf AGENTS.md "$bad_dir/CLAUDE.md"
if validate >/dev/null 2>&1; then
  ok "secrets/ may carry its own AGENTS.md, CLAUDE.md and README"
else
  bad "secrets/ may carry its own AGENTS.md, CLAUDE.md and README"
fi
rm -f "$bad_dir/AGENTS.md" "$bad_dir/README.md" "$bad_dir/CLAUDE.md"

# ============================================================
echo 'failure modes'
# ============================================================

# A ciphertext that is well formed but encrypted to a different key passes
# validation (nothing can tell without decrypting) and must fail the sync loudly
# rather than writing a partial secret.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out "$root/other.pem" 2>/dev/null
openssl rsa -pubout -in "$root/other.pem" -out "$root/other.pub.pem" 2>/dev/null
SECRET_PUBLIC_KEY="$root/other.pub.pem" \
  bash -c "printf %s wrong-key-value | '$here/secret-encrypt.sh' '$file' WRONG_KEY" >/dev/null
validate "$file" >/dev/null 2>&1 &&
  ok 'a wrong-key ciphertext still passes structural validation' ||
  bad 'a wrong-key ciphertext still passes structural validation'
if sync_env dev >/dev/null 2>&1; then
  bad 'sync fails on a ciphertext encrypted to the wrong key'
else
  ok 'sync fails on a ciphertext encrypted to the wrong key'
fi
jq 'del(.values.WRONG_KEY)' "$file" >"$root/t.json" && mv "$root/t.json" "$file"

# A tampered envelope body must be caught by the MAC, not silently decrypted.
# Now that payloads live in S3, the thing to tamper with is the object — which is
# also the realistic threat: the bucket is a surface the repo's review cannot see,
# so the MAC is what stands between a modified object and a deployed value.
printf %s "$long_value" | encrypt "$file" MAC_KEY >/dev/null
mac_version=$(manifest_entry "$file" MAC_KEY)
mac_object="$root/s3/dev/GP_API_DEV/MAC_KEY/${mac_version#v1:s3:}"
# Flip the first base64 character of the ciphertext body. base64 has no '.', so
# awk -F. splits the payload cleanly into wrapped / iv / mac / body.
awk -F. '{
  first = substr($4, 1, 1);
  repl = (first == "A" ? "B" : "A");
  print $1 "." $2 "." $3 "." repl substr($4, 2)
}' <"$mac_object" >"$root/t.payload"
printf %s "$(cat "$root/t.payload")" >"$mac_object"
# Captured into a variable rather than piped into grep: `pipefail` is on, and a
# failing sync (which is the expected outcome here) would make the pipeline
# report failure even when grep matched.
out=$(sync_env dev 2>&1)
case "$out" in
  *'MAC does not verify'*) ok 'a tampered envelope body is caught by the MAC' ;;
  *) bad 'a tampered envelope body is caught by the MAC' "$out" ;;
esac
jq 'del(.values.MAC_KEY)' "$file" >"$root/t.json" && mv "$root/t.json" "$file"

# A missing secret container is IaC's problem, and must not be auto-created.
printf %s 'v' | encrypt --secret-id NO_SUCH_SECRET_DEV \
  "$SECRET_FILES_DIR/ghost.dev.json" GHOST_KEY >/dev/null
if sync_env dev >/dev/null 2>&1; then
  bad 'sync fails when the secret container does not exist'
else
  ok 'sync fails when the secret container does not exist'
fi
[ -f "$root/live/NO_SUCH_SECRET_DEV.json" ] &&
  bad 'sync did not create the missing secret' ||
  ok 'sync did not create the missing secret'
rm -f "$SECRET_FILES_DIR/ghost.dev.json"

# ============================================================
echo 'guards'
# ============================================================

if printf %s '' | encrypt "$file" EMPTY_KEY >/dev/null 2>&1; then
  bad 'refuses an empty value'
else
  ok 'refuses an empty value'
fi

if printf %s 'x' | encrypt "$file" 'bad-name' >/dev/null 2>&1; then
  bad 'refuses an invalid key name'
else
  ok 'refuses an invalid key name'
fi

if SECRET_PUBLIC_KEY="$root/nope.pem" \
  bash -c "printf %s x | '$here/secret-encrypt.sh' '$file' K" >/dev/null 2>&1; then
  bad 'refuses to run without the committed public key'
else
  ok 'refuses to run without the committed public key'
fi

# A sentinel unlikely to collide with the script's own wording, unlike "x".
sentinel='QQsentinelvalueQQ'
out=$(printf %s "$sentinel" | encrypt "$file" LEAK_CHECK 2>&1)
case "$out" in
  *"$sentinel"*) bad 'encrypt output does not echo the value' "$out" ;;
  *) ok 'encrypt output does not echo the value' ;;
esac

echo
echo "self-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
