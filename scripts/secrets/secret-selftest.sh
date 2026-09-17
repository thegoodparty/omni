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

# --- fixture: throwaway keypair standing in for the KMS key ---

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 \
  -out "$root/priv.pem" 2>/dev/null
openssl rsa -pubout -in "$root/priv.pem" -out "$root/pub.pem" 2>/dev/null

# secret-lib.sh ignores these two unless SECRET_SELFTEST is set, so a stray
# export cannot redirect a real run.
export SECRET_SELFTEST=1
export SECRET_PUBLIC_KEY="$root/pub.pem"
export SECRET_FILES_DIR="$root/secrets"
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
entry=$(jq -r '.values.LONG_KEY' "$file")
case "$entry" in
  v1:env:*) ok 'long value selected the envelope format' ;;
  *) bad 'long value selected the envelope format' "got prefix ${entry%%:*}:${entry#*:}" ;;
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

jq -n '{secretId:"X", environment:"dev", values:{PLAIN_KEY:"just-a-plaintext-secret"}}' \
  >"$bad_dir/plain.dev.json"
reject 'rejects a committed plaintext value' "$bad_dir/plain.dev.json"

truncated=$(jq -r '.values.TRICKY_KEY' "$file" | cut -c1-200)
jq -n --arg v "$truncated" '{secretId:"X", environment:"dev", values:{T_KEY:$v}}' \
  >"$bad_dir/trunc.dev.json"
reject 'rejects a truncated ciphertext' "$bad_dir/trunc.dev.json"

jq -n '{secretId:"X", environment:"dev", values:{E_KEY:"v1:env:AAAA.BBBB"}}' \
  >"$bad_dir/badenv.dev.json"
reject 'rejects a malformed envelope' "$bad_dir/badenv.dev.json"

jq -n '{secretId:"X", environment:"prod", values:{K:"v1:rsa:AAAA"}}' \
  >"$bad_dir/mismatch.dev.json"
reject 'rejects environment that disagrees with the filename' "$bad_dir/mismatch.dev.json"

jq -n '{secretId:"X", environment:"dev", values:{"lower_case":"v1:rsa:AAAA"}}' \
  >"$bad_dir/case.dev.json"
reject 'rejects a lowercase key name' "$bad_dir/case.dev.json"

jq -n '{secretId:"X", environment:"dev", values:{}, oops:"typo"}' \
  >"$bad_dir/extra.dev.json"
reject 'rejects an unexpected top-level key' "$bad_dir/extra.dev.json"

printf 'DB_PASSWORD=hunter2\n' >"$bad_dir/leaked.env"
if validate >/dev/null 2>&1; then
  bad 'rejects a stray non-secret file in secrets/'
else
  ok 'rejects a stray non-secret file in secrets/'
fi
rm -f "$bad_dir/leaked.env"

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
printf %s "$long_value" | encrypt "$file" MAC_KEY >/dev/null
# Flip the first base64 character of the ciphertext body. base64 has no '.', so
# awk -F. splits the entry cleanly into wrapped / iv / mac / body.
tampered=$(jq -r '.values.MAC_KEY' "$file" | awk -F. '{
  first = substr($4, 1, 1);
  repl = (first == "A" ? "B" : "A");
  print $1 "." $2 "." $3 "." repl substr($4, 2)
}')
jq --arg v "$tampered" '.values.MAC_KEY = $v' "$file" >"$root/t.json" && mv "$root/t.json" "$file"
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
printf %s 'v' | encrypt --secret-id NO_SUCH_SECRET \
  "$SECRET_FILES_DIR/ghost.dev.json" GHOST_KEY >/dev/null
if sync_env dev >/dev/null 2>&1; then
  bad 'sync fails when the secret container does not exist'
else
  ok 'sync fails when the secret container does not exist'
fi
[ -f "$root/live/NO_SUCH_SECRET.json" ] &&
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
